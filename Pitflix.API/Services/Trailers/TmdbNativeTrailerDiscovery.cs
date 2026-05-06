using Microsoft.Extensions.Logging;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services.Trailers;

/// <summary>
/// Discovers latest trailers directly from TMDB without relying on YouTube channel uploads.
/// Fetches recently-released content (movies: 6 months, TV: 3 months) and extracts their YouTube trailers,
/// focusing on items with recent trailer publication dates to ensure truly "latest" trailers.
/// </summary>
public sealed class TmdbNativeTrailerDiscovery
{
    private readonly ILogger _log;

    public TmdbNativeTrailerDiscovery(ILogger log)
    {
        _log = log;
    }

    /// <summary>
    /// Discover latest trailers from TMDB with recency validation.
    /// Ensures trailers are truly recent by checking publication dates and filtering out old series.
    /// </summary>
    public async Task<List<TrailerItem>> DiscoverLatestAsync(
        TmdbClient tmdb,
        DateTime? trailerPublishedAfterUtc = null,
        CancellationToken ct = default)
    {
        if (tmdb == null)
        {
            _log.LogWarning("TMDB native trailer discovery: TMDB client is null");
            return new List<TrailerItem>();
        }

        try
        {
            var publishedCutoff = trailerPublishedAfterUtc ?? DateTime.UtcNow.AddDays(-14);
            
            _log.LogInformation(
                "TMDB native trailer discovery starting: looking for trailers published after {PublishedCutoff:o}",
                publishedCutoff);

            var latestTrailers = await tmdb.GetLatestTmdbTrailersAsync(ct).ConfigureAwait(false);

            if (latestTrailers.Count == 0)
            {
                _log.LogInformation("TMDB native trailer discovery: no trailers found");
                return new List<TrailerItem>();
            }

            var filtered = new List<TrailerItem>();
            var skipped = 0;
            var mediaAgeCutoff = DateTime.UtcNow.AddDays(-180); // 6 months age limit for media

            foreach (var (tmdbId, mediaType, title, releaseDate, videoKey, videoName, videoType, publishedAt,
                         voteAverage, voteCount) in latestTrailers)
            {
                // Primary filter: only on trailer publication date
                if (publishedAt == null || publishedAt < publishedCutoff)
                {
                    skipped++;
                    continue;
                }

                // Secondary filter: Media age. Don't show trailers for stuff that's been out for a long time.
                if (!string.IsNullOrEmpty(releaseDate) && DateTime.TryParse(releaseDate, out var airDate))
                {
                    if (airDate < mediaAgeCutoff)
                    {
                        skipped++;
                        _log.LogDebug("Skip old media: {Title} (released {ReleaseDate})", title, releaseDate);
                        continue;
                    }
                }

                var item = new TrailerItem
                {
                    VideoId = videoKey,
                    YoutubeUrl = $"https://www.youtube.com/watch?v={videoKey}",
                    Title = videoName,
                    ChannelName = "TMDB", // Indicates this came from TMDB's video metadata, not a channel
                    ChannelId = "tmdb-native",
                    IngestionSource = "tmdb_native",
                    MatchConfidence = 0.95, // High confidence since TMDB matched it
                    TrustTier = 1,
                    TmdbId = tmdbId,
                    MediaType = mediaType == "tv" ? "Series" : "Movie",
                    PublishedAtUtc = publishedAt.Value,
                    QualityScore = ComputeQualityScore(publishedAt, videoType, voteAverage, voteCount),
                    IsActive = true
                };

                filtered.Add(item);
            }

            _log.LogInformation(
                "TMDB native trailer discovery: fetched {FetchedCount} trailers, skipped {SkippedCount}, filtered to {FilteredCount} with recent publications",
                latestTrailers.Count, skipped, filtered.Count);

            return filtered;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "TMDB native trailer discovery failed");
            return new List<TrailerItem>();
        }
    }

    /// <summary>
    /// Quality score combining recency (most important), video type, and source popularity.
    /// </summary>
    private static double ComputeQualityScore(DateTime? publishedAt, string videoType, double voteAverage, int voteCount)
    {
        if (publishedAt == null)
            return 0.1;

        var recency = 0.0;
        var daysSincePublished = (DateTime.UtcNow - publishedAt.Value).TotalDays;
        if (daysSincePublished <= 1)
            recency = 0.40;
        else if (daysSincePublished <= 7)
            recency = 0.35;
        else if (daysSincePublished <= 14)
            recency = 0.30;
        else if (daysSincePublished <= 30)
            recency = 0.20;
        else
            recency = 0.10;

        var typeWeight = videoType.Equals("Trailer", StringComparison.OrdinalIgnoreCase) ? 0.30
            : videoType.Equals("Teaser", StringComparison.OrdinalIgnoreCase) ? 0.20
            : 0.10;

        var popularityWeight = Math.Min(voteCount / 100.0, 1.0) * 0.15;

        return Math.Clamp(recency + typeWeight + popularityWeight, 0, 1.0);
    }
}
