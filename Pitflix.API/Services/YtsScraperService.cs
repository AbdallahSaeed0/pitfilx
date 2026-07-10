using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pitflix.API.Services;

public sealed record YtsTorrent(
    string Title,
    string Size,
    string Quality,
    string Format,
    List<string> Badges,
    string MagnetLink,
    string TorrentFileUrl);

/// <summary>Fetches movie torrents from the YTS public API (yts.gg). The website HTML is Cloudflare-protected,
/// but the JSON API is open. Magnet links are built from torrent hashes per YTS documentation.</summary>
public sealed class YtsScraperService
{
    private const string ApiBase = "https://movies-api.accel.li/api/v2";
    private static readonly HttpClient Http = CreateSharedClient();

    private static readonly string[] Trackers =
    [
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://tracker.dler.org:6969/announce",
        "udp://open.stealth.si:80/announce",
        "udp://open.demonii.com:1337/announce",
        "https://tracker.moeblog.cn:443/announce",
        "udp://open.dstud.io:6969/announce",
        "udp://tracker.srv00.com:6969/announce",
    ];

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private static HttpClient CreateSharedClient()
    {
        var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (compatible; Pitflix/1.0)");
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        http.Timeout = TimeSpan.FromSeconds(20);
        return http;
    }

    public async Task<IReadOnlyList<YtsTorrent>> ScrapeAsync(string? imdbId, string title, int year, CancellationToken ct)
    {
        try
        {
            YtsMovie? movie = null;

            if (!string.IsNullOrWhiteSpace(imdbId))
                movie = await FetchMovieDetailsAsync($"imdb_id={Uri.EscapeDataString(imdbId.Trim())}", ct).ConfigureAwait(false);

            if (movie == null && !string.IsNullOrWhiteSpace(title))
            {
                var query = Uri.EscapeDataString(title.Trim());
                var listUrl = $"{ApiBase}/list_movies.json?query_term={query}&limit=20";
                using var listRes = await Http.GetAsync(listUrl, ct).ConfigureAwait(false);
                if (listRes.IsSuccessStatusCode)
                {
                    var listJson = await listRes.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                    var list = JsonSerializer.Deserialize<YtsListResponse>(listJson, JsonOptions);
                    movie = list?.Data?.Movies?
                        .FirstOrDefault(m => m.Year == year)
                        ?? list?.Data?.Movies?.FirstOrDefault(m =>
                            string.Equals(m.Title, title, StringComparison.OrdinalIgnoreCase));
                }
            }

            if (movie?.Torrents == null || movie.Torrents.Count == 0)
                return Array.Empty<YtsTorrent>();

            var displayTitle = string.IsNullOrWhiteSpace(movie.TitleLong) ? title : movie.TitleLong;
            return movie.Torrents
                .Select(t => MapTorrent(displayTitle, t))
                .Where(t => !string.IsNullOrWhiteSpace(t.MagnetLink))
                .ToList();
        }
        catch
        {
            return Array.Empty<YtsTorrent>();
        }
    }

    private static async Task<YtsMovie?> FetchMovieDetailsAsync(string query, CancellationToken ct)
    {
        var url = $"{ApiBase}/movie_details.json?{query}";
        using var res = await Http.GetAsync(url, ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
            return null;

        var json = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        var parsed = JsonSerializer.Deserialize<YtsDetailsResponse>(json, JsonOptions);
        return parsed?.Status == "ok" ? parsed.Data?.Movie : null;
    }

    private static YtsTorrent MapTorrent(string movieTitle, YtsApiTorrent t)
    {
        var quality = NormalizeQuality(t.Quality);
        var source = string.IsNullOrWhiteSpace(t.Type) ? "Unknown" : char.ToUpperInvariant(t.Type[0]) + t.Type[1..];
        var rowTitle = $"{movieTitle} [{quality}] [{source}]";

        var badges = new List<string>();
        if (!string.IsNullOrWhiteSpace(t.VideoCodec))
        {
            var codec = t.VideoCodec.ToUpperInvariant();
            badges.Add(codec is "X264" or "X265" ? codec.ToLowerInvariant() : t.VideoCodec);
            if (codec is "X265" or "HEVC")
                badges.Add("HEVC");
        }

        if (!string.IsNullOrWhiteSpace(t.Type))
            badges.Add(t.Type.Equals("bluray", StringComparison.OrdinalIgnoreCase) ? "Bluray" : "WEB");

        if (t.BitDepth is "10")
            badges.Add("10bit");

        if (!string.IsNullOrWhiteSpace(t.AudioChannels))
        {
            if (t.AudioChannels.Contains("5.1", StringComparison.Ordinal))
                badges.Add("5.1Ch");
            else if (t.AudioChannels.Contains("7.1", StringComparison.Ordinal))
                badges.Add("7.1Ch");
        }

        if (t.Seeds > 0)
            badges.Add($"{t.Seeds} seeds");

        var magnet = BuildMagnet(t.Hash, movieTitle);
        var torrentUrl = string.IsNullOrWhiteSpace(t.Url) ? "" : t.Url;

        return new YtsTorrent(rowTitle, t.Size ?? "", quality, "MKV", badges, magnet, torrentUrl);
    }

    private static string NormalizeQuality(string? quality)
    {
        if (string.IsNullOrWhiteSpace(quality))
            return "Unknown";
        if (quality.Contains("2160", StringComparison.Ordinal) || quality.Contains("4k", StringComparison.OrdinalIgnoreCase))
            return "4K";
        return quality;
    }

    private static string BuildMagnet(string? hash, string displayName)
    {
        if (string.IsNullOrWhiteSpace(hash))
            return "";

        var parts = new List<string>
        {
            $"magnet:?xt=urn:btih:{hash.Trim()}",
            $"dn={Uri.EscapeDataString(displayName)}",
        };
        parts.AddRange(Trackers.Select(tr => $"tr={Uri.EscapeDataString(tr)}"));
        return string.Join("&", parts);
    }

    private sealed class YtsDetailsResponse
    {
        public string? Status { get; set; }
        public YtsDetailsData? Data { get; set; }
    }

    private sealed class YtsDetailsData
    {
        public YtsMovie? Movie { get; set; }
    }

    private sealed class YtsListResponse
    {
        public string? Status { get; set; }
        public YtsListData? Data { get; set; }
    }

    private sealed class YtsListData
    {
        public List<YtsMovie>? Movies { get; set; }
    }

    private sealed class YtsMovie
    {
        public string? Title { get; set; }

        [JsonPropertyName("title_long")]
        public string? TitleLong { get; set; }

        public int Year { get; set; }

        public List<YtsApiTorrent>? Torrents { get; set; }
    }

    private sealed class YtsApiTorrent
    {
        public string? Url { get; set; }
        public string? Hash { get; set; }
        public string? Quality { get; set; }
        public string? Type { get; set; }

        [JsonPropertyName("video_codec")]
        public string? VideoCodec { get; set; }

        [JsonPropertyName("bit_depth")]
        public string? BitDepth { get; set; }

        [JsonPropertyName("audio_channels")]
        public string? AudioChannels { get; set; }

        public int Seeds { get; set; }
        public string? Size { get; set; }
    }
}
