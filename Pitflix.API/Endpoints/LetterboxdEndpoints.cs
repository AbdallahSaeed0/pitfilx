using System.Text.Json;
using Pitflix.API.Services.Letterboxd;

namespace Pitflix.API.Endpoints;

public static class LetterboxdEndpoints
{
    public static void MapLetterboxdEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/letterboxd/auth/status", async (LetterboxdService svc, CancellationToken ct) =>
        {
            var status = await svc.GetStatusAsync(ct).ConfigureAwait(false);
            return Results.Json(new
            {
                configured = status.Configured,
                username = status.Username,
                sessionActive = status.SessionActive,
            }, jsonSerializerOptions);
        });

        app.MapGet("/api/letterboxd/username/verify", async (string? username, LetterboxdService svc, CancellationToken ct) =>
        {
            var exists = await svc.UsernameExistsAsync(username ?? "", ct).ConfigureAwait(false);
            return Results.Json(new { exists }, jsonSerializerOptions);
        });

        app.MapPost("/api/letterboxd/session", async (LetterboxdSessionBody body, LetterboxdService svc, CancellationToken ct) =>
        {
            await svc.SaveSessionCookieAsync(body.CookieHeader ?? "", body.UserAgent, ct).ConfigureAwait(false);
            return Results.Json(new { success = true }, jsonSerializerOptions);
        });

        app.MapGet("/api/letterboxd/film/{tmdbId:int}/data", async (int tmdbId, LetterboxdService svc, CancellationToken ct) =>
        {
            var data = await svc.GetFilmDataAsync(tmdbId, ct).ConfigureAwait(false);
            return Results.Json(new
            {
                configured = data.Configured,
                communityRating = data.CommunityRating,
                ratingCount = data.RatingCount,
                userRating = data.UserRating,
                userDiaryEntries = data.UserDiaryEntries,
                friendReviews = data.FriendReviews,
            }, jsonSerializerOptions);
        });

        app.MapPost("/api/letterboxd/sync/start", async (LetterboxdService svc, CancellationToken ct) =>
        {
            var status = await svc.StartLibrarySyncAsync(ct).ConfigureAwait(false);
            return Results.Json(MapSyncStatus(status), jsonSerializerOptions);
        });

        app.MapPost("/api/letterboxd/sync/cancel", (LetterboxdService svc) =>
        {
            svc.CancelLibrarySync();
            return Results.Json(MapSyncStatus(svc.GetSyncStatus()), jsonSerializerOptions);
        });

        app.MapGet("/api/letterboxd/sync/status", (LetterboxdService svc) =>
            Results.Json(MapSyncStatus(svc.GetSyncStatus()), jsonSerializerOptions));

        // ── Watchlist → Pitflix list sync ────────────────────────────────────
        app.MapGet("/api/letterboxd/watchlist-sync", async (LetterboxdWatchlistSyncService sync,
            Pitflix.Core.Database.LibraryRepository repo, CancellationToken ct) =>
        {
            var st = sync.Status;
            var enabled = await repo.GetSettingAsync(LetterboxdWatchlistSyncService.EnabledKey, ct).ConfigureAwait(false) == "1";
            var listIdStr = await repo.GetSettingAsync(LetterboxdWatchlistSyncService.ListIdKey, ct).ConfigureAwait(false);
            return Results.Json(new
            {
                enabled,
                listId = int.TryParse(listIdStr, out var lid) ? lid : (int?)null,
                running = st.Running,
                phase = st.Phase,
                lastRunUtc = st.LastRunUtc,
                onWatchlist = st.OnWatchlist,
                added = st.Added,
                removed = st.Removed,
                unresolved = st.Unresolved,
                lastError = st.LastError,
            }, jsonSerializerOptions);
        });

        app.MapPost("/api/letterboxd/watchlist-sync", async (WatchlistSyncSettingsBody body, LetterboxdWatchlistSyncService sync,
            Pitflix.Core.Database.LibraryRepository repo, CancellationToken ct) =>
        {
            await repo.SaveSettingAsync(LetterboxdWatchlistSyncService.EnabledKey, body.Enabled ? "1" : "0", ct).ConfigureAwait(false);
            if (body.ListId is int id)
                await repo.SaveSettingAsync(LetterboxdWatchlistSyncService.ListIdKey, id.ToString(), ct).ConfigureAwait(false);
            if (body.Enabled) StartSyncInBackground(sync);
            return Results.Json(new { ok = true }, jsonSerializerOptions);
        });

        app.MapPost("/api/letterboxd/watchlist-sync/run", (LetterboxdWatchlistSyncService sync) =>
        {
            StartSyncInBackground(sync);
            return Results.Json(new { ok = true }, jsonSerializerOptions);
        });
    }

    /// <summary>Fire-and-forget forced run — it can take minutes on a first sync (one page per new film).</summary>
    private static void StartSyncInBackground(LetterboxdWatchlistSyncService sync) =>
        _ = Task.Run(async () =>
        {
            try { await sync.RunIfEnabledAsync(force: true, CancellationToken.None).ConfigureAwait(false); }
            catch { /* status carries the error */ }
        });

    private static object MapSyncStatus(LetterboxdSyncStatus status) => new
    {
        isRunning = status.IsRunning,
        processed = status.Processed,
        total = status.Total,
        rateLimited = status.RateLimited,
        message = status.Message,
        recentlyProcessed = (status.RecentlyProcessed ?? Array.Empty<LetterboxdSyncedMovie>())
            .Select(m => new { tmdbId = m.TmdbId, title = m.Title, ratingFound = m.RatingFound, userRating = m.UserRating }),
    };
}

public sealed record LetterboxdSessionBody(string? CookieHeader, string? UserAgent);
public sealed record WatchlistSyncSettingsBody(bool Enabled, int? ListId);
