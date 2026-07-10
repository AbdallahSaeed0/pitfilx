using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace PitflixPlayer;

internal sealed class OsSubtitleRow
{
    public string  SubtitleId   { get; set; } = "";
    public string  Language     { get; set; } = "";
    public string  ReleaseName  { get; set; } = "";
    public int     DownloadCount { get; set; }
    public int     FileId       { get; set; }
    public string  FileName     { get; set; } = "";
}

internal sealed class SubDlSubtitleRow
{
    public string ReleaseName { get; set; } = "";
    public string Language    { get; set; } = "";
    public string FullLink    { get; set; } = "";
}

internal sealed class SubSourceSubtitleRow
{
    public string ReleaseName        { get; set; } = "";
    public string Language           { get; set; } = "";
    public int    SubtitleId         { get; set; }
    public bool   IsHearingImpaired  { get; set; }
}

internal sealed class SubtitleSearchPayload
{
    public List<OsSubtitleRow> Items { get; set; } = [];
    public string?             Error { get; set; }
}

internal sealed class SubDlSearchPayload
{
    public List<SubDlSubtitleRow> Items { get; set; } = [];
    public string?                Error { get; set; }
}

internal sealed class SubSourceSearchPayload
{
    public List<SubSourceSubtitleRow> Items { get; set; } = [];
    public string?                    Error { get; set; }
}

internal sealed class PlaybackResolveInfo
{
    public string? MediaType         { get; set; }
    public string? Title             { get; set; }
    public int?    LibraryShowId     { get; set; }
    public int?    LibraryEpisodeId  { get; set; }
    public int?    LibraryMovieId    { get; set; }
    public int?    Season            { get; set; }
    public int?    EpisodeNumber     { get; set; }
}

/// <summary>HTTP client for Pitflix.API subtitle endpoints (same routes as the React app).</summary>
internal static class SubtitleApiClient
{
    private const string ApiRoot = "http://localhost:5280/api";

    private static readonly HttpClient Http = new()
    {
        Timeout = TimeSpan.FromSeconds(30)
    };

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy        = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    public static async Task<SubtitleSearchPayload> SearchOpenSubtitlesAsync(
        string query, string type, int? season, int? episode,
        int? tmdbId, int? parentTmdbId, CancellationToken ct = default)
    {
        var parts = new List<string>
        {
            $"query={Uri.EscapeDataString(query)}",
            $"type={Uri.EscapeDataString(type)}"
        };
        if (season is int s)       parts.Add($"season={s}");
        if (episode is int e)      parts.Add($"episode={e}");
        if (tmdbId is int tid)     parts.Add($"tmdbId={tid}");
        if (parentTmdbId is int p) parts.Add($"parentTmdbId={p}");

        return await GetJsonAsync<SubtitleSearchPayload>(
            $"{ApiRoot}/subtitles/search?{string.Join("&", parts)}", ct).ConfigureAwait(false)
            ?? new SubtitleSearchPayload();
    }

    public static async Task<SubDlSearchPayload> SearchSubDlAsync(
        string? title, string? imdbId, int? tmdbId, string mediaType,
        int? season, int? episode, CancellationToken ct = default)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(title))    parts.Add($"title={Uri.EscapeDataString(title)}");
        if (!string.IsNullOrWhiteSpace(imdbId))   parts.Add($"imdbId={Uri.EscapeDataString(imdbId)}");
        if (tmdbId is int tid)                    parts.Add($"tmdbId={tid}");
        if (!string.IsNullOrWhiteSpace(mediaType)) parts.Add($"mediaType={Uri.EscapeDataString(mediaType)}");
        if (season is int s)                      parts.Add($"season={s}");
        if (episode is int e)                     parts.Add($"episode={e}");

        var qs = parts.Count > 0 ? "?" + string.Join("&", parts) : "";
        return await GetJsonAsync<SubDlSearchPayload>(
            $"{ApiRoot}/subtitles/subdl/search{qs}", ct).ConfigureAwait(false)
            ?? new SubDlSearchPayload();
    }

    public static async Task<SubSourceSearchPayload> SearchSubSourceAsync(
        string? title, string? imdbId, string mediaType, int? season, CancellationToken ct = default)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(title))     parts.Add($"title={Uri.EscapeDataString(title)}");
        if (!string.IsNullOrWhiteSpace(imdbId))    parts.Add($"imdbId={Uri.EscapeDataString(imdbId)}");
        if (!string.IsNullOrWhiteSpace(mediaType)) parts.Add($"mediaType={Uri.EscapeDataString(mediaType)}");
        if (season is int s)                       parts.Add($"season={s}");

        var qs = parts.Count > 0 ? "?" + string.Join("&", parts) : "";
        return await GetJsonAsync<SubSourceSearchPayload>(
            $"{ApiRoot}/subtitles/subsource/search{qs}", ct).ConfigureAwait(false)
            ?? new SubSourceSearchPayload();
    }

    public static async Task<(bool Success, string? SavedPath, string? Error)> DownloadOpenSubtitlesAsync(
        int fileId, string videoFilePath, string languageCode, CancellationToken ct = default)
    {
        var body = JsonSerializer.Serialize(new
        {
            fileId,
            videoFilePath,
            languageCode
        }, JsonOpts);
        return await PostDownloadAsync($"{ApiRoot}/subtitles/download", body, ct).ConfigureAwait(false);
    }

    public static async Task<(bool Success, string? SavedPath, string? Error)> DownloadSubDlAsync(
        string fullLink, string videoFilePath, string language, CancellationToken ct = default)
    {
        var body = JsonSerializer.Serialize(new
        {
            fullLink,
            videoFilePath,
            language
        }, JsonOpts);
        return await PostDownloadAsync($"{ApiRoot}/subtitles/subdl/download", body, ct).ConfigureAwait(false);
    }

    public static async Task<(bool Success, string? SavedPath, string? Error)> DownloadSubSourceAsync(
        int subtitleId, string videoFilePath, string language, CancellationToken ct = default)
    {
        var body = JsonSerializer.Serialize(new
        {
            subtitleId,
            videoFilePath,
            language
        }, JsonOpts);
        return await PostDownloadAsync($"{ApiRoot}/subtitles/subsource/download", body, ct).ConfigureAwait(false);
    }

    public static async Task<PlaybackResolveInfo?> ResolveByPathAsync(
        string filePath, CancellationToken ct = default)
    {
        var encoded = Uri.EscapeDataString(filePath);
        return await GetJsonAsync<PlaybackResolveInfo>(
            $"{ApiRoot}/playback/resolve-by-path?filePath={encoded}", ct).ConfigureAwait(false);
    }

    public static async Task<int?> GetMovieTmdbIdAsync(int movieId, CancellationToken ct = default)
    {
        try
        {
            var resp = await Http.GetAsync($"{ApiRoot}/movies/{movieId}", ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return null;
            var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.TryGetProperty("movie", out var movie) && movie.ValueKind == JsonValueKind.Object)
                root = movie;
            if (root.TryGetProperty("tmdbId", out var t) && t.TryGetInt32(out var v)) return v;
        }
        catch { /* best-effort */ }
        return null;
    }

    public static async Task<int?> GetShowTmdbIdAsync(int showId, CancellationToken ct = default)
    {
        try
        {
            var resp = await Http.GetAsync($"{ApiRoot}/series/{showId}", ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return null;
            var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.TryGetProperty("show", out var show) && show.ValueKind == JsonValueKind.Object)
                root = show;
            if (root.TryGetProperty("tmdbId", out var t) && t.TryGetInt32(out var v)) return v;
        }
        catch { /* best-effort */ }
        return null;
    }

    public static async Task<string?> GetImdbIdAsync(
        int tmdbId, string mediaType, CancellationToken ct = default)
    {
        try
        {
            var mt = Uri.EscapeDataString(mediaType);
            var resp = await Http.GetAsync(
                $"{ApiRoot}/stream/imdb-id/{tmdbId}?mediaType={mt}", ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return null;
            var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("imdbId", out var im) &&
                im.ValueKind == JsonValueKind.String)
                return im.GetString();
        }
        catch { /* best-effort */ }
        return null;
    }

    private static async Task<T?> GetJsonAsync<T>(string url, CancellationToken ct) where T : class
    {
        try
        {
            var resp = await Http.GetAsync(url, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return null;
            var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            return JsonSerializer.Deserialize<T>(json, JsonOpts);
        }
        catch
        {
            return null;
        }
    }

    private static async Task<(bool Success, string? SavedPath, string? Error)> PostDownloadAsync(
        string url, string body, CancellationToken ct)
    {
        try
        {
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var resp    = await Http.PostAsync(url, content, ct).ConfigureAwait(false);
            var json    = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            bool ok = root.TryGetProperty("success", out var s) && s.GetBoolean();
            string? path = root.TryGetProperty("savedPath", out var p) && p.ValueKind == JsonValueKind.String
                ? p.GetString() : null;
            string? err = root.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String
                ? e.GetString() : null;
            return (ok, path, err);
        }
        catch (Exception ex)
        {
            return (false, null, ex.Message);
        }
    }
}
