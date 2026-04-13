using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Pitflix.API.Services.Trailers;

/// <summary>
/// Invidious-compatible <c>/api/v1/search</c> — YouTube-like search without a Data API key. Supports multiple base URLs (fallback when instances go down).
/// </summary>
public static class InvidiousSearchTrailerDiscovery
{
    /// <summary>First non-empty wins: <paramref name="primary"/> then <paramref name="fallbackList"/>.</summary>
    public static IReadOnlyList<string> NormalizeBaseUrls(string? primary, IEnumerable<string>? fallbackList)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var list = new List<string>();
        foreach (var u in new[] { primary }.Concat(fallbackList ?? Array.Empty<string>()))
        {
            var s = u?.Trim().TrimEnd('/') ?? "";
            if (s.Length < 8)
                continue;
            if (!s.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !s.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                continue;
            if (set.Add(s))
                list.Add(s);
        }

        return list;
    }

    /// <param name="publishedAfterDays">Drop videos older than this window (uses <c>published</c> unix time when present).</param>
    /// <param name="sortBy">Invidious <c>sort_by</c>, e.g. <c>upload_date</c> for newest-first (like YouTube “Recently uploaded”). Empty = omit.</param>
    /// <param name="maxQueries">When set, only the first N search strings are used (keeps home-row requests under client timeouts).</param>
    /// <param name="maxBaseUrls">When set, only the first N base URLs are tried per query (fewer slow fallbacks).</param>
    public static async Task<IReadOnlyList<RawTrailerCandidate>> FetchFromSearchAsync(
        HttpClient http,
        IReadOnlyList<string> invidiousBaseUrls,
        IReadOnlyList<string> queries,
        int maxResultsPerQuery,
        int maxRetries,
        TimeSpan perAttemptTimeout,
        int publishedAfterDays,
        string? sortBy,
        ILogger? logger,
        CancellationToken ct,
        int? maxQueries = null,
        int? maxBaseUrls = null)
    {
        if (invidiousBaseUrls.Count == 0 || queries.Count == 0)
            return Array.Empty<RawTrailerCandidate>();

        if (maxQueries is int mq && mq > 0)
            queries = queries.Take(mq).ToList();
        if (maxBaseUrls is int mb && mb > 0)
            invidiousBaseUrls = invidiousBaseUrls.Take(mb).ToList();

        maxResultsPerQuery = Math.Clamp(maxResultsPerQuery, 1, 40);
        maxRetries = Math.Clamp(maxRetries, 1, 8);
        publishedAfterDays = Math.Clamp(publishedAfterDays, 1, 90);
        var publishedAfterUtc = DateTime.UtcNow.AddDays(-publishedAfterDays);
        var sortPart = string.IsNullOrWhiteSpace(sortBy)
            ? ""
            : $"&sort_by={Uri.EscapeDataString(sortBy.Trim())}";

        var list = new List<RawTrailerCandidate>();
        var seenIds = new HashSet<string>(StringComparer.Ordinal);

        foreach (var q in queries)
        {
            if (string.IsNullOrWhiteSpace(q))
                continue;

            var gotAny = false;
            foreach (var baseUrl in invidiousBaseUrls)
            {
                var urlPrimary =
                    $"{baseUrl}/api/v1/search?q={Uri.EscapeDataString(q.Trim())}&type=video{sortPart}";
                var urlFallback = $"{baseUrl}/api/v1/search?q={Uri.EscapeDataString(q.Trim())}&type=video";
                string? json = null;
                try
                {
                    string? tryUrl = urlPrimary;
                    using var resp = await TrailerYoutubeSearchResilience.TrySendGetWithRetriesAsync(
                            http, tryUrl, TrailerYoutubeSearchResilience.DefaultUserAgent + " (invidious)",
                            maxRetries, perAttemptTimeout, ct)
                        .ConfigureAwait(false);
                    if (resp == null)
                    {
                        logger?.LogDebug("Invidious: no response for {Base} query {Query}", baseUrl, q);
                        continue;
                    }

                    json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                    var status = (int)resp.StatusCode;
                    if (!resp.IsSuccessStatusCode && !string.IsNullOrEmpty(sortPart) && status is 400 or 404 or 422)
                    {
                        logger?.LogDebug("Invidious: HTTP {Code} with sort — retrying without sort_by ({Base})", status,
                            baseUrl);
                        using var resp2 = await TrailerYoutubeSearchResilience.TrySendGetWithRetriesAsync(
                                http, urlFallback, TrailerYoutubeSearchResilience.DefaultUserAgent + " (invidious)",
                                maxRetries, perAttemptTimeout, ct)
                            .ConfigureAwait(false);
                        if (resp2 == null)
                            continue;
                        json = await resp2.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                        if (!resp2.IsSuccessStatusCode)
                        {
                            logger?.LogDebug("Invidious: HTTP {Code} {Base} for query {Query}", (int)resp2.StatusCode,
                                baseUrl, q);
                            continue;
                        }
                    }
                    else if (!resp.IsSuccessStatusCode)
                    {
                        logger?.LogDebug("Invidious: HTTP {Code} {Base} for query {Query}", status, baseUrl, q);
                        continue;
                    }
                }
                catch (Exception ex)
                {
                    logger?.LogDebug(ex, "Invidious: request failed {Base} {Query}", baseUrl, q);
                    continue;
                }

                if (string.IsNullOrEmpty(json) ||
                    !TrailerYoutubeSearchResilience.TryParseJsonDocument(json, out var doc) || doc is null)
                {
                    logger?.LogDebug("Invidious: invalid JSON from {Base} for query {Query}", baseUrl, q);
                    continue;
                }

                using (doc)
                {
                    if (doc.RootElement.ValueKind != JsonValueKind.Array)
                        continue;

                    var n = 0;
                    foreach (var el in doc.RootElement.EnumerateArray())
                    {
                        if (n >= maxResultsPerQuery)
                            break;

                        var type = el.TryGetProperty("type", out var tp) ? tp.GetString() : null;
                        if (!string.Equals(type, "video", StringComparison.OrdinalIgnoreCase))
                            continue;

                        var videoId = TryGetVideoId(el);
                        if (string.IsNullOrWhiteSpace(videoId) || videoId.Length != 11)
                            continue;
                        if (!seenIds.Add(videoId))
                            continue;

                        var title = el.TryGetProperty("title", out var t) ? t.GetString()?.Trim() : null;
                        if (string.IsNullOrWhiteSpace(title) || title.Length < 3)
                            continue;

                        DateTime? pub = null;
                        if (el.TryGetProperty("published", out var pubEl))
                        {
                            if (pubEl.ValueKind == JsonValueKind.Number && pubEl.TryGetInt64(out var unix))
                                pub = DateTimeOffset.FromUnixTimeSeconds(unix).UtcDateTime;
                        }

                        if (pub.HasValue && pub.Value < publishedAfterUtc)
                            continue;

                        var href = $"https://www.youtube.com/watch?v={videoId}";
                        list.Add(new RawTrailerCandidate(
                            RawTitle: title,
                            SourceUrl: href,
                            ThumbnailUrl: $"https://img.youtube.com/vi/{videoId}/hqdefault.jpg",
                            PublishedAtUtc: pub,
                            SourceName: $"invidious:{baseUrl}",
                            InferredTrailerType: null));
                        n++;
                    }

                    if (n > 0)
                        gotAny = true;
                }

                if (gotAny)
                    break;
            }

            if (!gotAny)
                logger?.LogWarning("Invidious: all base URLs failed for query {Query}", q);
        }

        return list;
    }

    private static string? TryGetVideoId(JsonElement el)
    {
        if (el.TryGetProperty("videoId", out var v) && v.ValueKind == JsonValueKind.String)
            return v.GetString();
        if (el.TryGetProperty("video_id", out var v2) && v2.ValueKind == JsonValueKind.String)
            return v2.GetString();
        return null;
    }
}
