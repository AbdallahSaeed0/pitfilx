using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Pitflix.API.Services;

public sealed record EztvTorrent(
    string Title,
    string Size,
    string Quality,
    string Format,
    List<string> Badges,
    string MagnetLink,
    string TorrentFileUrl);

/// <summary>
/// Searches EZTV's free public JSON API (no API key) via IMDb id — TV only, no movie catalog.
/// Unlike PSA's multi-query cascade across general-purpose trackers, this is a single ID-exact
/// lookup against a dedicated TV tracker, so precision is closer to WSM/TPB than to PSA.
/// </summary>
public sealed class EztvScraperService
{
    private const string ApiBase = "https://eztv.re/api/get-torrents";
    private static readonly HttpClient Http = CreateSharedClient();

    /// <summary>
    /// One show's whole catalog, keyed by IMDb numeric id. Every season/episode lookup goes through
    /// the same single <c>limit=100</c> request, so without this each season of a show paid the full
    /// upstream round-trip again — measured at ~15s when eztv.re is having a bad day. The endpoint
    /// cache above this only keys on tmdbId+season(+episode), so it can't collapse those.
    /// </summary>
    private static readonly ConcurrentDictionary<string, (DateTimeOffset ExpiresAt, List<EztvApiTorrent> Torrents)> ShowCache = new();

    private static readonly TimeSpan ShowCacheTtl = TimeSpan.FromMinutes(30);
    /// <summary>Short TTL for empty/failed fetches so a slow upstream isn't retried on every open.</summary>
    private static readonly TimeSpan ShowCacheEmptyTtl = TimeSpan.FromMinutes(3);

    private static readonly Regex ImdbNumericRegex = new(@"\d+", RegexOptions.Compiled);
    private static readonly Regex FormatRegex = new(@"\b(MKV|MP4|AVI|WMV)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private static HttpClient CreateSharedClient()
    {
        var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (compatible; Pitflix/1.0)");
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        // 20s was long enough that a struggling upstream held the Download modal's EZTV tab on a
        // spinner well past the point the result was still wanted. Nothing that slow beats the
        // other providers, which answer in well under a second.
        http.Timeout = TimeSpan.FromSeconds(8);
        return http;
    }

    private static string? ParseImdbNumericId(string? imdbId)
    {
        if (string.IsNullOrWhiteSpace(imdbId))
            return null;
        var match = ImdbNumericRegex.Match(imdbId);
        return match.Success ? match.Value : null;
    }

    public async Task<IReadOnlyList<EztvTorrent>> ScrapeEpisodeAsync(string imdbId, int season, int episode, CancellationToken ct)
    {
        var torrents = await FetchAllForShowAsync(imdbId, ct).ConfigureAwait(false);
        return torrents
            .Where(t => t.SeasonNumber == season && t.EpisodeNumber == episode)
            .Select(MapTorrent)
            .Where(t => !string.IsNullOrWhiteSpace(t.MagnetLink))
            .ToList();
    }

    /// <summary>Season packs on EZTV are listed with episode "0" — single episodes never use that value.</summary>
    public async Task<IReadOnlyList<EztvTorrent>> ScrapeSeasonAsync(string imdbId, int season, CancellationToken ct)
    {
        var torrents = await FetchAllForShowAsync(imdbId, ct).ConfigureAwait(false);
        return torrents
            .Where(t => t.SeasonNumber == season && t.EpisodeNumber == 0)
            .Select(MapTorrent)
            .Where(t => !string.IsNullOrWhiteSpace(t.MagnetLink))
            .ToList();
    }

    private async Task<List<EztvApiTorrent>> FetchAllForShowAsync(string imdbId, CancellationToken ct)
    {
        var numericId = ParseImdbNumericId(imdbId);
        if (numericId == null)
            return [];

        if (ShowCache.TryGetValue(numericId, out var cached) && cached.ExpiresAt > DateTimeOffset.UtcNow)
            return cached.Torrents;

        try
        {
            // 100 is the API's documented max page size — one show's full catalog rarely exceeds that,
            // and unlike PSA/WSM this is a single request either way (no cascade, no per-result fetch).
            var url = $"{ApiBase}?imdb_id={Uri.EscapeDataString(numericId)}&limit=100";
            using var res = await Http.GetAsync(url, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                return CacheAndReturn(numericId, []);

            var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            var parsed = JsonSerializer.Deserialize<EztvApiResponse>(body, JsonOptions);
            return CacheAndReturn(numericId, parsed?.Torrents ?? []);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Caller gave up (modal closed) — not an upstream failure, so don't poison the cache.
            return [];
        }
        catch
        {
            return CacheAndReturn(numericId, []);
        }
    }

    private static List<EztvApiTorrent> CacheAndReturn(string numericId, List<EztvApiTorrent> torrents)
    {
        var ttl = torrents.Count > 0 ? ShowCacheTtl : ShowCacheEmptyTtl;
        ShowCache[numericId] = (DateTimeOffset.UtcNow.Add(ttl), torrents);
        return torrents;
    }

    private static EztvTorrent MapTorrent(EztvApiTorrent t)
    {
        var name = (t.Title ?? t.Filename ?? "").Trim();
        var quality = ExtractQuality(name);
        var format = FormatRegex.Match(name) is { Success: true } fm ? fm.Groups[1].Value.ToUpperInvariant() : "Unknown";
        var size = FormatBytes(t.SizeBytes);
        var badges = ExtractBadges(name, t.Seeds);
        var magnet = t.MagnetUrl?.Trim() ?? "";

        return new EztvTorrent(name, size, quality, format, badges, magnet, t.TorrentUrl?.Trim() ?? "");
    }

    private static string FormatBytes(string? sizeRaw)
    {
        if (!long.TryParse(sizeRaw, out var bytes) || bytes <= 0)
            return "";

        const double kb = 1024;
        const double mb = kb * 1024;
        const double gb = mb * 1024;

        if (bytes >= gb) return $"{bytes / gb:0.##} GB";
        if (bytes >= mb) return $"{bytes / mb:0.##} MB";
        return $"{bytes / kb:0.##} KB";
    }

    private static string ExtractQuality(string text)
    {
        if (Regex.IsMatch(text, @"2160p|4K", RegexOptions.IgnoreCase)) return "4K";
        if (Regex.IsMatch(text, @"1080p|FullHD", RegexOptions.IgnoreCase)) return "1080p";
        if (Regex.IsMatch(text, @"720p|\bHD\b", RegexOptions.IgnoreCase)) return "720p";
        if (Regex.IsMatch(text, @"480p|\bSD\b", RegexOptions.IgnoreCase)) return "480p";
        return "Unknown";
    }

    private static List<string> ExtractBadges(string text, int? seeds)
    {
        var badges = new List<string>();
        if (Regex.IsMatch(text, @"HEVC|x265|H\.265", RegexOptions.IgnoreCase))
            badges.Add("HEVC");
        else if (Regex.IsMatch(text, @"x264|H\.264", RegexOptions.IgnoreCase))
            badges.Add("x264");

        if (Regex.IsMatch(text, @"HDR10\+", RegexOptions.IgnoreCase))
            badges.Add("HDR10+");
        else if (Regex.IsMatch(text, @"HDR", RegexOptions.IgnoreCase))
            badges.Add("HDR");

        if (Regex.IsMatch(text, @"WEB-DL", RegexOptions.IgnoreCase))
            badges.Add("WEB-DL");
        else if (Regex.IsMatch(text, @"WEBRip|WebRip", RegexOptions.IgnoreCase))
            badges.Add("WEBRip");
        else if (Regex.IsMatch(text, @"BluRay|Bluray|BDRip|BRRip", RegexOptions.IgnoreCase))
            badges.Add("Bluray");
        else if (Regex.IsMatch(text, @"HDTV", RegexOptions.IgnoreCase))
            badges.Add("HDTV");

        if (Regex.IsMatch(text, @"10bit|10-bit", RegexOptions.IgnoreCase))
            badges.Add("10bit");

        if (seeds is > 0)
            badges.Add($"{seeds} seeds");

        return badges;
    }

    private sealed class EztvApiResponse
    {
        [JsonPropertyName("torrents_count")]
        public int TorrentsCount { get; set; }
        public List<EztvApiTorrent>? Torrents { get; set; }
    }

    private sealed class EztvApiTorrent
    {
        public string? Title { get; set; }
        public string? Filename { get; set; }

        [JsonPropertyName("magnet_url")]
        public string? MagnetUrl { get; set; }

        [JsonPropertyName("torrent_url")]
        public string? TorrentUrl { get; set; }

        [JsonPropertyName("size_bytes")]
        public string? SizeBytes { get; set; }

        public int? Seeds { get; set; }

        [JsonPropertyName("season")]
        public string? SeasonRaw { get; set; }

        [JsonPropertyName("episode")]
        public string? EpisodeRaw { get; set; }

        [JsonIgnore]
        public int SeasonNumber => int.TryParse(SeasonRaw, out var s) ? s : -1;

        [JsonIgnore]
        public int EpisodeNumber => int.TryParse(EpisodeRaw, out var e) ? e : -1;
    }
}
