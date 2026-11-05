using Microsoft.Extensions.Logging;
using Pitflix.Core;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;
using Pitflix.Core.Scanner;

namespace Pitflix.API.Services;

/// <summary>
/// Re-scans configured library folders so new files are picked up without a manual run: hourly, and
/// within ~30 s of a new video file appearing (FileSystemWatcher on every library folder). Without the
/// watcher a freshly downloaded episode stayed "Download episode" for up to an hour.
/// </summary>
public sealed class LibraryAutoScanService : BackgroundService
{
    /// <summary>A new file must stop growing for this long before it's scanned (download finished).</summary>
    private static readonly TimeSpan SettleTime = TimeSpan.FromSeconds(30);

    private readonly SemaphoreSlim _wake = new(0, 1);
    private readonly object _watchLock = new();
    private readonly List<FileSystemWatcher> _watchers = new();
    private string _watchedRootsKey = "";
    /// <summary>New video files seen by the watchers → (last size, when that size was first seen).</summary>
    private readonly Dictionary<string, (long Size, DateTime StableSinceUtc)> _pending = new(StringComparer.OrdinalIgnoreCase);

    private readonly IServiceScopeFactory _scopes;
    private readonly ScanRuntime _scanRuntime;
    private readonly RatingsRefreshQueue _ratingsRefreshQueue;
    private readonly ITmdbClientFactory _tmdbClientFactory;
    private readonly ILogger<LibraryAutoScanService> _logger;

    public LibraryAutoScanService(IServiceScopeFactory scopes, ScanRuntime scanRuntime, RatingsRefreshQueue ratingsRefreshQueue,
        ITmdbClientFactory tmdbClientFactory, ILogger<LibraryAutoScanService> logger)
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
            await Task.Delay(TimeSpan.FromSeconds(90), stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        using var settleTimer = new Timer(_ => CheckPendingFiles(), null, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(10));
        while (!stoppingToken.IsCancellationRequested)
        {
            await RefreshWatchersAsync(stoppingToken).ConfigureAwait(false);
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
                // Hourly, or sooner when a new video file has settled in a library folder.
                await _wake.WaitAsync(TimeSpan.FromHours(1), stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        lock (_watchLock)
        {
            foreach (var w in _watchers) w.Dispose();
            _watchers.Clear();
        }
    }

    /// <summary>(Re)creates one recursive watcher per library folder whenever the folder list changes.</summary>
    private async Task RefreshWatchersAsync(CancellationToken ct)
    {
        List<string> roots;
        try
        {
            await using var scope = _scopes.CreateAsyncScope();
            var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
            roots = (await repo.GetAllLibraryPathsAsync(ct).ConfigureAwait(false))
                .Where(r => !string.IsNullOrWhiteSpace(r))
                .Select(r => MediaPathNormalizer.PreferredPhysicalPath(r.Trim()))
                .Where(r => !string.IsNullOrEmpty(r) && Directory.Exists(r))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList()!;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogDebug(ex, "Library watcher: could not read library folders");
            return;
        }

        var key = string.Join("|", roots.OrderBy(r => r, StringComparer.OrdinalIgnoreCase));
        lock (_watchLock)
        {
            if (key == _watchedRootsKey) return;
            foreach (var w in _watchers) w.Dispose();
            _watchers.Clear();
            foreach (var root in roots)
            {
                try
                {
                    var w = new FileSystemWatcher(root)
                    {
                        IncludeSubdirectories = true,
                        NotifyFilter = NotifyFilters.FileName | NotifyFilters.Size | NotifyFilters.LastWrite,
                        InternalBufferSize = 64 * 1024,
                    };
                    w.Created += (_, e) => NoteCandidate(e.FullPath);
                    w.Changed += (_, e) => NoteCandidate(e.FullPath);
                    // Torrent clients often download to "name.mkv.!qB"/".part" and rename at the end.
                    w.Renamed += (_, e) => NoteCandidate(e.FullPath);
                    w.EnableRaisingEvents = true;
                    _watchers.Add(w);
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Library watcher: cannot watch {Root}", root);
                }
            }
            _watchedRootsKey = key;
            _logger.LogInformation("Library watcher: watching {Count} library folder(s) for new videos", _watchers.Count);
        }
    }

    private void NoteCandidate(string path)
    {
        if (!FileScanner.IsVideoFile(path)) return;
        lock (_pending)
        {
            // (Re)start the settle clock on every event — a growing file keeps pushing it back.
            _pending[path] = (-1, DateTime.UtcNow);
        }
    }

    /// <summary>Every 10 s: wake the scan once some new file has kept the same size for SettleTime.</summary>
    private void CheckPendingFiles()
    {
        var settled = false;
        lock (_pending)
        {
            if (_pending.Count == 0) return;
            var now = DateTime.UtcNow;
            foreach (var path in _pending.Keys.ToList())
            {
                long size;
                try
                {
                    var fi = new FileInfo(path);
                    if (!fi.Exists) { _pending.Remove(path); continue; }
                    size = fi.Length;
                }
                catch { continue; }

                var (lastSize, since) = _pending[path];
                if (size != lastSize)
                    _pending[path] = (size, now); // still growing (or first check) — restart the clock
                else if (size > 0 && now - since >= SettleTime)
                {
                    _pending.Remove(path);
                    settled = true;
                }
            }
        }
        if (settled && _wake.CurrentCount == 0)
        {
            _logger.LogInformation("Library watcher: new video file finished — scanning now");
            try { _wake.Release(); } catch (SemaphoreFullException) { }
        }
    }

    private async Task RunQuietScanAsync(CancellationToken cancellationToken)
    {
        var tmdb = _tmdbClientFactory.Create();
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

        // Claim the shared scan mutex for real — the earlier "if (!_scanRuntime.IsRunning)" check in
        // ExecuteAsync is only a cheap pre-filter. Without actually acquiring here, this background
        // pass never marked itself as running, so a manual scan, "Rescan unmatched", or the pinned-
        // folder scan's own timer could start concurrently and reprocess the same files — surfacing
        // as the same title getting a fresh "Matched" notification minutes after it was already matched.
        var jobId = await _scanRuntime.BeginJobAsync(cancellationToken).ConfigureAwait(false);
        if (jobId == null)
            return; // another scan is genuinely in progress — wait for the next tick

        try
        {
            _scanRuntime.ResetProgress(distinct.Count);

            var notifyDesktop = await repo.GetLibraryScanDesktopToastsEnabledAsync(cancellationToken).ConfigureAwait(false);
            var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
            var progress = new Progress<ScanProgress>(p =>
            {
                _scanRuntime.Update(p.Current, p.CurrentFile, p.MatchedSoFar, p.UnmatchedSoFar, p.SkippedSoFar);
                if (p.EmitLibraryNotification && !string.IsNullOrWhiteSpace(p.LibraryNotificationTitle))
                {
                    _ = _scanRuntime.BroadcastAsync(new
                    {
                        type = "libraryNotification",
                        source = "libraryScan",
                        kind = p.LibraryNotificationKind ?? "",
                        title = p.LibraryNotificationTitle,
                        matched = p.LibraryNotificationMatched,
                        libraryId = p.LibraryNotificationLibraryId,
                        season = p.LibraryNotificationSeason
                    }, CancellationToken.None);
                }
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
        finally
        {
            await _scanRuntime.EndJobAsync().ConfigureAwait(false);
        }
    }
}
