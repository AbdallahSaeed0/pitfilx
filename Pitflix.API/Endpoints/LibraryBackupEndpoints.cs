using System.Text.Json;
using Pitflix.API.Services;

namespace Pitflix.API.Endpoints;

/// <summary>
/// Full library backup/restore — Settings &gt; Maintenance &gt; "Backup &amp; Restore". Export downloads a
/// JSON snapshot (paths, watch state, lists, cast, ratings, settings — no images/video files); import
/// merges that snapshot back in, filling gaps and advancing watch progress without ever overwriting or
/// deleting anything already in the local library. See LibraryBackupService for the merge rules.
/// </summary>
public static class LibraryBackupEndpoints
{
    public static void MapLibraryBackupEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/library/backup/export", async (LibraryBackupService backup, CancellationToken ct) =>
        {
            var payload = await backup.BuildAsync(ct).ConfigureAwait(false);
            var fileName = $"pitflix-backup-{DateTime.UtcNow:yyyy-MM-dd}.json";
            var json = JsonSerializer.SerializeToUtf8Bytes(payload, jsonSerializerOptions);
            return Results.File(json, "application/json", fileName);
        });

        app.MapPost("/api/library/backup/import", async (HttpRequest request, LibraryBackupService backup,
            CancellationToken ct) =>
        {
            LibraryBackupPayload? payload;
            try
            {
                payload = await JsonSerializer.DeserializeAsync<LibraryBackupPayload>(request.Body, jsonSerializerOptions, ct)
                    .ConfigureAwait(false);
            }
            catch (JsonException ex)
            {
                return Results.BadRequest(new { error = $"Not a valid Pitflix backup file: {ex.Message}" });
            }

            if (payload == null)
                return Results.BadRequest(new { error = "Empty backup file." });
            if (payload.SchemaVersion > LibraryBackupService.CurrentSchemaVersion)
                return Results.BadRequest(new { error = "This backup was made by a newer version of Pitflix. Update the app first." });

            var result = await backup.ImportAsync(payload, ct).ConfigureAwait(false);
            return Results.Json(result, jsonSerializerOptions);
        });
    }
}
