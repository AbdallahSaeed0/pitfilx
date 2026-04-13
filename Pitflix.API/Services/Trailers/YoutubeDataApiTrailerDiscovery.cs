using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Pitflix.API.Services.Trailers;

/// <summary>
/// YouTube Data API v3 search — same intent as YouTube’s search box. Hardened with retries and quota-aware early stop.
/// </summary>
public static class YoutubeDataApiTrailerDiscovery
{
    /// <param name="publishedAfterDays">Only videos uploaded on or after <c>UtcNow - days</c> (YouTube <c>publishedAfter</c> + client filter). Mimics “Recently uploaded” / last-days behavior.</param>
    public static async Task<IReadOnlyList<RawTrailerCandidate>> FetchFromSearchAsync(
        HttpClient http,
        string apiKey,
        IReadOnlyList<string> queries,
        int maxResultsPerQuery,
        int maxRetries,
        TimeSpan perAttemptTimeout,
        int publishedAfterDays,
        ILogger? logger,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(apiKey) || queries.Count == 0)
            return Array.Empty<RawTrailerCandidate>();

        maxResultsPerQuery = Math.Clamp(maxResultsPerQuery, 1, 25);
        maxRetries = Math.Clamp(maxRetries, 1, 8);
        publishedAfterDays = Math.Clamp(publishedAfterDays, 1, 90);
        var publishedAfterUtc = DateTime.UtcNow.AddDays(-publishedAfterDays);
        var publishedAfterParam = publishedAfterUtc.ToString("yyyy-MM-dd'T'HH:mm:ss.fffZ");

        var list = new List<RawTrailerCandidate>();
        var seenIds = new HashSet<string>(StringComparer.Ordinal);
        var key = apiKey.Trim();

        foreach (var q in queries)
        {
            if (string.IsNullOrWhiteSpace(q))
                continue;

            // order=date: newest first; publishedAfter: server-side window like YouTube’s “last days”
            var url =
                "https://www.googleapis.com/youtube/v3/search?" +
                "part=snippet&type=video&order=date&videoEmbeddable=true&safeSearch=moderate" +
                $"&publishedAfter={Uri.EscapeDataString(publishedAfterParam)}" +
                $"&maxResults={maxResultsPerQuery}" +
                $"&q={Uri.EscapeDataString(q.Trim())}" +
                $"&key={Uri.EscapeDataString(key)}";

            string? body = null;
            try
            {
                using var resp = await TrailerYoutubeSearchResilience.TrySendGetWithRetriesAsync(
                        http, url, TrailerYoutubeSearchResilience.DefaultUserAgent, maxRetries, perAttemptTimeout, ct)
                    .ConfigureAwait(false);
                if (resp == null)
                {
                    logger?.LogWarning("YouTube Data API: no response for query after retries: {Query}", q);
                    continue;
                }

                body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                if (!resp.IsSuccessStatusCode)
                {
                    logger?.LogWarning("YouTube Data API: HTTP {Code} for query {Query}", (int)resp.StatusCode, q);
                    if (body != null && TrailerYoutubeSearchResilience.LooksLikeYoutubeQuotaExceeded(body))
                    {
                        logger?.LogWarning("YouTube Data API: quota/limit hit — stopping further search queries this run.");
                        break;
                    }

                    continue;
                }
            }
            catch (Exception ex)
            {
                logger?.LogDebug(ex, "YouTube Data API: request failed for query {Query}", q);
                continue;
            }

            if (string.IsNullOrEmpty(body))
                continue;

            if (TrailerYoutubeSearchResilience.LooksLikeYoutubeQuotaExceeded(body))
            {
                logger?.LogWarning("YouTube Data API: quota/limit in body — stopping further search queries this run.");
                break;
            }

            if (!TrailerYoutubeSearchResilience.TryParseJsonDocument(body, out var doc) || doc is null)
            {
                logger?.LogWarning("YouTube Data API: invalid JSON for query {Query}", q);
                continue;
            }

            using (doc)
            {
                if (!doc.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
                    continue;

                foreach (var item in items.EnumerateArray())
                {
                    if (!item.TryGetProperty("id", out var idEl))
                        continue;
                    var vid = idEl.TryGetProperty("videoId", out var v) ? v.GetString() : null;
                    if (string.IsNullOrWhiteSpace(vid) || vid.Length != 11)
                        continue;
                    if (!seenIds.Add(vid))
                        continue;

                    if (!item.TryGetProperty("snippet", out var sn))
                        continue;
                    var title = sn.TryGetProperty("title", out var t) ? t.GetString()?.Trim() : null;
                    if (string.IsNullOrWhiteSpace(title) || title.Length < 3)
                        continue;

                    DateTime? pub = null;
                    var pubRaw = sn.TryGetProperty("publishedAt", out var p) ? p.GetString() : null;
                    if (!string.IsNullOrWhiteSpace(pubRaw) &&
                        DateTime.TryParse(pubRaw, System.Globalization.CultureInfo.InvariantCulture,
                            System.Globalization.DateTimeStyles.AssumeUniversal |
                            System.Globalization.DateTimeStyles.AdjustToUniversal,
                            out var dto))
                        pub = dto;

                    if (pub.HasValue && pub.Value < publishedAfterUtc)
                        continue;

                    var href = $"https://www.youtube.com/watch?v={vid}";
                    list.Add(new RawTrailerCandidate(
                        RawTitle: title,
                        SourceUrl: href,
                        ThumbnailUrl: $"https://img.youtube.com/vi/{vid}/hqdefault.jpg",
                        PublishedAtUtc: pub,
                        SourceName: "youtube-data-api:search",
                        InferredTrailerType: null));
                }
            }
        }

        return list;
    }
}
