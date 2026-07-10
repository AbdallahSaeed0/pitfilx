using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Pitflix.API.Services;

public sealed record TpbTorrent(
    string Title,
    string Size,
    string Quality,
    string Format,
    List<string> Badges,
    string MagnetLink,
    string TorrentFileUrl);

/// <summary>Searches The Pirate Bay via the unofficial apibay.org JSON API. Supports movies, episodes, and season packs.</summary>
public sealed class TpbScraperService
{
    private const string ApiBase = "https://apibay.org";
    private static readonly HttpClient Http = CreateSharedClient();

    private static readonly string[] Trackers =
    [
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://tracker.dler.org:6969/announce",
        "udp://open.stealth.si:80/announce",
        "udp://open.demonii.com:1337/announce",
        "udp://explodie.org:6969/announce",
        "udp://tracker.cyberia.is:6969/announce",
    ];

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private static readonly Regex FormatRegex = new(@"\b(MKV|MP4|AVI|WMV)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex SeasonEpisodeRegex = new(@"S(\d{1,2})E(\d{1,2})", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static HttpClient CreateSharedClient()
    {
        var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (compatible; Pitflix/1.0)");
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        http.Timeout = TimeSpan.FromSeconds(25);
        return http;
    }

    public Task<IReadOnlyList<TpbTorrent>> ScrapeMovieAsync(string title, int year, string? imdbId, CancellationToken ct)
    {
        var query = $"{title.Trim()} {year}";
        return SearchAndMapAsync(query, ct, results =>
        {
            var yearStr = year.ToString();
            return results.Where(r =>
            {
                if (!string.IsNullOrWhiteSpace(imdbId) &&
                    !string.IsNullOrWhiteSpace(r.Imdb) &&
                    string.Equals(r.Imdb.Trim(), imdbId.Trim(), StringComparison.OrdinalIgnoreCase))
                    return true;

                var name = r.Name ?? "";
                if (SeasonEpisodeRegex.IsMatch(name))
                    return false;
                return name.Contains(yearStr, StringComparison.Ordinal);
            });
        });
    }

    public Task<IReadOnlyList<TpbTorrent>> ScrapeEpisodeAsync(string title, int season, int episode, CancellationToken ct)
    {
        var query = $"{title.Trim()} S{season:D2}E{episode:D2}";
        var epPattern = $"S{season:D2}E{episode:D2}";
        return SearchAndMapAsync(query, ct, results => results.Where(r =>
            (r.Name ?? "").Contains(epPattern, StringComparison.OrdinalIgnoreCase)));
    }

    public Task<IReadOnlyList<TpbTorrent>> ScrapeSeasonAsync(string title, int season, CancellationToken ct)
    {
        var query = $"{title.Trim()} S{season:D2}";
        var seasonTag = $"S{season:D2}";
        return SearchAndMapAsync(query, ct, results => results.Where(r =>
        {
            var name = r.Name ?? "";
            if (!name.Contains(seasonTag, StringComparison.OrdinalIgnoreCase))
                return false;

            if (name.Contains("COMPLETE", StringComparison.OrdinalIgnoreCase) ||
                name.Contains("Season Pack", StringComparison.OrdinalIgnoreCase) ||
                name.Contains("Full Season", StringComparison.OrdinalIgnoreCase))
                return true;

            // Season header without a specific episode (e.g. "S02" but not "S02E03")
            var match = SeasonEpisodeRegex.Match(name);
            return !match.Success;
        }));
    }

    private async Task<IReadOnlyList<TpbTorrent>> SearchAndMapAsync(
        string query,
        CancellationToken ct,
        Func<IEnumerable<ApibayResult>, IEnumerable<ApibayResult>>? filter = null)
    {
        try
        {
            var results = await FetchSearchAsync(query, ct).ConfigureAwait(false);
            if (filter != null)
                results = filter(results).ToList();

            return results
                .Select(MapTorrent)
                .Where(t => !string.IsNullOrWhiteSpace(t.MagnetLink))
                .ToList();
        }
        catch
        {
            return Array.Empty<TpbTorrent>();
        }
    }

    private static async Task<List<ApibayResult>> FetchSearchAsync(string query, CancellationToken ct)
    {
        var url = $"{ApiBase}/q.php?q={Uri.EscapeDataString(query.Trim())}";
        using var res = await Http.GetAsync(url, ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
            return [];

        var body = (await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false)).Trim();
        if (body.Length == 0 || body.Contains("no torrents", StringComparison.OrdinalIgnoreCase))
            return [];

        try
        {
            var parsed = JsonSerializer.Deserialize<List<ApibayResult>>(body, JsonOptions);
            return parsed ?? [];
        }
        catch
        {
            return [];
        }
    }

    private static TpbTorrent MapTorrent(ApibayResult r)
    {
        var name = r.Name?.Trim() ?? "";
        var quality = ExtractQuality(name);
        var format = FormatRegex.Match(name) is { Success: true } fm ? fm.Groups[1].Value.ToUpperInvariant() : "Unknown";
        var size = FormatBytes(r.Size);
        var badges = ExtractBadges(name, r.Seeders);

        var magnet = BuildMagnet(r.InfoHash, name);
        var torrentUrl = string.IsNullOrWhiteSpace(r.Id)
            ? ""
            : $"https://apibay.org/t.php?id={Uri.EscapeDataString(r.Id)}";

        return new TpbTorrent(name, size, quality, format, badges, magnet, torrentUrl);
    }

    private static string FormatBytes(string? sizeRaw)
    {
        if (!long.TryParse(sizeRaw, out var bytes) || bytes <= 0)
            return "";

        const double kb = 1024;
        const double mb = kb * 1024;
        const double gb = mb * 1024;

        if (bytes >= gb)
            return $"{bytes / gb:0.##} GB";
        if (bytes >= mb)
            return $"{bytes / mb:0.##} MB";
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

    private static List<string> ExtractBadges(string text, string? seedersRaw)
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

        if (Regex.IsMatch(text, @"Remux", RegexOptions.IgnoreCase))
            badges.Add("Remux");
        else if (Regex.IsMatch(text, @"WEB-DL", RegexOptions.IgnoreCase))
            badges.Add("WEB-DL");
        else if (Regex.IsMatch(text, @"WEBRip|WebRip", RegexOptions.IgnoreCase))
            badges.Add("WEBRip");
        else if (Regex.IsMatch(text, @"BluRay|Bluray|BDRip|BRRip", RegexOptions.IgnoreCase))
            badges.Add("Bluray");
        else if (Regex.IsMatch(text, @"HDTV", RegexOptions.IgnoreCase))
            badges.Add("HDTV");

        if (Regex.IsMatch(text, @"10bit|10-bit", RegexOptions.IgnoreCase))
            badges.Add("10bit");

        if (Regex.IsMatch(text, @"DDP5\.1|DD5\.1|5\.1", RegexOptions.IgnoreCase))
            badges.Add("5.1Ch");
        else if (Regex.IsMatch(text, @"7\.1", RegexOptions.IgnoreCase))
            badges.Add("7.1Ch");

        if (int.TryParse(seedersRaw, out var seeds) && seeds > 0)
            badges.Add($"{seeds} seeds");

        return badges;
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

    private sealed class ApibayResult
    {
        public string? Id { get; set; }
        public string? Name { get; set; }

        [JsonPropertyName("info_hash")]
        public string? InfoHash { get; set; }

        public string? Seeders { get; set; }
        public string? Size { get; set; }
        public string? Imdb { get; set; }
    }
}
