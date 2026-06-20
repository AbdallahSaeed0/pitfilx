using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using Pitflix.API.Models;
using Pitflix.Core.Database;

namespace Pitflix.API.Services;

public sealed class PlayerService : IDisposable
{
    private readonly string _mpvExePath;
    private readonly string[] _scriptPaths;
    private readonly ILogger<PlayerService> _logger;
    private readonly bool _useLibMpv;

    // Scope factory for periodic / on-exit writes to WatchHistory.  This service
    // is registered as a singleton; LibraryRepository is scoped, so we have to
    // create a scope each time we want one.  Used by SaveProgressToHistoryAsync.
    private readonly IServiceScopeFactory _scopeFactory;

    // ── libmpv in-process backend (when _useLibMpv = true) ────────────────
    private LibMpvHandle? _libMpv;
    private System.Threading.Timer? _libMpvSaveTimer;

    // One session at a time; guarded by _lock for all reads/writes.
    private PlayerSession? _session;
    private Process? _mpvProcess;
    private CancellationTokenSource? _pollCts;
    private StreamWriter? _pipeWriter;
    // Set to true while AttachWindowAsync is killing the OLD mpv, so its Exited event does
    // not mark the still-valid session as stopped before the new mpv process takes over.
    private bool _suppressMpvExited = false;
    // True while AttachWindowAsync is mid-spawn.  StartAsync's companion
    // watchdog checks this so it never races a fallback standalone mpv
    // against an attach that is already in flight.
    private bool _attachInProgress = false;

    // Last position we persisted to the WatchHistory row, per session, so the
    // poll loop only writes back when it's actually moved (avoids hammering the
    // DB once-per-second when the user is paused).
    private double _lastSavedPosition;
    private DateTime _lastSaveAtUtc = DateTime.MinValue;
    // Track id of the active session's saved history row so we don't have to
    // look it up by FilePath on every save.  Set lazily on the first save.
    private int? _activeHistoryId;
    // Track the FilePath the history id was resolved for; if it changes
    // (playlist-next) we re-resolve so a movie in a folder full of episodes
    // saves to the right row.
    private string? _activeHistoryFilePath;

    private readonly object _lock = new();

    // Ensures poll-loop writes and external SendCommandAsync writes never interleave on the pipe.
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public PlayerService(IConfiguration config, ILogger<PlayerService> logger,
                         IServiceScopeFactory scopeFactory)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _scriptPaths = config.GetSection("Player:ScriptPaths").Get<string[]>() ?? Array.Empty<string>();
        _useLibMpv   = config.GetValue<bool>("Player:UseLibMpv");

        // Resolve mpv.exe at startup using a small probe list.  The previous
        // logic just used config["Player:MpvExePath"] ?? "mpv" and trusted
        // PATH to do the rest — which fails on this user's machine because
        // mpv isn't on PATH and isn't sitting next to Pitflix.API.exe.  The
        // actual mpv.exe lives in the Tauri sidecar dir.
        var configured = config["Player:MpvExePath"];
        _mpvExePath = ResolveMpvExePath(configured);
        _logger.LogInformation("PlayerService: mpv.exe resolved to '{Path}'", _mpvExePath);

        if (_useLibMpv)
            InitLibMpv();
    }

    private void InitLibMpv()
    {
        try
        {
            // Pre-load libmpv-2.dll from a known path so the resolver finds it.
            // Search order: next to pitflix-api.exe, then next to mpv.exe, then
            // Assembly location (dev), then let Windows search PATH/system dirs.
            var candidates = new[]
            {
                Path.Combine(Path.GetDirectoryName(Environment.ProcessPath ?? "") ?? "", "libmpv-2.dll"),
                Path.Combine(Path.GetDirectoryName(_mpvExePath) ?? "", "libmpv-2.dll"),
                Path.Combine(Path.GetDirectoryName(
                    System.Reflection.Assembly.GetExecutingAssembly().Location) ?? "", "libmpv-2.dll"),
            };

            var found = candidates.FirstOrDefault(File.Exists);
            if (found is not null)
            {
                // Pre-load so the WindowsFunctionResolver finds it by name
                System.Runtime.InteropServices.NativeLibrary.Load(found);
                _logger.LogInformation("PlayerService: pre-loaded {Path}", found);
            }

            LibMpv.Client.DynamicallyLoadedBindings.Initialize();
            _logger.LogInformation("PlayerService: libmpv initialised (dll={Path})", found ?? "PATH");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PlayerService: libmpv init failed — player commands will not work");
        }
    }

    /// <summary>
    /// Returns the first valid mpv.exe location.  Probe order:
    ///   1. The explicit `Player:MpvExePath` config value (absolute or
    ///      resolvable on PATH).
    ///   2. Sibling alongside Pitflix.API.exe (production / packaged build).
    ///   3. Tauri sidecar dir: …/Pitflix.UI/src-tauri/target/{debug,release}/mpv.exe
    ///      (dev workflow — this is where the user's mpv actually lives).
    /// Falls back to the configured value as a last resort so Process.Start
    /// will still throw a clear "file not found" error mentioning the path,
    /// rather than silently going to "mpv" and getting a confusing message.
    /// </summary>
    private static string ResolveMpvExePath(string? configured)
    {
        bool IsExistingFile(string p) => !string.IsNullOrWhiteSpace(p) && File.Exists(p);

        // 1. Configured explicit path
        if (IsExistingFile(configured!)) return configured!;

        // 2/3. Probe candidates relative to Pitflix.API.exe.  We climb four
        // levels up from bin/Debug/net8.0-windows/ to reach the repo root.
        //
        // NOTE: in production, Pitflix.API is published with
        // IncludeAllContentForSelfExtract=true, which makes
        // Assembly.GetExecutingAssembly().Location point into a temp
        // self-extraction directory (%TEMP%\.net\Pitflix.API\<hash>\...), NOT the
        // install directory. Environment.ProcessPath always points at the actual
        // pitflix-api.exe on disk (the install root), so it's the reliable source
        // for production-relative paths.
        var apiDir = Path.GetDirectoryName(
            System.Reflection.Assembly.GetExecutingAssembly().Location) ?? string.Empty;
        var processDir = Path.GetDirectoryName(Environment.ProcessPath ?? string.Empty) ?? string.Empty;
        string Combine(params string[] parts) => Path.GetFullPath(Path.Combine(parts));

        var candidates = new[]
        {
            // Sibling exe (production) — resolved from the running exe's actual location
            Combine(processDir, "mpv.exe"),
            // Same, derived from Assembly.Location (works in dev / non-single-file builds)
            Combine(apiDir, "mpv.exe"),
            // Dev — Tauri sidecar dir
            Combine(apiDir, "..", "..", "..", "..", "Pitflix.UI", "src-tauri", "target", "debug",   "mpv.exe"),
            Combine(apiDir, "..", "..", "..", "..", "Pitflix.UI", "src-tauri", "target", "release", "mpv.exe"),
        };
        foreach (var c in candidates)
            if (IsExistingFile(c)) return c;

        // Last resort: return the configured value (or "mpv") so Process.Start
        // gives a clear "file not found" error against THAT path, not against
        // an empty string.
        return string.IsNullOrWhiteSpace(configured) ? "mpv" : configured!;
    }

    /// <summary>
    /// Synchronously runs a progress save for the currently-active session.
    /// Exposed via /api/player/save-progress-now so PitflixPlayer can flush
    /// the user's final time-pos before the window closes — eliminates the
    /// race where React refetches the history row before HandleMpvExited's
    /// async save has committed.
    /// </summary>
    public async Task SaveProgressNowAsync(CancellationToken ct)
    {
        PlayerSession? s;
        lock (_lock) s = _session;
        if (s is not null)
            await SaveProgressToHistoryAsync(s, isFinal: false, ct).ConfigureAwait(false);
    }

    /// <summary>
    /// Resolve (and cache) the history id for the session's current FilePath
    /// and write the position back via UpdateWatchHistoryProgressAsync.
    /// Called from PollLoopAsync (throttled to every ~5 s and only when
    /// position has moved) and from HandleMpvExited for the final save.
    /// All errors are swallowed — failing to save progress should never
    /// surface to the user; their playback experience is untouched.
    /// </summary>
    /// <summary>
    /// Normalizes a file path for case-insensitive Windows comparison.
    /// Resolves to a full path (canonicalizing relative segments, dot
    /// segments) and replaces forward slashes with back-slashes so
    /// mpv-reported paths (which may use either separator) compare equal
    /// to the originally-passed path.  Failures fall through to the input
    /// unchanged — we'd rather miss a path-change event than crash on a
    /// malformed path.
    /// </summary>
    private static string NormalizePath(string p)
    {
        if (string.IsNullOrEmpty(p)) return p;
        try { return Path.GetFullPath(p).Replace('/', '\\'); }
        catch { return p.Replace('/', '\\'); }
    }

    private async Task SaveProgressToHistoryAsync(PlayerSession session,
                                                  bool isFinal,
                                                  CancellationToken ct)
    {
        try
        {
            int pos = (int)Math.Floor(session.Position);
            int? dur = session.Duration > 0 ? (int)Math.Floor(session.Duration) : (int?)null;
            string filePath = session.FilePath;
            if (string.IsNullOrEmpty(filePath) || pos < 0) return;

            using var scope = _scopeFactory.CreateScope();
            var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();

            // Cache the history id for the active file.  Invalidate when
            // FilePath changes (playlist-next picked a different episode).
            int? historyId;
            lock (_lock)
            {
                if (_activeHistoryId is null ||
                    !string.Equals(_activeHistoryFilePath, filePath, StringComparison.OrdinalIgnoreCase))
                {
                    _activeHistoryId       = null;
                    _activeHistoryFilePath = filePath;
                }
                historyId = _activeHistoryId;
            }

            if (historyId is null)
            {
                historyId = await repo.FindActiveHistoryIdByFileAsync(filePath, ct).ConfigureAwait(false);
                if (historyId is null) return;   // file never had a history row; nothing to update
                lock (_lock) _activeHistoryId = historyId;
            }

            await repo.UpdateWatchHistoryProgressAsync(historyId.Value, pos, dur,
                markWatching: !isFinal, ct).ConfigureAwait(false);

            _lastSavedPosition = session.Position;
            _lastSaveAtUtc     = DateTime.UtcNow;
            _logger.LogDebug("PlayerService: saved position {Pos}s for history {Hid} ({File})",
                pos, historyId.Value, System.IO.Path.GetFileName(filePath));
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "PlayerService: SaveProgressToHistory failed (non-fatal)");
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    public PlayerSession? GetSession()
    {
        lock (_lock)
            return _session is null ? null : Snapshot(_session);
    }

    public async Task<PlayerSession> StartAsync(
        string filePath, int mediaId, int? episodeId,
        double startPosition, string? subtitleTrack,
        string? player = null,
        CancellationToken ct = default)
    {
        await StopAsync().ConfigureAwait(false);

        var sessionId = Guid.NewGuid();
        var pipeName = $"pitflix-player-{sessionId:N}";

        var session = new PlayerSession
        {
            SessionId  = sessionId,
            MediaId    = mediaId,
            EpisodeId  = episodeId,
            FilePath   = filePath,
            Position   = startPosition,
            Duration   = 0,
            IsPaused   = false,
            IsStopped  = false,
            SubtitleTrack  = subtitleTrack,
            StartedAt      = DateTime.UtcNow,
            LastUpdatedAt  = DateTime.UtcNow,
            PipeName   = pipeName
        };

        lock (_lock)
        {
            _session    = session;
            _mpvProcess = null;
            _activeHistoryId       = null;
            _activeHistoryFilePath = null;
            _lastSavedPosition     = 0;
            _lastSaveAtUtc         = DateTime.MinValue;
        }

        // Resolve which companion to use based on the caller's preference.
        bool usePitflix2    = string.Equals(player, "pitflix2", StringComparison.OrdinalIgnoreCase);
        string processName  = usePitflix2 ? "PitflixPlayer2" : "PitflixPlayer";
        string? companionExe = usePitflix2 ? FindPitflixPlayer2Exe() : FindPitflixPlayerExe();
        bool companionRunning = Process.GetProcessesByName(processName).Length > 0;

        // ── libmpv in-process path ─────────────────────────────────────────
        // Start audio/video playback immediately (headless — hwnd=null);
        // the companion will call /attach and supply its HWND so libmpv
        // re-renders into the WPF window.
        if (_useLibMpv)
        {
            StartLibMpv(session, startPosition, hwnd: null, subtitleTrack);
            if (companionExe is not null && !companionRunning)
                _ = Task.Run(() => SpawnCompanion(companionExe, processName, _logger));
            return Snapshot(session);
        }

        if (companionExe is not null || companionRunning)
        {
            // Smooth-open path: defer mpv spawn to AttachWindowAsync so the
            // window is embedded from the first frame (no kill+respawn merge).
            if (!companionRunning)
                _ = Task.Run(() => SpawnCompanion(companionExe!, processName, _logger));

            // Watchdog: if the companion never calls /api/player/attach
            // (crashed, stale build, blocked by AV), fall back to standalone
            // mpv so playback still starts.
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(10)).ConfigureAwait(false);
                bool needFallback;
                lock (_lock)
                    needFallback = ReferenceEquals(_session, session)
                                   && !session.IsStopped
                                   && _mpvProcess is null
                                   && !_attachInProgress;
                if (!needFallback) return;
                _logger.LogWarning("PlayerService: {Name} did not attach within 10 s — starting standalone mpv fallback", processName);
                try { StartStandaloneMpv(session, startPosition, subtitleTrack); }
                catch (Exception ex) { _logger.LogError(ex, "PlayerService: standalone mpv fallback failed"); }
            });

            return Snapshot(session);
        }

        StartStandaloneMpv(session, startPosition, subtitleTrack);
        return Snapshot(session);
    }

    /// <summary>
    /// Spawns mpv as its own top-level window (no --wid) for the given
    /// session and starts the IPC poll loop.  Used when no PitflixPlayer
    /// companion is available, and as the watchdog fallback when the
    /// companion fails to attach.
    /// </summary>
    private void StartStandaloneMpv(PlayerSession session, double startPosition, string? subtitleTrack)
    {
        var pipeName = session.PipeName!;

        var psi = new ProcessStartInfo(_mpvExePath)
        {
            UseShellExecute = false,
            CreateNoWindow  = true
        };

        psi.ArgumentList.Add(session.FilePath);
        psi.ArgumentList.Add($@"--input-ipc-server=\\.\pipe\{pipeName}");
        psi.ArgumentList.Add($"--start={startPosition:F3}");
        psi.ArgumentList.Add("--no-terminal");
        psi.ArgumentList.Add("--keep-open=yes");

        foreach (var script in _scriptPaths)
        {
            if (!string.IsNullOrWhiteSpace(script))
                psi.ArgumentList.Add($"--script={script}");
        }

        if (!string.IsNullOrWhiteSpace(subtitleTrack))
            psi.ArgumentList.Add($"--sub-file={subtitleTrack}");

        var process = Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to start mpv process.");

        process.EnableRaisingEvents = true;
        // Identity-check the exiting process against _mpvProcess so that
        // when AttachWindowAsync kills THIS process and respawns a new one,
        // this lambda's late-firing Exited event doesn't incorrectly
        // mark the still-valid session as stopped.
        var thisProcess = process;
        process.Exited += (_, _) =>
        {
            lock (_lock)
            {
                if (!ReferenceEquals(_mpvProcess, thisProcess)) return;
            }
            HandleMpvExited(session);
        };

        lock (_lock)
            _mpvProcess = process;

        _pollCts = new CancellationTokenSource();
        _ = Task.Run(() => PollLoopAsync(process, session, pipeName, _pollCts.Token), CancellationToken.None);
    }

    // ── libmpv in-process helpers ─────────────────────────────────────────────

    /// <summary>
    /// Creates a LibMpvHandle for <paramref name="session"/> and wires its
    /// property callbacks into the session fields.  Replaces the old
    /// StartStandaloneMpv + PollLoopAsync for the libmpv path.
    /// </summary>
    private void StartLibMpv(PlayerSession session, double startPosition, long? hwnd, string? subtitleTrack)
    {
        lock (_lock) { _libMpv?.Dispose(); _libMpv = null; }

        var handle = new LibMpvHandle(session.FilePath, startPosition, hwnd, _scriptPaths, subtitleTrack);

        handle.OnTimePos  = pos =>
        {
            lock (_lock)
            {
                if (!ReferenceEquals(_session, session)) return;
                session.Position      = pos;
                session.LastUpdatedAt = DateTime.UtcNow;
            }
        };
        handle.OnPause = paused =>
        {
            lock (_lock)
            {
                if (!ReferenceEquals(_session, session)) return;
                session.IsPaused      = paused;
                session.LastUpdatedAt = DateTime.UtcNow;
            }
        };
        handle.OnDuration = dur =>
        {
            lock (_lock)
            {
                if (!ReferenceEquals(_session, session)) return;
                session.Duration      = dur;
                session.LastUpdatedAt = DateTime.UtcNow;
            }
        };
        handle.OnPath = path =>
        {
            lock (_lock)
            {
                if (!ReferenceEquals(_session, session)) return;
                string normNew = NormalizePath(path);
                string normCur = NormalizePath(session.FilePath);
                if (!string.Equals(normNew, normCur, StringComparison.OrdinalIgnoreCase))
                {
                    session.FilePath      = path;
                    session.LastUpdatedAt = DateTime.UtcNow;
                    _activeHistoryId       = null;
                    _activeHistoryFilePath = null;
                }
            }
        };
        handle.OnEnded = () => HandleMpvExited(session);

        lock (_lock) _libMpv = handle;

        // Periodic progress save — replaces PollLoopAsync's 5s save tick
        _libMpvSaveTimer?.Dispose();
        _libMpvSaveTimer = new System.Threading.Timer(_ =>
        {
            PlayerSession? s;
            lock (_lock) s = _session;
            if (s is null || s.IsStopped) return;
            if ((DateTime.UtcNow - _lastSaveAtUtc).TotalSeconds >= 5 &&
                Math.Abs(s.Position - _lastSavedPosition) >= 2.0)
            {
                _ = SaveProgressToHistoryAsync(s, isFinal: false, CancellationToken.None);
            }
        }, null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5));

        _logger.LogInformation("PlayerService(libmpv): started '{File}' at {Pos}s hwnd={Hwnd}",
            System.IO.Path.GetFileName(session.FilePath), startPosition, hwnd);
    }

    /// <summary>
    /// Locates a player companion exe by name.  Searches next to the API exe
    /// (production) and the dev bin/Debug + bin/Release trees.  Returns null
    /// if not found — callers treat this as "headless-only mode".
    /// </summary>
    private static string? FindCompanionExe(string exeName)
    {
        try
        {
            var exeDir = Path.GetDirectoryName(
                System.Reflection.Assembly.GetExecutingAssembly().Location) ?? string.Empty;
            var processDir = Path.GetDirectoryName(Environment.ProcessPath ?? string.Empty) ?? string.Empty;

            string Combine(params string[] parts) => Path.GetFullPath(Path.Combine(parts));

            // Strip ".exe" for the directory name used in production bundles
            var dirName = exeName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                ? exeName[..^4] : exeName;

            var candidates = new[]
            {
                Combine(processDir, exeName),
                Combine(processDir, "binaries", dirName, exeName),
                Combine(exeDir, exeName),
                Combine(exeDir, "..", "..", "..", "..", dirName, "bin", "Debug",   "net8.0-windows", exeName),
                Combine(exeDir, "..", "..", "..", "..", dirName, "bin", "Release", "net8.0-windows", exeName),
            };
            return candidates.FirstOrDefault(File.Exists);
        }
        catch { return null; }
    }

    private static string? FindPitflixPlayerExe()  => FindCompanionExe("PitflixPlayer.exe");
    private static string? FindPitflixPlayer2Exe() => FindCompanionExe("PitflixPlayer2.exe");

    /// <summary>
    /// Spawns a companion exe.  Fire-and-forget; errors are swallowed because
    /// a missing companion degrades to headless mpv, not a crash.
    /// Idempotent: skips launch if a process with <paramref name="processName"/> is already running.
    /// </summary>
    private static void SpawnCompanion(string exePath, string processName, ILogger logger)
    {
        try
        {
            if (Process.GetProcessesByName(processName).Length > 0)
            {
                logger.LogDebug("{Name} already running — skipping auto-launch", processName);
                return;
            }
            var psi = new ProcessStartInfo(exePath)
            {
                UseShellExecute = true,
                WindowStyle     = ProcessWindowStyle.Normal,
            };
            Process.Start(psi);
            logger.LogInformation("Launched companion: {Path}", exePath);
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "{Name} auto-launch failed (non-fatal)", processName);
        }
    }

    // Back-compat shim so existing call-sites don't need updating.
    private static void SpawnPitflixPlayer(string exePath, ILogger logger)
        => SpawnCompanion(exePath, "PitflixPlayer", logger);

    /// <summary>
    /// Writes a raw mpv IPC JSON command to the named pipe.
    /// ipcCommand is the value of the "command" array, e.g. ["seek", 60.0, "absolute"].
    /// </summary>
    public async Task SendCommandAsync(string[] ipcCommand)
    {
        if (_useLibMpv)
        {
            LibMpvHandle? h;
            lock (_lock) h = _libMpv;
            h?.Command(ipcCommand);
            return;
        }
        var json = JsonSerializer.Serialize(new { command = ipcCommand });
        await WritePipeLineAsync(json).ConfigureAwait(false);
    }

    /// <summary>
    /// Builds the mpv playlist from an ordered file list.  Clears the current
    /// playlist, appends all files except the currently-playing one, then moves
    /// the current file into its natural alphabetical position so ⏮/⏭ traverse
    /// the folder in order.  Works for both libmpv and named-pipe IPC paths.
    /// </summary>
    public async Task BuildPlaylistAsync(string[] files, string current,
                                         CancellationToken ct = default)
    {
        string normCurrent = NormalizePath(current);
        int currentIdx = Array.FindIndex(files,
            f => string.Equals(NormalizePath(f), normCurrent, StringComparison.OrdinalIgnoreCase));
        if (currentIdx < 0) return;

        await SendCommandAsync(["playlist-clear"]).ConfigureAwait(false);
        foreach (var f in files)
        {
            if (!string.Equals(NormalizePath(f), normCurrent, StringComparison.OrdinalIgnoreCase))
                await SendCommandAsync(["loadfile", f, "append"]).ConfigureAwait(false);
        }
        if (currentIdx > 0)
            await SendCommandAsync(["playlist-move", "0", (currentIdx + 1).ToString()])
                .ConfigureAwait(false);
    }

    /// <summary>
    /// Stops the current mpv process and immediately restarts it with <c>--wid=<paramref name="hwnd"/></c>
    /// so mpv renders into the WPF companion window's native child HWND.
    /// The existing <see cref="PlayerSession"/> (position, media info, etc.) is preserved.
    /// </summary>
    public async Task<PlayerSession> AttachWindowAsync(long hwnd, CancellationToken ct = default)
    {
        PlayerSession? session;
        string?  filePath;
        double   position;
        string?  subtitleTrack;

        lock (_lock)
        {
            session       = _session;
            filePath      = _session?.FilePath;
            position      = _session?.Position ?? 0.0;
            subtitleTrack = _session?.SubtitleTrack;
        }

        if (session is null || string.IsNullOrEmpty(filePath))
            throw new InvalidOperationException("No active player session to attach.");

        // ── libmpv path: recreate handle with wid, no process management ──
        if (_useLibMpv)
        {
            StartLibMpv(session, position, hwnd, subtitleTrack);
            return Snapshot(session);
        }

        lock (_lock) _attachInProgress = true;
        try
        {

        // No more _suppressMpvExited dance — the Exited handler (set up in
        // StartAsync / AttachWindowAsync) now checks process identity against
        // _mpvProcess and silently ignores events from a process that's no
        // longer the current one.  That fix removes the timing constraint
        // that broke the previous immediate-kill optimization (mpv #1's
        // Exited event firing async after we'd already moved on, then being
        // incorrectly treated as a session-stop and tearing down the player).
        var oldCts = _pollCts;
        oldCts?.Cancel();

        Process? process;
        lock (_lock) process = _mpvProcess;
        if (process != null && !process.HasExited)
        {
            // Kill immediately — saves ~250 ms vs. WaitForExit.  The identity-
            // check in the Exited handler protects us from the now-orphan
            // process's late Exited event.
            try { process.Kill(); } catch { }
        }

        lock (_lock)
        {
            _pipeWriter = null;
            _mpvProcess = null;
        }

        // Fresh pipe name — reusing the old one can cause a race if the old
        // NamedPipeClientStream's OS handle hasn't been fully released yet.
        var pipeName = $"pitflix-wid-{Guid.NewGuid():N}";
        session.PipeName = pipeName;

        var psi = new ProcessStartInfo(_mpvExePath)
        {
            UseShellExecute         = false,
            CreateNoWindow          = true,
            RedirectStandardError   = true,    // keep stderr capture for diagnostics
            RedirectStandardOutput  = true,
        };
        psi.ArgumentList.Add(filePath);
        psi.ArgumentList.Add($@"--input-ipc-server=\\.\pipe\{pipeName}");
        psi.ArgumentList.Add($"--start={position:F3}");
        psi.ArgumentList.Add("--terminal=no");
        psi.ArgumentList.Add("--keep-open=always");   // 'always' is stricter than 'yes' — never exits
        psi.ArgumentList.Add($"--wid={hwnd}");
        // Start paused so audio doesn't beat the WPF window to the user's
        // ears.  PitflixPlayer's OnLoadedCore sends pause=false right
        // after the controls are visible.
        psi.ArgumentList.Add("--pause=yes");
        // NOTE: do NOT add --force-window here — it conflicts with --wid and causes immediate exit

        foreach (var script in _scriptPaths)
            if (!string.IsNullOrWhiteSpace(script))
                psi.ArgumentList.Add($"--script={script}");

        if (!string.IsNullOrWhiteSpace(subtitleTrack))
            psi.ArgumentList.Add($"--sub-file={subtitleTrack}");

        var newProcess = Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to restart mpv with --wid.");

        // Log mpv's stderr so we know exactly why it exits if it does
        newProcess.ErrorDataReceived  += (_, e) => { if (e.Data is not null) _logger.LogInformation("[mpv-wid stderr] {L}", e.Data); };
        newProcess.OutputDataReceived += (_, e) => { if (e.Data is not null) _logger.LogInformation("[mpv-wid stdout] {L}", e.Data); };
        newProcess.BeginErrorReadLine();
        newProcess.BeginOutputReadLine();

        newProcess.EnableRaisingEvents = true;
        // Identity-check: another AttachWindowAsync call (or StopAsync) may
        // have already replaced _mpvProcess.  Skip the handler when this
        // exit notification belongs to a stale process — otherwise we'd
        // tear down the live session.  Same pattern as StartAsync.
        var thisNewProcess = newProcess;
        newProcess.Exited += (_, _) =>
        {
            _logger.LogInformation("[mpv-wid] process exited with code {Code}", thisNewProcess.HasExited ? thisNewProcess.ExitCode : -1);
            lock (_lock)
            {
                if (!ReferenceEquals(_mpvProcess, thisNewProcess)) return;
            }
            HandleMpvExited(session);
        };

        lock (_lock)
        {
            _mpvProcess = newProcess;
            // _session intentionally kept — same Guid, same media info
        }

        _pollCts = new CancellationTokenSource();
        _ = Task.Run(() => PollLoopAsync(newProcess, session, pipeName, _pollCts.Token),
                     CancellationToken.None);

        return Snapshot(session);
        }
        finally
        {
            lock (_lock) _attachInProgress = false;
        }
    }

    // ── Subtitle track discovery ──────────────────────────────────────────────

    // Type is "sub" or "audio" so a single call returns both kinds and the
    // client can render two separate menus (subtitles + audio tracks) from
    // one round-trip.  Naming preserved for backwards compat with existing
    // PlayerApiClient.GetSubtitleTracksAsync — it's a misnomer now but
    // renaming would ripple through Pitflix.UI's React code as well.
    public sealed record SubtitleTrackInfo(int Index, string Language, string Title, string Type);

    /// <summary>
    /// Sends a <c>get_property track-list</c> request to mpv and returns subtitle tracks.
    /// Uses a pending-request table so the reader loop can route the response back.
    /// </summary>
    public async Task<IReadOnlyList<SubtitleTrackInfo>> GetSubtitleTracksAsync(
        CancellationToken ct = default)
    {
        // libmpv: query track-list via indexed properties — synchronous, no TCS needed
        if (_useLibMpv)
        {
            LibMpvHandle? h;
            lock (_lock) h = _libMpv;
            if (h is null) return [];
            return await Task.Run(() =>
            {
                var raw = h.GetTrackList();
                return (IReadOnlyList<SubtitleTrackInfo>)raw
                    .Select(t => new SubtitleTrackInfo((int)t.Id, t.Lang, t.Title, t.Type))
                    .ToList();
            }, ct).ConfigureAwait(false);
        }

        const int RequestId = 99;
        var tcs = new TaskCompletionSource<IReadOnlyList<SubtitleTrackInfo>>(
                      TaskCreationOptions.RunContinuationsAsynchronously);

        lock (_lock)
            _pendingTrackRequest = tcs;

        try
        {
            await WritePipeLineAsync(
                $"{{\"command\":[\"get_property\",\"track-list\"],\"request_id\":{RequestId}}}")
                .ConfigureAwait(false);

            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
            linked.CancelAfter(2500);

            return await tcs.Task.WaitAsync(linked.Token).ConfigureAwait(false);
        }
        catch
        {
            return [];
        }
        finally
        {
            lock (_lock)
                if (ReferenceEquals(_pendingTrackRequest, tcs))
                    _pendingTrackRequest = null;
        }
    }

    // Nullable field holding the pending track-list request TCS (null when none is in flight).
    private TaskCompletionSource<IReadOnlyList<SubtitleTrackInfo>>? _pendingTrackRequest;

    /// <summary>
    /// Sends a raw mpv IPC command where values may be non-string types (e.g. integer
    /// for <c>sid</c>).  Unlike <see cref="SendCommandAsync"/>, values are serialised
    /// with their native JSON types.
    /// </summary>
    public async Task SendRawCommandAsync(object[] ipcCommand)
    {
        if (_useLibMpv)
        {
            LibMpvHandle? h;
            lock (_lock) h = _libMpv;
            h?.Command(ipcCommand.Select(v => v?.ToString() ?? "").ToArray());
            return;
        }
        var json = System.Text.Json.JsonSerializer.Serialize(new { command = ipcCommand });
        await WritePipeLineAsync(json).ConfigureAwait(false);
    }

    public async Task StopAsync()
    {
        if (_useLibMpv)
        {
            await StopLibMpvAsync().ConfigureAwait(false);
            return;
        }

        _pollCts?.Cancel();

        // Persist the final playback position BEFORE we tear the session down.
        // Without this, closing the player loses the user's place: the close
        // button calls StopAsync() (which used to null _session here) and only
        // THEN does PitflixPlayer.OnClosed fire /save-progress-now — which
        // found _session already null and saved nothing.  Resume then fell
        // back to the throttled 5 s periodic save, so reopening often landed
        // at a stale position (or the start).  Save isFinal:false so the title
        // also stays in "Continue Watching".
        PlayerSession? toSave;
        lock (_lock) toSave = _session;
        if (toSave is not null && !toSave.IsStopped)
        {
            try { await SaveProgressToHistoryAsync(toSave, isFinal: false, CancellationToken.None).ConfigureAwait(false); }
            catch { /* progress save is best-effort */ }
        }

        // Best-effort quit command before killing
        try { await WritePipeLineAsync("{\"command\":[\"quit\"]}").ConfigureAwait(false); }
        catch { /* ignore */ }

        Process? process;
        lock (_lock)
            process = _mpvProcess;

        if (process != null && !process.HasExited)
        {
            try
            {
                if (!process.WaitForExit(3000))
                    process.Kill();
            }
            catch { /* ignore */ }
        }

        lock (_lock)
        {
            if (_session != null)
                _session.IsStopped = true;
            _session    = null;
            _mpvProcess = null;
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private async Task StopLibMpvAsync()
    {
        _libMpvSaveTimer?.Dispose();
        _libMpvSaveTimer = null;

        PlayerSession? toSave;
        lock (_lock) toSave = _session;
        if (toSave is not null && !toSave.IsStopped)
        {
            try { await SaveProgressToHistoryAsync(toSave, isFinal: false, CancellationToken.None).ConfigureAwait(false); }
            catch { }
        }

        LibMpvHandle? handle;
        lock (_lock) { handle = _libMpv; _libMpv = null; }
        handle?.Dispose();

        lock (_lock)
        {
            if (_session != null) _session.IsStopped = true;
            _session = null;
        }
    }

    private async Task WritePipeLineAsync(string json)
    {
        await _writeLock.WaitAsync().ConfigureAwait(false);
        try
        {
            StreamWriter? w;
            lock (_lock)
                w = _pipeWriter;
            if (w is null) return;
            await w.WriteLineAsync(json).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "PlayerService: pipe write failed");
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private async Task PollLoopAsync(Process process, PlayerSession session, string pipeName, CancellationToken ct)
    {
        // Give mpv ~1.5 s to start and create the pipe before the first connect attempt.
        try { await Task.Delay(1500, ct).ConfigureAwait(false); }
        catch (OperationCanceledException) { return; }

        NamedPipeClientStream? pipe = null;
        // Declared here so the finally block can reference it for the ReferenceEquals guard.
        StreamWriter? capturedWriter = null;

        try
        {
            // Retry connect up to 10 times (5 seconds total)
            for (var attempt = 0; attempt < 10 && !ct.IsCancellationRequested; attempt++)
            {
                try
                {
                    pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
                    await pipe.ConnectAsync(2000, ct).ConfigureAwait(false);
                    break;
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    _logger.LogDebug(ex, "PlayerService: pipe connect attempt {Attempt} failed", attempt + 1);
                    pipe?.Dispose();
                    pipe = null;
                    if (attempt < 9)
                        try { await Task.Delay(500, ct).ConfigureAwait(false); }
                        catch (OperationCanceledException) { return; }
                }
            }

            if (pipe is null)
            {
                _logger.LogWarning("PlayerService: could not connect to mpv pipe {PipeName}", pipeName);
                return;
            }

            var enc    = new UTF8Encoding(false);
            var writer = new StreamWriter(pipe, enc, leaveOpen: true) { AutoFlush = true };
            var reader = new StreamReader(pipe, enc, leaveOpen: true);

            // Capture for use in the finally block (writer is declared inside the try scope).
            capturedWriter = writer;

            lock (_lock)
                _pipeWriter = writer;

            // Dedicated reader task: continuously processes incoming IPC messages from mpv.
            var readerTask = Task.Run(async () =>
            {
                try
                {
                    while (!ct.IsCancellationRequested && pipe.IsConnected)
                    {
                        var line = await reader.ReadLineAsync(ct).ConfigureAwait(false);
                        if (line is null) break;
                        ProcessIpcLine(line, session);
                    }
                }
                catch (OperationCanceledException) { }
                catch { /* pipe closed or broken */ }
            }, CancellationToken.None);

            // Poll loop: query time-pos, pause, duration every 1 second.
            // Fixed request_ids so ProcessIpcLine can map response → property without a dictionary.
            while (!ct.IsCancellationRequested && !process.HasExited && pipe.IsConnected)
            {
                // Guard _writeLock.WaitAsync separately so cancellation never leaves the
                // semaphore acquired while the inner finally calls Release().
                bool lockAcquired = false;
                try
                {
                    await _writeLock.WaitAsync(ct).ConfigureAwait(false);
                    lockAcquired = true;
                    await writer.WriteLineAsync("{\"command\":[\"get_property\",\"time-pos\"],\"request_id\":1}").ConfigureAwait(false);
                    await writer.WriteLineAsync("{\"command\":[\"get_property\",\"pause\"],\"request_id\":2}").ConfigureAwait(false);
                    await writer.WriteLineAsync("{\"command\":[\"get_property\",\"duration\"],\"request_id\":3}").ConfigureAwait(false);
                    // request_id 4: current `path` — so playlist-next/prev
                    // updates session.FilePath, which then flows through the
                    // WebSocket so PitflixPlayer's titlebar & playlist-popup
                    // highlight track the actual playing file instead of
                    // forever showing the one mpv started with.
                    await writer.WriteLineAsync("{\"command\":[\"get_property\",\"path\"],\"request_id\":4}").ConfigureAwait(false);
                }
                catch (OperationCanceledException) { break; }
                catch { break; }
                finally { if (lockAcquired) _writeLock.Release(); }

                // 500 ms poll interval — twice the WS-push rate of the
                // previous 1 s.  Time-pos label updates feel half a tick
                // snappier, and seek-target confirmation (which lets us
                // release the optimistic _pendingSeekTarget) lands quicker.
                // The four get_property writes per tick are cheap (mpv IPC
                // is local pipe, sub-millisecond), and the WebSocket push
                // is a few hundred bytes — both stay well below any cost
                // ceiling on the UI thread.
                try { await Task.Delay(500, ct).ConfigureAwait(false); }
                catch (OperationCanceledException) { break; }

                // Periodic progress write-back: every ~5 s if the position
                // actually moved.  This makes "close the player, reopen the
                // same episode" resume where the user left off rather than
                // where they originally started.  Cheap (single UPDATE) and
                // throttled enough that paused / stationary playback doesn't
                // hammer the DB.
                if ((DateTime.UtcNow - _lastSaveAtUtc).TotalSeconds >= 5 &&
                    Math.Abs(session.Position - _lastSavedPosition) >= 2.0)
                {
                    await SaveProgressToHistoryAsync(session, isFinal: false, ct).ConfigureAwait(false);
                }
            }

            await readerTask.ConfigureAwait(false);

            // DisposeAsync on StreamWriter waits for any in-flight async write to complete,
            // preventing "stream is currently in use by a previous operation" from Dispose().
            // StreamReader has no DisposeAsync — a guarded sync Dispose is sufficient.
            try { await writer.DisposeAsync().ConfigureAwait(false); } catch { }
            try { reader.Dispose(); } catch { }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PlayerService: poll loop error for session {SessionId}", session.SessionId);
        }
        finally
        {
            lock (_lock)
            {
                // Only null the writer if it is still OUR writer — AttachWindowAsync may have
                // already replaced _pipeWriter with the new session's writer; clobbering that
                // would silently break all future IPC writes to the new mpv process.
                if (ReferenceEquals(_pipeWriter, capturedWriter))
                    _pipeWriter = null;
            }
            pipe?.Dispose();
        }
    }

    // request_id 1 → time-pos, 2 → pause, 3 → duration, 99 → track-list (subtitle discovery)
    private void ProcessIpcLine(string line, PlayerSession session)
    {
        try
        {
            using var doc  = JsonDocument.Parse(line);
            var root = doc.RootElement;

            if (!root.TryGetProperty("error",      out var errEl)  || errEl.GetString() != "success") return;
            if (!root.TryGetProperty("request_id", out var ridEl))  return;
            if (!root.TryGetProperty("data",       out var dataEl)) return;

            var rid = ridEl.GetInt32();

            if (rid == 99)
            {
                // Track-list response — resolve the pending subtitle-tracks request.
                TaskCompletionSource<IReadOnlyList<SubtitleTrackInfo>>? pending;
                lock (_lock) { pending = _pendingTrackRequest; _pendingTrackRequest = null; }

                if (pending is not null && dataEl.ValueKind == JsonValueKind.Array)
                {
                    var tracks = new List<SubtitleTrackInfo>();
                    foreach (var track in dataEl.EnumerateArray())
                    {
                        if (!track.TryGetProperty("type", out var typeProp)) continue;
                        var type = typeProp.GetString() ?? "";
                        // Include subtitle AND audio tracks so a single call
                        // populates both menus in the client.  Filter out
                        // "video" tracks (they're never shown in either menu).
                        if (type != "sub" && type != "audio") continue;

                        var id  = track.TryGetProperty("id",       out var idEl)   ? idEl.GetInt32()     : 0;
                        var lng = track.TryGetProperty("lang",     out var langEl) ? langEl.GetString()  : "";
                        var ttl = track.TryGetProperty("title",    out var ttlEl)  ? ttlEl.GetString()   : "";
                        tracks.Add(new SubtitleTrackInfo(id, lng ?? "", ttl ?? "", type));
                    }
                    pending.TrySetResult(tracks);
                }
                return;
            }

            lock (_lock)
            {
                switch (rid)
                {
                    case 1 when dataEl.ValueKind == JsonValueKind.Number:
                        session.Position      = dataEl.GetDouble();
                        session.LastUpdatedAt = DateTime.UtcNow;
                        break;

                    case 2 when dataEl.ValueKind is JsonValueKind.True or JsonValueKind.False:
                        session.IsPaused      = dataEl.GetBoolean();
                        session.LastUpdatedAt = DateTime.UtcNow;
                        break;

                    case 3 when dataEl.ValueKind == JsonValueKind.Number:
                        var dur = dataEl.GetDouble();
                        if (dur > 0) session.Duration = dur;
                        break;

                    case 4 when dataEl.ValueKind == JsonValueKind.String:
                        // mpv's `path` changes whenever playlist-pos changes
                        // (next/prev/jump).  Update session.FilePath so the
                        // next WS push carries the new filename and clients
                        // can refresh their titlebar + playlist highlight.
                        //
                        // Normalize BOTH sides with Path.GetFullPath before
                        // comparing — mpv may report the path with different
                        // separators or casing than what was originally
                        // passed (the cause of "open and close repeatedly,
                        // time not accurate": every poll the raw comparison
                        // would falsely flag a file change and earlier
                        // versions of this code reset Position to 0 each
                        // time, racing with the periodic history save and
                        // the close-time final save).
                        var newPath = dataEl.GetString();
                        if (!string.IsNullOrEmpty(newPath))
                        {
                            string normNew = NormalizePath(newPath);
                            string normCur = NormalizePath(session.FilePath);
                            if (!string.Equals(normNew, normCur, StringComparison.OrdinalIgnoreCase))
                            {
                                // Real file change (playlist-next etc.).
                                // We deliberately DO NOT zero Position here:
                                // the next poll tick (≤1 s away) will report
                                // the new file's actual time-pos, and the
                                // brief stale value is harmless flicker.
                                // Zeroing would race with progress-save and
                                // wipe the user's resume position if they
                                // closed within the window.
                                session.FilePath      = newPath;
                                session.LastUpdatedAt = DateTime.UtcNow;
                                // Reset the cached history-id binding so
                                // the next save resolves the row for the
                                // new file rather than the old one.
                                _activeHistoryId       = null;
                                _activeHistoryFilePath = null;
                            }
                        }
                        break;
                }
            }
        }
        catch { /* malformed JSON, silently ignore */ }
    }

    private void HandleMpvExited(PlayerSession session)
    {
        lock (_lock)
        {
            // Ignore the exit event while AttachWindowAsync is replacing the process —
            // killing the old mpv is intentional and must not mark the session stopped.
            if (_suppressMpvExited) return;

            session.IsStopped     = true;
            session.LastUpdatedAt = DateTime.UtcNow;
        }

        // Final progress write — the moment the user closes the player is
        // exactly when "resume from here next time" matters most.  Use the
        // last-known position from session (the poll loop kept it current up
        // to ~1 second before the exit).  Fire-and-forget; we don't want to
        // block the 3 s session-clear timer behind this.
        _ = Task.Run(() => SaveProgressToHistoryAsync(session, isFinal: true, CancellationToken.None));

        // Clear the active session reference 3 seconds after mpv exits, giving the
        // WebSocket and callers a window to read the final IsStopped=true state.
        _ = Task.Run(async () =>
        {
            await Task.Delay(3000).ConfigureAwait(false);
            lock (_lock)
            {
                if (ReferenceEquals(_session, session))
                    _session = null;
            }
        });
    }

    private static PlayerSession Snapshot(PlayerSession s) => new()
    {
        SessionId     = s.SessionId,
        MediaId       = s.MediaId,
        EpisodeId     = s.EpisodeId,
        FilePath      = s.FilePath,
        Position      = s.Position,
        Duration      = s.Duration,
        IsPaused      = s.IsPaused,
        IsStopped     = s.IsStopped,
        SubtitleTrack = s.SubtitleTrack,
        StartedAt     = s.StartedAt,
        LastUpdatedAt = s.LastUpdatedAt,
        PipeName      = s.PipeName
    };

    public void Dispose()
    {
        _libMpvSaveTimer?.Dispose();
        _libMpv?.Dispose();
        _pollCts?.Cancel();
        _pollCts?.Dispose();
        _writeLock.Dispose();
        _mpvProcess?.Dispose();
    }
}
