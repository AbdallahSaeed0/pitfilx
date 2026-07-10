using System.Net.Http.Headers;
using System.Text.RegularExpressions;
using HtmlAgilityPack;

namespace Pitflix.API.Services;

public sealed record PsaTorrent(
    string Title,
    string Size,
    string Quality,
    string Format,
    List<string> Badges,
    string MagnetLink,
    string TorrentFileUrl);

/// <summary>Aggregates PSA-only releases from third-party indexers (Bitsearch, LimeTorrents).
/// Uses fallback queries when strict title+year searches return nothing.</summary>
public sealed class PsaScraperService
{
    private const string BitsearchBase = "https://bitsearch.to";
    private const string LimeBase = "https://www.limetorrents.lol";
    private static readonly HttpClient Http = CreateSharedClient();

    private static readonly string[] Trackers =
    [
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://tracker.dler.org:6969/announce",
        "udp://open.stealth.si:80/announce",
        "udp://open.demonii.com:1337/announce",
        "udp://explodie.org:6969/announce",
    ];

    private static readonly Regex FormatRegex = new(@"\b(MKV|MP4|AVI|WMV)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex SeasonEpisodeRegex = new(@"S(\d{1,2})E(\d{1,2})", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex PsaReleaseRegex = new(@"(?:^|[.\-_ \[])(?:HEVC-)?PSA(?:$|[.\-_ \]])", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex HashRegex = new(@"/torrent/([A-Fa-f0-9]{40})", RegexOptions.Compiled);
    private static readonly Regex SizeRegex = new(@"(\d+(?:\.\d+)?\s*(?:GB|MB|KB))", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex YearRegex = new(@"\b(19|20)\d{2}\b", RegexOptions.Compiled);

    private static HttpClient CreateSharedClient()
    {
        var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("text/html"));
        http.Timeout = TimeSpan.FromSeconds(25);
        return http;
    }

    public Task<IReadOnlyList<PsaTorrent>> ScrapeMovieAsync(string title, int year, CancellationToken ct)
    {
        var queries = new List<string>();
        foreach (var y in MovieSearchYears(year))
        {
            queries.Add($"{title.Trim()} {y} psa");
            queries.Add($"{title.Trim()}.{y} psa");
        }
        queries.Add($"{title.Trim()} psa");

        return AggregateAsync(queries, ct, (name, _) =>
            IsPsaRelease(name) &&
            ContainsShowTitle(name, title) &&
            !SeasonEpisodeRegex.IsMatch(name) &&
            MovieYearMatches(name, year));
    }

    public Task<IReadOnlyList<PsaTorrent>> ScrapeEpisodeAsync(string title, int season, int episode, CancellationToken ct)
    {
        var epPattern = $"S{season:D2}E{episode:D2}";
        var epPatternAlt = $"S{season}E{episode}";
        var queries = new[]
        {
            $"{title.Trim()} {epPattern} psa",
            $"{title.Trim()} {epPatternAlt} psa",
            $"{title.Trim()} {epPattern}",
            $"{title.Trim()} psa",
        };

        return AggregateAsync(queries, ct, (name, _) =>
            IsPsaRelease(name) &&
            ContainsShowTitle(name, title) &&
            (name.Contains(epPattern, StringComparison.OrdinalIgnoreCase) ||
             name.Contains(epPatternAlt, StringComparison.OrdinalIgnoreCase)));
    }

    public Task<IReadOnlyList<PsaTorrent>> ScrapeSeasonAsync(string title, int season, CancellationToken ct)
    {
        var seasonTag = $"S{season:D2}";
        var seasonTagAlt = $"S{season}";
        var queries = new[]
        {
            $"{title.Trim()} {seasonTag} psa",
            $"{title.Trim()} {seasonTagAlt} psa",
            $"{title.Trim()} Season {season} psa",
            $"{title.Trim()} psa",
        };

        return AggregateAsync(queries, ct, (name, _) =>
        {
            if (!IsPsaRelease(name) || !ContainsShowTitle(name, title))
                return false;

            if (!name.Contains(seasonTag, StringComparison.OrdinalIgnoreCase) &&
                !name.Contains(seasonTagAlt, StringComparison.OrdinalIgnoreCase) &&
                !name.Contains($"Season {season}", StringComparison.OrdinalIgnoreCase))
                return false;

            if (name.Contains("COMPLETE", StringComparison.OrdinalIgnoreCase) ||
                name.Contains("Season Pack", StringComparison.OrdinalIgnoreCase) ||
                name.Contains("Full Season", StringComparison.OrdinalIgnoreCase))
                return true;

            return !SeasonEpisodeRegex.IsMatch(name);
        });
    }

    private static bool IsPsaRelease(string name) => PsaReleaseRegex.IsMatch(name);

    private static bool ContainsShowTitle(string releaseName, string title)
    {
        var trimmed = title.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
            return false;

        var escaped = Regex.Escape(trimmed);
        // Require the show title as its own segment (avoids "Secret Obsession" when searching "Obsession").
        return Regex.IsMatch(releaseName, $@"(?:^|[.\-_\[( ])(?:\d{{4}}\.)?{escaped}(?:[.\-_\] ]|$|\d)", RegexOptions.IgnoreCase);
    }

    /// <summary>TMDB release year often differs from scene naming (e.g. 2026 vs 2025).</summary>
    private static IEnumerable<int> MovieSearchYears(int year)
    {
        yield return year;
        if (year > 1901)
            yield return year - 1;
        yield return year + 1;
    }

    private static bool MovieYearMatches(string releaseName, int year)
    {
        var yearsInRelease = YearRegex.Matches(releaseName)
            .Select(m => int.Parse(m.Value, System.Globalization.CultureInfo.InvariantCulture))
            .Distinct()
            .ToList();

        if (yearsInRelease.Count == 0)
            return true;

        return yearsInRelease.All(y => Math.Abs(y - year) <= 1);
    }

    private async Task<IReadOnlyList<PsaTorrent>> AggregateAsync(
        IEnumerable<string> queries,
        CancellationToken ct,
        Func<string, string, bool> titleFilter)
    {
        try
        {
            var merged = new Dictionary<string, PsaTorrent>(StringComparer.OrdinalIgnoreCase);

            foreach (var query in queries.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                using var gate = new SemaphoreSlim(2);
                var bitsearchTask = RunSourceAsync(() => ScrapeBitsearchAsync(query, ct), gate, ct);
                var limeTask = RunSourceAsync(() => ScrapeLimeAsync(query, ct), gate, ct);
                await Task.WhenAll(bitsearchTask, limeTask).ConfigureAwait(false);

                foreach (var hit in bitsearchTask.Result.Concat(limeTask.Result))
                {
                    if (!titleFilter(hit.Title, query) || !IsPsaRelease(hit.Title))
                        continue;

                    var hash = ExtractHash(hit.MagnetLink);
                    if (string.IsNullOrWhiteSpace(hash))
                        continue;

                    if (!merged.ContainsKey(hash))
                        merged[hash] = MapHit(hit);
                }

                if (merged.Count > 0)
                    break;
            }

            return merged.Values.ToList();
        }
        catch
        {
            return Array.Empty<PsaTorrent>();
        }
    }

    private static async Task<List<PsaSourceHit>> RunSourceAsync(
        Func<Task<List<PsaSourceHit>>> scrape,
        SemaphoreSlim gate,
        CancellationToken ct)
    {
        await gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            return await scrape().ConfigureAwait(false);
        }
        catch
        {
            return [];
        }
        finally
        {
            gate.Release();
        }
    }

    private static async Task<List<PsaSourceHit>> ScrapeBitsearchAsync(string query, CancellationToken ct)
    {
        var url = $"{BitsearchBase}/search?q={Uri.EscapeDataString(query)}";
        using var res = await Http.GetAsync(url, ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
            return [];

        var html = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        var doc = new HtmlDocument();
        doc.LoadHtml(html);

        var hits = new List<PsaSourceHit>();
        var seenHashes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var magnetNodes = doc.DocumentNode.SelectNodes("//a[contains(@href,'magnet:')]");
        if (magnetNodes == null)
            return hits;

        foreach (var magnetNode in magnetNodes)
        {
            var magnet = HtmlEntity.DeEntitize(magnetNode.GetAttributeValue("href", "")).Trim();
            if (string.IsNullOrWhiteSpace(magnet))
                continue;

            var hash = ExtractHash(magnet);
            if (string.IsNullOrWhiteSpace(hash) || !seenHashes.Add(hash))
                continue;

            var card = magnetNode.SelectSingleNode("ancestor::div[contains(@class,'shadow-sm')][1]");
            var title = HtmlEntity.DeEntitize(card?.SelectSingleNode(".//h3//a")?.InnerText?.Trim() ?? "");
            if (string.IsNullOrWhiteSpace(title))
                continue;

            var cardText = HtmlEntity.DeEntitize(card?.InnerText ?? "");
            var size = SizeRegex.Match(cardText) is { Success: true } m ? m.Value : "";
            var seeds = ExtractSeedCount(cardText);

            hits.Add(new PsaSourceHit(title, size, magnet, "", "Bitsearch", seeds));
        }

        return hits;
    }

    private static async Task<List<PsaSourceHit>> ScrapeLimeAsync(string query, CancellationToken ct)
    {
        var slug = Regex.Replace(query.Trim().ToLowerInvariant(), @"[^a-z0-9]+", "-").Trim('-');
        var url = $"{LimeBase}/search/all/{slug}/";
        using var res = await Http.GetAsync(url, ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
            return [];

        var html = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        var doc = new HtmlDocument();
        doc.LoadHtml(html);

        var hits = new List<PsaSourceHit>();
        var rows = doc.DocumentNode.SelectNodes("//tr[.//div[contains(@class,'tt-name')]]");
        if (rows == null)
            return hits;

        foreach (var row in rows)
        {
            var ttName = row.SelectSingleNode(".//div[contains(@class,'tt-name')]");
            if (ttName == null)
                continue;

            var title = "";
            HtmlNode? torrentHrefNode = null;
            foreach (var link in ttName.SelectNodes(".//a") ?? Enumerable.Empty<HtmlNode>())
            {
                var href = link.GetAttributeValue("href", "");
                if (href.Contains("itorrents.net/torrent/", StringComparison.OrdinalIgnoreCase))
                    torrentHrefNode = link;
                else if (!href.StartsWith("/leet", StringComparison.OrdinalIgnoreCase) &&
                         !href.StartsWith("http", StringComparison.OrdinalIgnoreCase) &&
                         link.InnerText.Trim().Length > 0)
                    title = HtmlEntity.DeEntitize(link.InnerText.Trim());
            }

            if (string.IsNullOrWhiteSpace(title))
                title = HtmlEntity.DeEntitize(ttName.InnerText.Trim());

            if (title.Contains("Download", StringComparison.OrdinalIgnoreCase) && title.Length < 20)
                continue;

            var torrentHref = torrentHrefNode?.GetAttributeValue("href", "") ?? "";
            var hashMatch = HashRegex.Match(torrentHref);
            if (!hashMatch.Success)
                continue;

            var hash = hashMatch.Groups[1].Value;
            var magnet = BuildMagnet(hash, title);
            var torrentUrl = torrentHref.StartsWith("http", StringComparison.OrdinalIgnoreCase)
                ? torrentHref
                : $"http://itorrents.net/torrent/{hash}.torrent";

            var size = "";
            var seeds = 0;
            foreach (var cell in row.SelectNodes(".//td[contains(@class,'tdnormal')]") ?? Enumerable.Empty<HtmlNode>())
            {
                var text = HtmlEntity.DeEntitize(cell.InnerText.Trim());
                if (SizeRegex.IsMatch(text))
                    size = SizeRegex.Match(text).Value;
            }

            var seedCell = row.SelectSingleNode(".//td[contains(@class,'tdseed')]");
            if (seedCell != null && int.TryParse(HtmlEntity.DeEntitize(seedCell.InnerText.Trim()), out var s))
                seeds = s;

            hits.Add(new PsaSourceHit(title, size, magnet, torrentUrl, "LimeTorrents", seeds));
        }

        return hits;
    }

    private static PsaTorrent MapHit(PsaSourceHit hit)
    {
        var quality = ExtractQuality(hit.Title);
        var format = FormatRegex.Match(hit.Title) is { Success: true } fm ? fm.Groups[1].Value.ToUpperInvariant() : "Unknown";
        var badges = ExtractBadges(hit.Title, hit.Seeds);
        badges.Add(hit.Source);

        return new PsaTorrent(hit.Title, hit.Size, quality, format, badges, hit.MagnetLink, hit.TorrentFileUrl);
    }

    private static string ExtractHash(string magnet)
    {
        var match = Regex.Match(magnet, @"btih:([A-Fa-f0-9]{40})", RegexOptions.IgnoreCase);
        return match.Success ? match.Groups[1].Value : "";
    }

    private static int ExtractSeedCount(string text)
    {
        var match = Regex.Match(text, @"(\d+)\s*seeders", RegexOptions.IgnoreCase);
        return match.Success && int.TryParse(match.Groups[1].Value, out var seeds) ? seeds : 0;
    }

    private static string ExtractQuality(string text)
    {
        if (Regex.IsMatch(text, @"2160p|4K", RegexOptions.IgnoreCase)) return "4K";
        if (Regex.IsMatch(text, @"1080p|FullHD", RegexOptions.IgnoreCase)) return "1080p";
        if (Regex.IsMatch(text, @"720p|\bHD\b", RegexOptions.IgnoreCase)) return "720p";
        if (Regex.IsMatch(text, @"480p|\bSD\b", RegexOptions.IgnoreCase)) return "480p";
        return "Unknown";
    }

    private static List<string> ExtractBadges(string text, int seeds)
    {
        var badges = new List<string> { "PSA" };

        if (Regex.IsMatch(text, @"HEVC|x265|H\.265", RegexOptions.IgnoreCase))
            badges.Add("HEVC");
        else if (Regex.IsMatch(text, @"x264|H\.264", RegexOptions.IgnoreCase))
            badges.Add("x264");

        if (Regex.IsMatch(text, @"10bit|10-bit", RegexOptions.IgnoreCase))
            badges.Add("10bit");

        if (Regex.IsMatch(text, @"WEB-DL", RegexOptions.IgnoreCase))
            badges.Add("WEB-DL");
        else if (Regex.IsMatch(text, @"WEBRip|WebRip", RegexOptions.IgnoreCase))
            badges.Add("WEBRip");
        else if (Regex.IsMatch(text, @"BluRay|Bluray|BDRip|BRRip", RegexOptions.IgnoreCase))
            badges.Add("Bluray");

        if (Regex.IsMatch(text, @"DDP5\.1|DD5\.1|5\.1|6CH", RegexOptions.IgnoreCase))
            badges.Add("5.1Ch");

        if (seeds > 0)
            badges.Add($"{seeds} seeds");

        return badges;
    }

    private static string BuildMagnet(string hash, string displayName)
    {
        var parts = new List<string>
        {
            $"magnet:?xt=urn:btih:{hash.Trim()}",
            $"dn={Uri.EscapeDataString(displayName)}",
        };
        parts.AddRange(Trackers.Select(tr => $"tr={Uri.EscapeDataString(tr)}"));
        return string.Join("&", parts);
    }

    private sealed record PsaSourceHit(
        string Title,
        string Size,
        string MagnetLink,
        string TorrentFileUrl,
        string Source,
        int Seeds);
}
