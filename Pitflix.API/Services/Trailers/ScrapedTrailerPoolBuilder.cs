using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Pitflix.Core.Api;
using Pitflix.Core.Models;

namespace Pitflix.API.Services.Trailers;

/// <summary>
/// Builds TMDB discover rows from external discovery: optional Invidious search (unofficial JSON API), optional YouTube Data API search, RSS channel feeds — merged ahead of TMDB-only pools.
/// </summary>
public static class ScrapedTrailerPoolBuilder
{
    /// <param name="externalBudgetSeconds">
    /// Hard cap for Invidious + YouTube search + RSS fetch + TMDB resolve (linked cancellation). Omit for full probes (e.g. rss-status).
    /// </param>
    public static Task<(List<TmdbDiscoverItem> Items, TrailerRssDiscoveryDiagnostics Diagnostics)> BuildFromYoutubeRssAsync(
        IHttpClientFactory httpFactory,
        TmdbClient tmdb,
        IConfiguration configuration,
        CancellationToken ct,
        ILogger? logger = null,
        int? maxRssTitlesToResolveOverride = null,
        int? externalBudgetSeconds = null,
        int? invidiousMaxQueries = null,
        int? invidiousMaxBaseUrls = null,
        int? httpSearchMaxRetriesOverride = null,
        int? httpSearchPerAttemptTimeoutSecondsOverride = null) =>
        BuildFromYoutubeRssCoreAsync(httpFactory, tmdb, configuration, ct, logger, maxRssTitlesToResolveOverride,
            externalBudgetSeconds, invidiousMaxQueries, invidiousMaxBaseUrls, httpSearchMaxRetriesOverride,
            httpSearchPerAttemptTimeoutSecondsOverride);

    private static async Task<(List<TmdbDiscoverItem> Items, TrailerRssDiscoveryDiagnostics Diagnostics)>
        BuildFromYoutubeRssCoreAsync(
            IHttpClientFactory httpFactory,
            TmdbClient tmdb,
            IConfiguration configuration,
            CancellationToken ct,
            ILogger? logger,
            int? maxRssTitlesToResolveOverride,
            int? externalBudgetSeconds,
            int? invidiousMaxQueries,
            int? invidiousMaxBaseUrls,
            int? httpSearchMaxRetriesOverride,
            int? httpSearchPerAttemptTimeoutSecondsOverride)
    {
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(ct);
        if (externalBudgetSeconds is int secs && secs > 0)
            budget.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(secs, 8, 90)));
        var workCt = budget.Token;

        var rssEnabled = configuration.GetValue("TrailerDiscovery:EnableYoutubeRss", true);
        var apiKey = configuration["TrailerDiscovery:YoutubeDataApiKey"] ?? "";
        var searchConfigured = configuration.GetValue("TrailerDiscovery:EnableYoutubeSearch", false)
            && !string.IsNullOrWhiteSpace(apiKey);
        var invidiousBases = InvidiousSearchTrailerDiscovery.NormalizeBaseUrls(
            configuration["TrailerDiscovery:InvidiousBaseUrl"],
            configuration.GetSection("TrailerDiscovery:InvidiousBaseUrls").GetChildren()
                .Select(c => c.Value)
                .Where(v => !string.IsNullOrWhiteSpace(v))
                .Select(v => v!));
        var invidiousConfigured = configuration.GetValue("TrailerDiscovery:EnableInvidiousSearch", false)
            && invidiousBases.Count > 0;
        var searchMaxRetries = Math.Clamp(
            httpSearchMaxRetriesOverride ?? configuration.GetValue("TrailerDiscovery:HttpSearchMaxRetries", 3), 1, 8);
        var searchTimeoutSec = httpSearchPerAttemptTimeoutSecondsOverride
            ?? configuration.GetValue("TrailerDiscovery:HttpSearchPerAttemptTimeoutSeconds", 22);
        var searchPerAttemptTimeout = TimeSpan.FromSeconds(Math.Clamp(searchTimeoutSec, 5, 90));
        var searchPublishedAfterDays = configuration.GetValue("TrailerDiscovery:SearchPublishedAfterDays", 10);
        var invidiousSortBy = (configuration["TrailerDiscovery:InvidiousSearchSortBy"] ?? "upload_date").Trim();

        var channelIds = configuration
            .GetSection("TrailerDiscovery:YoutubeChannelIds")
            .GetChildren()
            .Select(c => c.Value)
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Select(v => v!.Trim())
            .ToArray();
        if (channelIds.Length == 0)
            channelIds = DefaultChannelIds;

        if (!rssEnabled && !searchConfigured && !invidiousConfigured)
        {
            logger?.LogInformation(
                "Trailer external discovery: skipped (RSS off; Invidious off; YouTube Data API search off)");
            return (new List<TmdbDiscoverItem>(),
                new TrailerRssDiscoveryDiagnostics(false, channelIds.Length, 0, 0, Array.Empty<string>(), null));
        }

        var maxResolve = maxRssTitlesToResolveOverride
            ?? configuration.GetValue("TrailerDiscovery:MaxRssTitlesToResolve", 28);
        var maxPerCh = configuration.GetValue("TrailerDiscovery:RssMaxEntriesPerChannel", 12);
        var http = httpFactory.CreateClient();

        var mergedRaw = new List<RawTrailerCandidate>();
        var seenVideo = new HashSet<string>(StringComparer.Ordinal);
        IReadOnlyList<string> channelErrors = Array.Empty<string>();
        var searchRawEntries = 0;
        string? searchError = null;
        var invidiousRawEntries = 0;
        string? invidiousError = null;

        void AddBatchDedupe(IEnumerable<RawTrailerCandidate> batch)
        {
            foreach (var r in batch)
            {
                var id = YoutubeRssTrailerDiscovery.TryExtractVideoId(r.SourceUrl);
                if (string.IsNullOrEmpty(id))
                    continue;
                if (!seenVideo.Add(id))
                    continue;
                mergedRaw.Add(r);
            }
        }

        // RSS first: Invidious can stall on dead instances (many retries × long timeouts) and would block RSS entirely.
        if (rssEnabled)
        {
            try
            {
                IReadOnlyList<RawTrailerCandidate> raw;
                (raw, channelErrors) = await YoutubeRssTrailerDiscovery.FetchRecentFromChannelsAsync(
                    http, channelIds, maxPerCh, workCt).ConfigureAwait(false);
                AddBatchDedupe(raw);
            }
            catch (Exception ex)
            {
                logger?.LogWarning(ex, "Trailer RSS: fetch failed");
                channelErrors = new[] { ex.Message };
            }
        }

        if (invidiousConfigured)
        {
            try
            {
                var queries = ReadYoutubeSearchQueries(configuration);
                var maxInv = configuration.GetValue("TrailerDiscovery:MaxInvidiousResultsPerQuery", 15);
                var ir = await InvidiousSearchTrailerDiscovery
                    .FetchFromSearchAsync(http, invidiousBases, queries, maxInv, searchMaxRetries, searchPerAttemptTimeout,
                        searchPublishedAfterDays, invidiousSortBy, logger, workCt,
                        maxQueries: invidiousMaxQueries, maxBaseUrls: invidiousMaxBaseUrls)
                    .ConfigureAwait(false);
                invidiousRawEntries = ir.Count;
                AddBatchDedupe(ir);
                logger?.LogInformation("Trailer Invidious search: {Count} video(s) from {Q} quer(ies); {Bases} base URL(s)",
                    ir.Count, queries.Count, invidiousBases.Count);
            }
            catch (Exception ex)
            {
                invidiousError = ex.Message;
                logger?.LogWarning(ex, "Trailer Invidious search failed");
            }
        }

        if (searchConfigured)
        {
            try
            {
                var queries = ReadYoutubeSearchQueries(configuration);
                var maxResults = configuration.GetValue("TrailerDiscovery:MaxYoutubeSearchResultsPerQuery", 12);
                var sr = await YoutubeDataApiTrailerDiscovery
                    .FetchFromSearchAsync(http, apiKey, queries, maxResults, searchMaxRetries, searchPerAttemptTimeout,
                        searchPublishedAfterDays, logger, workCt)
                    .ConfigureAwait(false);
                searchRawEntries = sr.Count;
                AddBatchDedupe(sr);
                logger?.LogInformation("Trailer YouTube search API: {Count} video(s) from {Q} quer(ies)",
                    sr.Count, queries.Count);
            }
            catch (Exception ex)
            {
                searchError = ex.Message;
                logger?.LogWarning(ex, "Trailer YouTube search API failed");
            }
        }

        if (mergedRaw.Count == 0)
        {
            var diagEmpty = new TrailerRssDiscoveryDiagnostics(
                true,
                channelIds.Length,
                0,
                0,
                channelErrors,
                "no_raw_candidates",
                searchRawEntries,
                searchError,
                invidiousRawEntries,
                invidiousError);
            logger?.LogWarning(
                "Trailer external discovery: 0 raw candidates (invidious {Invidious}, search {SearchCount}, RSS {RssEnabled})",
                invidiousRawEntries, searchRawEntries, rssEnabled);
            return (new List<TmdbDiscoverItem>(), diagEmpty);
        }

        var seenKeys = new HashSet<string>(StringComparer.Ordinal);
        var resolved = new List<TmdbDiscoverItem>();
        var orderedRaw = mergedRaw
            .OrderByDescending(x => x.PublishedAtUtc ?? DateTime.MinValue)
            .ToList();
        var resolveConcurrency = Math.Clamp(
            configuration.GetValue("TrailerDiscovery:MaxTmdbResolveConcurrency", 4), 1, 8);

        for (var i = 0; i < orderedRaw.Count && resolved.Count < maxResolve; i += resolveConcurrency)
        {
            workCt.ThrowIfCancellationRequested();
            var chunk = orderedRaw.Skip(i).Take(resolveConcurrency).ToList();
            var chunkRows = await Task.WhenAll(chunk.Select(async r =>
            {
                try
                {
                    return await ScrapedTrailerTmdbResolver.TryResolveAsync(r, tmdb, workCt).ConfigureAwait(false);
                }
                catch
                {
                    return null;
                }
            })).ConfigureAwait(false);

            foreach (var row in chunkRows)
            {
                if (resolved.Count >= maxResolve)
                    break;
                if (row == null)
                    continue;
                var k = $"{row.MediaType}:{row.Id}";
                if (!seenKeys.Add(k))
                    continue;
                resolved.Add(row);
            }
        }

        var diagnostics = new TrailerRssDiscoveryDiagnostics(
            true,
            channelIds.Length,
            mergedRaw.Count,
            resolved.Count,
            channelErrors,
            null,
            searchRawEntries,
            searchError,
            invidiousRawEntries,
            invidiousError);

        if (channelErrors.Count > 0)
            logger?.LogWarning(
                "Trailer external discovery: {Raw} raw → {Resolved} TMDB; {ErrCount} RSS feed issue(s); invidious {Invidious}; official search {SearchRaw}",
                mergedRaw.Count, resolved.Count, channelErrors.Count, invidiousRawEntries, searchRawEntries);
        else
            logger?.LogInformation(
                "Trailer external discovery: {Raw} raw (invidious {Invidious}, official search {SearchRaw}) → {Resolved} TMDB title(s)",
                mergedRaw.Count, invidiousRawEntries, searchRawEntries, resolved.Count);

        return (resolved, diagnostics);
    }

    private static IReadOnlyList<string> ReadYoutubeSearchQueries(IConfiguration configuration)
    {
        var list = configuration
            .GetSection("TrailerDiscovery:YoutubeSearchQueries")
            .GetChildren()
            .Select(c => c.Value)
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Select(v => v!.Trim())
            .ToList();
        if (list.Count > 0)
            return list;

        var y = DateTime.UtcNow.Year;
        // Match YouTube’s generic “trailers” search + a few focused queries; narrow list in appsettings if needed.
        return new[]
        {
            "trailers",
            $"official trailer {y}",
            "tv series official trailer"
        };
    }

    /// <summary>Well-known trailer channels (Atom RSS). Override via TrailerDiscovery:YoutubeChannelIds array.</summary>
    private static readonly string[] DefaultChannelIds =
    {
        "UC3PaKrV0Z1oxQq7yEJih5KA", // FilmSelect Trailer
        "UCp0rADOT9K4HrjpV6Cfr6YQ", // IGN Movie Trailers
        "UCKvn9VBLtVvDr4nWKU6cHZA", // Rotten Tomatoes Trailers
    };
}
