using System.Diagnostics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitflix.API.Services;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Endpoints;

public static class PlayerControlEndpoints
{
    public static void MapPlayerControlEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/series/{id:int}/next-episode",
            async (int id, int? currentEpisodeId, LibraryRepository repo, CancellationToken ct) =>
            {
                var show = await repo.GetShowByIdAsync(id, ct).ConfigureAwait(false);
                if (show == null)
                    return Results.NotFound();

                var eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
                Episode? next;
                if (currentEpisodeId is { } cid)
                    next = LibraryRepository.GetNextEpisodeInOrder(eps, cid);
                else
                    next = LibraryRepository.GetNextEpisodeForShow(eps);
                if (next == null)
                    return Results.Json(new { next = (object?)null }, jsonSerializerOptions);

                return Results.Json(new
                {
                    next = new
                    {
                        id = next.Id,
                        filePath = next.FilePath,
                        season = next.Season,
                        episodeNumber = next.EpisodeNumber,
                        title = next.Title,
                    }
                }, jsonSerializerOptions);
            });

        app.MapGet("/api/series/{id:int}/previous-episode", async (int id, int currentEpisodeId, LibraryRepository repo,
                CancellationToken ct) =>
        {
            var show = await repo.GetShowByIdAsync(id, ct).ConfigureAwait(false);
            if (show == null)
                return Results.NotFound();

            var eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
            var prev = LibraryRepository.GetPreviousEpisodeInOrder(eps, currentEpisodeId);
            if (prev == null)
                return Results.Json(new { previous = (object?)null }, jsonSerializerOptions);

            return Results.Json(new
            {
                previous = new
                {
                    id = prev.Id,
                    filePath = prev.FilePath,
                    season = prev.Season,
                    episodeNumber = prev.EpisodeNumber,
                    title = prev.Title,
                }
            }, jsonSerializerOptions);
        });

        app.MapGet("/api/playback/resolve-by-path", async (string filePath, LibraryRepository repo, LibraryContext db, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(filePath))
                return Results.BadRequest(new { error = "filePath is required." });

            var ep = await repo.TryGetEpisodeByFilePathAsync(filePath, ct).ConfigureAwait(false);
            if (ep != null)
            {
                var show = await db.Shows.AsNoTracking()
                    .Where(s => s.Id == ep.ShowId)
                    .Select(s => new { s.Id, s.Title, PosterPath = s.SelectedPosterPath ?? s.PosterLocalPath })
                    .FirstOrDefaultAsync(ct)
                    .ConfigureAwait(false);
                var title = !string.IsNullOrWhiteSpace(ep.Title)
                    ? ep.Title!
                    : $"{show?.Title ?? "Series"} · S{ep.Season}E{ep.EpisodeNumber}";
                return Results.Json(new
                {
                    mediaType = "Series",
                    filePath = ep.FilePath,
                    title,
                    posterPath = show?.PosterPath,
                    libraryShowId = ep.ShowId,
                    libraryEpisodeId = ep.Id,
                    season = ep.Season,
                    episodeNumber = ep.EpisodeNumber,
                }, jsonSerializerOptions);
            }

            var movie = await repo.TryGetMovieByFilePathAsync(filePath, ct).ConfigureAwait(false);
            if (movie != null)
            {
                return Results.Json(new
                {
                    mediaType = "Movie",
                    filePath = movie.FilePath,
                    title = movie.Title,
                    posterPath = movie.SelectedPosterPath ?? movie.PosterLocalPath,
                    libraryMovieId = movie.Id,
                }, jsonSerializerOptions);
            }

            return Results.NotFound(new { error = "No library media found for file path." });
        });

        app.MapPost("/api/play", async (PlayBody body, LibraryRepository repo, ILogger<Program> logger, CancellationToken ct) =>
        {
            try
            {
                if (string.IsNullOrWhiteSpace(body.FilePath) || !File.Exists(body.FilePath))
                    return Results.Json(new { success = false, error = "File not found." });

                var filePath = body.FilePath!;
                var title = string.IsNullOrWhiteSpace(body.Title)
                    ? Path.GetFileNameWithoutExtension(filePath)
                    : body.Title!.Trim();
                var mediaType = string.IsNullOrWhiteSpace(body.MediaType) ? "Movie" : body.MediaType!.Trim();
                var duration = body.DurationSeconds ?? 0;
                if (duration < 0)
                    duration = 0;

                if (body.SkipHistoryAdd != true)
                    await repo.AddToHistoryAsync(filePath, title, body.PosterPath, mediaType, duration, ct).ConfigureAwait(false);

                var configured = await repo.GetSettingAsync("MediaPlayerPath", ct).ConfigureAwait(false);
                var trimmedExe = configured?.Trim();

                if (string.IsNullOrWhiteSpace(trimmedExe))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = filePath,
                        UseShellExecute = true,
                    });
                    return Results.Json(new { success = true });
                }

                var exe = trimmedExe;

                var startArg = "";
                if (body.StartSeconds is > 0 and var sec)
                {
                    if (exe.Contains("vlc", StringComparison.OrdinalIgnoreCase))
                        startArg = $" --start-time={sec}";
                    else if (exe.Contains("mpv", StringComparison.OrdinalIgnoreCase))
                        startArg = $" --start={sec}";
                }

                Process.Start(new ProcessStartInfo
                {
                    FileName = exe,
                    Arguments = $"\"{filePath}\"{startArg}",
                    UseShellExecute = true
                });
                return Results.Json(new { success = true });
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "External player launch failed for {FilePath}", body.FilePath);
                return Results.Json(new { success = false, error = ex.Message });
            }
        });

        app.MapPost("/api/player/play", async (PlayerPlayBody body, PlayerService playerService, ILogger<Program> logger, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.FilePath))
                return Results.BadRequest(new { error = "filePath is required." });

            try
            {
                var session = await playerService.StartAsync(
                    body.FilePath,
                    body.MediaId,
                    body.EpisodeId,
                    body.StartPosition ?? 0.0,
                    body.SubtitleTrack,
                    body.Player,
                    ct).ConfigureAwait(false);
                return Results.Json(session, jsonSerializerOptions);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Player play failed for {FilePath}", body.FilePath);
                return Results.Problem(ex.Message);
            }
        });

        app.MapPost("/api/player/attach", async (PlayerAttachBody body, PlayerService playerService, ILogger<Program> logger, CancellationToken ct) =>
        {
            try
            {
                var session = await playerService.AttachWindowAsync(body.Hwnd, ct).ConfigureAwait(false);
                return Results.Json(session, jsonSerializerOptions);
            }
            catch (InvalidOperationException ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Player attach failed for HWND {Hwnd}", body.Hwnd);
                return Results.Problem(ex.Message);
            }
        });

        app.MapPost("/api/player/command", async (PlayerCommandBody body, PlayerService playerService) =>
        {
            var session = playerService.GetSession();
            if (session is null)
                return Results.NotFound(new { error = "No active player session." });

            if (body.Command == "subtitle")
            {
                var trackId = (int)(body.Value ?? 0);
                await playerService.SendRawCommandAsync(["set_property", "sid", (object)trackId])
                                   .ConfigureAwait(false);
                return Results.Ok(new { success = true });
            }

            string[] ipcCommand = body.Command switch
            {
                "pause"  => ["cycle", "pause"],
                "seek"   => ["seek", (body.Value ?? 0).ToString("F3"), "absolute"],
                "stop"   => ["quit"],
                "next"   => ["playlist-next"],
                "prev"   => ["playlist-prev"],
                "volume" => ["set_property", "volume", (body.Value ?? 100).ToString("F1")],
                _        => []
            };

            if (ipcCommand.Length == 0)
                return Results.BadRequest(new { error = $"Unknown command: {body.Command}" });

            await playerService.SendCommandAsync(ipcCommand).ConfigureAwait(false);

            if (body.Command == "stop")
                await playerService.StopAsync().ConfigureAwait(false);

            return Results.Ok(new { success = true });
        });

        app.MapPost("/api/player/mpv-command", async (PlayerMpvCommandBody body, PlayerService playerService) =>
        {
            var session = playerService.GetSession();
            if (session is null)
                return Results.NotFound(new { error = "No active player session." });
            await playerService.SendCommandAsync(body.Args).ConfigureAwait(false);
            return Results.Ok(new { success = true });
        });

        app.MapPost("/api/player/playlist", async (PlayerPlaylistBody body, PlayerService playerService) =>
        {
            var session = playerService.GetSession();
            if (session is null)
                return Results.NotFound(new { error = "No active player session." });
            await playerService.BuildPlaylistAsync(body.Files, body.Current).ConfigureAwait(false);
            return Results.Ok(new { success = true });
        });

        app.MapGet("/api/player/session", (PlayerService playerService) =>
        {
            var session = playerService.GetSession();
            return session is null
                ? Results.NotFound(new { error = "No active player session." })
                : Results.Json(session, jsonSerializerOptions);
        });

        app.MapPost("/api/player/stop", async (PlayerService playerService) =>
        {
            await playerService.StopAsync().ConfigureAwait(false);
            return Results.Ok(new { success = true });
        });

        app.MapPost("/api/player/save-progress-now", async (PlayerService playerService, CancellationToken ct) =>
        {
            await playerService.SaveProgressNowAsync(ct).ConfigureAwait(false);
            return Results.Ok(new { success = true });
        });

        app.MapGet("/api/player/tracks", async (PlayerService playerService) =>
        {
            var tracks = await playerService.GetSubtitleTracksAsync().ConfigureAwait(false);
            return Results.Json(
                tracks.Select(t => new { index = t.Index, language = t.Language, title = t.Title, type = t.Type }),
                jsonSerializerOptions);
        });

        app.Map("/api/player/ws", async (HttpContext ctx, PlayerService playerService) =>
        {
            if (!ctx.WebSockets.IsWebSocketRequest)
            {
                ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }

            using var ws = await ctx.WebSockets.AcceptWebSocketAsync().ConfigureAwait(false);
            var wsJsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

            static ValueTask SendJson<T>(System.Net.WebSockets.WebSocket socket, T value, JsonSerializerOptions opts, CancellationToken ct)
            {
                var bytes = JsonSerializer.SerializeToUtf8Bytes(value, opts);
                return socket.SendAsync(bytes.AsMemory(), System.Net.WebSockets.WebSocketMessageType.Text, true, ct);
            }

            var initial = playerService.GetSession();
            await SendJson(ws, initial, wsJsonOpts, CancellationToken.None).ConfigureAwait(false);

            while (ws.State == System.Net.WebSockets.WebSocketState.Open)
            {
                await Task.Delay(1000).ConfigureAwait(false);

                if (ws.State != System.Net.WebSockets.WebSocketState.Open)
                    break;

                var current = playerService.GetSession();

                if (current is null || current.IsStopped)
                {
                    try
                    {
                        await SendJson(ws, new { isStopped = true }, wsJsonOpts, CancellationToken.None).ConfigureAwait(false);
                        await ws.CloseAsync(System.Net.WebSockets.WebSocketCloseStatus.NormalClosure, "session ended", CancellationToken.None).ConfigureAwait(false);
                    }
                    catch { /* client already disconnected */ }
                    break;
                }

                try
                {
                    await SendJson(ws, current, wsJsonOpts, CancellationToken.None).ConfigureAwait(false);
                }
                catch
                {
                    break;
                }
            }
        });
    }
}
