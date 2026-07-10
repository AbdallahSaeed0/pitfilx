using System.Text.Json;
using Pitflix.API.Services;
using Pitflix.Core.Config;
using Pitflix.Core.Database;

namespace Pitflix.API.Endpoints;

/// <summary>
/// Desktop-side "Link Mobile Account" feature — signs the desktop app in as a specific
/// Supabase Auth account (same one used on the phone) so it can push watch history/lists
/// directly to Supabase (see MobileAccountSyncService), instead of the mobile app having to
/// reach this desktop over the local network to pull the same data.
/// </summary>
public static class MobileSyncEndpoints
{
    public static void MapMobileSyncEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/mobile-sync/status", async (
            MobileAccountSyncService sync, CancellationToken ct) =>
        {
            var (email, lastSyncedAt) = await sync.GetStatusAsync(ct).ConfigureAwait(false);
            return Results.Json(new { linked = email != null, email, lastSyncedAt }, jsonSerializerOptions);
        });

        app.MapPost("/api/mobile-sync/link", async (
            MobileLinkRequest body, MobileAccountSyncService sync, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.Email) || string.IsNullOrWhiteSpace(body.Password))
                return Results.BadRequest(new { error = "Email and password are required." });

            var (ok, email, error) = await sync.LinkAsync(body.Email.Trim(), body.Password, ct).ConfigureAwait(false);
            if (!ok)
                return Results.Json(new { success = false, error }, jsonSerializerOptions, statusCode: 400);

            // Push right away so the link "does something" immediately instead of waiting
            // up to 5 minutes for the background timer's first tick.
            var (pushOk, pushError) = await sync.PushAsync(ct).ConfigureAwait(false);
            return Results.Json(
                new { success = true, email, pushed = pushOk, pushError },
                jsonSerializerOptions);
        });

        app.MapPost("/api/mobile-sync/unlink", async (
            MobileAccountSyncService sync, CancellationToken ct) =>
        {
            await sync.UnlinkAsync(ct).ConfigureAwait(false);
            return Results.Json(new { success = true }, jsonSerializerOptions);
        });

        app.MapPost("/api/mobile-sync/push", async (
            MobileAccountSyncService sync, CancellationToken ct) =>
        {
            var (ok, error) = await sync.PushAsync(ct).ConfigureAwait(false);
            return Results.Json(new { success = ok, error }, jsonSerializerOptions);
        });

        app.MapPost("/api/mobile-sync/config", async (
            MobileSyncConfigRequest body, LibraryRepository repo, CancellationToken ct) =>
        {
            if (!string.IsNullOrWhiteSpace(body.SupabaseUrl))
                await repo.SaveSettingAsync("SupabaseUrl", body.SupabaseUrl.Trim(), ct).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(body.SupabaseAnonKey))
                await repo.SaveSettingAsync("SupabaseAnonKey", body.SupabaseAnonKey.Trim(), ct).ConfigureAwait(false);
            AppSettings.ResolveSupabaseCredentialsFromSources(repo);
            return Results.Json(new { success = true }, jsonSerializerOptions);
        });
    }
}

public sealed class MobileLinkRequest
{
    public string Email { get; set; } = "";
    public string Password { get; set; } = "";
}

public sealed class MobileSyncConfigRequest
{
    public string? SupabaseUrl { get; set; }
    public string? SupabaseAnonKey { get; set; }
}
