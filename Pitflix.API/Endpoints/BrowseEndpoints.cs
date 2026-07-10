using System.Text.Json;
using Pitflix.API.Services.Browse;

namespace Pitflix.API.Endpoints;

/// <summary>
/// Isolated endpoint group for the Browse tab's download hand-off (arbitrary images/videos
/// found on pages loaded in the embedded webview). Not to be confused with the existing
/// <c>/api/library/browse/decade</c> / <c>/api/library/browse/keyword</c> catalog-browsing
/// endpoints — unrelated feature, name collision avoided by living entirely under
/// <c>/api/browse/*</c> with its own request/response models in <c>Services/Browse</c>.
/// </summary>
public static class BrowseEndpoints
{
    public static void MapBrowseEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapPost("/api/browse/download", async (BrowseDownloadRequest body, BrowseDownloadService service,
            CancellationToken ct) =>
        {
            var result = await service.DownloadAsync(body, ct).ConfigureAwait(false);
            return Results.Json(result, jsonSerializerOptions);
        });

        // Polled by the frontend for progress/completion — every download (image, direct
        // video, or HLS) runs as a background job (see BrowseDownloadJobTracker).
        app.MapGet("/api/browse/download/{jobId}/status", (string jobId, BrowseDownloadJobTracker jobs) =>
        {
            var status = jobs.Get(jobId);
            if (status == null)
                return Results.NotFound();

            return Results.Json(new BrowseDownloadJobStatusResult(
                status.State.ToString().ToLowerInvariant(),
                status.SavedPath,
                status.Error,
                status.ProgressPercent,
                status.BytesDone,
                status.BytesTotal), jsonSerializerOptions);
        });

        app.MapPost("/api/browse/download/{jobId}/cancel", (string jobId, BrowseDownloadJobTracker jobs) =>
        {
            var cancelled = jobs.RequestCancel(jobId);
            return Results.Json(new { success = cancelled }, jsonSerializerOptions);
        });
    }
}
