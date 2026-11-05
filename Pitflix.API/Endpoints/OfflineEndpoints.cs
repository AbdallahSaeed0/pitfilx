using System.Text.Json;
using Pitflix.API.Services;
using Pitflix.Core.Database;
using Pitflix.Core.Net;

namespace Pitflix.API.Endpoints;

/// <summary>Offline mode (forced / detected), the offline-library preload job, and the IMDb ratings dataset.</summary>
public static class OfflineEndpoints
{
    public const string OfflineModeSettingKey = "OfflineMode";

    public static void MapOfflineEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/offline/status", async (OfflineLibraryPreloadService preload, ImdbDatasetService imdb,
            CancellationToken ct) =>
        {
            await NetworkStatus.RefreshIfDueAsync(ct).ConfigureAwait(false);
            var (ready, total) = await preload.GetCoverageAsync(ct).ConfigureAwait(false);
            return Results.Json(new
            {
                offline = NetworkStatus.IsOffline,
                forcedOffline = NetworkStatus.ForcedOffline,
                detectedOffline = NetworkStatus.DetectedOffline,
                preload = new
                {
                    running = preload.IsRunning,
                    total = preload.Total,
                    done = preload.Done,
                    current = preload.Current,
                    lastCompletedUtc = preload.LastCompletedUtc,
                    lastError = preload.LastError,
                    readyTitles = ready,
                    totalTitles = total,
                },
                imdbRatings = new
                {
                    available = imdb.IsAvailable,
                    builtAtUtc = imdb.BuiltAtUtc,
                    refreshing = imdb.IsRefreshing,
                    lastError = imdb.LastError,
                },
                savedTmdbResponses = TmdbClientFactory.ResponseCache.Count(),
            }, jsonSerializerOptions);
        });

        app.MapPost("/api/offline/mode", async (OfflineModeRequest body, LibraryRepository repo,
            OfflineLibraryPreloadService preload, CancellationToken ct) =>
        {
            await repo.SaveSettingAsync(OfflineModeSettingKey, body.Enabled ? "1" : "0", ct).ConfigureAwait(false);
            NetworkStatus.SetForcedOffline(body.Enabled);
            if (!body.Enabled) preload.RequestRun(); // back online — catch up on anything pending
            return Results.Json(new { ok = true, offline = NetworkStatus.IsOffline }, jsonSerializerOptions);
        });

        app.MapPost("/api/offline/preload", (OfflineLibraryPreloadService preload) =>
        {
            if (NetworkStatus.IsOffline)
                return Results.Json(new { ok = false, error = "Offline — connect to the internet to download the library." },
                    jsonSerializerOptions);
            preload.RequestRun();
            return Results.Json(new { ok = true }, jsonSerializerOptions);
        });

        app.MapPost("/api/offline/imdb-ratings/refresh", (ImdbDatasetService imdb, ILogger<ImdbDatasetService> log) =>
        {
            if (NetworkStatus.IsOffline)
                return Results.Json(new { ok = false, error = "Offline" }, jsonSerializerOptions);
            _ = Task.Run(async () =>
            {
                try { await imdb.RefreshAsync(force: true, CancellationToken.None).ConfigureAwait(false); }
                catch (Exception ex) { log.LogWarning("IMDb dataset manual refresh failed: {Msg}", ex.Message); }
            });
            return Results.Json(new { ok = true }, jsonSerializerOptions);
        });
    }

    public sealed record OfflineModeRequest(bool Enabled);
}
