using System.Collections.Concurrent;
using System.IO.Compression;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Pitflix.Core.Services;

public sealed record SubDlSubtitleResult(
    string ReleaseName,
    string Language,
    string Url,
    string FullLink,
    bool IsHearingImpaired,
    string Type);

public sealed record SubDlSearchOutcome(IReadOnlyList<SubDlSubtitleResult> Items, string? Error);

/// <summary>SubDL.com subtitle search and download client (api.subdl.com/api/v1/subtitles).</summary>
public sealed class SubDlClient : IDisposable
{
    // ── Process-lifetime cache shared across all SubDlClient instances ──────
    // Key = canonical search key; Value = (expiry, result).
    private static readonly ConcurrentDictionary<string, (DateTime Expiry, SubDlSearchOutcome Result)>
        _cache = new(StringComparer.Ordinal);

    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(10);

    // Shared across instances — SubDlClient is constructed fresh per request (Program.cs),
    // so a per-instance HttpClient would create a new socket pool on every search/download.
    private static readonly HttpClient _http = CreateSharedClient();
    private readonly string? _apiKey;

    private static HttpClient CreateSharedClient()
    {
        var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0");
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        http.Timeout = TimeSpan.FromSeconds(25);
        return http;
    }

    public SubDlClient(string? apiKey = null)
    {
        _apiKey = apiKey?.Trim();
    }

    // ── Search ──────────────────────────────────────────────────────────────

    public async Task<SubDlSearchOutcome> SearchAsync(
        string? title,
        string? imdbId,
        int? tmdbId,
        string mediaType,
        int? season,
        int? episode,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
            return new SubDlSearchOutcome([], "SubDL API key not configured.");

        // ── Pick the single best identifier to avoid 422 ───────────────────
        // Priority: imdb_id > tmdb_id > film_name
        string? useImdbId = string.IsNullOrWhiteSpace(imdbId) ? null : imdbId!.Trim();
        bool    useTmdbId = tmdbId is > 0 && useImdbId is null;
        bool    useTitle  = !string.IsNullOrWhiteSpace(title) && useImdbId is null && !useTmdbId;

        var isTv = mediaType.Equals("Series", StringComparison.OrdinalIgnoreCase) ||
                   mediaType.Equals("episode", StringComparison.OrdinalIgnoreCase);

        // ── Cache key — include episode so S2E1 and S2E5 are stored separately ──
        var cacheKey = $"{useImdbId ?? ""}|{(useTmdbId ? tmdbId : 0)}|{(useTitle ? title?.Trim() : "")}|{(isTv ? "tv" : "movie")}|s{season ?? 0}e{episode ?? 0}";

        if (_cache.TryGetValue(cacheKey, out var cached) && cached.Expiry > DateTime.UtcNow)
            return cached.Result;

        // ── Helper: build base query params ───────────────────────────────
        List<string> BaseParams() =>
        [
            $"api_key={Uri.EscapeDataString(_apiKey)}",
            "languages=AR,EN",
            $"type={(isTv ? "tv" : "movie")}",
            "subs_per_page=30",
        ];

        List<string> AddIdentifier(List<string> qb)
        {
            if (useImdbId is not null)       qb.Add($"imdb_id={Uri.EscapeDataString(useImdbId)}");
            else if (useTmdbId)              qb.Add($"tmdb_id={tmdbId!.Value}");
            else if (useTitle)               qb.Add($"film_name={Uri.EscapeDataString(title!.Trim())}");
            return qb;
        }

        if (!useTitle && useImdbId is null && !useTmdbId)
            return new SubDlSearchOutcome([], "SubDL: no usable identifier (provide imdbId, tmdbId, or title).");

        // ── Query 1: episode-specific (sends season + episode number) ──────
        // Returning results for exactly the episode the user has open, e.g. S02E01.
        // Previously episode_number was omitted, causing SubDL to return only the
        // 5 newest uploads (E13–E15 + season pack) and burying E01-specific files.
        SubDlSearchOutcome epOutcome = new([], null);
        if (isTv && season.HasValue && episode.HasValue && episode.Value > 0)
        {
            var epQb = AddIdentifier(BaseParams());
            epQb.Add($"season_number={season.Value}");
            epQb.Add($"episode_number={episode.Value}");
            var epUrl = "https://api.subdl.com/api/v1/subtitles?" + string.Join("&", epQb);
            try { epOutcome = await FetchWithRetryAsync(epUrl, cancellationToken).ConfigureAwait(false); }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex) { epOutcome = new SubDlSearchOutcome([], ex.Message); }
        }

        // ── Query 2: season-level (no episode_number) ─────────────────────
        // Gets full-season packs and any other episode files not caught above.
        var seasonQb = AddIdentifier(BaseParams());
        if (isTv && season.HasValue) seasonQb.Add($"season_number={season.Value}");
        var seasonUrl = "https://api.subdl.com/api/v1/subtitles?" + string.Join("&", seasonQb);
        SubDlSearchOutcome seasonOutcome;
        try { seasonOutcome = await FetchWithRetryAsync(seasonUrl, cancellationToken).ConfigureAwait(false); }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex) { seasonOutcome = new SubDlSearchOutcome([], ex.Message); }

        // ── Merge: episode-specific results first, then season-level deduped ──
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var merged = new List<SubDlSubtitleResult>();
        foreach (var r in epOutcome.Items)
            if (seen.Add(r.FullLink)) merged.Add(r);
        foreach (var r in seasonOutcome.Items)
            if (seen.Add(r.FullLink)) merged.Add(r);

        var outcome = merged.Count > 0
            ? new SubDlSearchOutcome(ParseMerged(merged), null)
            : seasonOutcome.Error is not null ? seasonOutcome
            : epOutcome.Error is not null ? epOutcome
            : new SubDlSearchOutcome([], null);

        // ── Fallback to title search when ID yields no results ─────────────
        if (outcome.Items.Count == 0 && outcome.Error is null
            && (useTmdbId || useImdbId is not null)
            && !string.IsNullOrWhiteSpace(title))
        {
            var fbQb = new List<string>
            {
                $"api_key={Uri.EscapeDataString(_apiKey)}",
                "languages=AR,EN",
                $"type={(isTv ? "tv" : "movie")}",
                "subs_per_page=30",
                $"film_name={Uri.EscapeDataString(title.Trim())}",
            };
            if (isTv && season.HasValue)  fbQb.Add($"season_number={season.Value}");
            if (isTv && episode.HasValue && episode.Value > 0) fbQb.Add($"episode_number={episode.Value}");

            var fbUrl = "https://api.subdl.com/api/v1/subtitles?" + string.Join("&", fbQb);
            try
            {
                var fbOutcome = await FetchWithRetryAsync(fbUrl, cancellationToken).ConfigureAwait(false);
                if (fbOutcome.Items.Count > 0 || fbOutcome.Error is not null)
                    outcome = fbOutcome;
            }
            catch (OperationCanceledException) { throw; }
            catch { /* ignore fallback failures */ }
        }

        var ttl = outcome.Error is null ? CacheTtl : TimeSpan.FromMinutes(2);
        _cache[cacheKey] = (DateTime.UtcNow + ttl, outcome);
        return outcome;
    }

    /// <summary>Sort a pre-merged list: Arabic first, then English, capped at 30 each.</summary>
    private static IReadOnlyList<SubDlSubtitleResult> ParseMerged(IReadOnlyList<SubDlSubtitleResult> list)
    {
        static bool IsArabic(string l) =>
            l.StartsWith("ar", StringComparison.OrdinalIgnoreCase) ||
            l.Contains("arabic", StringComparison.OrdinalIgnoreCase);
        static bool IsEnglish(string l) =>
            l.StartsWith("en", StringComparison.OrdinalIgnoreCase) ||
            l.Contains("english", StringComparison.OrdinalIgnoreCase);

        var arabic  = list.Where(x => IsArabic(x.Language)).Take(30).ToList();
        var english = list.Where(x => IsEnglish(x.Language)).Take(30).ToList();
        return arabic.Concat(english).ToList();
    }

    // ── HTTP with 429 retry (up to 3 attempts, exponential back-off) ───────

    private async Task<SubDlSearchOutcome> FetchWithRetryAsync(string url, CancellationToken ct)
    {
        int[] backoffSecs = [5, 15, 30];
        HttpResponseMessage? lastResp = null;

        for (var attempt = 0; attempt <= backoffSecs.Length; attempt++)
        {
            lastResp?.Dispose();
            lastResp = await _http.GetAsync(new Uri(url), ct).ConfigureAwait(false);

            var statusCode = (int)lastResp.StatusCode;

            if (statusCode == 429)
            {
                if (attempt == backoffSecs.Length)
                    break; // no more retries

                // Honour Retry-After if present, else use our exponential schedule
                int waitSec = backoffSecs[attempt];
                if (lastResp.Headers.RetryAfter?.Delta is TimeSpan delta)
                    waitSec = Math.Max(waitSec, Math.Min((int)delta.TotalSeconds + 1, 60));

                lastResp.Dispose();
                lastResp = null;
                await Task.Delay(TimeSpan.FromSeconds(waitSec), ct).ConfigureAwait(false);
                continue;
            }

            if (!lastResp.IsSuccessStatusCode)
            {
                // Include response body for debugging 422 / other errors
                var body = await lastResp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                var snippet = body.Length > 200 ? body[..200] : body;
                lastResp.Dispose();
                return new SubDlSearchOutcome([], $"SubDL HTTP {statusCode}: {snippet}");
            }

            var json = await lastResp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            lastResp.Dispose();
            return new SubDlSearchOutcome(ParseResponse(json), null);
        }

        lastResp?.Dispose();
        return new SubDlSearchOutcome([], "SubDL rate-limited (429) — all retries exhausted. Try again later.");
    }

    // ── Response parser ─────────────────────────────────────────────────────

    private static IReadOnlyList<SubDlSubtitleResult> ParseResponse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            // { "status": false } → key rejected or no results
            if (root.TryGetProperty("status", out var st) && st.ValueKind == JsonValueKind.False)
                return [];

            // Collect all subtitle elements from whichever structure SubDL returns:
            //   Flat:   { "subtitles": [ ... ] }
            //   Nested: { "results": [ { "subtitles": [ ... ] }, ... ] }
            var subsElements = new List<JsonElement>();

            if (root.TryGetProperty("subtitles", out var flatSubs) && flatSubs.ValueKind == JsonValueKind.Array)
            {
                foreach (var el in flatSubs.EnumerateArray()) subsElements.Add(el);
            }
            else if (root.TryGetProperty("results", out var results) && results.ValueKind == JsonValueKind.Array)
            {
                foreach (var result in results.EnumerateArray())
                {
                    if (result.TryGetProperty("subtitles", out var nestedSubs) && nestedSubs.ValueKind == JsonValueKind.Array)
                        foreach (var el in nestedSubs.EnumerateArray()) subsElements.Add(el);
                }
            }

            if (subsElements.Count == 0) return [];

            var list = new List<SubDlSubtitleResult>();
            foreach (var item in subsElements)
            {
                var releaseName = GetStr(item, "release_name") ?? GetStr(item, "name") ?? "(no name)";
                var lang        = GetStr(item, "lang") ?? GetStr(item, "language") ?? "";
                var url         = GetStr(item, "url") ?? "";
                var fullLink    = GetStr(item, "full_link")
                                  ?? (string.IsNullOrEmpty(url) ? "" : $"https://dl.subdl.com{url}");
                var hi = item.TryGetProperty("hi", out var hiEl) && hiEl.ValueKind == JsonValueKind.True;
                if (!hi && item.TryGetProperty("isHearingImpaired", out var hiEl2))
                    hi = hiEl2.ValueKind == JsonValueKind.True;
                var type = GetStr(item, "type") ?? "srt";

                if (string.IsNullOrWhiteSpace(fullLink)) continue;
                list.Add(new SubDlSubtitleResult(releaseName, lang, url, fullLink, hi, type));
            }

            return ParseMerged(list);
        }
        catch
        {
            return [];
        }
    }

    private static string? GetStr(JsonElement el, string key) =>
        el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()?.Trim()
            : null;

    // ── Download ────────────────────────────────────────────────────────────

    /// <summary>
    /// Downloads a SubDL subtitle zip from <paramref name="fullLink"/>,
    /// extracts the first .srt or .ass entry, and saves it next to <paramref name="videoFilePath"/>.
    /// </summary>
    public async Task<(bool Ok, string? Path, string? Error)> DownloadAsync(
        string fullLink,
        string videoFilePath,
        string language,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(fullLink) || string.IsNullOrWhiteSpace(videoFilePath))
            return (false, null, "Invalid request.");

        try
        {
            var bytes = await _http.GetByteArrayAsync(new Uri(fullLink), cancellationToken).ConfigureAwait(false);
            using var ms      = new MemoryStream(bytes);
            using var archive = new ZipArchive(ms, ZipArchiveMode.Read);

            var entry = archive.Entries
                .Where(e => e.Name.EndsWith(".srt", StringComparison.OrdinalIgnoreCase) ||
                            e.Name.EndsWith(".ass", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(e => e.Name.EndsWith(".srt", StringComparison.OrdinalIgnoreCase))
                .FirstOrDefault();

            if (entry == null)
                return (false, null, "No .srt/.ass file found in the downloaded zip.");

            var dir = System.IO.Path.GetDirectoryName(videoFilePath);
            if (string.IsNullOrEmpty(dir))
                return (false, null, "Invalid video path.");

            var baseName = System.IO.Path.GetFileNameWithoutExtension(videoFilePath);
            var ext = language.Contains("Arabic",  StringComparison.OrdinalIgnoreCase) ||
                      language.StartsWith("ar",     StringComparison.OrdinalIgnoreCase)
                ? "ar" : "en";
            var subExt  = entry.Name.EndsWith(".ass", StringComparison.OrdinalIgnoreCase) ? "ass" : "srt";
            var outPath = System.IO.Path.Combine(dir, $"{baseName}.{ext}.{subExt}");

            using var outStream   = File.Create(outPath);
            using var entryStream = entry.Open();
            await entryStream.CopyToAsync(outStream, cancellationToken).ConfigureAwait(false);

            return (true, outPath, null);
        }
        catch (Exception ex)
        {
            return (false, null, ex.Message);
        }
    }

    /// <summary>No-op — <see cref="_http"/> is shared process-wide and outlives any one instance.</summary>
    public void Dispose()
    {
    }
}
