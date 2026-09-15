using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Api;
using Pitflix.Core.Database;

namespace Pitflix.API.Services.Recommendations;

/// <summary>Powers the detail page's "You may like this" section: a single-seed call into the shared
/// <see cref="RecommendationEngine"/>, cached per title with a TTL so repeat visits don't re-hit TMDB.</summary>
public static class DetailRecommendationCacheService
{
    private static readonly TimeSpan Ttl = TimeSpan.FromHours(36);
    private const int ResultLimit = 20;

    public static async Task<List<object>> GetOrBuildAsync(
        LibraryContext db, TmdbClient tmdb, LibraryRepository repo,
        int tmdbId, string mediaType, string? title, CancellationToken ct)
    {
        if (tmdbId <= 0)
            return new List<object>();

        try
        {
            var cached = await db.DetailRecommendationCaches.AsNoTracking()
                .FirstOrDefaultAsync(c => c.TmdbId == tmdbId && c.MediaType == mediaType, ct)
                .ConfigureAwait(false);

            if (cached != null && cached.ExpiresAtUtc > DateTime.UtcNow)
            {
                var fromCache = JsonSerializer.Deserialize<List<RecommendationCandidate>>(cached.ResultJson);
                if (fromCache != null)
                    return fromCache.Select(MapOutput).ToList<object>();
            }

            var seeds = new List<RecommendationSeed> { new(tmdbId, mediaType, title) };
            var candidates = await RecommendationEngine.BuildAsync(tmdb, repo, db, seeds, ResultLimit, ct)
                .ConfigureAwait(false);
            var json = JsonSerializer.Serialize(candidates);
            var nowUtc = DateTime.UtcNow;
            var expiresUtc = nowUtc.Add(Ttl);

            if (cached != null)
            {
                await db.Database.ExecuteSqlRawAsync(
                    "UPDATE DetailRecommendationCaches SET ResultJson = {0}, ComputedAtUtc = {1}, ExpiresAtUtc = {2} WHERE TmdbId = {3} AND MediaType = {4}",
                    json, nowUtc, expiresUtc, tmdbId, mediaType).ConfigureAwait(false);
            }
            else
            {
                await db.Database.ExecuteSqlRawAsync(
                    "INSERT INTO DetailRecommendationCaches (TmdbId, MediaType, ResultJson, ComputedAtUtc, ExpiresAtUtc) VALUES ({0}, {1}, {2}, {3}, {4})",
                    tmdbId, mediaType, json, nowUtc, expiresUtc).ConfigureAwait(false);
            }

            return candidates.Select(MapOutput).ToList<object>();
        }
        catch
        {
            // Show an empty section rather than erroring the detail page.
            return new List<object>();
        }
    }

    private static object MapOutput(RecommendationCandidate c) => new
    {
        tmdbId = c.TmdbId,
        title = c.Title,
        posterUrl = c.PosterUrl,
        year = c.Year,
        voteAverage = c.VoteAverage,
        mediaType = c.MediaType.Equals("tv", StringComparison.OrdinalIgnoreCase) ? "Series" : "Movie",
        isInLibrary = c.InLibrary,
        libraryId = c.LibraryId,
        watchStatus = c.WatchStatus,
    };
}
