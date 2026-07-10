using System.Text.Json;
using Pitflix.API.Services.Trakt;
using Pitflix.Core.Config;
using Pitflix.Core.Database;

namespace Pitflix.API.Endpoints;

internal sealed record TraktSettingsPatchBody(bool? AutoSyncEnabled, string? ClientId, string? ClientSecret);

public static class TraktEndpoints
{
    public static void MapTraktEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/trakt/auth-url", (TraktAuthService auth) =>
        {
            var url = auth.BuildAuthorizeUrl(Guid.NewGuid().ToString("N"));
            if (url == null)
                return Results.Json(new { error = "Trakt is not configured yet — add a Client ID and Secret below first." },
                    jsonSerializerOptions, statusCode: 400);

            return Results.Json(new { url }, jsonSerializerOptions);
        });

        app.MapGet("/api/trakt/callback", async (string? code, TraktAuthService auth, TraktSyncService sync,
            LibraryRepository repo, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(code))
                return Results.Content(TraktCallbackPage(success: false), "text/html");

            var ok = await auth.ExchangeCodeAsync(code, repo, ct).ConfigureAwait(false);
            if (ok)
            {
                // Kick off the one-time history import in the background — the browser tab the user is
                // looking at should show "connected" immediately, not wait on a paginated Trakt sync.
                var services = app.Services;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await using var scope = services.CreateAsyncScope();
                        var bgRepo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
                        var bgSync = scope.ServiceProvider.GetRequiredService<TraktSyncService>();
                        await bgSync.ImportAllAsync(bgRepo, CancellationToken.None).ConfigureAwait(false);
                    }
                    catch { /* best-effort */ }
                });
            }

            return Results.Content(TraktCallbackPage(success: ok), "text/html");
        });

        app.MapPost("/api/trakt/disconnect", async (LibraryRepository repo, CancellationToken ct) =>
        {
            await repo.DisconnectTraktAsync(ct).ConfigureAwait(false);
            return Results.Json(new { success = true }, jsonSerializerOptions);
        });

        app.MapGet("/api/trakt/status", async (LibraryRepository repo, TraktAuthService auth, CancellationToken ct) =>
        {
            var settings = await repo.GetOrCreateTraktSettingsAsync(ct).ConfigureAwait(false);
            var expired = !settings.IsConnected && !string.IsNullOrEmpty(settings.RefreshToken);

            string? username = null;
            if (settings.IsConnected)
            {
                var token = await auth.GetValidAccessTokenAsync(repo, ct).ConfigureAwait(false);
                if (token != null)
                    username = await auth.GetConnectedUsernameAsync(token, ct).ConfigureAwait(false);
            }

            return Results.Json(new
            {
                connected = settings.IsConnected,
                expired,
                autoSyncEnabled = settings.AutoSyncEnabled,
                username,
                appConfigured = auth.IsAppConfigured,
            }, jsonSerializerOptions);
        });

        app.MapPatch("/api/trakt/settings", async (TraktSettingsPatchBody body, LibraryRepository repo,
            TraktSyncService sync, CancellationToken ct) =>
        {
            if (!string.IsNullOrWhiteSpace(body.ClientId) && !string.IsNullOrWhiteSpace(body.ClientSecret))
            {
                await repo.SaveSettingAsync("TraktClientId", body.ClientId.Trim(), ct).ConfigureAwait(false);
                await repo.SaveSettingAsync("TraktClientSecret", body.ClientSecret.Trim(), ct).ConfigureAwait(false);
                AppSettings.ResolveTraktCredentialsFromSources(repo);
            }

            if (body.AutoSyncEnabled.HasValue)
            {
                var before = await repo.GetOrCreateTraktSettingsAsync(ct).ConfigureAwait(false);
                var turningOn = body.AutoSyncEnabled.Value && !before.AutoSyncEnabled;

                await repo.SetTraktAutoSyncEnabledAsync(body.AutoSyncEnabled.Value, ct).ConfigureAwait(false);

                if (turningOn)
                {
                    var services = app.Services;
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await using var scope = services.CreateAsyncScope();
                            var bgRepo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
                            var bgSync = scope.ServiceProvider.GetRequiredService<TraktSyncService>();
                            await bgSync.ImportAllAsync(bgRepo, CancellationToken.None).ConfigureAwait(false);
                        }
                        catch { /* best-effort */ }
                    });
                }
            }

            return Results.Json(new { success = true }, jsonSerializerOptions);
        });

        app.MapPost("/api/trakt/import-history", async (LibraryRepository repo, TraktSyncService sync,
            CancellationToken ct) =>
        {
            var settings = await repo.GetOrCreateTraktSettingsAsync(ct).ConfigureAwait(false);
            if (!settings.IsConnected)
                return Results.Json(new { success = false, error = "Not connected to Trakt." }, jsonSerializerOptions,
                    statusCode: 400);

            var (matched, unmatched, playbackApplied, playbackSkipped) =
                await sync.ImportAllAsync(repo, ct).ConfigureAwait(false);
            return Results.Json(new
            {
                success = true,
                matched,
                unmatched,
                playbackApplied,
                playbackSkipped,
            }, jsonSerializerOptions);
        });
    }

    private static string TraktCallbackPage(bool success)
    {
        var heading = success ? "Connected to Trakt" : "Trakt connection failed";
        var message = success
            ? "You can close this tab and go back to Pitflix."
            : "Something went wrong exchanging the authorization code. Close this tab and try again from Pitflix Settings.";
        return $"""
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"><title>{heading}</title></head>
            <body style="font-family: sans-serif; background:#111; color:#eee; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
              <div style="text-align:center;">
                <h1>{heading}</h1>
                <p>{message}</p>
              </div>
            </body>
            </html>
            """;
    }
}
