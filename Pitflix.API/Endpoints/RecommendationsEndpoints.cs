using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitflix.API.Services.Recommendations;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Endpoints;

/// <summary>Auto-generated "For You" feed on the Recommendations page — background-computed from the
/// library's most recently completed titles, read from the cached LibraryRecommendations table.</summary>
public static class RecommendationsEndpoints
{
    public static void MapRecommendationsEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/recommendations/library", async (LibraryContext db, LibraryRepository repo, CancellationToken ct) =>
            await GetLibraryFeedAsync(db, repo, jsonSerializerOptions, ct).ConfigureAwait(false));

        app.MapPost("/api/recommendations/library/refresh", async (
            LibraryRecommendationsService svc, LibraryContext db, LibraryRepository repo, CancellationToken ct) =>
        {
            var refreshed = await svc.RefreshAsync(ct).ConfigureAwait(false);
            var payload = await GetLibraryFeedAsync(db, repo, jsonSerializerOptions, ct).ConfigureAwait(false);
            return refreshed ? payload : Results.Json(
                new { items = Array.Empty<object>(), computedAtUtc = (string?)null, refreshed = false,
                      error = "Could not refresh — no watch history yet, TMDB unavailable, or the batch came back empty. Showing the previous list." },
                jsonSerializerOptions);
        });
    }

    private static async Task<IResult> GetLibraryFeedAsync(
        LibraryContext db, LibraryRepository repo, JsonSerializerOptions jsonSerializerOptions, CancellationToken ct)
    {
        var rows = await db.LibraryRecommendations.AsNoTracking()
            .OrderBy(r => r.SortOrder)
            .ToListAsync(ct).ConfigureAwait(false);

        var localMovies = await db.Movies.AsNoTracking()
            .Where(m => m.IsMatched)
            .Select(m => new { m.Id, m.TmdbId, m.WatchStatus })
            .ToListAsync(ct).ConfigureAwait(false);
        var localShows = await db.Shows.AsNoTracking()
            .Where(s => s.IsMatched)
            .Select(s => new { s.Id, s.TmdbId, s.WatchStatus })
            .ToListAsync(ct).ConfigureAwait(false);
        var movieLookup = localMovies.ToDictionary(m => m.TmdbId);
        var showLookup = localShows.ToDictionary(s => s.TmdbId);

        var items = rows.Select(r =>
        {
            var isMovie = r.MediaType.Equals("movie", StringComparison.OrdinalIgnoreCase);
            var lookup = isMovie ? movieLookup : showLookup;
            lookup.TryGetValue(r.TmdbId, out var libEntry);
            var inLibrary = libEntry != null;
            List<object>? seedRefs = null;
            try
            {
                seedRefs = JsonSerializer.Deserialize<List<RecommendationSeedRef>>(r.ContributingSeedsJson)
                    ?.Select(s => (object)new { tmdbId = s.TmdbId, mediaType = s.MediaType, title = s.Title })
                    .ToList();
            }
            catch { /* ignore malformed cache row */ }

            return new
            {
                tmdbId = r.TmdbId,
                mediaType = r.MediaType,
                title = r.Title,
                year = r.Year,
                overview = r.Overview,
                posterUrl = r.PosterUrl,
                voteAverage = r.VoteAverage,
                voteCount = r.VoteCount,
                score = r.Score,
                contributingSeeds = seedRefs ?? new List<object>(),
                isInLibrary = inLibrary,
                libraryId = libEntry?.Id,
                watchStatus = libEntry?.WatchStatus,
            };
        }).ToList();

        var computedAtUtc = await repo.GetSettingAsync(LibraryRecommendationsService.ComputedAtSettingKey, ct)
            .ConfigureAwait(false);

        return Results.Json(new { items, computedAtUtc, refreshed = true, error = (string?)null }, jsonSerializerOptions);
    }
}
