using Pitflix.API.Services;
using Pitflix.Core.Database;
using Pitflix.Core.Models;
using Pitflix.Core.Parser;
using Pitflix.Core.Scanner;

namespace Pitflix.API.Endpoints;

public static class ScanEndpoints
{
    public static void MapScanEndpoints(this WebApplication app)
    {
        app.MapPost("/api/scan/start", async (ScanStartBody body, LibraryRepository repo, ScanRuntime scan, IServiceScopeFactory scopes,
                RatingsRefreshQueue ratingsRefreshQueue, ITmdbClientFactory tmdbClientFactory, CancellationToken _startupCt) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.BadRequest(new { error = "TMDB API key not configured." });

            if (scan.IsRunning)
                return Results.Conflict(new { error = "Scan already running.", jobId = scan.JobId });

            var folders = body.Folders;
            if (folders == null || folders.Length == 0)
                folders = (await repo.GetAllLibraryPathsAsync().ConfigureAwait(false)).ToArray();
            if (folders.Length == 0)
                return Results.BadRequest(new
                {
                    error = "NO_LIBRARY_FOLDERS",
                    message =
                        "No library folders are configured. Open Settings, add at least one folder under \"Library folders\", then scan again."
                });

            var jobId = await scan.BeginJobAsync().ConfigureAwait(false);
            scan.StartCancellationSource();
            var token = scan.ScanToken;

            _ = Task.Run(async () =>
            {
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    var r = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
                    var pipeline = new ScanPipeline(new FileScanner(), tmdb, r);
                    var fileList = new List<string>();
                    var scannerFs = new FileScanner();
                    var excludedPaths = await r.GetExcludedScanPathsAsync(token).ConfigureAwait(false);
                    foreach (var root in folders)
                    {
                        if (string.IsNullOrWhiteSpace(root)) continue;
                        foreach (var f in scannerFs.ScanDirectory(root, recursive: true, excludedPaths))
                            fileList.Add(f);
                    }

                    var distinct = fileList.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                    if (distinct.Count == 0)
                    {
                        scan.ResetProgress(0);
                        await scan.BroadcastAsync(new
                        {
                            type = "complete",
                            matched = 0,
                            unmatched = 0,
                            skipped = 0,
                            empty = true,
                            message =
                                "No video files were found in the selected folders. Add media files or choose a different folder."
                        }, CancellationToken.None).ConfigureAwait(false);
                        return;
                    }

                    scan.ResetProgress(distinct.Count);

                    var progress = new Progress<ScanProgress>(p =>
                    {
                        scan.Update(p.Current, p.CurrentFile, p.MatchedSoFar, p.UnmatchedSoFar, p.SkippedSoFar);
                        _ = scan.BroadcastAsync(new
                        {
                            type = "progress",
                            current = p.Current,
                            total = p.Total,
                            file = string.IsNullOrEmpty(p.CurrentFile)
                                ? ""
                                : Path.GetFileNameWithoutExtension(p.CurrentFile),
                            p.MatchedSoFar,
                            p.UnmatchedSoFar,
                            skipped = p.SkippedSoFar
                        }, CancellationToken.None);
                    });

                    var result = await pipeline.RunScanOnFilesAsync(distinct, progress, token).ConfigureAwait(false);
                    await scan.BroadcastAsync(new
                    {
                        type = "complete",
                        result.Matched,
                        result.Unmatched,
                        skipped = result.SkippedAlreadyMatched
                    }, CancellationToken.None).ConfigureAwait(false);
                    ratingsRefreshQueue.TryEnqueueStaleSweep();
                }
                catch (OperationCanceledException)
                {
                    await scan.BroadcastAsync(new { type = "cancelled" }, CancellationToken.None).ConfigureAwait(false);
                }
                finally
                {
                    scan.DisposeCancellationSource();
                    await scan.EndJobAsync().ConfigureAwait(false);
                }
            }, CancellationToken.None);

            return Results.Json(new { jobId });
        });

        app.MapGet("/api/scan/progress", (ScanRuntime scan) =>
        {
            return Results.Json(new
            {
                isRunning = scan.IsRunning,
                total = scan.Total,
                current = scan.Current,
                currentFile = scan.CurrentFile,
                matched = scan.Matched,
                unmatched = scan.Unmatched,
                percent = scan.Percent
            });
        });

        app.MapPost("/api/scan/cancel", (ScanRuntime scan) =>
        {
            scan.CancelScan();
            return Results.Ok();
        });

        app.MapGet("/api/scan/stream", async (HttpContext ctx, ScanRuntime scan, CancellationToken ct) =>
        {
            ctx.Response.Headers.Append("Content-Type", "text/event-stream");
            ctx.Response.Headers.Append("Cache-Control", "no-cache");
            ctx.Response.Headers.Append("Connection", "keep-alive");

            var reader = scan.Subscribe(out var subId);
            try
            {
                await foreach (var msg in reader.ReadAllAsync(ct).ConfigureAwait(false))
                {
                    await ctx.Response.WriteAsync("data: " + msg + "\n\n", ct).ConfigureAwait(false);
                    await ctx.Response.Body.FlushAsync(ct).ConfigureAwait(false);
                }
            }
            finally
            {
                scan.Unsubscribe(subId);
            }
        });
    }
}
