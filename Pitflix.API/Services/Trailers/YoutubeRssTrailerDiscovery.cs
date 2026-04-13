using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Pitflix.API.Services.Trailers;

/// <summary>
/// Fetches recent videos from public YouTube channel RSS feeds (Atom). No YouTube Data API key required.
/// Feeds: <c>https://www.youtube.com/feeds/videos.xml?channel_id=…</c>
/// </summary>
public static class YoutubeRssTrailerDiscovery
{
    private static readonly Regex YoutubeIdFromUrl = new(
        @"(?:youtube\.com/watch\?v=|youtu\.be/)([A-Za-z0-9_-]{11})",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static string? TryExtractVideoId(string? url)
    {
        if (string.IsNullOrWhiteSpace(url))
            return null;
        var m = YoutubeIdFromUrl.Match(url);
        return m.Success ? m.Groups[1].Value : null;
    }

    public static async Task<(IReadOnlyList<RawTrailerCandidate> Items, IReadOnlyList<string> ChannelErrors)>
        FetchRecentFromChannelsAsync(
            HttpClient http,
            IReadOnlyList<string> channelIds,
            int maxEntriesPerChannel,
            CancellationToken ct)
    {
        maxEntriesPerChannel = Math.Clamp(maxEntriesPerChannel, 1, 50);
        var list = new List<RawTrailerCandidate>();
        var errors = new List<string>();
        foreach (var id in channelIds)
        {
            if (string.IsNullOrWhiteSpace(id))
                continue;
            var trimmed = id.Trim();
            try
            {
                var url =
                    $"https://www.youtube.com/feeds/videos.xml?channel_id={Uri.EscapeDataString(trimmed)}";
                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.TryAddWithoutValidation("User-Agent", "Pitflix/1.0 (trailer discovery)");
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromSeconds(18));
                using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, timeout.Token)
                    .ConfigureAwait(false);
                if (!resp.IsSuccessStatusCode)
                {
                    errors.Add($"{trimmed}: HTTP {(int)resp.StatusCode}");
                    continue;
                }

                var xml = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                list.AddRange(ParseFeed(xml, trimmed, maxEntriesPerChannel));
            }
            catch (Exception ex)
            {
                errors.Add($"{trimmed}: {ex.GetType().Name}");
            }
        }

        return (list, errors);
    }

    private static IEnumerable<RawTrailerCandidate> ParseFeed(string xml, string channelId, int maxEntries)
    {
        XDocument doc;
        try
        {
            doc = XDocument.Parse(xml);
        }
        catch
        {
            yield break;
        }

        XNamespace atom = "http://www.w3.org/2005/Atom";
        var n = 0;
        foreach (var entry in doc.Descendants(atom + "entry"))
        {
            if (n++ >= maxEntries)
                yield break;

            var title = entry.Element(atom + "title")?.Value?.Trim() ?? "";
            if (title.Length < 3)
                continue;

            var linkEl = entry.Elements(atom + "link")
                .FirstOrDefault(l => string.Equals((string?)l.Attribute("rel"), "alternate", StringComparison.OrdinalIgnoreCase))
                ?? entry.Element(atom + "link");
            var href = (string?)linkEl?.Attribute("href") ?? "";
            if (string.IsNullOrWhiteSpace(href))
                continue;

            DateTime? pub = null;
            var pubRaw = entry.Element(atom + "published")?.Value ?? entry.Element(atom + "updated")?.Value;
            if (!string.IsNullOrWhiteSpace(pubRaw) &&
                DateTime.TryParse(pubRaw, System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                    out var dto))
                pub = dto;

            var m = YoutubeIdFromUrl.Match(href);
            var thumb = m.Success
                ? $"https://img.youtube.com/vi/{m.Groups[1].Value}/hqdefault.jpg"
                : null;

            var type = InferTrailerType(title);
            yield return new RawTrailerCandidate(
                RawTitle: title,
                SourceUrl: href,
                ThumbnailUrl: thumb,
                PublishedAtUtc: pub,
                SourceName: $"youtube-rss:{channelId}",
                InferredTrailerType: type);
        }
    }

    private static string? InferTrailerType(string title)
    {
        var t = title.ToLowerInvariant();
        if (t.Contains("teaser")) return "teaser";
        if (t.Contains("trailer")) return "trailer";
        if (t.Contains("sneak")) return "sneak peek";
        return null;
    }
}
