using System.Text.Json;
using Pitflix.API.Services;

namespace Pitflix.API.Endpoints;

/// <summary>
/// One-shot flat export of the desktop library's watched state, used by the mobile
/// app's Settings "Sync Now" to import watch history into its own per-account
/// Supabase library (see PitflixAndroid's UserLibraryService/AppSettings). Payload
/// building lives in LibraryExportBuilder — MobileAccountSyncService (push-to-Supabase)
/// shares it too.
/// </summary>
public static class LibraryExportEndpoints
{
    public static void MapLibraryExportEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/library/watched-export", async (LibraryExportBuilder builder, CancellationToken ct) =>
        {
            var payload = await builder.BuildAsync(ct).ConfigureAwait(false);
            return Results.Json(payload, jsonSerializerOptions);
        });
    }
}
