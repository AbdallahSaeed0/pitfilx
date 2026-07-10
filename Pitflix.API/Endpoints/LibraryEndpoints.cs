using System.Text.Json;
using System.Threading;
using Microsoft.EntityFrameworkCore;
using Pitflix.API;
using Pitflix.API.Services;
using Pitflix.Core.Database;
using Pitflix.Core.Models;
using Pitflix.Core.Parser;
using Pitflix.Core.Scanner;

namespace Pitflix.API.Endpoints;

public static class LibraryEndpoints
{
    public static void MapLibraryEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
app.MapPost("/api/library/movies/{id:int}/refresh-metadata", async (int id, LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);
    var (ok, err) = await repo.RefreshMovieMetadataFromTmdbAsync(id, tmdb, ct).ConfigureAwait(false);
    return ok
        ? Results.Json(new { success = true }, jsonSerializerOptions)
        : Results.Json(new { success = false, error = err }, jsonSerializerOptions);
});

app.MapPost("/api/library/series/{id:int}/refresh-metadata", async (int id, LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);
    var (ok, err) = await repo.RefreshShowMetadataFromTmdbAsync(id, tmdb, ct).ConfigureAwait(false);
    return ok
        ? Results.Json(new { success = true }, jsonSerializerOptions)
        : Results.Json(new { success = false, error = err }, jsonSerializerOptions);
});

app.MapPost("/api/library/movies/{id:int}/refresh-cast", async (int id, LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);
    var (ok, err) = await repo.RefreshMovieCastFromTmdbAsync(id, tmdb, ct).ConfigureAwait(false);
    return ok
        ? Results.Json(new { success = true }, jsonSerializerOptions)
        : Results.Json(new { success = false, error = err }, jsonSerializerOptions);
});

app.MapPost("/api/library/series/{id:int}/refresh-cast", async (int id, LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);
    var (ok, err) = await repo.RefreshShowCastFromTmdbAsync(id, tmdb, ct).ConfigureAwait(false);
    return ok
        ? Results.Json(new { success = true }, jsonSerializerOptions)
        : Results.Json(new { success = false, error = err }, jsonSerializerOptions);
});

app.MapPost("/api/library/movies/{id:int}/rematch-from-file", async (int id, LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);
    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
    var (ok, newId, err) = await pipeline.RematchMovieByLibraryIdAsync(id, null, ct).ConfigureAwait(false);
    if (!ok)
        return Results.Json(new { success = false, error = err ?? "Re-match failed." }, jsonSerializerOptions);
    return Results.Json(new { success = true, libraryId = newId }, jsonSerializerOptions);
});

/// <summary>Remove library row and attach file to a specific TMDB movie id (manual fix).</summary>
app.MapPost("/api/library/movies/{id:int}/match-tmdb", async (int id, MatchTmdbBody body, LibraryRepository repo,
        RatingsRefreshQueue ratingsRefreshQueue, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    if (body.TmdbId <= 0)
        return Results.Json(new { success = false, error = "Invalid TMDB id." }, jsonSerializerOptions);

    var path = await repo.GetMovieFilePathByLibraryIdAsync(id, ct).ConfigureAwait(false);
    if (string.IsNullOrWhiteSpace(path))
        return Results.Json(new { success = false, error = "Movie not found or file path is empty." }, jsonSerializerOptions);

    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);

    if (!await repo.DeleteMovieByIdAsync(id, ct).ConfigureAwait(false))
        return Results.Json(new { success = false, error = "Movie could not be removed." }, jsonSerializerOptions);

    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
    var applied = await pipeline.MatchFileWithTmdbAsync(path, body.TmdbId, "Movie", ct).ConfigureAwait(false);
    if (!applied)
        return Results.Json(new { success = false, error = "Could not apply that TMDB title to this file." }, jsonSerializerOptions);

    var newId = await repo.GetLibraryMovieIdByFilePathAsync(path, ct).ConfigureAwait(false);
    ratingsRefreshQueue.TryEnqueueSingle(body.TmdbId, "Movie");
    return Results.Json(new { success = true, libraryId = newId }, jsonSerializerOptions);
});

app.MapPost("/api/library/series/{id:int}/rematch-from-folder", async (int id, LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);
    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
    var (ok, newId, err) = await pipeline.RematchShowByLibraryIdAsync(id, null, ct).ConfigureAwait(false);
    if (!ok)
        return Results.Json(new { success = false, error = err ?? "Re-match failed." }, jsonSerializerOptions);
    return Results.Json(new { success = true, libraryId = newId }, jsonSerializerOptions);
});

app.MapPost("/api/library/series/{id:int}/match-tmdb", async (int id, MatchTmdbBody body, LibraryRepository repo,
        RatingsRefreshQueue ratingsRefreshQueue, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    if (body.TmdbId <= 0)
        return Results.Json(new { success = false, error = "Invalid TMDB id." }, jsonSerializerOptions);

    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);

    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
    var (ok, newId, err) = await pipeline.MatchShowFolderToTmdbAsync(id, body.TmdbId, ct).ConfigureAwait(false);
    if (!ok)
        return Results.Json(new { success = false, error = err ?? "Could not apply that series to this folder." },
            jsonSerializerOptions);

    ratingsRefreshQueue.TryEnqueueSingle(body.TmdbId, "Series");
    return Results.Json(new { success = true, libraryId = newId }, jsonSerializerOptions);
});

app.MapPost("/api/library/episodes/{id:int}/rematch-from-file", async (int id, LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);

    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
    var (ok, showId, episodeId, err) = await pipeline.RematchEpisodeByLibraryIdAsync(id, null, ct).ConfigureAwait(false);
    if (!ok)
        return Results.Json(new { success = false, error = err ?? "Re-match failed." }, jsonSerializerOptions);

    return Results.Json(new { success = true, showId, episodeId }, jsonSerializerOptions);
});

app.MapPost("/api/library/episodes/{id:int}/match-tmdb", async (int id, MatchTmdbBody body, LibraryRepository repo,
        RatingsRefreshQueue ratingsRefreshQueue, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    if (body.TmdbId <= 0)
        return Results.Json(new { success = false, error = "Invalid TMDB id." }, jsonSerializerOptions);

    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);

    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
    var (ok, showId, episodeId, err) = await pipeline.RematchEpisodeFileToTmdbAsync(id, body.TmdbId, ct)
        .ConfigureAwait(false);
    if (!ok)
        return Results.Json(new { success = false, error = err ?? "Re-link failed." }, jsonSerializerOptions);

    ratingsRefreshQueue.TryEnqueueSingle(body.TmdbId, "Series");
    return Results.Json(new { success = true, showId, episodeId }, jsonSerializerOptions);
});

app.MapPost("/api/library/series/{id:int}/season/{season:int}/wrap-episodes", async (int id, int season, LibraryRepository repo, CancellationToken ct) =>
{
    var result = await repo.WrapSeasonEpisodesIntoFolderAsync(id, season, ct).ConfigureAwait(false);
    return Results.Json(new { success = result.Success, message = result.Message, movedCount = result.MovedCount, targetFolder = result.TargetFolder }, jsonSerializerOptions);
});

app.MapPost("/api/library/series/{id:int}/dropped", async (int id, DroppedBody body, LibraryRepository repo,
    Microsoft.Extensions.Caching.Memory.IMemoryCache memoryCache, CancellationToken ct) =>
{
    var ok = await repo.SetShowDroppedAsync(id, body.Dropped, ct).ConfigureAwait(false);
    if (ok)
        memoryCache.Remove("home:watching-currently");
    return ok ? Results.Json(new { success = true, dropped = body.Dropped }, jsonSerializerOptions)
              : Results.NotFound(new { success = false, error = "Series not found." });
});

app.MapPost("/api/library/movies/{id:int}/wrap-file", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var result = await repo.WrapMovieFileIntoFolderAsync(id, ct).ConfigureAwait(false);
    return Results.Json(new { success = result.Success, message = result.Message, movedCount = result.MovedCount, targetFolder = result.TargetFolder }, jsonSerializerOptions);
});

app.MapPost("/api/library/bulk-rescan-series", async (HttpRequest request, LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    var body = await request.ReadFromJsonAsync<BulkRescanSeriesRequest>(cancellationToken: ct).ConfigureAwait(false);
    if (body?.ShowIds == null || body.ShowIds.Length == 0)
        return Results.Json(new { success = false, error = "No series IDs provided." }, jsonSerializerOptions);

    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);

    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
    var results = new List<object>();
    var successCount = 0;
    var failureCount = 0;

    foreach (var showId in body.ShowIds)
    {
        var (ok, newId, err) = await pipeline.RematchShowByLibraryIdAsync(showId, null, ct).ConfigureAwait(false);
        if (ok)
        {
            successCount++;
            results.Add(new { showId, success = true, newLibraryId = newId });
        }
        else
        {
            failureCount++;
            results.Add(new { showId, success = false, error = err ?? "Re-match failed." });
        }
    }

    return Results.Json(new
    {
        success = true,
        totalProcessed = body.ShowIds.Length,
        successCount,
        failureCount,
        results
    }, jsonSerializerOptions);
});

app.MapPost("/api/library/prefetch-metadata", async (LibraryRepository repo, HttpContext http, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
    {
        http.Response.StatusCode = StatusCodes.Status400BadRequest;
        await http.Response.WriteAsJsonAsync(new { success = false, error = "TMDB API key not configured." },
            jsonSerializerOptions, cancellationToken: ct).ConfigureAwait(false);
        return;
    }

    http.Response.ContentType = "application/x-ndjson; charset=utf-8";
    http.Response.Headers.CacheControl = "no-cache";
    await http.Response.StartAsync(ct).ConfigureAwait(false);

    await foreach (var ev in repo.PrefetchAllLibraryMetadataStreamAsync(tmdb, ct).ConfigureAwait(false))
    {
        var line = JsonSerializer.Serialize(ev, jsonSerializerOptions) + "\n";
        await http.Response.WriteAsync(line, cancellationToken: ct).ConfigureAwait(false);
        await http.Response.Body.FlushAsync(ct).ConfigureAwait(false);
    }
});

app.MapPost("/api/library/cleanup", async (LibraryContext db, CancellationToken ct) =>
{
    var removedEpisodes = 0;
    var removedShows = 0;
    var removedMovies = 0;

    // Remove episodes whose files no longer exist
    var episodes = await db.Episodes.ToListAsync(ct).ConfigureAwait(false);
    foreach (var ep in episodes)
    {
        if (string.IsNullOrEmpty(ep.FilePath) || File.Exists(ep.FilePath))
            continue;
        db.Episodes.Remove(ep);
        removedEpisodes++;
    }

    await db.SaveChangesAsync(ct).ConfigureAwait(false);

    // Remove shows that have no episodes OR whose folder is gone OR have no folder path (smart match ghosts)
    var shows = await db.Shows.Include(s => s.Episodes).ToListAsync(ct).ConfigureAwait(false);
    var ghostShows = new List<Show>();
    foreach (var show in shows)
    {
        var hasNoEpisodes = !show.Episodes.Any();
        var folderGone = !string.IsNullOrEmpty(show.FolderPath) && !Directory.Exists(show.FolderPath);
        var noFolderPath = string.IsNullOrEmpty(show.FolderPath);
        
        // Remove if: no episodes AND (folder is gone OR no folder path at all)
        // This catches smart match entries that were added but never had files
        if (hasNoEpisodes && (folderGone || noFolderPath))
            ghostShows.Add(show);
    }

    if (ghostShows.Count > 0)
    {
        var showTmdbIds = ghostShows.Select(s => s.TmdbId).ToList();
        var castForShows = await db.CastMembers
            .Where(c => showTmdbIds.Contains(c.MediaId) && c.MediaType == "Series")
            .ToListAsync(ct)
            .ConfigureAwait(false);
        db.CastMembers.RemoveRange(castForShows);
        db.Shows.RemoveRange(ghostShows);
        removedShows = ghostShows.Count;
    }

    // Remove movies whose files no longer exist OR have no file path (smart match ghosts)
    var movies = await db.Movies.ToListAsync(ct).ConfigureAwait(false);
    var ghostMovies = new List<Movie>();
    foreach (var movie in movies)
    {
        var noFilePath = string.IsNullOrEmpty(movie.FilePath);
        var fileGone = !string.IsNullOrEmpty(movie.FilePath) && !File.Exists(movie.FilePath);
        
        // Remove if: no file path at all OR file path exists but file is gone
        // This catches smart match entries that were added but never had files
        if (noFilePath || fileGone)
            ghostMovies.Add(movie);
    }
    
    if (ghostMovies.Count > 0)
    {
        var movieTmdbIds = ghostMovies.Select(m => m.TmdbId).ToList();
        var castForMovies = await db.CastMembers
            .Where(c => movieTmdbIds.Contains(c.MediaId) && c.MediaType == "Movie")
            .ToListAsync(ct)
            .ConfigureAwait(false);
        db.CastMembers.RemoveRange(castForMovies);
        db.Movies.RemoveRange(ghostMovies);
        removedMovies = ghostMovies.Count;
    }

    await db.SaveChangesAsync(ct).ConfigureAwait(false);

    return Results.Json(new
    {
        removedShows,
        removedMovies,
        removedEpisodes,
        message = $"Removed {removedShows} shows, {removedMovies} movies, {removedEpisodes} orphan episodes (including smart match entries without files)"
    }, jsonSerializerOptions);
});

app.MapPost("/api/library/refresh-artwork", async (LibraryContext db, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
        return Results.BadRequest(new { error = "TMDB API key not configured." });

    var movies = await db.Movies.Where(m => m.IsMatched && m.TmdbId > 0).ToListAsync(ct).ConfigureAwait(false);
    var shows = await db.Shows.Where(s => s.IsMatched && s.TmdbId > 0).ToListAsync(ct).ConfigureAwait(false);

    var failures = 0;

    await Parallel.ForEachAsync(movies, new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = ct },
        async (m, token) =>
        {
            var art = await tmdb.GetArtworkPathsAsync(m.TmdbId, "Movie", token).ConfigureAwait(false);
            if (art == null)
            {
                Interlocked.Increment(ref failures);
                return;
            }

            var (posterPath, backdropPath) = art.Value;
            try
            {
                if (!string.IsNullOrEmpty(posterPath))
                    m.PosterLocalPath = await tmdb
                        .DownloadImageAsync(posterPath, $"poster_Movie_{m.TmdbId}.jpg", token)
                        .ConfigureAwait(false);
                if (!string.IsNullOrEmpty(backdropPath))
                    m.BackdropLocalPath = await tmdb
                        .DownloadImageAsync(backdropPath, $"backdrop_{m.TmdbId}.jpg", token, null, "w1280")
                        .ConfigureAwait(false);
            }
            catch
            {
                Interlocked.Increment(ref failures);
            }
        }).ConfigureAwait(false);

    await Parallel.ForEachAsync(shows, new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = ct },
        async (s, token) =>
        {
            var art = await tmdb.GetArtworkPathsAsync(s.TmdbId, "Series", token).ConfigureAwait(false);
            if (art == null)
            {
                Interlocked.Increment(ref failures);
                return;
            }

            var (posterPath, backdropPath) = art.Value;
            try
            {
                if (!string.IsNullOrEmpty(posterPath))
                    s.PosterLocalPath = await tmdb
                        .DownloadImageAsync(posterPath, $"poster_Series_{s.TmdbId}.jpg", token)
                        .ConfigureAwait(false);
                if (!string.IsNullOrEmpty(backdropPath))
                    s.BackdropLocalPath = await tmdb
                        .DownloadImageAsync(backdropPath, $"backdrop_{s.TmdbId}.jpg", token, null, "w1280")
                        .ConfigureAwait(false);
            }
            catch
            {
                Interlocked.Increment(ref failures);
            }
        }).ConfigureAwait(false);

    await db.SaveChangesAsync(ct).ConfigureAwait(false);

    return Results.Json(new
    {
        movies = movies.Count,
        shows = shows.Count,
        failures
    }, jsonSerializerOptions);
});

app.MapGet("/api/library/title-search", async (string? q, LibraryContext db, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
    {
        return Results.Json(new { movies = Array.Empty<object>(), shows = Array.Empty<object>() },
            jsonSerializerOptions);
    }

    var term = q.Trim();
    var lower = term.ToLowerInvariant();
    var movieRows = await db.Movies.AsNoTracking()
        .Where(m => m.Title.ToLower().Contains(lower))
        .OrderBy(m => m.Title)
        .Take(50)
        .Select(m => new
        {
            kind = "movie", id = m.Id, title = m.Title, year = m.Year,
            posterPath = m.SelectedPosterPath ?? m.PosterLocalPath,
            overview = m.Overview, voteAverage = m.VoteAverage,
        })
        .ToListAsync(ct)
        .ConfigureAwait(false);
    var showRows = await db.Shows.AsNoTracking()
        .Where(s => s.Title.ToLower().Contains(lower))
        .OrderBy(s => s.Title)
        .Take(50)
        .Select(s => new
        {
            kind = "series", id = s.Id, title = s.Title, year = s.Year,
            posterPath = s.SelectedPosterPath ?? s.PosterLocalPath,
            overview = s.Overview, voteAverage = s.VoteAverage,
        })
        .ToListAsync(ct)
        .ConfigureAwait(false);

    // Pure DB columns — no TMDB round-trip needed just to show a poster/overview in the search dropdown.
    var movies = movieRows.Select(m => new
    {
        m.kind, m.id, m.title, m.year, posterUrl = ImageUrls.ToImageUrl(m.posterPath), m.overview, m.voteAverage,
    });
    var shows = showRows.Select(s => new
    {
        s.kind, s.id, s.title, s.year, posterUrl = ImageUrls.ToImageUrl(s.posterPath), s.overview, s.voteAverage,
    });

    return Results.Json(new { movies, shows }, jsonSerializerOptions);
});

/// <summary>Maps TMDB ids from online streaming search to library movie/episode ids for watch status.</summary>
app.MapGet("/api/library/watch-target", async (
    int tmdbId,
    string? mediaType,
    int? season,
    int? episode,
    LibraryRepository repo,
    CancellationToken ct) =>
{
    if (tmdbId <= 0)
        return Results.Json(new { matched = false }, jsonSerializerOptions);
    var mt = string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase) ? "Series" : "Movie";
    if (mt == "Movie")
    {
        var movie = await repo.GetMovieByTmdbIdAsync(tmdbId, ct).ConfigureAwait(false);
        if (movie is not { IsMatched: true })
            return Results.Json(new { matched = false }, jsonSerializerOptions);
        return Results.Json(new { matched = true, movieId = movie.Id }, jsonSerializerOptions);
    }

    var show = await repo.GetShowByTmdbIdAsync(tmdbId, ct).ConfigureAwait(false);
    if (show is not { IsMatched: true })
        return Results.Json(new { matched = false }, jsonSerializerOptions);

    if (season is null or < 1 || episode is null or < 1)
        return Results.Json(new { matched = true, showId = show.Id }, jsonSerializerOptions);

    var eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
    var ep = eps.FirstOrDefault(e => e.Season == season.Value && e.EpisodeNumber == episode.Value);
    if (ep == null)
        return Results.Json(new { matched = true, showId = show.Id }, jsonSerializerOptions);
    return Results.Json(new { matched = true, showId = show.Id, episodeId = ep.Id }, jsonSerializerOptions);
});

app.MapDelete("/api/library/movie/{id:int}", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var ok = await repo.DeleteMovieByIdAsync(id, ct).ConfigureAwait(false);
    return ok ? Results.Ok(new { success = true }) : Results.NotFound();
});

app.MapDelete("/api/library/show/{id:int}", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var ok = await repo.DeleteShowByIdAsync(id, ct).ConfigureAwait(false);
    return ok ? Results.Ok(new { success = true }) : Results.NotFound();
});

app.MapDelete("/api/library/delete-from-device", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var req = await request.ReadFromJsonAsync<DeleteFromDeviceRequest>(cancellationToken: ct).ConfigureAwait(false);
    var path = req?.Path?.Trim();
    var mediaType = req?.MediaType?.Trim();
    var libraryId = req?.LibraryId ?? 0;

    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { error = "Path is required." });
    
    if (string.IsNullOrWhiteSpace(mediaType))
        return Results.BadRequest(new { error = "Media type is required." });

    try
    {
        if (mediaType == "Series")
        {
            if (!Directory.Exists(path))
                return Results.BadRequest(new { error = "Series folder not found on device." });
            
            Directory.Delete(path, recursive: true);
            
            if (libraryId > 0)
            {
                var show = await repo.GetShowByIdAsync(libraryId, ct).ConfigureAwait(false);
                if (show != null)
                {
                    await repo.DeleteShowByIdAsync(show.Id, ct).ConfigureAwait(false);
                }
            }
        }
        else if (mediaType == "Movie")
        {
            if (!File.Exists(path))
                return Results.BadRequest(new { error = "Movie file not found on device." });
            
            File.Delete(path);
            
            if (libraryId > 0)
            {
                var movie = await repo.GetMovieByIdAsync(libraryId, ct).ConfigureAwait(false);
                if (movie != null)
                {
                    await repo.DeleteMovieByIdAsync(movie.Id, ct).ConfigureAwait(false);
                }
            }
        }
        else
        {
            return Results.BadRequest(new { error = "Invalid media type." });
        }

        return Results.Ok(new { success = true });
    }
    catch (UnauthorizedAccessException)
    {
        return Results.BadRequest(new { error = "Access denied. Check file/folder permissions." });
    }
    catch (IOException ex)
    {
        return Results.BadRequest(new { error = $"Could not delete: {ex.Message}" });
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "Library media delete failed");
        return Results.BadRequest(new { error = $"Failed to delete: {ex.Message}" });
    }
});

app.MapPost("/api/library/cleanup-missing-files", async (LibraryRepository repo, CancellationToken ct) =>
{
    try
    {
        var removedEpisodes = 0;
        var removedMovies = 0;
        var removedShows = 0;

        // Clean up episodes with missing files
        var allShows = await repo.GetAllShowsAsync(ct).ConfigureAwait(false);
        foreach (var show in allShows)
        {
            var episodes = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
            var missingEpisodes = episodes.Where(e => !string.IsNullOrWhiteSpace(e.FilePath) && !File.Exists(e.FilePath)).ToList();
            
            foreach (var ep in missingEpisodes)
            {
                await repo.DeleteEpisodeAsync(ep.Id, ct).ConfigureAwait(false);
                removedEpisodes++;
            }

            // If show has no episodes left, delete the show
            var remainingEpisodes = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
            if (remainingEpisodes.Count == 0)
            {
                await repo.DeleteShowByIdAsync(show.Id, ct).ConfigureAwait(false);
                removedShows++;
            }
        }

        // Clean up movies with missing files
        var allMovies = await repo.GetAllMoviesAsync(ct).ConfigureAwait(false);
        var missingMovies = allMovies.Where(m => !string.IsNullOrWhiteSpace(m.FilePath) && !File.Exists(m.FilePath)).ToList();
        
        foreach (var movie in missingMovies)
        {
            await repo.DeleteMovieByIdAsync(movie.Id, ct).ConfigureAwait(false);
            removedMovies++;
        }

        return Results.Ok(new
        {
            success = true,
            removedEpisodes,
            removedMovies,
            removedShows,
            message = $"Cleaned up {removedEpisodes} episodes, {removedMovies} movies, and {removedShows} shows with missing files."
        });
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "Library cleanup-missing-files failed");
        return Results.BadRequest(new { error = $"Cleanup failed: {ex.Message}" });
    }
});
app.MapGet("/api/library/duplicates", async (LibraryRepository repo, LibraryContext db, CancellationToken ct) =>
{
    var allMovies = await repo.GetAllMoviesAsync(ct).ConfigureAwait(false);

    // Movie duplicates: group by TmdbId (matched) or normalised title+year (unmatched)
    var movieGroups = allMovies
        .GroupBy(m => m.TmdbId > 0
            ? $"tmdb:{m.TmdbId}"
            : $"title:{m.Title.Trim().ToLowerInvariant()}:{m.Year}")
        .Where(g => g.Count() > 1)
        .Select(g =>
        {
            var first = g.First();
            var posterUrl = string.IsNullOrEmpty(first.SelectedPosterPath)
                ? (string.IsNullOrEmpty(first.PosterLocalPath) ? null : $"{ImageUrls.PublicBase.TrimEnd('/')}/images/{Path.GetFileName(first.PosterLocalPath)}")
                : $"{ImageUrls.PublicBase.TrimEnd('/')}/images/{Path.GetFileName(first.SelectedPosterPath)}";
            return new
            {
                tmdbId    = first.TmdbId,
                title     = first.Title,
                year      = first.Year,
                posterUrl,
                copies = g.Select(m => new
                {
                    id          = m.Id,
                    filePath    = m.FilePath,
                    fileExists  = File.Exists(m.FilePath),
                    fileSize    = TryGetFileSize(m.FilePath),
                    dateAdded   = m.DateAdded,
                    watchStatus = m.WatchStatus,
                }).OrderBy(c => c.dateAdded).ToList(),
            };
        })
        .OrderBy(g => g.title)
        .ToList();

    // Episode duplicates: group by ShowId + Season + EpisodeNumber (client-side — EF can't translate GroupBy+Count on Episodes)
    var epKeys = await db.Episodes.AsNoTracking()
        .Select(e => new { e.Id, e.ShowId, e.Season, e.EpisodeNumber })
        .ToListAsync(ct).ConfigureAwait(false);

    var dupEpIds = epKeys
        .GroupBy(e => new { e.ShowId, e.Season, e.EpisodeNumber })
        .Where(g => g.Count() > 1)
        .SelectMany(g => g.Select(e => e.Id))
        .ToList();

    var showIds = epKeys
        .Where(e => dupEpIds.Contains(e.Id))
        .Select(e => e.ShowId)
        .Distinct()
        .ToList();
    var showMap = await db.Shows.AsNoTracking()
        .Where(s => showIds.Contains(s.Id))
        .ToDictionaryAsync(s => s.Id, s => s.Title, ct).ConfigureAwait(false);

    var dupEpisodes = dupEpIds.Count == 0
        ? new List<Episode>()
        : await db.Episodes.AsNoTracking()
            .Where(e => dupEpIds.Contains(e.Id))
            .ToListAsync(ct).ConfigureAwait(false);

    var episodeDuplicates = dupEpisodes
        .GroupBy(e => $"{e.ShowId}:{e.Season}:{e.EpisodeNumber}")
        .Where(g => g.Count() > 1)
        .Select(g =>
        {
            var first = g.First();
            showMap.TryGetValue(first.ShowId, out var showTitle);
            return new
            {
                showId        = first.ShowId,
                showTitle     = showTitle ?? "Unknown Show",
                season        = first.Season,
                episodeNumber = first.EpisodeNumber,
                episodeTitle  = first.Title,
                copies = g.Select(e => new
                {
                    id          = e.Id,
                    filePath    = e.FilePath,
                    fileExists  = File.Exists(e.FilePath),
                    fileSize    = TryGetFileSize(e.FilePath),
                    watchStatus = e.WatchStatus,
                }).OrderBy(c => c.id).ToList(),
            };
        })
        .OrderBy(g => g.showTitle).ThenBy(g => g.season).ThenBy(g => g.episodeNumber)
        .ToList();

    return Results.Json(new
    {
        movieDuplicates   = movieGroups,
        episodeDuplicates,
        totalMovieDuplicateGroups   = movieGroups.Count,
        totalEpisodeDuplicateGroups = episodeDuplicates.Count,
    }, jsonSerializerOptions);

    static long? TryGetFileSize(string path)
    {
        try { return string.IsNullOrEmpty(path) ? null : new FileInfo(path).Length; }
        catch { return null; }
    }
});

app.MapPost("/api/library/bulk-watch", async (BulkWatchBody body, LibraryRepository repo, CancellationToken ct) =>
{
    var status = body.WatchStatus ?? "";
    if (!WatchStatuses.IsValid(status))
        return Results.BadRequest(new { error = "Invalid watch status." });

    foreach (var id in body.MovieIds ?? Array.Empty<int>())
        await repo.UpdateMovieWatchStatusAsync(id, status, ct).ConfigureAwait(false);

    foreach (var id in body.ShowIds ?? Array.Empty<int>())
        await repo.UpdateShowWatchStatusAsync(id, status, ct).ConfigureAwait(false);

    return Results.Json(new { success = true }, jsonSerializerOptions);
});

app.MapPost("/api/library/bulk-remove", async (BulkLibraryIdsBody body, LibraryRepository repo, CancellationToken ct) =>
{
    foreach (var id in body.MovieIds ?? Array.Empty<int>())
        await repo.DeleteMovieByIdAsync(id, ct).ConfigureAwait(false);
    foreach (var id in body.ShowIds ?? Array.Empty<int>())
        await repo.DeleteShowByIdAsync(id, ct).ConfigureAwait(false);
    return Results.Json(new { success = true }, jsonSerializerOptions);
});

app.MapPost("/api/library/bulk-delete-from-device", async (BulkLibraryIdsBody body, LibraryRepository repo, CancellationToken ct) =>
{
    var errors = new List<string>();
    var filesDeleted = 0;

    foreach (var mid in body.MovieIds ?? Array.Empty<int>())
    {
        var m = await repo.GetMovieByIdAsync(mid, ct).ConfigureAwait(false);
        if (m == null)
            continue;
        if (!string.IsNullOrWhiteSpace(m.FilePath) && File.Exists(m.FilePath))
        {
            try
            {
                File.Delete(m.FilePath);
                filesDeleted++;
            }
            catch (Exception ex)
            {
                app.Logger.LogWarning(ex, "Bulk delete from device failed for movie {MovieId} ({Title})", mid, m.Title);
                errors.Add($"{m.Title}: {ex.Message}");
                continue;
            }
        }

        await repo.DeleteMovieByIdAsync(mid, ct).ConfigureAwait(false);
    }

    foreach (var sid in body.ShowIds ?? Array.Empty<int>())
    {
        var eps = await repo.GetEpisodesForShowAsync(sid, ct).ConfigureAwait(false);
        foreach (var ep in eps)
        {
            if (string.IsNullOrWhiteSpace(ep.FilePath) || !File.Exists(ep.FilePath))
                continue;
            try
            {
                File.Delete(ep.FilePath);
                filesDeleted++;
            }
            catch (Exception ex)
            {
                app.Logger.LogWarning(ex, "Bulk delete from device failed for show {ShowId} S{Season}E{Episode}", sid, ep.Season, ep.EpisodeNumber);
                errors.Add($"Show {sid} S{ep.Season}E{ep.EpisodeNumber}: {ex.Message}");
            }
        }

        await repo.DeleteShowByIdAsync(sid, ct).ConfigureAwait(false);
    }

    return Results.Json(new { success = true, filesDeleted, errors }, jsonSerializerOptions);
});

// —— Library Browse ——

// Decade browsing: returns movies or shows (or both) filtered by decade
app.MapGet("/api/library/browse/decade", async (
    LibraryContext db,
    int decade,
    ITmdbClientFactory tmdbClientFactory,
    string mediaType = "all",
    CancellationToken ct = default) =>
{
    var decadeStart = (decade / 10) * 10;
    var decadeEnd = decadeStart + 10;
    var tmdb = tmdbClientFactory.Create();
    var results = new List<object>();

    var rawCards = new List<MediaCardDto>();

    if (!string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase))
    {
        var movies = await db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.Year.HasValue && m.Year >= decadeStart && m.Year < decadeEnd)
            .OrderByDescending(m => m.VoteAverage)
            .Take(120)
            .ToListAsync(ct).ConfigureAwait(false);
        rawCards.AddRange(movies.Select(MediaCardMappers.ToCardFromMovie));
    }

    if (!string.Equals(mediaType, "Movie", StringComparison.OrdinalIgnoreCase))
    {
        var shows = await db.Shows.AsNoTracking()
            .Where(s => s.IsMatched && s.Year.HasValue && s.Year >= decadeStart && s.Year < decadeEnd)
            .OrderByDescending(s => s.VoteAverage)
            .Take(120)
            .ToListAsync(ct).ConfigureAwait(false);
        rawCards.AddRange(shows.Select(MediaCardMappers.ToCardFromShow));
    }

    await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(rawCards, tmdb, ct).ConfigureAwait(false);
    var mappedCards = rawCards.OrderByDescending(c => c.VoteAverage).Select(ImageUrls.MapMediaCard).ToList();
    return Results.Json(new { decade = decadeStart, items = mappedCards, total = mappedCards.Count }, jsonSerializerOptions);
});

// Keyword browsing: returns library items whose KeywordsJson contains the given keyword name
app.MapGet("/api/library/browse/keyword", async (
    LibraryContext db,
    string keyword,
    ITmdbClientFactory tmdbClientFactory,
    string mediaType = "all",
    CancellationToken ct = default) =>
{
    if (string.IsNullOrWhiteSpace(keyword))
        return Results.Json(new { items = Array.Empty<object>(), total = 0 }, jsonSerializerOptions);

    var needle = keyword.Trim().ToLowerInvariant();
    var tmdb = tmdbClientFactory.Create();
    var rawCards = new List<MediaCardDto>();

    if (!string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase))
    {
        var movies = await db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.KeywordsJson != null &&
                        EF.Functions.Like(m.KeywordsJson.ToLower(), $"%\"name\":\"{needle}\"%"))
            .OrderByDescending(m => m.VoteAverage)
            .Take(80)
            .ToListAsync(ct).ConfigureAwait(false);
        rawCards.AddRange(movies.Select(MediaCardMappers.ToCardFromMovie));
    }

    if (!string.Equals(mediaType, "Movie", StringComparison.OrdinalIgnoreCase))
    {
        var shows = await db.Shows.AsNoTracking()
            .Where(s => s.IsMatched && s.KeywordsJson != null &&
                        EF.Functions.Like(s.KeywordsJson.ToLower(), $"%\"name\":\"{needle}\"%"))
            .OrderByDescending(s => s.VoteAverage)
            .Take(80)
            .ToListAsync(ct).ConfigureAwait(false);
        rawCards.AddRange(shows.Select(MediaCardMappers.ToCardFromShow));
    }

    await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(rawCards, tmdb, ct).ConfigureAwait(false);
    var mappedCards = rawCards.Select(ImageUrls.MapMediaCard).ToList();
    return Results.Json(new { keyword, items = mappedCards, total = mappedCards.Count }, jsonSerializerOptions);
});

    }

}