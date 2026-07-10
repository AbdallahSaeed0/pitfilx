using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Pitflix.Core.Services;

/// <summary>Result of a subtitle search including HTTP/API error details for the client.</summary>
public sealed record SubtitleSearchOutcome(IReadOnlyList<SubtitleResult> Items, string? Error);

public sealed class SubtitleResult
{
    public string SubtitleId { get; init; } = "";
    public string Language { get; init; } = "";
    public string ReleaseName { get; init; } = "";
    public int DownloadCount { get; init; }
    public double Ratings { get; init; }
    public bool IsHearingImpaired { get; init; }
    public bool IsMachineTranslated { get; init; }
    public string Format { get; init; } = "srt";
    public int FileId { get; init; }
    public string FileName { get; init; } = "";
}

/// <summary>OpenSubtitles.com API v1 (api.opensubtitles.com).</summary>
public sealed class OpenSubtitlesClient : IDisposable
{
    // Keyed by (apiKey, appName) — OpenSubtitlesClient is constructed fresh per request (Program.cs),
    // and the configured key/app rarely changes, so cache and reuse the underlying HttpClient
    // instead of opening a new socket pool on every subtitle search.
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<(string, string), HttpClient>
        _sharedClients = new();
    private static readonly HttpClient _sharedDownloadClient = new();

    private readonly HttpClient _http;
    private readonly string _apiKey;
    private readonly string _appName;

    public OpenSubtitlesClient(string apiKey, string appName = "Pitflix")
    {
        _apiKey = apiKey ?? "";
        _appName = string.IsNullOrWhiteSpace(appName) ? "Pitflix" : appName;
        _http = _sharedClients.GetOrAdd((_apiKey, _appName), key =>
        {
            var http = new HttpClient { BaseAddress = new Uri("https://api.opensubtitles.com/api/v1/") };
            http.DefaultRequestHeaders.TryAddWithoutValidation("Api-Key", key.Item1);
            http.DefaultRequestHeaders.UserAgent.ParseAdd($"{key.Item2} v1.0");
            http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            return http;
        });
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_apiKey);

    public Task<SubtitleSearchOutcome> SearchAsync(
        string title,
        int? season,
        int? episode,
        string mediaType,
        int? tmdbId,
        CancellationToken cancellationToken = default) =>
        SearchWithFallbacksAsync(title, season, episode, mediaType, tmdbId, cancellationToken);

    private async Task<SubtitleSearchOutcome> SearchWithFallbacksAsync(
        string title,
        int? season,
        int? episode,
        string mediaType,
        int? tmdbId,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
            return new SubtitleSearchOutcome(Array.Empty<SubtitleResult>(), "OpenSubtitles API key not configured.");
        if (string.IsNullOrWhiteSpace(title))
            return new SubtitleSearchOutcome(Array.Empty<SubtitleResult>(), null);

        var typeEpisode = mediaType.Equals("episode", StringComparison.OrdinalIgnoreCase);
        var typeToken = typeEpisode ? "episode" : "movie";
        var variants = TitleQueryVariants(title);
        var tryTmdb = tmdbId is > 0;

        foreach (var q in variants)
        {
            for (var pass = 0; pass < (tryTmdb ? 2 : 1); pass++)
            {
                var useTmdb = tryTmdb && pass == 0;
                var outcome = await SearchOnceAsync(q, season, episode, typeToken, typeEpisode, useTmdb ? tmdbId : null,
                    useTmdb, cancellationToken).ConfigureAwait(false);
                if (outcome.Error != null)
                    return outcome;
                if (outcome.Items.Count > 0)
                    return outcome;
            }
        }

        return new SubtitleSearchOutcome(Array.Empty<SubtitleResult>(), null);
    }

    private static IEnumerable<string> TitleQueryVariants(string title)
    {
        var t = title.Trim();
        yield return t;
        if (t.Contains(':', StringComparison.Ordinal))
        {
            var collapsed = t.Replace(":", " ", StringComparison.Ordinal).Trim();
            while (collapsed.Contains("  ", StringComparison.Ordinal))
                collapsed = collapsed.Replace("  ", " ", StringComparison.Ordinal);
            if (!string.Equals(collapsed, t, StringComparison.Ordinal))
                yield return collapsed;
        }
    }

    private async Task<SubtitleSearchOutcome> SearchOnceAsync(
        string query,
        int? season,
        int? episode,
        string typeToken,
        bool typeEpisode,
        int? tmdbId,
        bool sendTmdb,
        CancellationToken cancellationToken)
    {
        var qb = new List<string>
        {
            $"query={Uri.EscapeDataString(query.Trim())}",
            "languages=ar,en",
            $"type={typeToken}",
        };
        if (season.HasValue) qb.Add($"season_number={season.Value}");
        if (episode.HasValue) qb.Add($"episode_number={episode.Value}");
        if (sendTmdb && tmdbId is > 0 and var tid)
        {
            // TV episodes use parent show id; movies use the film's TMDB id.
            if (typeEpisode)
                qb.Add($"parent_tmdb_id={tid}");
            else
                qb.Add($"tmdb_id={tid}");
        }

        var url = "subtitles?" + string.Join("&", qb);
        using var req = new HttpRequestMessage(HttpMethod.Get, url);

        using var resp = await _http.SendAsync(req, cancellationToken).ConfigureAwait(false);
        var json = await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
        {
            var snippet = json.Length > 280 ? json[..280] + "…" : json;
            return new SubtitleSearchOutcome(Array.Empty<SubtitleResult>(),
                $"OpenSubtitles HTTP {(int)resp.StatusCode}: {snippet}");
        }

        return new SubtitleSearchOutcome(ParseSearchResponse(json), null);
    }

    private static IReadOnlyList<SubtitleResult> ParseSearchResponse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
                return Array.Empty<SubtitleResult>();

            var list = new List<SubtitleResult>();
            foreach (var item in data.EnumerateArray())
            {
                if (!item.TryGetProperty("attributes", out var attr))
                    continue;
                var subtitleId = item.TryGetProperty("id", out var idEl) ? idEl.GetRawText().Trim('"') : "";
                var lang = attr.TryGetProperty("language", out var l) ? l.GetString() ?? "" : "";
                var release =
                    attr.TryGetProperty("release", out var rel)
                        ? rel.GetString() ?? ""
                        : attr.TryGetProperty("feature_details", out var fd) && fd.TryGetProperty("movie_name", out var mn)
                            ? mn.GetString() ?? ""
                            : "";
                if (string.IsNullOrEmpty(release) &&
                    attr.TryGetProperty("feature_details", out var fd2) &&
                    fd2.TryGetProperty("title", out var t))
                    release = t.GetString() ?? "";

                var dl = 0;
                if (attr.TryGetProperty("download_count", out var dc) && dc.TryGetInt32(out var dci))
                    dl = dci;

                var ratings = 0.0;
                if (attr.TryGetProperty("ratings", out var rat))
                {
                    if (rat.ValueKind == JsonValueKind.Number) rat.TryGetDouble(out ratings);
                    else if (rat.ValueKind == JsonValueKind.String &&
                             double.TryParse(rat.GetString(), System.Globalization.NumberStyles.Any,
                                 System.Globalization.CultureInfo.InvariantCulture, out var rr))
                        ratings = rr;
                }

                var hi = attr.TryGetProperty("hearing_impaired", out var h) &&
                         h.ValueKind is JsonValueKind.True;
                var machine = attr.TryGetProperty("machine_translated", out var mt) &&
                              mt.ValueKind is JsonValueKind.True;
                var fmt = "srt";
                if (attr.TryGetProperty("format", out var fo)) fmt = fo.GetString() ?? "srt";

                if (!attr.TryGetProperty("files", out var files) || files.ValueKind != JsonValueKind.Array ||
                    files.GetArrayLength() == 0)
                    continue;

                var f0 = files[0];
                var fileId = 0;
                if (f0.TryGetProperty("file_id", out var fid))
                {
                    if (fid.ValueKind == JsonValueKind.Number) fid.TryGetInt32(out fileId);
                    else if (fid.ValueKind == JsonValueKind.String)
                        int.TryParse(fid.GetString(), out fileId);
                }

                var fileName = f0.TryGetProperty("file_name", out var fn) ? fn.GetString() ?? "" : "";

                list.Add(new SubtitleResult
                {
                    SubtitleId = subtitleId,
                    Language = lang,
                    ReleaseName = string.IsNullOrEmpty(release) ? "(no name)" : release,
                    DownloadCount = dl,
                    Ratings = ratings,
                    IsHearingImpaired = hi,
                    IsMachineTranslated = machine,
                    Format = fmt,
                    FileId = fileId,
                    FileName = fileName,
                });
            }

            return list
                .OrderByDescending(x => x.Language.Equals("ar", StringComparison.OrdinalIgnoreCase))
                .ThenByDescending(x => x.DownloadCount)
                .Take(20)
                .ToList();
        }
        catch
        {
            return Array.Empty<SubtitleResult>();
        }
    }

    public async Task<(bool Ok, string? Path, string? Error)> DownloadAsync(int fileId, string videoFilePath,
        string languageCode, CancellationToken cancellationToken = default)
    {
        if (!IsConfigured || fileId <= 0 || string.IsNullOrWhiteSpace(videoFilePath))
            return (false, null, "Invalid request.");

        try
        {
            var body = $$"""{"file_id":{{fileId}}}""";
            using var req = new HttpRequestMessage(HttpMethod.Post, "download")
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            using var resp = await _http.SendAsync(req, cancellationToken).ConfigureAwait(false);
            var json = await resp.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
                return (false, null, $"OpenSubtitles error {(int)resp.StatusCode}: {json}");

            using var doc = JsonDocument.Parse(json);
            string? link = null;
            if (doc.RootElement.TryGetProperty("link", out var linkEl))
                link = linkEl.GetString();
            else if (doc.RootElement.TryGetProperty("data", out var dataEl) && dataEl.TryGetProperty("link", out var link2))
                link = link2.GetString();

            if (string.IsNullOrEmpty(link))
                return (false, null, "No download link in response.");

            var bytes = await _sharedDownloadClient.GetByteArrayAsync(new Uri(link), cancellationToken).ConfigureAwait(false);
            var dir = Path.GetDirectoryName(videoFilePath);
            if (string.IsNullOrEmpty(dir))
                return (false, null, "Invalid video path.");
            var baseName = Path.GetFileNameWithoutExtension(videoFilePath);
            var ext = string.Equals(languageCode, "ar", StringComparison.OrdinalIgnoreCase) ? "ar" : "en";
            var outPath = Path.Combine(dir, $"{baseName}.{ext}.srt");
            await File.WriteAllBytesAsync(outPath, bytes, cancellationToken).ConfigureAwait(false);

            return (true, outPath, null);
        }
        catch (Exception ex)
        {
            return (false, null, ex.Message);
        }
    }

    /// <summary>No-op — <see cref="_http"/> is shared/cached process-wide and outlives any one instance.</summary>
    public void Dispose()
    {
    }
}
