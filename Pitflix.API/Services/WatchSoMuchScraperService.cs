using System.Net.Http.Headers;
using System.Text.RegularExpressions;
using HtmlAgilityPack;

namespace Pitflix.API.Services;

public sealed record WsmTorrent(
    string Title,
    string Size,
    string Quality,
    string Format,
    List<string> Badges,
    string MagnetLink,
    string TorrentFileUrl);

/// <summary>Scrapes watchsomuch.to title pages for torrent/magnet links. WatchSoMuch's internal ID for a
/// title is exactly the numeric part of its IMDb ID (e.g. imdb "tt0114709" -> WSM id 114709) — confirmed by
/// testing several titles directly against the live site. The site tolerates a wrong/missing tag segment
/// (redirects to canonical), but the slug must match its own slugify algorithm and the release year must be
/// exact. For TV episodes, the title page itself only embeds the *current* episode; the full season/episode
/// archive is reached via the site's own AJAX endpoint (/Movies/ajTVTorrents.aspx?mid=).</summary>
public sealed class WatchSoMuchScraperService
{
    private const string BaseUrl = "https://watchsomuch.to";
    private static readonly HttpClient _http = CreateSharedClient();

    private static readonly Regex ImdbNumericRegex = new(@"(\d+)", RegexOptions.Compiled);
    private static readonly Regex SizeRegex = new(@"(\d+\.?\d*\s*(?:GB|MB))", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex FormatRegex = new(@"\[(MKV|MP4)\]", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly (Regex Pattern, string Badge)[] BadgePatterns =
    {
        (new Regex(@"HEVC|x265", RegexOptions.IgnoreCase), "HEVC"),
        (new Regex(@"x264", RegexOptions.IgnoreCase), "x264"),
        (new Regex(@"HDR10\+", RegexOptions.IgnoreCase), "HDR10+"),
        (new Regex(@"HDR", RegexOptions.IgnoreCase), "HDR"),
        (new Regex(@"Dolby|DV", RegexOptions.IgnoreCase), "Dolby"),
        (new Regex(@"DDP5\.1|DD5\.1|5\.1", RegexOptions.IgnoreCase), "5.1Ch"),
        (new Regex(@"7\.1", RegexOptions.IgnoreCase), "7.1Ch"),
        (new Regex(@"10bit|10-bit", RegexOptions.IgnoreCase), "10bit"),
        (new Regex(@"Remux", RegexOptions.IgnoreCase), "Remux"),
        (new Regex(@"BluRay|Bluray", RegexOptions.IgnoreCase), "Bluray"),
        (new Regex(@"WEBRip|WebRip", RegexOptions.IgnoreCase), "WEBRip"),
        (new Regex(@"WEB-DL", RegexOptions.IgnoreCase), "WEB-DL"),
        (new Regex(@"HDTV", RegexOptions.IgnoreCase), "HDTV"),
    };

    private static HttpClient CreateSharedClient()
    {
        var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0");
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("text/html"));
        http.Timeout = TimeSpan.FromSeconds(20);
        return http;
    }

    /// <summary>Mirrors WatchSoMuch's own MovieData.GetMoviePath() slug algorithm (reverse-engineered from
    /// their minified client JS), since the site validates the slug strictly and 404s on a mismatch.</summary>
    private static string ToSlug(string title)
    {
        var s = title.Replace("&", "-And-");
        s = Regex.Replace(s, "'s", "s");
        s = Regex.Replace(s, @"\W+", "-", RegexOptions.ECMAScript);
        s = Regex.Replace(s, "-{2,}", "-");
        s = Regex.Replace(s, "-+$", "");
        return s;
    }

    /// <summary>Extracts the numeric WatchSoMuch/IMDb id from an "tt1234567"-style IMDb id string.</summary>
    private static int? ParseImdbNumericId(string? imdbId)
    {
        if (string.IsNullOrWhiteSpace(imdbId))
            return null;
        var match = ImdbNumericRegex.Match(imdbId);
        return match.Success && int.TryParse(match.Value, out var id) ? id : null;
    }

    public Task<IReadOnlyList<WsmTorrent>> ScrapeAsync(string imdbId, string title, int year, CancellationToken ct)
    {
        var id = ParseImdbNumericId(imdbId);
        if (id == null)
            return Task.FromResult<IReadOnlyList<WsmTorrent>>(Array.Empty<WsmTorrent>());

        var url = $"{BaseUrl}/Movie/{id}/{ToSlug(title)}-{year}";
        return ScrapeTitlePageAsync(url, null, null, ct);
    }

    /// <summary>Targets a specific season/episode by fetching the show's full archive directly from its
    /// AJAX endpoint, rather than the title page (which only ever shows the current episode).</summary>
    public Task<IReadOnlyList<WsmTorrent>> ScrapeEpisodeAsync(string imdbId, int season, int episode, CancellationToken ct)
    {
        var id = ParseImdbNumericId(imdbId);
        if (id == null)
            return Task.FromResult<IReadOnlyList<WsmTorrent>>(Array.Empty<WsmTorrent>());

        var archiveUrl = $"{BaseUrl}/Movies/ajTVTorrents.aspx?mid={id}";
        return ScrapeTitlePageAsync(archiveUrl, season, episode, ct);
    }

    /// <summary>Targets a season's "full season pack" releases (e.g. header "S05" or "S05 - Full Season"),
    /// as opposed to a single episode's releases.</summary>
    public Task<IReadOnlyList<WsmTorrent>> ScrapeSeasonAsync(string imdbId, int season, CancellationToken ct)
    {
        var id = ParseImdbNumericId(imdbId);
        if (id == null)
            return Task.FromResult<IReadOnlyList<WsmTorrent>>(Array.Empty<WsmTorrent>());

        var archiveUrl = $"{BaseUrl}/Movies/ajTVTorrents.aspx?mid={id}";
        return ScrapeTitlePageAsync(archiveUrl, season, episode: 0, ct);
    }

    private async Task<IReadOnlyList<WsmTorrent>> ScrapeTitlePageAsync(string url, int? season, int? episode, CancellationToken ct)
    {
        try
        {
            using var res = await _http.GetAsync(url, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                return Array.Empty<WsmTorrent>();

            var html = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            var doc = new HtmlDocument();
            doc.LoadHtml(html);

            HtmlNode scope = doc.DocumentNode;
            if (season is > 0 && episode is > 0)
            {
                var episodeNode = FindEpisodeNode(doc, season.Value, episode.Value);
                if (episodeNode == null)
                    return Array.Empty<WsmTorrent>();
                scope = episodeNode;
            }
            else if (season is > 0 && episode == 0)
            {
                var seasonPackNode = FindSeasonPackNode(doc, season.Value);
                if (seasonPackNode == null)
                    return Array.Empty<WsmTorrent>();
                scope = seasonPackNode;
            }

            var downloadLinks = scope.SelectNodes(".//a[contains(@href, '/Download-')]");
            if (downloadLinks == null || downloadLinks.Count == 0)
                return Array.Empty<WsmTorrent>();

            var downloadPageUrls = new List<string>();
            foreach (var link in downloadLinks)
            {
                var href = link.GetAttributeValue("href", "");
                if (string.IsNullOrWhiteSpace(href))
                    continue;
                var absolute = href.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? href : $"{BaseUrl}{href}";
                downloadPageUrls.Add(absolute);
            }

            var results = new List<WsmTorrent>();
            using var gate = new SemaphoreSlim(5);
            var tasks = downloadPageUrls.Select(async pageUrl =>
            {
                await gate.WaitAsync(ct).ConfigureAwait(false);
                try
                {
                    return await ScrapeDownloadPageAsync(pageUrl, ct).ConfigureAwait(false);
                }
                finally
                {
                    gate.Release();
                }
            });

            var scraped = await Task.WhenAll(tasks).ConfigureAwait(false);
            foreach (var torrent in scraped)
            {
                if (torrent != null && !string.IsNullOrWhiteSpace(torrent.MagnetLink))
                    results.Add(torrent);
            }

            return results;
        }
        catch
        {
            return Array.Empty<WsmTorrent>();
        }
    }

    /// <summary>Finds the &lt;div class="episode"&gt; block whose header reads e.g. "S05E08" or
    /// "S05E08 - title" for the requested season/episode.</summary>
    private static HtmlNode? FindEpisodeNode(HtmlDocument doc, int season, int episode)
    {
        var pattern = $"S{season:D2}E{episode:D2}";
        var episodeNodes = doc.DocumentNode.SelectNodes("//div[contains(@class, 'episode')][@data-episode]");
        if (episodeNodes == null)
            return null;

        foreach (var node in episodeNodes)
        {
            var headerText = node.SelectSingleNode(".//div[contains(@class, 'episodeHeader')]//span[contains(@class, 'title')]")?.InnerText;
            if (headerText != null && headerText.TrimStart().StartsWith(pattern, StringComparison.OrdinalIgnoreCase))
                return node;
        }

        return null;
    }

    /// <summary>Finds the season-pack entry (header reads e.g. "S05" or "S05 - Full Season") rather than
    /// a single episode — these always start with "S{season:D2}" not immediately followed by "E".</summary>
    private static HtmlNode? FindSeasonPackNode(HtmlDocument doc, int season)
    {
        var pattern = $"S{season:D2}";
        var episodeNodes = doc.DocumentNode.SelectNodes("//div[contains(@class, 'episode')][@data-episode]");
        if (episodeNodes == null)
            return null;

        foreach (var node in episodeNodes)
        {
            var headerText = node.SelectSingleNode(".//div[contains(@class, 'episodeHeader')]//span[contains(@class, 'title')]")?.InnerText?.TrimStart();
            if (headerText == null || !headerText.StartsWith(pattern, StringComparison.OrdinalIgnoreCase))
                continue;

            var rest = headerText.Substring(pattern.Length);
            if (rest.Length == 0 || !char.IsDigit(rest[0]) && !rest.StartsWith("E", StringComparison.OrdinalIgnoreCase))
                return node;
        }

        return null;
    }

    private async Task<WsmTorrent?> ScrapeDownloadPageAsync(string pageUrl, CancellationToken ct)
    {
        try
        {
            using var res = await _http.GetAsync(pageUrl, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                return null;

            var html = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            var doc = new HtmlDocument();
            doc.LoadHtml(html);

            var magnetNode = doc.DocumentNode.SelectSingleNode("//a[contains(@href, 'magnet:')]");
            var magnetLink = magnetNode?.GetAttributeValue("href", "") ?? "";
            if (string.IsNullOrWhiteSpace(magnetLink))
                return null;

            var torrentNode = doc.DocumentNode.SelectSingleNode("//a[contains(@href, '/Torrent/Download.aspx')]");
            var torrentHref = torrentNode?.GetAttributeValue("href", "") ?? "";
            var torrentFileUrl = string.IsNullOrWhiteSpace(torrentHref)
                ? ""
                : torrentHref.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? torrentHref : $"{BaseUrl}{torrentHref}";

            var headingNode = doc.DocumentNode.SelectSingleNode("//h2[contains(@class, 'title')]");
            var heading = HtmlEntity.DeEntitize(headingNode?.InnerText?.Trim() ?? "");

            var sizeNode = doc.DocumentNode.SelectSingleNode("//div[@class='infoTitle' and contains(text(), 'Size:')]/following-sibling::div[1]");
            var sizeText = HtmlEntity.DeEntitize(sizeNode?.InnerText?.Trim() ?? "");
            var size = SizeRegex.Match(sizeText) is { Success: true } sizeMatch ? sizeMatch.Value : "";
            var quality = ExtractQuality(heading);
            var format = FormatRegex.Match(heading) is { Success: true } formatMatch
                ? formatMatch.Groups[1].Value.ToUpperInvariant()
                : "Unknown";
            var badges = ExtractBadges(heading);

            return new WsmTorrent(heading, size, quality, format, badges, magnetLink, torrentFileUrl);
        }
        catch
        {
            return null;
        }
    }

    private static string ExtractQuality(string text)
    {
        if (Regex.IsMatch(text, @"2160p|4K", RegexOptions.IgnoreCase)) return "4K";
        if (Regex.IsMatch(text, @"1080p|FullHD", RegexOptions.IgnoreCase)) return "1080p";
        if (Regex.IsMatch(text, @"720p|HD\b", RegexOptions.IgnoreCase)) return "720p";
        if (Regex.IsMatch(text, @"480p|SD\b", RegexOptions.IgnoreCase)) return "480p";
        return "Unknown";
    }

    private static List<string> ExtractBadges(string text)
    {
        var badges = new List<string>();
        foreach (var (pattern, badge) in BadgePatterns)
        {
            if (pattern.IsMatch(text) && !badges.Contains(badge))
                badges.Add(badge);
        }
        return badges;
    }
}
