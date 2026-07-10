using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitflix.API.Services;
using Pitflix.API.Services.Trakt;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Endpoints;

public static class HistoryEndpoints
{
    /// <summary>Fire-and-forget Trakt scrobble hook. Runs in its own DI scope so it survives the HTTP
    /// request completing, and never touches the response — local watch-status/resume-position already
    /// committed before this is called.</summary>
    private static void FireTraktScrobble(IServiceProvider services, int historyId, string action)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await using var scope = services.CreateAsyncScope();
                var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
                var scrobble = scope.ServiceProvider.GetRequiredService<TraktScrobbleService>();
                var h = await repo.GetWatchHistoryByIdAsync(historyId, CancellationToken.None).ConfigureAwait(false);
                if (h == null)
                    return;

                switch (action)
                {
                    case "stop":
                        await scrobble.StopAsync(h, repo, CancellationToken.None).ConfigureAwait(false);
                        break;
                    case "pause":
                        await scrobble.PauseAsync(h, repo, CancellationToken.None).ConfigureAwait(false);
                        break;
                    default:
                        await scrobble.StartAsync(h, repo, CancellationToken.None).ConfigureAwait(false);
                        break;
                }
            }
            catch
            {
                // Best-effort — never let a Trakt failure surface anywhere near playback.
            }
        });
    }

    public static void MapHistoryEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/history", async (LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, int limit = 10, bool includeSuppressed = false,
                bool lite = false, CancellationToken ct = default) =>
        {
            var cap = Math.Clamp(limit, 1, 200);
            var list = (await repo.GetRecentHistoryAsync(cap, includeSuppressed, ct).ConfigureAwait(false)).ToList();
            var tmdb = lite ? null : tmdbClientFactory.Create();
            foreach (var h in lite ? Enumerable.Empty<WatchHistory>() : list)
            {
                if (string.IsNullOrWhiteSpace(h.PosterLocalPath) ||
                    string.IsNullOrWhiteSpace(ImageUrls.ToImageUrl(h.PosterLocalPath)))
                {
                    var resolved = await repo.TryResolvePosterPathForPlayedFileAsync(h.FilePath, h.MediaType, ct)
                        .ConfigureAwait(false);
                    if (!string.IsNullOrWhiteSpace(resolved))
                        h.PosterLocalPath = resolved;
                }

                if (string.IsNullOrWhiteSpace(ImageUrls.ToImageUrl(h.PosterLocalPath)))
                {
                    var altType = string.Equals(h.MediaType, "Series", StringComparison.OrdinalIgnoreCase)
                        ? "Movie"
                        : "Series";
                    var again = await repo.TryResolvePosterPathForPlayedFileAsync(h.FilePath, altType, ct).ConfigureAwait(false);
                    if (!string.IsNullOrWhiteSpace(again))
                        h.PosterLocalPath = again;
                }

                if (string.IsNullOrWhiteSpace(ImageUrls.ToImageUrl(h.PosterLocalPath)))
                {
                    var fromTitle = await repo.TryResolvePosterFromHistoryTitleAsync(h.Title, h.MediaType, ct)
                        .ConfigureAwait(false);
                    if (!string.IsNullOrWhiteSpace(fromTitle))
                        h.PosterLocalPath = fromTitle;
                }

                if (tmdb != null &&
                    string.IsNullOrWhiteSpace(ImageUrls.ToImageUrl(h.PosterLocalPath)) &&
                    string.IsNullOrWhiteSpace(h.PosterRemoteUrl))
                {
                    var tid = await repo.TryGetTmdbIdForHistoryPlaybackAsync(h.FilePath, h.MediaType, h.Title, ct)
                        .ConfigureAwait(false);
                    if (tid.HasValue && tid.Value > 0)
                    {
                        var mt = string.Equals(h.MediaType, "Movie", StringComparison.OrdinalIgnoreCase)
                            ? "Movie"
                            : "Series";
                        var art = await tmdb.GetArtworkPathsAsync(tid.Value, mt, ct).ConfigureAwait(false);
                        var posterPath = art.HasValue ? art.Value.PosterPath : null;
                        if (string.IsNullOrEmpty(posterPath))
                        {
                            var other = mt == "Movie" ? "Series" : "Movie";
                            var artAlt = await tmdb.GetArtworkPathsAsync(tid.Value, other, ct).ConfigureAwait(false);
                            posterPath = artAlt.HasValue ? artAlt.Value.PosterPath : null;
                        }

                        if (!string.IsNullOrEmpty(posterPath))
                            h.PosterRemoteUrl = $"https://image.tmdb.org/t/p/w342{posterPath}";
                    }
                }

                if (string.Equals(h.MediaType, "Series", StringComparison.OrdinalIgnoreCase))
                {
                    var ep = await repo.TryGetEpisodeByFilePathAsync(h.FilePath, ct).ConfigureAwait(false);
                    if (ep != null)
                    {
                        h.LibraryShowId = ep.ShowId;
                        h.LibraryEpisodeId = ep.Id;
                        h.NextUpLabel = $"S{ep.Season} E{ep.EpisodeNumber}";
                        if (!string.IsNullOrWhiteSpace(ep.Title))
                            h.EpisodeTitle = ep.Title.Trim();
                    }
                }
                else if (string.Equals(h.MediaType, "Movie", StringComparison.OrdinalIgnoreCase))
                {
                    var movie = await repo.TryGetMovieByFilePathAsync(h.FilePath, ct).ConfigureAwait(false);
                    if (movie != null)
                        h.LibraryMovieId = movie.Id;
                }

                var backdropPath = await repo.TryGetBackdropPathForPlayedFileAsync(h.FilePath, h.MediaType, ct)
                    .ConfigureAwait(false);
                if (!string.IsNullOrWhiteSpace(backdropPath))
                    h.BackdropLocalPath = backdropPath;
            }

            return Results.Json(list.Select(ImageUrls.MapWatchHistory).ToList(), jsonSerializerOptions);
        });

        app.MapPost("/api/history", async (HistoryAddBody body, LibraryRepository repo, CancellationToken ct) =>
        {
            var id = await repo.AddToHistoryAsync(
                body.FilePath ?? "",
                body.Title ?? "",
                body.PosterPath,
                body.MediaType ?? "Movie",
                body.DurationSeconds,
                ct,
                body.SuppressContinueWatching == true).ConfigureAwait(false);
            FireTraktScrobble(app.Services, id, "start");
            return Results.Json(new { id });
        });

        app.MapPost("/api/history/{id:int}/stopped", async (int id, StoppedBody body, LibraryRepository repo, LibraryContext db, CancellationToken ct) =>
        {
            var stopped = body.StoppedAt.Kind == DateTimeKind.Unspecified
                ? DateTime.SpecifyKind(body.StoppedAt, DateTimeKind.Utc)
                : body.StoppedAt.ToUniversalTime();

            var h = await db.WatchHistories.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct).ConfigureAwait(false);
            if (h == null)
                return Results.NotFound();

            var started = h.StartedAt ?? h.OpenedAt;
            var sessionSeconds = Math.Max(0, (int)(stopped - started).TotalSeconds);

            if (body.PositionSeconds is >= 0 and var pos)
            {
                await repo.FinalizeWatchHistoryStoppedWithPositionAsync(id, stopped, pos, ct).ConfigureAwait(false);
            }
            else if (sessionSeconds > 0)
            {
                await repo.UpdateWatchHistoryAfterReturnAsync(id, stopped, sessionSeconds, ct).ConfigureAwait(false);
            }
            else
            {
                var hTracked = await db.WatchHistories.FirstOrDefaultAsync(x => x.Id == id, ct).ConfigureAwait(false);
                if (hTracked == null)
                    return Results.NotFound();
                if (hTracked.IsStopFinalized)
                    return Results.Ok();
                hTracked.StoppedAt = stopped;
                hTracked.IsStopFinalized = true;
                hTracked.LastHeartbeatAtUtc = stopped;
                await db.SaveChangesAsync(ct).ConfigureAwait(false);
            }

            FireTraktScrobble(app.Services, id, "stop");
            return Results.Ok();
        });

        app.MapPost("/api/history/{id:int}/progress", async (int id, HistoryProgressBody body, LibraryRepository repo, CancellationToken ct) =>
        {
            if (body.PositionSeconds < 0)
                return Results.BadRequest(new { error = "Invalid position." });

            await repo.UpdateWatchHistoryProgressAsync(id, body.PositionSeconds, body.DurationSeconds, body.MarkWatching ?? true,
                ct).ConfigureAwait(false);
            // Heartbeat: push paused progress to Trakt (throttled). Start is only sent once on session open —
            // re-sending start clears Trakt's saved playback position.
            FireTraktScrobble(app.Services, id, "pause");
            return Results.Ok();
        });

        app.MapDelete("/api/history/{id:int}", async (int id, LibraryRepository repo, CancellationToken ct) =>
        {
            var ok = await repo.RemoveContinueWatchingByHistoryIdAsync(id, ct).ConfigureAwait(false);
            return ok
                ? Results.Json(new { success = true }, jsonSerializerOptions)
                : Results.NotFound();
        });

        app.MapPost("/api/history/{id:int}/dismiss", async (int id, HistoryDismissBody? body, LibraryRepository repo,
            CancellationToken ct) =>
        {
            var mark = body?.MarkCompleted == true;
            var ok = await repo.ContinueWatchingDismissAsync(id, mark, ct).ConfigureAwait(false);
            return ok
                ? Results.Json(new { success = true }, jsonSerializerOptions)
                : Results.NotFound();
        });

        app.MapPost("/api/history/mark-watched", async (HttpRequest req, LibraryRepository repo,
            Microsoft.Extensions.Caching.Memory.IMemoryCache memoryCache, CancellationToken ct) =>
        {
            var body = await req.ReadFromJsonAsync<UnifiedWatchBody>(cancellationToken: ct).ConfigureAwait(false);
            if (body == null || body.TmdbId <= 0)
                return Results.Json(new { success = false, error = "tmdbId is required." }, jsonSerializerOptions, statusCode: 400);

            var source = string.IsNullOrWhiteSpace(body.Source) ? "manual" : body.Source.Trim().ToLowerInvariant();
            if (source is not ("streaming" or "manual"))
                source = "manual";

            await repo.RecordUnifiedWatchAsync(
                tmdbId: body.TmdbId,
                imdbId: body.ImdbId?.Trim(),
                mediaType: body.MediaType ?? "Movie",
                title: body.Title ?? "",
                posterUrl: body.PosterUrl?.Trim(),
                source: source,
                seasonNumber: body.SeasonNumber,
                episodeNumber: body.EpisodeNumber,
                estimatedSeconds: body.RuntimeMinutes > 0 ? body.RuntimeMinutes * 60 : 0,
                ct: ct,
                watchedAtUtc: body.WatchedAt?.ToUniversalTime()).ConfigureAwait(false);
            memoryCache.Remove("home:watching-currently");

            return Results.Json(new { success = true }, jsonSerializerOptions);
        });

        app.MapPost("/api/history/unmark-watched", async (HttpRequest req, LibraryRepository repo,
            Microsoft.Extensions.Caching.Memory.IMemoryCache memoryCache, CancellationToken ct) =>
        {
            var body = await req.ReadFromJsonAsync<UnifiedWatchBody>(cancellationToken: ct).ConfigureAwait(false);
            if (body == null || body.TmdbId <= 0)
                return Results.Json(new { success = false, error = "tmdbId is required." }, jsonSerializerOptions, statusCode: 400);

            await repo.UnrecordUnifiedWatchAsync(
                tmdbId: body.TmdbId,
                mediaType: body.MediaType ?? "Movie",
                seasonNumber: body.SeasonNumber,
                episodeNumber: body.EpisodeNumber,
                ct: ct).ConfigureAwait(false);
            memoryCache.Remove("home:watching-currently");

            return Results.Json(new { success = true }, jsonSerializerOptions);
        });

        app.MapGet("/api/history/watched-tmdb-ids", async (string? mediaType, LibraryRepository repo, CancellationToken ct) =>
        {
            var mt = string.IsNullOrWhiteSpace(mediaType) ? "Movie" : mediaType!;
            var set = await repo.GetWatchedTmdbIdsAsync(mt, ct).ConfigureAwait(false);
            return Results.Json(set.Order().ToArray(), jsonSerializerOptions);
        });

        app.MapPost("/api/history/re-enrich", async (LibraryRepository repo, CancellationToken ct) =>
        {
            var updated = await repo.ReEnrichHistoryRowsAsync(ct).ConfigureAwait(false);
            return Results.Json(new { success = true, updatedRows = updated }, jsonSerializerOptions);
        });
    }
}
