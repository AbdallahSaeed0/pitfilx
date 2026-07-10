using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitflix.API.Services;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Endpoints;

public static class StatsEndpoints
{
    public static void MapStatsEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/stats", async (LibraryRepository repo, LibraryContext db, CancellationToken ct) =>
        {
            var totalMovies = await db.Movies.AsNoTracking().CountAsync(m => m.IsMatched, ct).ConfigureAwait(false);
            var totalSeries = await db.Shows.AsNoTracking().CountAsync(s => s.IsMatched, ct).ConfigureAwait(false);
            var totalUnmatched = await db.ScanLogs.AsNoTracking().CountAsync(x => x.Status == "Unmatched", ct)
                .ConfigureAwait(false);
            var arabicMovies = await db.Movies.AsNoTracking().CountAsync(m => m.IsMatched && m.IsArabic, ct)
                .ConfigureAwait(false);
            var englishMovies = await db.Movies.AsNoTracking().CountAsync(m => m.IsMatched && !m.IsArabic, ct)
                .ConfigureAwait(false);
            var arabicSeries = await db.Shows.AsNoTracking().CountAsync(s => s.IsMatched && s.IsArabic, ct)
                .ConfigureAwait(false);
            var englishSeries = await db.Shows.AsNoTracking().CountAsync(s => s.IsMatched && !s.IsArabic, ct)
                .ConfigureAwait(false);
            var moviesUnwatched = await db.Movies.AsNoTracking()
                .CountAsync(m => m.IsMatched && m.WatchStatus == WatchStatuses.Unwatched, ct).ConfigureAwait(false);
            var moviesWatching = await db.Movies.AsNoTracking()
                .CountAsync(m => m.IsMatched && m.WatchStatus == WatchStatuses.Watching, ct).ConfigureAwait(false);
            var moviesCompleted = await db.Movies.AsNoTracking()
                .CountAsync(m => m.IsMatched && m.WatchStatus == WatchStatuses.Completed, ct).ConfigureAwait(false);
            var seriesUnwatched = await db.Shows.AsNoTracking()
                .CountAsync(s => s.IsMatched && s.WatchStatus == WatchStatuses.Unwatched, ct).ConfigureAwait(false);
            var seriesWatching = await db.Shows.AsNoTracking()
                .CountAsync(s => s.IsMatched && s.WatchStatus == WatchStatuses.Watching, ct).ConfigureAwait(false);
            var seriesCompleted = await db.Shows.AsNoTracking()
                .CountAsync(s => s.IsMatched && s.WatchStatus == WatchStatuses.Completed, ct).ConfigureAwait(false);
            var imgPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Pitflix", "Images");
            var imgExists = Directory.Exists(imgPath);
            var imgCount = imgExists ? Directory.GetFiles(imgPath).Length : 0;

            return Results.Json(new
            {
                totalMovies,
                totalSeries,
                totalUnmatched,
                arabicMovies,
                englishMovies,
                arabicSeries,
                englishSeries,
                moviesUnwatched,
                moviesWatching,
                moviesCompleted,
                seriesUnwatched,
                seriesWatching,
                seriesCompleted,
                imagesCachePath = ImageUrls.ImagesRoot,
                imagesFolderExists = imgExists,
                imagesRootFileCount = imgCount
            });
        });

        app.MapGet("/api/stats/watch", async (LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            var b = await repo.GetWatchStatisticsBundleAsync(tmdb, ct).ConfigureAwait(false);
            var recent = new List<MediaCardDto>();
            foreach (var o in b.RecentlyCompleted)
            {
                if (o is Movie mm)
                    recent.Add(MediaCardMappers.ToCardFromMovie(mm));
                else if (o is Show ss)
                    recent.Add(MediaCardMappers.ToCardFromShow(ss));
            }

            var mapped = recent.Select(ImageUrls.MapMediaCard).ToList();
            await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(mapped, tmdb, ct).ConfigureAwait(false);

            var recentMoviesMapped = b.RecentlyCompletedMovies.OfType<Movie>()
                .Select(MediaCardMappers.ToCardFromMovie).Select(ImageUrls.MapMediaCard).ToList();
            await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(recentMoviesMapped, tmdb, ct).ConfigureAwait(false);
            var recentSeriesMapped = b.RecentlyCompletedSeries.OfType<Show>()
                .Select(MediaCardMappers.ToCardFromShow).Select(ImageUrls.MapMediaCard).ToList();
            await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(recentSeriesMapped, tmdb, ct).ConfigureAwait(false);

            return Results.Json(new
            {
                totalWatchTimeMinutes = b.TotalWatchTimeMinutes,
                thisWeekMinutes = b.ThisWeekMinutes,
                thisMonthMinutes = b.ThisMonthMinutes,
                totalMoviesWatched = b.TotalMoviesWatched,
                totalEpisodesWatched = b.TotalEpisodesWatched,
                totalSeriesCompleted = b.TotalSeriesCompleted,
                topGenres = b.TopGenres.Select(g => new { genre = g.Genre, count = g.Count }).ToList(),
                topLanguage = b.TopLanguage,
                recentlyCompleted = mapped,
                watchStreak = b.WatchStreak,
                movieVsSeries = new { moviePercent = b.MoviePercent, seriesPercent = b.SeriesPercent },
                mostWatchedGenre = b.MostWatchedGenre,
                averageMovieRating = b.AverageMovieRating,
                averageSeriesRating = b.AverageSeriesRating,
                currentlyWatchingCount = b.CurrentlyWatchingCount,
                episodesCompletedThisWeek = b.EpisodesCompletedThisWeek,
                seriesCompletionPercent = b.SeriesCompletionPercent,
                showsWatchingLibrary = b.ShowsWatchingLibrary,
                decadeTop = b.DecadeTop.Select(d => new { decade = d.DecadeLabel, count = d.Count }).ToList(),
                rewatchSessionsApprox = b.RewatchSessionsApprox,
                movieWatchTimeMinutes = b.MovieWatchTimeMinutes,
                seriesWatchTimeMinutes = b.SeriesWatchTimeMinutes,
                movieWatchTimeMinutesWeek = b.MovieWatchTimeMinutesWeek,
                seriesWatchTimeMinutesWeek = b.SeriesWatchTimeMinutesWeek,
                movieWatchTimeMinutesMonth = b.MovieWatchTimeMinutesMonth,
                seriesWatchTimeMinutesMonth = b.SeriesWatchTimeMinutesMonth,
                longestMarathonEpisodes = b.LongestMarathonEpisodes,
                longestMarathonShowTitle = b.LongestMarathonShowTitle,
                networkCounts = b.NetworkCounts.Select(n => new { network = n.Network, count = n.Count }).ToList(),
                topMovieGenres = b.TopMovieGenres.Select(g => new { genre = g.Genre, count = g.Count }).ToList(),
                topSeriesGenres = b.TopSeriesGenres.Select(g => new { genre = g.Genre, count = g.Count }).ToList(),
                decadeTopMovies = b.DecadeTopMovies.Select(d => new { decade = d.DecadeLabel, count = d.Count }).ToList(),
                decadeTopSeries = b.DecadeTopSeries.Select(d => new { decade = d.DecadeLabel, count = d.Count }).ToList(),
                recentlyCompletedMovies = recentMoviesMapped,
                recentlyCompletedSeries = recentSeriesMapped
            }, jsonSerializerOptions);
        });

        app.MapPost("/api/episodes/{id:int}/watch", async (int id, EpisodeWatchBody body, LibraryRepository repo, CancellationToken ct) =>
        {
            var status = string.IsNullOrWhiteSpace(body.WatchStatus)
                ? WatchStatuses.Unwatched
                : body.WatchStatus!;
            if (!WatchStatuses.IsValid(status))
                return Results.BadRequest();

            await repo.UpdateEpisodeWatchStatusAsync(id, status, ct).ConfigureAwait(false);
            return Results.Json(new { success = true }, jsonSerializerOptions);
        });

        app.MapGet("/api/coming-soon", async (LibraryRepository repo, CancellationToken ct) =>
        {
            var rows = await repo.GetPinnedComingSoonAsync(ct).ConfigureAwait(false);
            return Results.Json(rows.Select(r => new
            {
                r.Id, r.TmdbId, r.MediaType, r.Title,
                r.PosterUrl, r.ReleaseDate, r.TrailerUrl, r.Overview, r.PinnedAt
            }), jsonSerializerOptions);
        });

        app.MapPost("/api/coming-soon", async (HttpRequest req, LibraryRepository repo, CancellationToken ct) =>
        {
            var body = await req.ReadFromJsonAsync<PinComingSoonBody>(cancellationToken: ct).ConfigureAwait(false);
            if (body == null || body.TmdbId <= 0)
                return Results.Json(new { success = false, error = "tmdbId is required." }, jsonSerializerOptions, statusCode: 400);

            var item = new PinnedComingSoon
            {
                TmdbId = body.TmdbId,
                MediaType = body.MediaType ?? "Movie",
                Title = body.Title ?? "",
                PosterUrl = body.PosterUrl?.Trim(),
                ReleaseDate = body.ReleaseDate?.Trim(),
                TrailerUrl = body.TrailerUrl?.Trim(),
                Overview = body.Overview?.Trim(),
            };
            var saved = await repo.PinComingSoonAsync(item, ct).ConfigureAwait(false);
            return Results.Json(new { success = true, id = saved?.Id }, jsonSerializerOptions);
        });

        app.MapDelete("/api/coming-soon/{id:int}", async (int id, LibraryRepository repo, CancellationToken ct) =>
        {
            var ok = await repo.UnpinComingSoonAsync(id, ct).ConfigureAwait(false);
            return ok
                ? Results.Json(new { success = true }, jsonSerializerOptions)
                : Results.NotFound(new { success = false, error = "Not found." });
        });
    }
}
