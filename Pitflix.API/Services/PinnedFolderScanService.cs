using Microsoft.Extensions.Logging;
using Pitflix.Core;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;
using Pitflix.Core.Scanner;

namespace Pitflix.API.Services;

/// <summary>Re-scans user-pinned folders every few minutes so new downloads are indexed without waiting for the hourly full pass.</summary>
public sealed class PinnedFolderScanService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ScanRuntime _scanRuntime;
    private readonly RatingsRefreshQueue _ratingsRefreshQueue;
    private readonly ILogger<PinnedFolderScanService> _logger;

    public PinnedFolderScanService(IServiceScopeFactory scopes, ScanRuntime scanRuntime, RatingsRefreshQueue ratingsRefreshQueue,
        ILogger<PinnedFolderScanService> logger)
    {
        _scopes = scopes;
        _scanRuntime = scanRuntime;
        _ratingsRefreshQueue = ratingsRefreshQueue;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken).ConfigureAwait(false);
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
                    await RunPinnedScanAsync(stoppingToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Pinned folder auto-scan failed with exception: {Message}", ex.Message);
                }
            }

            try
            {
                await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task RunPinnedScanAsync(CancellationToken cancellationToken)
    {
        var tmdb = TmdbClientFactory.Create();
        if (tmdb == null)
        {
            _logger.LogWarning("Pinned folder auto-scan skipped: TMDB API key is not configured.");
            return;
        }

        await using var scope = _scopes.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        var pinned = await repo.GetPinnedScanPathsAsync(cancellationToken).ConfigureAwait(false);
        if (pinned.Count == 0)
            return;

        var scannerFs = new FileScanner();
        var fileList = new List<string>();
        var excludedPaths = await repo.GetExcludedScanPathsAsync(cancellationToken).ConfigureAwait(false);
        foreach (var root in pinned)
        {
            if (string.IsNullOrWhiteSpace(root))
                continue;
            var norm = MediaPathNormalizer.PreferredPhysicalPath(root.Trim());
            if (string.IsNullOrEmpty(norm) || !Directory.Exists(norm))
                continue;
            foreach (var f in scannerFs.ScanDirectory(norm, recursive: true, excludedPaths))
                fileList.Add(f);
        }

        var distinct = fileList.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (distinct.Count == 0)
        {
            _logger.LogInformation(
                "Pinned folder scan: 0 video files under {PinnedCount} pinned path(s). Check folder exists and file extensions.",
                pinned.Count);
            return;
        }

        var notifyDesktop = await repo.GetLibraryScanDesktopToastsEnabledAsync(cancellationToken).ConfigureAwait(false);
        var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
        var progress = new Progress<ScanProgress>(p =>
        {
            if (!p.EmitLibraryNotification || string.IsNullOrWhiteSpace(p.LibraryNotificationTitle))
                return;
            _ = _scanRuntime.BroadcastAsync(new
            {
                type = "libraryNotification",
                source = "pinnedScan",
                kind = p.LibraryNotificationKind ?? "",
                title = p.LibraryNotificationTitle,
                matched = p.LibraryNotificationMatched
            }, CancellationToken.None);
        });
        var result = await pipeline.RunScanOnFilesAsync(distinct, progress, cancellationToken,
                libraryNotifications: notifyDesktop, skipUnchangedUnmatchedScanLogs: true)
            .ConfigureAwait(false);
        _ratingsRefreshQueue.TryEnqueueStaleSweep();

        if (result.Matched > 0 || result.Unmatched > 0)
        {
            _ = _scanRuntime.BroadcastAsync(new
            {
                type = "libraryUpdated",
                matched = result.Matched,
                unmatched = result.Unmatched
            }, CancellationToken.None);
        }
    }
}
