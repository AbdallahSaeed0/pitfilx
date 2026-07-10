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
    private readonly ITmdbClientFactory _tmdbClientFactory;
    private readonly ILogger<PinnedFolderScanService> _logger;

    public PinnedFolderScanService(IServiceScopeFactory scopes, ScanRuntime scanRuntime, RatingsRefreshQueue ratingsRefreshQueue,
        ITmdbClientFactory tmdbClientFactory, ILogger<PinnedFolderScanService> logger)
    {
        _scopes = scopes;
        _scanRuntime = scanRuntime;
        _ratingsRefreshQueue = ratingsRefreshQueue;
        _tmdbClientFactory = tmdbClientFactory;
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
        var tmdb = _tmdbClientFactory.Create();
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

        // ── Incremental filter ────────────────────────────────────────────────
        // Same approach as LibraryAutoScanService: since this runs every 2 minutes,
        // only process files that are new or modified since the last pinned scan,
        // instead of re-matching every file under the pinned folders every pass.
        var lastScanAt = await repo.GetLastPinnedScanAtAsync(cancellationToken).ConfigureAwait(false);
        if (lastScanAt.HasValue)
        {
            LibraryPathPresenceIndex? presenceIndex = null;
            try
            {
                presenceIndex = await repo.CreateLibraryPathPresenceIndexAsync(cancellationToken)
                    .ConfigureAwait(false);
            }
            catch { /* fall back to full list if index fails */ }

            if (presenceIndex != null)
            {
                var cutoff = lastScanAt.Value.AddMinutes(-2);
                var before = distinct.Count;
                distinct = distinct.Where(f =>
                {
                    var norm = MediaPathNormalizer.PreferredPhysicalPath(f);
                    if (!string.IsNullOrEmpty(norm) && !presenceIndex.IsPhysicalPathInLibrary(norm))
                        return true;
                    try { return File.GetLastWriteTimeUtc(f) > cutoff; }
                    catch { return true; }
                }).ToList();

                _logger.LogInformation(
                    "Pinned folder scan incremental filter: {Before} → {After} files (last scan {LastScanAt:u}).",
                    before, distinct.Count, lastScanAt.Value);
            }
        }

        if (distinct.Count == 0)
        {
            await repo.SetLastPinnedScanAtAsync(DateTime.UtcNow, cancellationToken).ConfigureAwait(false);
            return;
        }
        // ─────────────────────────────────────────────────────────────────────

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
        await repo.SetLastPinnedScanAtAsync(DateTime.UtcNow, cancellationToken).ConfigureAwait(false);
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
