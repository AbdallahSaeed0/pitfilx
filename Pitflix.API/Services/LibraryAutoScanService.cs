using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;
using Pitflix.Core.Scanner;

namespace Pitflix.API.Services;

/// <summary>Periodically re-scans configured library folders so new files are picked up without a manual run.</summary>
public sealed class LibraryAutoScanService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ScanRuntime _scanRuntime;
    private readonly RatingsRefreshQueue _ratingsRefreshQueue;

    public LibraryAutoScanService(IServiceScopeFactory scopes, ScanRuntime scanRuntime, RatingsRefreshQueue ratingsRefreshQueue)
    {
        _scopes = scopes;
        _scanRuntime = scanRuntime;
        _ratingsRefreshQueue = ratingsRefreshQueue;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            if (!_scanRuntime.IsRunning)
            {
                try
                {
                    await RunQuietScanAsync(stoppingToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch
                {
                    /* avoid crashing host — next hour retry */
                }
            }

            try
            {
                await Task.Delay(TimeSpan.FromHours(1), stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task RunQuietScanAsync(CancellationToken cancellationToken)
    {
        var tmdb = TmdbClientFactory.Create();
        if (tmdb == null)
            return;

        await using var scope = _scopes.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        var paths = await repo.GetAllLibraryPathsAsync(cancellationToken).ConfigureAwait(false);
        if (paths.Count == 0)
            return;

        var fileList = new List<string>();
        var scannerFs = new FileScanner();
        var excludedPaths = await repo.GetExcludedScanPathsAsync(cancellationToken).ConfigureAwait(false);
        foreach (var root in paths)
        {
            if (string.IsNullOrWhiteSpace(root))
                continue;
            foreach (var f in scannerFs.ScanDirectory(root, recursive: true, excludedPaths))
                fileList.Add(f);
        }

        var distinct = fileList.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (distinct.Count == 0)
            return;

        var notifyDesktop = await repo.GetLibraryScanDesktopToastsEnabledAsync(cancellationToken).ConfigureAwait(false);
        var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
        var progress = new Progress<ScanProgress>(p =>
        {
            if (!p.EmitLibraryNotification || string.IsNullOrWhiteSpace(p.LibraryNotificationTitle))
                return;
            _ = _scanRuntime.BroadcastAsync(new
            {
                type = "libraryNotification",
                source = "libraryScan",
                kind = p.LibraryNotificationKind ?? "",
                title = p.LibraryNotificationTitle,
                matched = p.LibraryNotificationMatched
            }, CancellationToken.None);
        });
        await pipeline.RunScanOnFilesAsync(distinct, progress, cancellationToken, libraryNotifications: notifyDesktop)
            .ConfigureAwait(false);
        _ratingsRefreshQueue.TryEnqueueStaleSweep();
    }
}
