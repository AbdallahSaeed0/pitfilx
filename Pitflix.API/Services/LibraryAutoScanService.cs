using Microsoft.Extensions.Logging;
using Pitflix.Core;
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
    private readonly ILogger<LibraryAutoScanService> _logger;

    public LibraryAutoScanService(IServiceScopeFactory scopes, ScanRuntime scanRuntime, RatingsRefreshQueue ratingsRefreshQueue,
        ILogger<LibraryAutoScanService> logger)
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
            await Task.Delay(TimeSpan.FromSeconds(90), stoppingToken).ConfigureAwait(false);
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
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Library auto-scan failed with exception: {Message}", ex.Message);
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
        {
            _logger.LogWarning("Library auto-scan skipped: TMDB API key is not configured.");
            return;
        }

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
            var norm = MediaPathNormalizer.PreferredPhysicalPath(root.Trim());
            if (string.IsNullOrEmpty(norm))
                continue;
            foreach (var f in scannerFs.ScanDirectory(norm, recursive: true, excludedPaths))
                fileList.Add(f);
        }

        var distinct = fileList.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (distinct.Count == 0)
        {
            _logger.LogInformation(
                "Library auto-scan: 0 video files under {RootCount} library folder(s). Check paths exist, extensions (.mkv/.mp4/.ts/…), and Settings exclusions.",
                paths.Count);
            return;
        }

        // ── Incremental filter ────────────────────────────────────────────────
        // For the hourly auto-scan, only process files that are:
        //   (a) not yet in the library (brand-new), OR
        //   (b) modified since the last successful auto-scan.
        // This makes the auto-scan nearly instant when the library is stable.
        var lastScanAt = await repo.GetLastAutoScanAtAsync(cancellationToken).ConfigureAwait(false);
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
                // Always include a 2-minute buffer to tolerate clock skew / in-flight copies.
                var cutoff = lastScanAt.Value.AddMinutes(-2);
                var before = distinct.Count;
                distinct = distinct.Where(f =>
                {
                    // New file not yet in library → always process.
                    var norm = MediaPathNormalizer.PreferredPhysicalPath(f);
                    if (!string.IsNullOrEmpty(norm) && !presenceIndex.IsPhysicalPathInLibrary(norm))
                        return true;
                    // Already in library but recently modified → process in case metadata changed.
                    try { return File.GetLastWriteTimeUtc(f) > cutoff; }
                    catch { return true; }
                }).ToList();

                _logger.LogInformation(
                    "Library auto-scan incremental filter: {Before} → {After} files (last scan {LastScanAt:u}).",
                    before, distinct.Count, lastScanAt.Value);
            }
        }
        // ─────────────────────────────────────────────────────────────────────

        if (distinct.Count == 0)
        {
            // Nothing to process — update the timestamp so the next scan uses a fresh cutoff.
            await repo.SetLastAutoScanAtAsync(DateTime.UtcNow, cancellationToken).ConfigureAwait(false);
            _logger.LogInformation("Library auto-scan: all files already up-to-date, nothing to process.");
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
                source = "libraryScan",
                kind = p.LibraryNotificationKind ?? "",
                title = p.LibraryNotificationTitle,
                matched = p.LibraryNotificationMatched
            }, CancellationToken.None);
        });
        var result = await pipeline.RunScanOnFilesAsync(distinct, progress, cancellationToken,
                libraryNotifications: notifyDesktop, skipUnchangedUnmatchedScanLogs: true)
            .ConfigureAwait(false);

        // Stamp the successful completion time so the next auto-scan can skip unchanged files.
        await repo.SetLastAutoScanAtAsync(DateTime.UtcNow, cancellationToken).ConfigureAwait(false);

        _ratingsRefreshQueue.TryEnqueueStaleSweep();

        // Always broadcast a lightweight "libraryUpdated" so the UI can refresh queries,
        // even when desktop toasts are disabled and no libraryNotification events were emitted.
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
