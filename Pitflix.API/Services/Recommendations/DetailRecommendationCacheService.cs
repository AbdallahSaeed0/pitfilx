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
    /// <summary>Titles with a background rebuild in flight (one per title at a time).</summary>
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<(int, string), byte> Rebuilding = new();

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

            if (cached != null)
            {
                var fromCache = JsonSerializer.Deserialize<List<RecommendationCandidate>>(cached.ResultJson);
                if (fromCache != null)
                {
                    // Expired: still show it now and rebuild for next time. Rebuilding inline put a
                    // whole RecommendationEngine run (dozens of TMDB lookups) back on the detail
                    // page's critical path every 36 h per title.
                    if (cached.ExpiresAtUtc <= DateTime.UtcNow && !Pitflix.Core.Net.NetworkStatus.IsOffline)
                        RebuildInBackground(tmdb, tmdbId, mediaType, title);
                    return fromCache.Select(MapOutput).ToList<object>();
                }
            }

            var candidates = await BuildAndStoreAsync(db, tmdb, repo, tmdbId, mediaType, title, ct)
                .ConfigureAwait(false);
            return candidates.Select(MapOutput).ToList<object>();
        }
        catch
        {
            // Show an empty section rather than erroring the detail page.
            return new List<object>();
        }
    }

    private static async Task<IReadOnlyList<RecommendationCandidate>> BuildAndStoreAsync(
        LibraryContext db, TmdbClient tmdb, LibraryRepository repo,
        int tmdbId, string mediaType, string? title, CancellationToken ct)
    {
        var seeds = new List<RecommendationSeed> { new(tmdbId, mediaType, title) };
        var candidates = await RecommendationEngine.BuildAsync(tmdb, repo, db, seeds, ResultLimit, ct)
            .ConfigureAwait(false);
        var json = JsonSerializer.Serialize(candidates);
        var nowUtc = DateTime.UtcNow;
        var expiresUtc = nowUtc.Add(Ttl);

        // Upsert: a background rebuild and a first visit can race to write the same title.
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO DetailRecommendationCaches (TmdbId, MediaType, ResultJson, ComputedAtUtc, ExpiresAtUtc) VALUES ({0}, {1}, {2}, {3}, {4}) " +
            "ON CONFLICT(TmdbId, MediaType) DO UPDATE SET ResultJson = excluded.ResultJson, ComputedAtUtc = excluded.ComputedAtUtc, ExpiresAtUtc = excluded.ExpiresAtUtc",
            tmdbId, mediaType, json, nowUtc, expiresUtc).ConfigureAwait(false);
        return candidates;
    }

    /// <summary>Rebuilds an expired entry on its own DbContext — the request's one is disposed (and
    /// not safe to share) once the detail page has been answered.</summary>
    private static void RebuildInBackground(TmdbClient tmdb, int tmdbId, string mediaType, string? title)
    {
        if (!Rebuilding.TryAdd((tmdbId, mediaType), 0))
            return;
        _ = Task.Run(async () =>
        {
            try
            {
                await using var db = LibraryContext.Create();
                var repo = new LibraryRepository(db);
                await BuildAndStoreAsync(db, tmdb, repo, tmdbId, mediaType, title, CancellationToken.None)
                    .ConfigureAwait(false);
            }
            catch
            {
                /* keep the expired list; next visit tries again */
            }
            finally
            {
                Rebuilding.TryRemove((tmdbId, mediaType), out _);
            }
        });
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
