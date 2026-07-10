using System.IO.Compression;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Pitflix.Core.Services;

public sealed record SubSourceSubtitleResult(
    string ReleaseName,
    string Language,
    int SubtitleId,
    bool IsHearingImpaired);

public sealed record SubSourceSearchOutcome(IReadOnlyList<SubSourceSubtitleResult> Items, string? Error);

/// <summary>
/// SubSource.net subtitle search and download client (api.subsource.net/api/v1).
/// Unofficial REST API — GET requests authenticated via the X-API-Key header.
/// </summary>
public sealed class SubSourceClient : IDisposable
{
    private const string BaseUrl = "https://api.subsource.net/api/v1";

    // Shared across instances — SubSourceClient is constructed fresh per request (same pattern as SubDlClient),
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

    public SubSourceClient(string? apiKey = null)
    {
        _apiKey = apiKey?.Trim();
    }

    // ── Search ──────────────────────────────────────────────────────────────

    public async Task<SubSourceSearchOutcome> SearchAsync(
        string? title,
        string? imdbId,
        string mediaType,
        int? season,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
            return new SubSourceSearchOutcome([], "SubSource API key not configured.");
        if (string.IsNullOrWhiteSpace(title) && string.IsNullOrWhiteSpace(imdbId))
            return new SubSourceSearchOutcome([], "SubSource: title or imdbId is required.");

        var isTv = mediaType.Equals("Series", StringComparison.OrdinalIgnoreCase) ||
                   mediaType.Equals("episode", StringComparison.OrdinalIgnoreCase);

        try
        {
            var movieId = await SearchMovieIdAsync(title, imdbId, isTv, season, cancellationToken)
                .ConfigureAwait(false);
            if (movieId is null)
                return new SubSourceSearchOutcome([], null);

            var items = await GetSubtitlesAsync(movieId.Value, cancellationToken).ConfigureAwait(false);
            return new SubSourceSearchOutcome(items, null);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            return new SubSourceSearchOutcome([], ex.Message);
        }
    }

    private async Task<int?> SearchMovieIdAsync(
        string? title, string? imdbId, bool isTv, int? season, CancellationToken ct)
    {
        var qb = new List<string>();
        if (!string.IsNullOrWhiteSpace(imdbId))
        {
            qb.Add("searchType=imdb");
            qb.Add($"imdb={Uri.EscapeDataString(imdbId)}");
        }
        else
        {
            qb.Add("searchType=text");
            qb.Add($"q={Uri.EscapeDataString(title!.Trim())}");
        }
        qb.Add($"type={(isTv ? "series" : "movie")}");
        if (isTv && season is int s) qb.Add($"season={s}");

        using var resp = await GetAsync($"/movies/search?{string.Join("&", qb)}", ct).ConfigureAwait(false);
        if (resp is null || !resp.IsSuccessStatusCode) return null;

        var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
                return null;

            foreach (var item in data.EnumerateArray())
            {
                if (item.TryGetProperty("movieId", out var idEl) && idEl.TryGetInt32(out var id))
                    return id;
            }
            return null;
        }
        catch
        {
            return null;
        }
    }

    private async Task<IReadOnlyList<SubSourceSubtitleResult>> GetSubtitlesAsync(int movieId, CancellationToken ct)
    {
        using var resp = await GetAsync($"/subtitles?movieId={movieId}&limit=100", ct).ConfigureAwait(false);
        if (resp is null || !resp.IsSuccessStatusCode) return [];

        var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
                return [];

            var list = new List<SubSourceSubtitleResult>();
            foreach (var item in data.EnumerateArray())
            {
                if (!item.TryGetProperty("subtitleId", out var idEl) || !idEl.TryGetInt32(out var subtitleId))
                    continue;

                var lang = GetStr(item, "language") ?? "";
                var hi = item.TryGetProperty("hearingImpaired", out var hiEl) && hiEl.ValueKind == JsonValueKind.True;

                var releaseName = lang;
                if (item.TryGetProperty("releaseInfo", out var riEl) && riEl.ValueKind == JsonValueKind.Array)
                {
                    var parts = riEl.EnumerateArray()
                        .Where(e => e.ValueKind == JsonValueKind.String)
                        .Select(e => e.GetString())
                        .Where(s => !string.IsNullOrWhiteSpace(s));
                    var joined = string.Join(" / ", parts);
                    if (!string.IsNullOrWhiteSpace(joined)) releaseName = joined;
                }

                list.Add(new SubSourceSubtitleResult(releaseName, lang, subtitleId, hi));
            }
            return list;
        }
        catch
        {
            return [];
        }
    }

    // ── Download ────────────────────────────────────────────────────────────

    /// <summary>
    /// Downloads a SubSource subtitle zip via /subtitles/{id}/download, extracts the first
    /// .srt/.ass entry, and saves it next to <paramref name="videoFilePath"/>.
    /// </summary>
    public async Task<(bool Ok, string? Path, string? Error)> DownloadAsync(
        int subtitleId,
        string language,
        string videoFilePath,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
            return (false, null, "SubSource API key not configured.");
        if (subtitleId <= 0 || string.IsNullOrWhiteSpace(videoFilePath))
            return (false, null, "Invalid request.");

        try
        {
            using var resp = await GetAsync($"/subtitles/{subtitleId}/download", cancellationToken)
                .ConfigureAwait(false);
            if (resp is null || !resp.IsSuccessStatusCode)
                return (false, null, "SubSource: could not download subtitle.");

            var bytes = await resp.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);

            using var ms = new MemoryStream(bytes);
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
            var ext = language.Contains("Arabic", StringComparison.OrdinalIgnoreCase) ||
                      language.StartsWith("ar", StringComparison.OrdinalIgnoreCase)
                ? "ar" : "en";
            var subExt = entry.Name.EndsWith(".ass", StringComparison.OrdinalIgnoreCase) ? "ass" : "srt";
            var outPath = System.IO.Path.Combine(dir, $"{baseName}.{ext}.{subExt}");

            using var outStream = File.Create(outPath);
            using var entryStream = entry.Open();
            await entryStream.CopyToAsync(outStream, cancellationToken).ConfigureAwait(false);

            return (true, outPath, null);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            return (false, null, ex.Message);
        }
    }

    // ── HTTP helpers ─────────────────────────────────────────────────────────

    private async Task<HttpResponseMessage?> GetAsync(string pathAndQuery, CancellationToken ct)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, BaseUrl + pathAndQuery);
            req.Headers.TryAddWithoutValidation("X-API-Key", _apiKey);
            return await _http.SendAsync(req, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) { throw; }
        catch
        {
            return null;
        }
    }

    private static string? GetStr(JsonElement el, string key) =>
        el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()?.Trim()
            : null;

    /// <summary>No-op — <see cref="_http"/> is shared process-wide and outlives any one instance.</summary>
    public void Dispose()
    {
    }
}
