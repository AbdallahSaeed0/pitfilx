using System.IO;
using System.Linq;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;

namespace PitflixPlayer;

public partial class MainWindow : Window
{
    private ControlsWindow?          _controls;
    private ClientWebSocket?         _ws;
    private CancellationTokenSource? _wsCts;

    // ── IPC client ────────────────────────────────────────────────────────────
    private MpvIpcClient? _ipc;

    // ── Taskbar thumbnail toolbar (Previous / Play-Pause / Next) ─────────────
#if WINDOWS
    private TaskbarThumbButtons? _taskbarThumbButtons;
    private List<string>         _taskbarPlaylistFiles = new();
    private int                  _taskbarPlaylistIndex = -1;
#endif

    // ── Keyboard / mute state ─────────────────────────────────────────────────
    private bool   _isMuted    = false;
    private double _lastVolume = 80;

    // ── Global keyboard hook ──────────────────────────────────────────────────
    // Kept as a field so the GC never collects the delegate while the hook lives.
    private NativeMethods.LowLevelKeyboardProc? _hookProc;
    private IntPtr                               _hookHandle = IntPtr.Zero;

    // ── Global mouse hook (WH_MOUSE_LL) for double-click fullscreen ───────────
    private NativeMethods.LowLevelMouseProc? _mouseHookProc;
    private IntPtr                            _mouseHookHandle = IntPtr.Zero;
    private (int X, int Y)                    _lastClickPos;
    private DateTime                          _lastClickTime = DateTime.MinValue;
    private IntPtr                            _mainHwnd;     // set in OnLoaded

    // For detecting file-change events from the WS push so we can re-apply
    // the persisted subtitle preference (which would otherwise be reset to
    // mpv's default whenever a new file loads — the user's "next video opens
    // with default subtitle" bug).  Set to the normalized current path each
    // tick; comparison done case-insensitively.
    private string? _lastFilePathSeen;
    private bool    _initialApplyDone;

    // FIX 6: persistent audio-delay nudge (in seconds).  Reset to 0 on every
    // new session so leftover state from a previous video doesn't bleed
    // through.  +ve means audio plays LATER than video, -ve EARLIER.
    private double  _audioDelay;

    // ── Subtitle search overlay state ─────────────────────────────────────────
    private PlayerSession?          _currentSession;
    private SubtitleSearchOverlay?  _subtitleOverlay;
    private string                  _subtitleSearchTitle = "";

    // ── Pre-warm state (issue: cold-start dominated open time) ───────────────
    //
    // After a session ends (mpv hits EOF, or user clicks ⏹), instead of
    // closing PitflixPlayer entirely we HIDE it and stay in process.  WPF
    // runtime stays warm, JIT/PGO caches stay populated, brushes/resources
    // stay allocated.  When the user starts the next video, the backend's
    // WebSocket pushes a new session; we detect it, re-show the window,
    // and re-attach.  Saves the entire ~1.5 s cold-start cost on every
    // subsequent video.
    //
    // X-close still works as a full exit because the WS gets disposed in
    // OnClosed BEFORE any IsStopped message could route to the
    // hide-on-stop branch — so X-close = real close, EOF = pre-warm hide.
    private bool _waitingForNewSession;

    private static readonly JsonSerializerOptions _wsOpts = new()
        { PropertyNameCaseInsensitive = true };

    public MainWindow()
    {
        InitializeComponent();
        Loaded    += OnLoaded;
        Closed    += OnClosed;
        // Fix 4: re-focus this window whenever it becomes active so the global
        // keyboard hook's foreground-window check always passes.
        Activated += (_, _) => Focus();

        // FIX 2 (black bars): only re-fit on STATE changes (maximize /
        // restore), not every SizeChanged event.  SizeChanged fires
        // during user drag-resize at video frame rate and can interfere
        // with slider seek captures by repeatedly invalidating layout
        // while the user has the mouse down on the timeline.
        StateChanged += (_, _) =>
        {
            if (WindowState != WindowState.Minimized) RefitVideoChild();
        };
    }

    /// <summary>Public entry point for callers outside MainWindow (e.g. the
    /// ControlsWindow context menu) to force the mpv child window to re-sync
    /// after a change that doesn't trigger StateChanged, such as toggling
    /// Topmost — without this the video frame can go stale/frozen since
    /// VideoHwndHost only re-pokes mpv on an actual resize.</summary>
    public void RefitVideoChildExternal() => RefitVideoChild();

    private void RefitVideoChild()
    {
        if (VideoPanel is null) return;
        VideoPanel.InvalidateMeasure();
        VideoPanel.UpdateLayout();
        VideoPanel.ForceResize();
    }

    // ── Startup ───────────────────────────────────────────────────────────────

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        // Force foreground on launch so PitflixPlayer reliably appears on top.
        this.Topmost = true;
        this.Activate();
        _ = Dispatcher.InvokeAsync(async () =>
        {
            await Task.Delay(400).ConfigureAwait(true);
            this.Topmost = false;
        }, System.Windows.Threading.DispatcherPriority.Background);

        // Install global keyboard hook (fires regardless of which window has focus)
        _hookProc   = KeyboardHookProc;
        _hookHandle = NativeMethods.SetWindowsHookEx(
            NativeMethods.WH_KEYBOARD_LL,
            _hookProc,
            NativeMethods.GetModuleHandle(null),
            0);
        App.Log($"Keyboard hook handle: 0x{_hookHandle:X}");

        // Install global mouse hook for double-click fullscreen via WH_MOUSE_LL.
        // WPF ClickCount is unreliable over HwndHost because the native child steals
        // focus; the global hook sees every WM_LBUTTONDOWN regardless.
        _mouseHookProc   = MouseHookProc;
        _mouseHookHandle = NativeMethods.SetWindowsHookEx(
            NativeMethods.WH_MOUSE_LL,
            _mouseHookProc,
            NativeMethods.GetModuleHandle(null),
            0);
        App.Log($"Mouse hook handle: 0x{_mouseHookHandle:X}");

        // Cache our own HWND so MouseHookProc can compare roots without marshalling
        _mainHwnd = new WindowInteropHelper(this).Handle;

        // Install a WM_NCHITTEST hook so the top 40 px of the window's visible
        // area answers HTCAPTION → OS performs native drag-move when the user
        // drags from the titlebar area.  ControlsWindow forwards titlebar
        // drag-zone clicks through to us via HTTRANSPARENT, so this is what
        // ultimately catches them.  Without this, clicks at the very top edge
        // fell into the resize border (HTTOP) and the user got resize cursor
        // instead of drag — the "drag just resizes" bug.
        if (PresentationSource.FromVisual(this) is HwndSource src)
            src.AddHook(MainHitTestHook);

        try { await OnLoadedCore().ConfigureAwait(false); }
        catch (Exception ex)
        {
            Dispatcher.Invoke(() =>
            {
                MessageBox.Show($"Startup failed:\n\n{ex}", "PitflixPlayer — Fatal",
                                MessageBoxButton.OK, MessageBoxImage.Error);
                Close();
            });
        }

#if WINDOWS
        InitializeTaskbarThumbButtons();
#endif
    }

    private async Task OnLoadedCore()
    {
        App.Log("OnLoadedCore start");

        // 1. Check session — retry once after 1 s so player3_open (which starts
        //    the backend session then immediately launches us) has time to finish
        //    its POST /api/player/play before we try GET /api/player/session.
        PlayerSession? session = null;
        Exception? lastEx = null;
        for (int attempt = 0; attempt < 2; attempt++)
        {
            if (attempt > 0)
                await Task.Delay(1000).ConfigureAwait(false);
            try
            {
                session = await PlayerApiClient.GetSessionAsync().ConfigureAwait(false);
                lastEx  = null;
                break; // success
            }
            catch (Exception ex) { lastEx = ex; }
        }
        if (lastEx is not null)
        {
            Dispatcher.Invoke(() =>
            {
                MessageBox.Show(
                    $"Could not reach Pitflix API at http://localhost:5280\n\n{lastEx.Message}\n\n" +
                    "Make sure Pitflix.API is running first.",
                    "PitflixPlayer — API unreachable",
                    MessageBoxButton.OK, MessageBoxImage.Error);
                Close();
            });
            return;
        }

        if (session is null || session.IsStopped)
        {
            Dispatcher.Invoke(() =>
            {
                MessageBox.Show(
                    "No active playback session found.\n\n" +
                    "Start playing a video first, then launch PitflixPlayer.",
                    "PitflixPlayer — No session",
                    MessageBoxButton.OK, MessageBoxImage.Information);
                Close();
            });
            return;
        }

        // 2. Get child HWND and attach mpv
        var childHwnd = VideoPanel.ChildHwnd;
        App.Log($"ChildHwnd = 0x{childHwnd:X}");
        if (childHwnd == IntPtr.Zero)
        {
            Dispatcher.Invoke(() =>
            {
                MessageBox.Show("VideoPanel HWND is zero — layout not ready.",
                                "PitflixPlayer", MessageBoxButton.OK, MessageBoxImage.Error);
                Close();
            });
            return;
        }

        // Bring up the controls overlay window NOW (a transparent sibling — not
        // WPF-over-HwndHost, so no airspace crash) showing a full-screen LOADING
        // screen over the black host while attach + IPC + demux happen.  It's
        // hidden the moment playback actually starts (or the resume overlay shows).
        Dispatcher.Invoke(() =>
        {
            _controls = new ControlsWindow { Owner = this };
            _controls.ShowLoadingOverlay(FileBasename(session.FilePath));
            _controls.Show();
            _controls.ForceSyncFromOwner();
            // This is the cold-start path: by the time AttachAsync's network
            // round-trip finishes and we get here, whatever brief foreground
            // boost MainWindow.OnLoaded gave itself has long since expired.
            // If the user is alt-tabbed into another app (IDE/browser) at
            // this moment, neither MainWindow nor this owned ControlsWindow
            // is guaranteed to come out on top of it — Windows doesn't let a
            // background process steal foreground just by calling Show().
            // That's the "control bar shows the IDE through it" bug: it's not
            // transparency, it's the IDE window genuinely sitting ABOVE us in
            // z-order.  Force both windows to the front the same way
            // OnLoaded/ExitPreWarmHideAsync already do elsewhere.
            Topmost = true;
            Activate();
            _controls.Topmost = true;
            _controls.Activate();
            _ = Dispatcher.InvokeAsync(async () =>
            {
                await Task.Delay(400).ConfigureAwait(true);
                Topmost = false;
                if (_controls is not null) _controls.Topmost = false;
            }, System.Windows.Threading.DispatcherPriority.Background);
        });

        App.Log("Calling AttachAsync");
        try
        {
            var attached = await PlayerApiClient.AttachAsync((long)childHwnd).ConfigureAwait(false);
            if (attached is not null) session = attached;
            App.Log("AttachAsync succeeded");
        }
        catch (Exception ex)
        {
            App.Log($"AttachAsync failed: {ex.Message}");
            Dispatcher.Invoke(() =>
                MessageBox.Show($"Attach warning: {ex.Message}",
                                "PitflixPlayer", MessageBoxButton.OK, MessageBoxImage.Warning));
        }

        // 3. Connect to mpv IPC pipe
        if (string.IsNullOrEmpty(session.PipeName))
        {
            Dispatcher.Invoke(() =>
            {
                MessageBox.Show(
                    "Session has no pipe name — cannot connect to mpv IPC.\n\n" +
                    "Make sure Pitflix.API is running a version that exposes PipeName.",
                    "PitflixPlayer — IPC unavailable",
                    MessageBoxButton.OK, MessageBoxImage.Error);
                Close();
            });
            return;
        }

        App.Log($"Connecting IPC to pipe: {session.PipeName}");
        _ipc = new MpvIpcClient(session.PipeName);
        try
        {
            await _ipc.ConnectAsync(5000).ConfigureAwait(false);

            // NOTE: do NOT clear mpv's `start` property here.  An earlier
            // attempt did so to fix "next/prev opens at the same minute as
            // the previous episode", but it created a worse race: when
            // AttachWindowAsync respawns mpv with `--start=<resumePosition>`,
            // mpv hasn't necessarily applied that seek yet by the time we
            // connect IPC and send the clear.  Result: the user's resume
            // position was being wiped during the merge and every video
            // started from 00:00.
            //
            // Instead, the navigation commands (⏭ / ⏮ / playlist-popup row
            // click) reset `start` to 0 IMMEDIATELY BEFORE sending the
            // playlist-pos change — mpv processes the property update in
            // order, so the new file is guaranteed to load with start=0.
            // The initial file's resume seek is left untouched.

            // mpv ships its own built-in on-screen-controller (osc.lua), which
            // draws ITS OWN translucent gray bottom bar (with a seek slider, play/
            // pause, volume, etc.) on top of the video whenever the mouse moves —
            // completely independent of, and visually overlapping, our WPF
            // ControlsOverlay.  That's the "extra gray strip sitting above our
            // control bar" — mpv's native OSC peeking out above our overlay.
            // The backend launches mpv without "--osc=no" (out of scope for us to
            // change), so disable it at runtime over IPC instead: ask the osc
            // script to never show itself, and drop the OSD level so mpv's other
            // built-in overlays (status/seek OSD) stay silent too — PitflixPlayer's
            // WPF controls are the only UI that should ever appear over the video.
            _ = _ipc.SendAsync("script-message", "osc-visibility", "never");
            _ = _ipc.SendAsync("script-message-to", "osc", "visibility", "never");
            _ = _ipc.SendAsync("set_property", "osd-level", 0);

            // Second candidate for "the gray strip that's still showing": mpv's
            // own letterbox/pillarbox FILL COLOUR.  When the video's aspect ratio
            // doesn't exactly match the window/HwndHost bounds, mpv pads the gap
            // with its "background" colour — and several builds default that to a
            // dark/medium GRAY (not pure black).  That fill would render as a
            // perfectly flat, sharp-edged, full-width rectangle exactly where the
            // video's rendered frame ends — i.e. right above wherever our overlay
            // happens to sit for this video's geometry.  Force it to pure black so
            // any letterboxing blends invisibly into MainWindow's black backdrop.
            // (Property name changed across mpv versions — set both old and new.)
            _ = _ipc.SendAsync("set_property", "background", "#000000");
            _ = _ipc.SendAsync("set_property", "background-color", "#000000");

            // Push subtitle text up off the bottom edge so it never sits under
            // the semi-opaque ControlsOverlay gradient strip (80 px tall, anchored
            // to the bottom of the video).  Without this, native subtitles
            // rendered by mpv overlap the dark bar whenever the cursor hovers the
            // video and the transport controls fade in.
            //
            // sub-margin-y alone is NOT enough: many releases ship styled ASS
            // subtitles (lyrics/karaoke-style lines, e.g. "♪ ... ♪") that carry
            // their own embedded margins/positions, and mpv honours those over
            // the global sub-margin-y unless sub-ass-force-margins is enabled.
            // Force it on so every subtitle — plain SRT or styled ASS — respects
            // our margin, then push it up generously (110 px) to clear the bar
            // with room to spare at typical window sizes/DPI scales.
            _ = _ipc.SendAsync("set_property", "sub-ass-force-margins", true);
            _ = _ipc.SendAsync("set_property", "sub-margin-y", 110);
        }
        catch (Exception ex)
        {
            Dispatcher.Invoke(() =>
            {
                MessageBox.Show(
                    $"Could not connect to mpv IPC pipe '{session.PipeName}':\n\n{ex.Message}\n\n" +
                    "Controls will be unresponsive.",
                    "PitflixPlayer — IPC error",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                // Don't close — still show the player, just without IPC commands.
            });
        }

        // Per-session state reset (audio delay, etc.).
        _audioDelay = 0.0;

        // 4. Wire up the controls overlay (already created above with the LOADING
        //    screen; reuse it so the loading view stays continuous into playback).
        _currentSession = session;
        _subtitleSearchTitle = FileBasename(session.FilePath);
        Dispatcher.Invoke(() =>
        {
            _controls ??= new ControlsWindow { Owner = this };
            if (_ipc is not null) _controls.SetIpc(_ipc);
            // Use the filename initially so something appears immediately,
            // then asynchronously replace with the metadata-driven title
            // once the episodes/movies API responds.
            _controls.SetTitle(FileBasename(session.FilePath));
            _controls.SetSessionFilePath(session.FilePath);  // for hover thumbnails
            _controls.UpdateFromSession(session);
            _controls.Show();
            _ = ApplyMetadataTitleAsync(session);
            // Force one explicit re-sync now that ControlsWindow has its HWND.
            // WindowStartupLocation=CenterScreen on a multi-monitor setup can
            // initially place ControlsWindow on the primary while Owner sits
            // on a secondary — that's the "controls on one display, video on
            // the other" symptom.  Owner.LocationChanged only fires when
            // Owner MOVES; at initial Show(), Owner's position is final but
            // never "changed", so the sync hook misses it.  Explicit nudge:
            _controls.ForceSyncFromOwner();
            _controls.StartHideTimer();
            // ContentRendered only fires on the FIRST show of this window's
            // lifetime; the player is reused warm across videos, so kick the
            // layered-surface recomposite here too — otherwise the second and
            // later opens can come up with the transparent-bar glitch.
            _controls.ForceLayeredRepaint();
            _ = Dispatcher.BeginInvoke(new Action(() => _controls?.ForceLayeredRepaint()),
                                   System.Windows.Threading.DispatcherPriority.ApplicationIdle);
            _ = _controls.Dispatcher.BeginInvoke(new Action(() => _controls.ShowControls(animate: false)),
                                   System.Windows.Threading.DispatcherPriority.Render);
        });

        // Subtitle tracks are fetched on-demand when the CC button is clicked.

        // 4a. Build a folder playlist so ⏮ ⏭ navigate between siblings in
        //     the same directory.  Runs for EVERY session — episode or movie —
        //     because the EpisodeId metadata from the React side is unreliable
        //     in practice (it was the reason "playlist not working" was
        //     reported even on episode files).  Visibility of the prev/next
        //     buttons is gated on actual sibling count: folders with >1 video
        //     show them; standalone files don't.  Fire-and-forget so a build
        //     failure cannot block playback.
        if (_ipc is not null)
        {
            _ = BuildFolderPlaylistAsync(session.FilePath);
        }

        // 4b. Apply the persisted subtitle preference to the initial file.
        //     mpv has just loaded the video with its own default subtitle —
        //     if the user previously picked (say) English, switch to it now.
        //     Fire-and-forget; failure logs but never blocks startup.
        if (_ipc is not null && _controls is not null)
        {
            _initialApplyDone = true;
            _ = Task.Run(async () =>
            {
                try { await _controls.ApplyPreferredSubtitleAsync(); }
                catch (Exception ex) { App.Log($"Initial subtitle apply failed: {ex.Message}"); }
            });
        }

        // 5. Start WebSocket
        StartWebSocket();

        // The backend launches mpv with --pause=yes so audio does not play before
        // our window renders.  mpv is already seeked to the resume position via
        // --start — unpause immediately (no "pick up where you left off" prompt).
        _ = _ipc?.SendAsync("set_property", "pause", false);
        Dispatcher.Invoke(() => _controls?.HideLoadingOverlay());
#if WINDOWS
        Dispatcher.Invoke(UpdateTaskbarPlaybackState);
#endif

        App.Log("OnLoadedCore complete");
    }

    // ── Folder playlist build (episode siblings → mpv playlist) ─────────────
    //
    // For an episode like "F:\Shows\Foo\S01\Foo.S01E03.mkv", scan the parent
    // directory for video files, sort by natural order, and append each non-
    // current file to mpv's playlist via IPC loadfile.  After all appends:
    //
    //   • Playlist starts as just the currently-playing entry (index 0).
    //   • We append every OTHER file in folder order → [current, f0, f1, ...]
    //   • Then playlist-move 0 N+1 repositions `current` into its natural
    //     alphabetical slot, so ⏮ ⏭ traverse the folder in order.
    //
    // Mpv handles the rest: playlist-next/playlist-prev (which our existing
    // IPC handlers already send) walk this list, and on file change mpv
    // broadcasts the new path so the backend's poll sees the swap.

    private static readonly string[] _videoExtensions =
    {
        ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".webm",
        ".m4v", ".flv", ".ts",  ".mts", ".m2ts", ".vob",
        ".ogv", ".3gp", ".mpg", ".mpeg"
    };

    // ── Pre-warm: hide / re-attach instead of full close+restart ────────────

    /// <summary>
    /// Called when the WS reports the current session has ended (EOF or
    /// explicit stop).  We hide ourselves and dispose just the per-session
    /// state (IPC pipe, playlist), keeping the WPF runtime + JIT caches
    /// hot for the next video.  The HwndHost child window is NOT
    /// destroyed (Window.Hide preserves the HWND tree) — the next session's
    /// mpv can attach to the same child HWND, no re-creation needed.
    /// </summary>
    private void EnterPreWarmHide()
    {
        if (_waitingForNewSession) return;  // already hidden
        App.Log("EnterPreWarmHide");
        _waitingForNewSession = true;

        // Tear down per-session state
        _ipc?.Dispose();
        _ipc = null;
        _lastFilePathSeen  = null;
        _initialApplyDone  = false;
#if WINDOWS
        _taskbarPlaylistFiles = new();
        _taskbarPlaylistIndex = -1;
        UpdateTaskbarPlaybackState();
#endif
        _controls?.DisposeThumbServer();  // release the warm hover-thumbnail mpv

        // Hide both windows.  Hide() keeps the HWND alive and process running.
        _controls?.Hide();
        Hide();
    }

    /// <summary>
    /// Called when a new session arrives via WS while we were in pre-warm
    /// hide.  Re-runs the attach + IPC setup for the new session and shows
    /// ourselves again.  This is essentially OnLoadedCore minus the cold-
    /// start work (window creation, hook installation, ControlsWindow build).
    /// </summary>
    private async Task ExitPreWarmHideAsync(PlayerSession session)
    {
        App.Log($"ExitPreWarmHide — new session {session.SessionId}");
        _audioDelay = 0.0;   // reset per-session state

        // Show window first so HwndHost gets re-layered into the foreground
        // before mpv attaches — otherwise mpv may render to a hidden HWND
        // briefly and produce a black flash.
        Show();
        Activate();
        Topmost = true;
        _ = Dispatcher.InvokeAsync(async () =>
        {
            await Task.Delay(400).ConfigureAwait(true);
            Topmost = false;
        }, System.Windows.Threading.DispatcherPriority.Background);

        if (string.IsNullOrEmpty(session.PipeName))
        {
            App.Log("ExitPreWarmHide: session has no pipe name; abort");
            return;
        }

        var childHwnd = VideoPanel.ChildHwnd;
        if (childHwnd == IntPtr.Zero)
        {
            App.Log("ExitPreWarmHide: HwndHost child not ready; abort");
            return;
        }

        // Attach mpv into our (still-alive) HwndHost child window.
        try
        {
            var attached = await PlayerApiClient.AttachAsync((long)childHwnd).ConfigureAwait(true);
            if (attached is not null) session = attached;
        }
        catch (Exception ex)
        {
            App.Log($"ExitPreWarmHide: attach failed: {ex.Message}");
            return;
        }

        // Wire up the new IPC pipe.
        if (string.IsNullOrEmpty(session.PipeName)) return;
        _ipc = new MpvIpcClient(session.PipeName);
        try { await _ipc.ConnectAsync(5000).ConfigureAwait(true); }
        catch (Exception ex)
        {
            App.Log($"ExitPreWarmHide: IPC connect failed: {ex.Message}");
            return;
        }

        // Re-apply the per-session mpv property tweaks (background colour,
        // OSC off, subtitle margin) — these don't survive an mpv restart.
        _ = _ipc.SendAsync("script-message", "osc-visibility", "never");
        _ = _ipc.SendAsync("script-message-to", "osc", "visibility", "never");
        _ = _ipc.SendAsync("set_property", "osd-level", 0);
        _ = _ipc.SendAsync("set_property", "background", "#000000");
        _ = _ipc.SendAsync("set_property", "background-color", "#000000");
        _ = _ipc.SendAsync("set_property", "sub-ass-force-margins", true);
        _ = _ipc.SendAsync("set_property", "sub-margin-y", 110);

        // Update ControlsWindow with the new session data.
        _currentSession = session;
        _subtitleSearchTitle = FileBasename(session.FilePath);
        if (_controls is not null)
        {
            _controls.SetIpc(_ipc);
            _controls.SetTitle(FileBasename(session.FilePath));
            _controls.SetSessionFilePath(session.FilePath);
            _controls.UpdateFromSession(session);
            _controls.Show();
            _controls.ForceSyncFromOwner();
            _controls.StartHideTimer();
            _controls.ForceLayeredRepaint();
            _ = Dispatcher.BeginInvoke(new Action(() => _controls?.ForceLayeredRepaint()),
                                   System.Windows.Threading.DispatcherPriority.ApplicationIdle);
            _ = _controls.Dispatcher.BeginInvoke(new Action(() => _controls.ShowControls(animate: false)),
                                   System.Windows.Threading.DispatcherPriority.Render);
        }

        // Rebuild folder playlist for the new file.
        _ = BuildFolderPlaylistAsync(session.FilePath);

        // Re-apply subtitle preference for the new file.
        _initialApplyDone = true;
        _ = Task.Run(async () =>
        {
            try { if (_controls is not null) await _controls.ApplyPreferredSubtitleAsync(); }
            catch (Exception ex) { App.Log($"ExitPreWarmHide: subtitle apply failed: {ex.Message}"); }
        });

        // Backend spawned this new mpv with --pause=yes; unpause now that
        // we're fully ready.
        _ = _ipc?.SendAsync("set_property", "pause", false);

        App.Log("ExitPreWarmHide complete");
    }

    private async Task BuildFolderPlaylistAsync(string currentFilePath)
    {
        try
        {
            // Small delay so mpv has finished loading the current file before
            // we start mutating its playlist (avoids a race where playlist-
            // clear runs while mpv is still initialising entry 0).  150 ms is
            // empirically enough for mpv to settle on the new file — the
            // previous 300 ms was extra padding that just added to the
            // user-visible open time.
            await Task.Delay(150).ConfigureAwait(false);

            // Normalize the current file path so comparisons survive any
            // forward/back-slash differences, trailing dots, or relative
            // segments coming from the backend's JSON.  Path.GetFullPath
            // canonicalises all of those.
            string normCurrent;
            try { normCurrent = Path.GetFullPath(currentFilePath); }
            catch { normCurrent = currentFilePath; }

            var dir = Path.GetDirectoryName(normCurrent);
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir))
            {
                App.Log($"BuildFolderPlaylist: directory '{dir}' missing; skip");
                return;
            }

            // Sort by ordinal (natural file-listing order matches what most
            // file explorers show — close enough to "season order" for media
            // organised with leading SxxExx prefixes).  Normalize every
            // sibling too so the FindIndex comparison below is reliable.
            var siblings = Directory.EnumerateFiles(dir)
                .Where(f => _videoExtensions.Contains(
                    Path.GetExtension(f), StringComparer.OrdinalIgnoreCase))
                .Select(f =>
                {
                    try { return Path.GetFullPath(f); }
                    catch { return f; }
                })
                .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
                .ToList();

            App.Log($"BuildFolderPlaylist: scanned {siblings.Count} video file(s) in '{dir}'");

            if (siblings.Count <= 1)
            {
                App.Log("BuildFolderPlaylist: only 1 video; leaving prev/next hidden");
#if WINDOWS
                _taskbarPlaylistFiles = new();
                _taskbarPlaylistIndex = -1;
                await Dispatcher.InvokeAsync(UpdateTaskbarPlaybackState);
#endif
                return;   // nothing to navigate to — leave prev/next hidden
            }

            int currentIdx = siblings.FindIndex(
                f => string.Equals(f, normCurrent, StringComparison.OrdinalIgnoreCase));
            if (currentIdx < 0)
            {
                // Edge case: backend was given a path that resolves to a file
                // not in this folder enumeration (symlink target, weird casing
                // on a case-sensitive mount).  Bail rather than guess.
                App.Log($"BuildFolderPlaylist: current '{normCurrent}' not in scanned list; skip");
                return;
            }

            if (_ipc is null) return;

            // Reset to just the currently-playing entry, then append every
            // OTHER file in folder order.  Mpv's playlist-clear preserves the
            // entry that's currently playing — so playlist == [current].
            await _ipc.SendAsync("playlist-clear").ConfigureAwait(false);
            foreach (var f in siblings)
            {
                if (string.Equals(f, normCurrent, StringComparison.OrdinalIgnoreCase)) continue;
                await _ipc.SendAsync("loadfile", f, "append").ConfigureAwait(false);
            }

            // Reposition `current` (at playlist index 0) into its natural
            // alphabetical slot.  playlist-move dst semantics: "move src to
            // BEFORE the entry at dst", so dst = currentIdx + 1 places src at
            // index currentIdx.  No-op when currentIdx == 0.
            if (currentIdx > 0)
            {
                await _ipc.SendAsync("playlist-move", 0, currentIdx + 1).ConfigureAwait(false);
            }

            App.Log($"BuildFolderPlaylist: queued {siblings.Count} files; current at idx {currentIdx} — prev/next now visible");

            // Hand the final file list over to ControlsWindow so the Playlist
            // popup (in the ⋮ menu) can render it.  Order matches mpv's
            // playlist after the move, so the index in this list lines up
            // with mpv's playlist-pos for click-to-jump.
            await Dispatcher.InvokeAsync(() =>
            {
                _controls?.SetPlaylist(siblings, normCurrent);
                _controls?.SetPlaylistNavVisible(true);
#if WINDOWS
                _taskbarPlaylistFiles = siblings;
                _taskbarPlaylistIndex = currentIdx;
                UpdateTaskbarPlaybackState();
#endif
            });
        }
        catch (Exception ex)
        {
            App.Log($"BuildFolderPlaylist failed (non-fatal): {ex.Message}");
        }
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        // Fire-and-forget final save (was a blocking t.Wait up to 1.5 s, which
        // added visible lag to every close).  The authoritative resume save now
        // happens in PlayerService.StopAsync (invoked by the close button's
        // background StopAsync) BEFORE mpv is torn down, so this is just a
        // safety net for close paths that don't route through OnCloseClick
        // (Alt+F4, EOF).  Non-blocking so the window closes instantly.
        try
        {
            _ = Task.Run(async () =>
            {
                using var c = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(1.5) };
                using var resp = await c.PostAsync(PlayerApiClient.SaveProgressNowUri, content: null).ConfigureAwait(false);
                App.Log($"OnClosed: save-progress-now → {(int)resp.StatusCode}");
            });
        }
        catch (Exception ex) { App.Log($"OnClosed: save-progress-now failed (non-fatal): {ex.Message}"); }

        if (_hookHandle != IntPtr.Zero)
        {
            NativeMethods.UnhookWindowsHookEx(_hookHandle);
            _hookHandle = IntPtr.Zero;
        }
        if (_mouseHookHandle != IntPtr.Zero)
        {
            NativeMethods.UnhookWindowsHookEx(_mouseHookHandle);
            _mouseHookHandle = IntPtr.Zero;
        }
        _ipc?.Dispose();
#if WINDOWS
        _taskbarThumbButtons?.Dispose();
        _taskbarThumbButtons = null;
#endif
        _wsCts?.Cancel();
        _ws?.Dispose();
        _controls?.Close();
        App.Log("Window closed");
    }

    // ── WebSocket ─────────────────────────────────────────────────────────────

    private void StartWebSocket()
    {
        _wsCts = new CancellationTokenSource();
        _ = Task.Run(() => WebSocketLoopAsync(_wsCts.Token), CancellationToken.None);
    }

    private async Task WebSocketLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            _ws = new ClientWebSocket();
            try
            {
                await _ws.ConnectAsync(PlayerApiClient.WebSocketUri, ct).ConfigureAwait(false);
                var buffer = new ArraySegment<byte>(new byte[16_384]);
                while (_ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
                {
                    var sb = new StringBuilder();
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await _ws.ReceiveAsync(buffer, ct).ConfigureAwait(false);
                        if (result.MessageType == WebSocketMessageType.Close) goto closeWs;
                        sb.Append(Encoding.UTF8.GetString(buffer.Array!, 0, result.Count));
                    }
                    while (!result.EndOfMessage);
                    ProcessWsMessage(sb.ToString());
                }
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { App.Log($"WS error: {ex.Message}"); }
            finally { _ws?.Dispose(); _ws = null; }

            closeWs:
            if (!ct.IsCancellationRequested)
            {
                try { await Task.Delay(2000, ct).ConfigureAwait(false); }
                catch (OperationCanceledException) { break; }
            }
        }
    }

    private void ProcessWsMessage(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("isStopped", out var s) && s.GetBoolean())
            {
                // FIX 8: if the current item was an episode, try to show the
                // "Next Episode" countdown BEFORE entering pre-warm hide.
                // The overlay handles the user's choice (auto-advance, play
                // now, or cancel) and triggers the appropriate flow.
                int? episodeId = null;
                if (doc.RootElement.TryGetProperty("episodeId", out var epEl)
                    && epEl.ValueKind == JsonValueKind.Number)
                {
                    episodeId = epEl.GetInt32();
                }

                if (episodeId is int eid)
                {
                    _ = Dispatcher.InvokeAsync(() => TryShowNextEpisodeOverlayAsync(eid));
                    return;     // overlay decides what happens next
                }

                // Movie or no episode metadata → just hide for next session.
                App.Log("Session stopped — entering pre-warm hide");
                _ = Dispatcher.InvokeAsync(EnterPreWarmHide);
                return;
            }
            var session = JsonSerializer.Deserialize<PlayerSession>(json, _wsOpts);
            if (session is null) return;

            // If we're in pre-warm hide and got a non-stopped session, that's
            // the new video — re-attach and show ourselves again.
            if (_waitingForNewSession)
            {
                _waitingForNewSession = false;
                _ = Dispatcher.InvokeAsync(() => ExitPreWarmHideAsync(session));
                return;
            }

            if (_controls is not null)
            {
                _currentSession = session;
                _ = Dispatcher.InvokeAsync(() =>
                {
                    _controls.UpdateFromSession(session);
#if WINDOWS
                    if (!string.IsNullOrEmpty(session.FilePath))
                    {
                        string normPath;
                        try { normPath = System.IO.Path.GetFullPath(session.FilePath); }
                        catch { normPath = session.FilePath; }
                        if (_taskbarPlaylistFiles.Count > 1)
                        {
                            int idx = _taskbarPlaylistFiles.FindIndex(
                                f => string.Equals(f, normPath, StringComparison.OrdinalIgnoreCase));
                            if (idx >= 0) _taskbarPlaylistIndex = idx;
                        }
                    }
                    UpdateTaskbarPlaybackState();
#endif
                    // Propagate filename changes so the Playlist popup
                    // re-highlights when mpv steps to next/prev or when
                    // the user clicks an entry to jump.
                    if (!string.IsNullOrEmpty(session.FilePath))
                    {
                        string norm;
                        try { norm = System.IO.Path.GetFullPath(session.FilePath); }
                        catch { norm = session.FilePath; }

                        bool fileChanged = !string.Equals(norm, _lastFilePathSeen,
                                                         StringComparison.OrdinalIgnoreCase);
                        if (fileChanged)
                            App.Log($"WS: playing file changed → '{System.IO.Path.GetFileName(norm)}' (dur={session.Duration:F1})");
                        _lastFilePathSeen = norm;

                        _controls.UpdateCurrentPlaylistFile(norm);
                        _controls.SetSessionFilePath(norm);
                        _controls.SetTitle(FileBasename(norm));
                        if (fileChanged)
                            _subtitleSearchTitle = FileBasename(norm);

                        // File changed → re-apply the persisted subtitle
                        // preference so episodes consistently start with the
                        // language the user picked last time.  Skipped on the
                        // first WS push (initial file) because OnLoadedCore
                        // already triggers the same call after IPC connect.
                        if (fileChanged && _initialApplyDone)
                            _ = _controls.ApplyPreferredSubtitleAsync();

                        // Intro/outro skip data (Group 3) — fetch once per actual
                        // file/episode change (covers both the very first load and
                        // every subsequent next/prev), cache it on ControlsWindow,
                        // and never re-fetch per-frame. EpisodeId is null for movies
                        // or when metadata couldn't be resolved — clear any stale
                        // data from the previous episode in that case.
                        if (fileChanged)
                        {
                            if (session.EpisodeId is int skipEpisodeId)
                                _ = FetchAndApplySkipDataAsync(skipEpisodeId);
                            else
                                _controls.SetIntroOutroSkipData(null);
                        }
                    }
                });
            }
        }
        catch (Exception ex) { App.Log($"WS parse error: {ex.Message}"); }
    }

    // ── Global keyboard hook (WH_KEYBOARD_LL) ────────────────────────────────
    //
    // Fires for every key press system-wide regardless of which window has focus.
    // We guard with a foreground-window process check so the shortcuts only take
    // effect while PitflixPlayer is the foreground application.

    // ── WM_NCHITTEST hook for the titlebar drag zone ─────────────────────────
    //
    // Returns HTCAPTION for the top ~40 px of MainWindow's visible client
    // area so the OS performs a native drag-move when the user drags from
    // there.  HTCAPTION beats the resize border (HTTOP) which would
    // otherwise win at the very top edge, fixing the "drag just resizes"
    // bug.  All other coordinates fall through to default WPF handling so
    // side/bottom resize borders, controls, and the video surface all
    // continue to receive their normal hit-test results.

    private const int MAIN_WM_NCHITTEST = 0x0084;
    private const int MAIN_HTCAPTION    = 2;
    private const int TITLEBAR_DRAG_HEIGHT_PX = 40;

    // WM_WINDOWPOSCHANGED — fires synchronously, once per frame, during a
    // live OS resize-drag (mouse held on the edge/corner).  We use it to
    // re-sync ControlsWindow's geometry instead of relying solely on the
    // WPF Owner.SizeChanged event: SizeChanged is dispatched through the
    // managed layout/event queue and lags the native resize loop by a frame
    // or more.  Because ControlsWindow is a separate top-level window (it
    // has to be — see the airspace-conflict comment on VideoHwndHost), that
    // lag let ControlsWindow's transparent overlay briefly sit larger than
    // MainWindow's just-shrunk bounds, exposing whatever was behind the app
    // through the overlay's (normally click-through) excess area — the
    // "gap on the side while resizing" bug.  Resyncing on this message
    // keeps the two windows in lock-step.
    private const int MAIN_WM_WINDOWPOSCHANGED = 0x0047;

    private IntPtr MainHitTestHook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam,
                                    ref bool handled)
    {
        if (msg == NativeMethods.WM_GETMINMAXINFO)
        {
            // Clamp the native maximize bounds to the EXACT monitor rect.
            // Without this, a borderless+resizable window maximizes a few
            // pixels off-screen on each edge (room reserved for the invisible
            // resize border); the overhang gets clipped by the monitor, but
            // ControlsWindow.SyncFromOwner reads the unclipped DWM rect and
            // ends up offset from where MainWindow is actually painted —
            // the persistent (non-resize) edge gap that exposes the desktop.
            // Full monitor rect (not work area) matches this app's existing
            // "maximize = true fullscreen, covers taskbar" behavior.
            var monitor = NativeMethods.MonitorFromWindow(hwnd, NativeMethods.MONITOR_DEFAULTTONEAREST);
            if (monitor != IntPtr.Zero)
            {
                var mi = new NativeMethods.MONITORINFO
                { cbSize = (uint)Marshal.SizeOf<NativeMethods.MONITORINFO>() };
                if (NativeMethods.GetMonitorInfo(monitor, ref mi))
                {
                    var mmi = Marshal.PtrToStructure<NativeMethods.MINMAXINFO>(lParam);
                    mmi.ptMaxPosition.X = mi.rcMonitor.Left;
                    mmi.ptMaxPosition.Y = mi.rcMonitor.Top;
                    mmi.ptMaxSize.X = mi.rcMonitor.Right  - mi.rcMonitor.Left;
                    mmi.ptMaxSize.Y = mi.rcMonitor.Bottom - mi.rcMonitor.Top;
                    Marshal.StructureToPtr(mmi, lParam, true);
                    handled = true;
                }
            }
            return IntPtr.Zero;
        }

        if (msg == MAIN_WM_WINDOWPOSCHANGED)
        {
            _controls?.ForceSyncFromOwner();
            return IntPtr.Zero;
        }

        if (msg != MAIN_WM_NCHITTEST) return IntPtr.Zero;

        // Don't override resize behaviour when the window is maximized — the
        // user typically wants to restore (via the chrome ▢ button) rather
        // than drag a maximized window, and OS drag of a maximized window
        // can do unexpected snap things.
        if (WindowState != WindowState.Normal) return IntPtr.Zero;

        // lParam is screen coords in physical pixels.  We want the Y offset
        // from MainWindow's visible top.  Use DWM-extended bounds to skip
        // the invisible shadow margin (~8 px) — otherwise our 40 px zone
        // would be shifted down by the shadow and the user's very-top
        // clicks would still hit the resize border.
        int raw = lParam.ToInt32();
        int screenY = (short)((raw >> 16) & 0xFFFF);

        int visibleTop;
        if (NativeMethods.DwmGetWindowAttribute(
                _mainHwnd, NativeMethods.DWMWA_EXTENDED_FRAME_BOUNDS,
                out var bounds,
                System.Runtime.InteropServices.Marshal.SizeOf<NativeMethods.RECT>()) == 0)
        {
            visibleTop = bounds.Top;
        }
        else if (NativeMethods.GetWindowRect(_mainHwnd, out var wr))
        {
            visibleTop = wr.Top;
        }
        else return IntPtr.Zero;

        // Scale the 40 DIP threshold by current DPI so it stays visually
        // consistent on hi-DPI displays.
        var ps = PresentationSource.FromVisual(this);
        double dpiScale = ps?.CompositionTarget?.TransformToDevice.M22 ?? 1.0;
        int thresholdPx = (int)(TITLEBAR_DRAG_HEIGHT_PX * dpiScale);

        int relativeY = screenY - visibleTop;
        if (relativeY >= 0 && relativeY < thresholdPx)
        {
            handled = true;
            return new IntPtr(MAIN_HTCAPTION);
        }

        // Outside titlebar zone — let WPF compute the normal hit test
        // (resize borders, client area, etc.).
        return IntPtr.Zero;
    }

    private IntPtr KeyboardHookProc(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 &&
            (wParam == (IntPtr)NativeMethods.WM_KEYDOWN ||
             wParam == (IntPtr)NativeMethods.WM_SYSKEYDOWN))
        {
            // Only handle when our process is the foreground app
            var fg = NativeMethods.GetForegroundWindow();
            NativeMethods.GetWindowThreadProcessId(fg, out uint fgPid);
            if (fgPid == (uint)Environment.ProcessId)
            {
                var ks = Marshal.PtrToStructure<NativeMethods.KBDLLHOOKSTRUCT>(lParam);
                HandleVirtualKey(ks.vkCode);
            }
        }
        return NativeMethods.CallNextHookEx(_hookHandle, nCode, wParam, lParam);
    }

    private void HandleVirtualKey(uint vk)
    {
        switch (vk)
        {
            case 0x20: // VK_SPACE — pause/resume
                // Synchronous Invoke so the icon flips on the same message-pump tick.
                Dispatcher.Invoke(() =>
                {
                    if (_controls is null) return;
                    _controls.OptimisticTogglePause();
                    // IsPaused is already the post-toggle state after OptimisticTogglePause.
                    _ = _ipc?.SendAsync("set_property", "pause", _controls.IsPaused);
                });
                break;

            case 0x25: // VK_LEFT — seek back 5 s (absolute, works while paused)
                _ = Dispatcher.InvokeAsync(() =>
                {
                    if (_controls is null) return;
                    double pos = Math.Max(0, _controls.CurrentPosition - 5);
                    _controls.ApplyLocalSeek(pos);
                    _controls.ShowSkipIndicator(-5);
                    _ = _ipc?.SendAsync("seek", pos, "absolute");
                });
                break;

            case 0x27: // VK_RIGHT — seek forward 5 s (absolute, works while paused)
                _ = Dispatcher.InvokeAsync(() =>
                {
                    if (_controls is null) return;
                    double pos = Math.Min(_controls.CurrentDuration, _controls.CurrentPosition + 5);
                    _controls.ApplyLocalSeek(pos);
                    _controls.ShowSkipIndicator(+5);
                    _ = _ipc?.SendAsync("seek", pos, "absolute");
                });
                break;

            case 0x26: // VK_UP — volume +5 (range 0-200), show side bar
                _ = Dispatcher.InvokeAsync(() =>
                {
                    if (_controls is null) return;
                    double v = Math.Min(200, _controls.CurrentVolume + 5);
                    _controls.SetVolume(v); // → OnVolumeChanged → IPC
                    _controls.ShowVolumeIndicator((int)Math.Round(v));
                });
                break;

            case 0x28: // VK_DOWN — volume -5 (range 0-200), show side bar
                _ = Dispatcher.InvokeAsync(() =>
                {
                    if (_controls is null) return;
                    double v = Math.Max(0, _controls.CurrentVolume - 5);
                    _controls.SetVolume(v); // → OnVolumeChanged → IPC
                    _controls.ShowVolumeIndicator((int)Math.Round(v));
                });
                break;

            case 0x4D: // M — mute toggle
                _ = Dispatcher.InvokeAsync(() =>
                {
                    if (_controls is null) return;
                    if (_isMuted)
                    {
                        _isMuted = false;
                        _controls.SetVolume(Math.Max(_lastVolume, 5));
                    }
                    else
                    {
                        _lastVolume = _controls.CurrentVolume;
                        _isMuted    = true;
                        _controls.SetVolume(0);
                    }
                });
                break;

            case 0x46: // F — fullscreen toggle
                _ = Dispatcher.InvokeAsync(() => _controls?.ToggleMaximize());
                break;

            case 0x1B: // VK_ESCAPE — close help overlay, else exit fullscreen
                _ = Dispatcher.InvokeAsync(() =>
                {
                    if (_controls?.IsShortcutsHelpVisible == true)
                        _controls.ToggleShortcutsHelp();
                    else if (_controls?.IsMaximized == true)
                        _controls.ToggleMaximize();
                });
                break;

            case 0x4E: // N — next in playlist
                _ = Dispatcher.InvokeAsync(() => { _controls?.AbortThumbBulk(); _ = _ipc?.SendAsync("playlist-next"); });
                break;

            case 0x50: // P — previous in playlist
                _ = Dispatcher.InvokeAsync(() => { _controls?.AbortThumbBulk(); _ = _ipc?.SendAsync("playlist-prev"); });
                break;

            // FIX 6 — audio delay nudge (mpv `audio-delay` property, in seconds).
            // A = behind (negative delay), Z = ahead (positive delay).  Side-
            // bar indicator on the right edge mirrors the volume-bar pattern.
            case 0x41: // A — audio earlier by 100 ms
                _audioDelay -= 0.1;
                _ = Dispatcher.InvokeAsync(() =>
                {
                    _ = _ipc?.SendAsync("set_property", "audio-delay", _audioDelay);
                    _controls?.ShowAudioDelayIndicator(_audioDelay);
                });
                break;

            case 0x5A: // Z — audio later by 100 ms
                _audioDelay += 0.1;
                _ = Dispatcher.InvokeAsync(() =>
                {
                    _ = _ipc?.SendAsync("set_property", "audio-delay", _audioDelay);
                    _controls?.ShowAudioDelayIndicator(_audioDelay);
                });
                break;

            // FIX 7 — Screenshot (plain S) or subtitle search (Shift+S).
            case 0x53: // S
                if ((NativeMethods.GetAsyncKeyState(NativeMethods.VK_SHIFT) & 0x8000) != 0)
                {
                    _ = Dispatcher.InvokeAsync(OpenSubtitleSearchOverlay);
                    break;
                }
                _ = Dispatcher.InvokeAsync(() =>
                {
                    _ = _ipc?.SendAsync("async", "screenshot", "video");
                    _controls?.ShowToastOverlay("📸 Screenshot saved");
                });
                break;

            // H — toggle keyboard-shortcuts help overlay.
            case 0x48:
                _ = Dispatcher.InvokeAsync(() => _controls?.ToggleShortcutsHelp());
                break;
        }
    }

    // ── Global mouse hook — double-click fullscreen (WH_MOUSE_LL) ───────────────
    //
    // WPF's ClickCount resets to 1 whenever a native child window (mpv's HwndHost
    // surface) steals Win32 focus, making WPF double-click events unreliable.
    // WH_MOUSE_LL sees every WM_LBUTTONDOWN before any window processes it, so we
    // can track the inter-click interval ourselves.  We filter to clicks whose
    // root ancestor is MainWindow (not ControlsWindow) so button double-clicks
    // don't accidentally toggle fullscreen.

    private IntPtr MouseHookProc(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            var ms = Marshal.PtrToStructure<NativeMethods.MSLLHOOKSTRUCT>(lParam);

            // ── Left-button click handling — runs REGARDLESS of foreground PID ──
            //
            // CRITICAL: this branch deliberately does NOT sit behind the
            // foreground-PID gate that scopes wheel/etc. below.  When the user
            // is in another app and clicks our video to come back, we are NOT
            // yet the foreground process — so a PID-gated handler would drop
            // the click entirely and Activate() would never run.  The user
            // then has to make a SECOND click on ControlsWindow (a regular
            // top-level window that activates itself on click) to actually
            // bring us forward, which is exactly what they reported as
            // "have to click controls first to focus".
            //
            // Geometry alone is the right gate here: if the cursor is inside
            // our window's screen rect and not over a real control, the click
            // is meant for us regardless of who happens to be foreground.
            bool clickHitsVideo = false;
            if (wParam == (IntPtr)NativeMethods.WM_LBUTTONDOWN
                && NativeMethods.GetWindowRect(_mainHwnd, out var mainRect))
            {
                bool insideMain = ms.ptX >= mainRect.Left && ms.ptX <= mainRect.Right
                               && ms.ptY >= mainRect.Top  && ms.ptY <= mainRect.Bottom;
                bool overUi = _controls?.IsScreenPointOverUi(new Point(ms.ptX, ms.ptY)) ?? false;
                clickHitsVideo = insideMain && !overUi;
            }
            if (clickHitsVideo)
            {
                // VideoHwndHost answers WM_MOUSEACTIVATE with MA_NOACTIVATE so mpv
                // never steals keyboard focus — but that also means clicking the
                // video never brings MainWindow to the foreground if it wasn't
                // already active.  Without that, the global keyboard hook's
                // foreground-PID check fails and Space/arrows do nothing.
                //
                // IMPORTANT: do NOT call Activate() synchronously here.
                // WH_MOUSE_LL hook procs run with a watchdog timeout and
                // Window.Activate() pumps window-manager messages — which can
                // re-enter this very hook (same thread) mid-state-update,
                // scrambling _lastClickTime/_lastClickPos and breaking double-
                // click detection.  Queue it so the hook returns immediately.
                if (!IsActive)
                    _ = Dispatcher.InvokeAsync(() => { if (!IsActive) Activate(); });

                var now = DateTime.UtcNow;
                int dx  = Math.Abs(ms.ptX - _lastClickPos.X);
                int dy  = Math.Abs(ms.ptY - _lastClickPos.Y);

                if ((now - _lastClickTime).TotalMilliseconds < 400 && dx <= 10 && dy <= 10)
                {
                    _lastClickTime = DateTime.MinValue;
                    _ = Dispatcher.InvokeAsync(() => _controls?.ToggleMaximize());
                }
                else
                {
                    _lastClickTime = now;
                    _lastClickPos  = (ms.ptX, ms.ptY);
                }
            }

            // ── Right-click → context menu ────────────────────────────────────
            //
            // Same airspace problem as left-click: WPF's
            // PreviewMouseRightButtonUp on MainWindow never fires when the
            // cursor is over the mpv HwndHost (native child steals it).
            // Handle via the global low-level hook instead.  Geometry-gated
            // like left-click so we don't fire spuriously on clicks outside
            // our window.
            if (wParam == (IntPtr)NativeMethods.WM_RBUTTONDOWN
                && NativeMethods.GetWindowRect(_mainHwnd, out var rRect))
            {
                bool insideMainR = ms.ptX >= rRect.Left && ms.ptX <= rRect.Right
                                && ms.ptY >= rRect.Top  && ms.ptY <= rRect.Bottom;
                bool overUiR = _controls?.IsScreenPointOverUi(new Point(ms.ptX, ms.ptY)) ?? false;
                if (insideMainR && !overUiR)
                {
                    int captureX = ms.ptX;
                    int captureY = ms.ptY;
                    _ = Dispatcher.InvokeAsync(() =>
                        _controls?.ShowContextMenu(new Point(captureX, captureY)));
                }
            }

            // ── Wheel handling — STILL gated on foreground PID ────────────────
            //
            // Unlike clicks, wheel events should not bleed across apps: if the
            // user is scrolling inside another app while our window happens to
            // be under the cursor, we must not eat their scroll or change our
            // volume from the background.  So keep the original PID scope here.
            var fg = NativeMethods.GetForegroundWindow();
            NativeMethods.GetWindowThreadProcessId(fg, out uint fgPid);
            if (fgPid == (uint)Environment.ProcessId)
            {
                // ── Scroll wheel → volume / seek (bypasses HwndHost airspace) ──
                // WPF PreviewMouseWheel never fires when the cursor is over the
                // native mpv child window — Win32 delivers WM_MOUSEWHEEL straight
                // to that child, bypassing WPF's input pipeline entirely.  The
                // global low-level hook sees it first regardless of routing.
                //
                // NOTE: we deliberately do NOT gate this on rootHwnd == _mainHwnd.
                // WindowFromPoint returns the topmost HWND covering the point by
                // Z-order/bounds — it does not consult WM_NCHITTEST/HTTRANSPARENT
                // click-through — so it resolves to ControlsWindow (which visually
                // covers the whole video area in both windowed and maximized modes)
                // rather than MainWindow.  Instead we test screen-point geometry
                // directly: inside MainWindow's rect AND not over a visible control.
                if (wParam == (IntPtr)NativeMethods.WM_MOUSEWHEEL)
                {
                    if (NativeMethods.GetWindowRect(_mainHwnd, out var wr))
                    {
                        bool insideMain = ms.ptX >= wr.Left && ms.ptX <= wr.Right
                                       && ms.ptY >= wr.Top  && ms.ptY <= wr.Bottom;

                        // We're on the UI thread (hook procs run on the installing
                        // thread), so this WPF call is safe to make directly.
                        bool overUi = _controls?.IsScreenPointOverUi(new Point(ms.ptX, ms.ptY)) ?? false;

                        // Don't steal the wheel from the playlist popup —
                        // when the cursor is inside its scrollable area we
                        // want the user to scroll the list, not change the
                        // video volume.  The popup's own ScrollViewer will
                        // pick up the event via CallNextHookEx.
                        bool overPlaylist = _controls?.IsScreenPointInPlaylistPopup(
                            new Point(ms.ptX, ms.ptY)) ?? false;

                        if (insideMain && !overUi && !overPlaylist)
                        {
                            // mouseData high-word = signed wheel delta (+ = up/forward)
                            int delta = (short)((ms.mouseData >> 16) & 0xFFFF);
                            int h = wr.Bottom - wr.Top;
                            double relativeY = h > 0 ? (double)(ms.ptY - wr.Top) / h : 0;

                            _ = Dispatcher.InvokeAsync(() =>
                            {
                                if (_controls is null) return;
                                if (relativeY > 0.85)
                                {
                                    // Bottom 15 % → seek ±10 s
                                    int seconds = delta > 0 ? 10 : -10;
                                    double pos  = Math.Clamp(
                                        _controls.CurrentPosition + seconds, 0, _controls.CurrentDuration);
                                    _controls.ApplyLocalSeek(pos);
                                    _controls.ShowSkipIndicator(seconds);
                                    _ = _ipc?.SendAsync("seek", pos, "absolute");
                                }
                                else
                                {
                                    // Video area → volume ±5 (range 0-200)
                                    double d         = delta > 0 ? 5.0 : -5.0;
                                    double newVolume = Math.Clamp(_controls.CurrentVolume + d, 0, 200);
                                    _controls.SetVolume(newVolume); // → OnVolumeChanged → IPC
                                    _controls.ShowVolumeIndicator((int)Math.Round(newVolume));
                                }
                            });
                        }
                    }
                }
            }
        }
        return NativeMethods.CallNextHookEx(_mouseHookHandle, nCode, wParam, lParam);
    }

    // ── Mouse scroll — zone-sensitive ────────────────────────────────────────
    //
    // Bottom 15 % of the window → seek ±10 s.
    // Anywhere else on the video → volume ±5 (0-200 range).

    private void OnScrollWheel(object sender, MouseWheelEventArgs e)
    {
        if (_controls is null) return;
        e.Handled = true;

        var    mousePos  = e.GetPosition(this);
        double relativeY = ActualHeight > 0 ? mousePos.Y / ActualHeight : 0;

        if (relativeY > 0.85)
        {
            // ── Bottom 15 % → seek ±10 s ─────────────────────────────────────
            int seconds = e.Delta > 0 ? 10 : -10;
            double pos  = Math.Clamp(
                _controls.CurrentPosition + seconds, 0, _controls.CurrentDuration);
            _controls.ApplyLocalSeek(pos);
            _controls.ShowSkipIndicator(seconds);
            _ = _ipc?.SendAsync("seek", pos, "absolute");
        }
        else
        {
            // ── Video area → volume ±5 (range 0-200) ──────────────────────────
            double delta     = e.Delta > 0 ? 5.0 : -5.0;
            double newVolume = Math.Clamp(_controls.CurrentVolume + delta, 0, 200);
            _controls.SetVolume(newVolume); // → OnVolumeChanged → IPC
            _controls.ShowVolumeIndicator((int)Math.Round(newVolume));
        }
    }

    // ── Right-click context menu (Fix 6) ─────────────────────────────────────

    private void OnRightClick(object sender, MouseButtonEventArgs e)
    {
        if (_controls is null) return;
        e.Handled = true;
        var screenPt = PointToScreen(e.GetPosition(this));
        _controls.ShowContextMenu(screenPt);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static string FileBasename(string path)
    {
        var name = path.Replace('\\', '/').Split('/').LastOrDefault() ?? path;
        var dot  = name.LastIndexOf('.');
        return dot > 0 ? name[..dot] : name;
    }

    /// <summary>
    /// FIX 8 — at session end, try to find the next episode and show the
    /// auto-advance countdown overlay.  If no successor is found (endpoint
    /// missing, last episode of series, etc.) fall back to the pre-warm
    /// hide flow so we still hide instead of close.
    /// </summary>
    private async Task TryShowNextEpisodeOverlayAsync(int currentEpisodeId)
    {
        try
        {
            var next = await PlayerApiClient.GetNextEpisodeAsync(currentEpisodeId).ConfigureAwait(true);
            if (next is null || _controls is null)
            {
                // No next episode (or controls missing) → behave like the
                // normal session-stop flow: pre-warm hide for next video.
                EnterPreWarmHide();
                return;
            }

            // Build display info using the same metadata helpers.
            var info = await PlayerApiClient.GetEpisodeInfoAsync(next.EpisodeId).ConfigureAwait(true);
            string title    = info?.Title ?? next.Title;
            string? subtitle = info?.Subtitle ?? next.Subtitle;

            _controls.ShowNextEpisodeOverlay(
                title, subtitle,
                thumbnail: null,    // TODO thumbnail support — would need next-episode poster URL
                onPlayNow: () =>
                {
                    // Trigger playlist-next on the running mpv.  Backend's
                    // path-change handler + our WS file-loaded plumbing
                    // will then update everything else (title, playlist
                    // highlight, subtitle preference).
                    _ = _ipc?.SendAsync("set_property", "start", "none");
                    _ = _ipc?.SendAsync("playlist-next");
                    _ = _ipc?.SendAsync("set_property", "pause", false);
                },
                onCancel: EnterPreWarmHide);
        }
        catch (Exception ex)
        {
            App.Log($"TryShowNextEpisodeOverlay: {ex.Message} — falling back to hide");
            EnterPreWarmHide();
        }
    }

    /// <summary>
    /// Looks up the show/episode (or movie) title via the backend metadata
    /// endpoints and applies the friendly name to the title bar.  Silent
    /// no-op on 404 / network failure — caller has already set a filename
    /// fallback so we never end up with an empty titlebar.
    /// </summary>
    private async Task ApplyMetadataTitleAsync(PlayerSession session)
    {
        try
        {
            if (session.EpisodeId is int episodeId)
            {
                var info = await PlayerApiClient.GetEpisodeInfoAsync(episodeId).ConfigureAwait(false);
                if (info is not null && !string.IsNullOrWhiteSpace(info.Title))
                {
                    string display = string.IsNullOrWhiteSpace(info.Subtitle)
                        ? info.Title
                        : $"{info.Title}  ·  {info.Subtitle}";
                    // Search title: "Show Name S1E8" when season/episode known.
                    string searchTitle = info.Title;
                    if (!string.IsNullOrWhiteSpace(info.Subtitle))
                    {
                        var parts = info.Subtitle.Split('·', StringSplitOptions.TrimEntries);
                        if (parts.Length > 0)
                        {
                            var se = parts[0].Replace(" ", "", StringComparison.Ordinal);
                            searchTitle = $"{info.Title} {se}";
                        }
                    }
                    _subtitleSearchTitle = searchTitle;
                    await Dispatcher.InvokeAsync(() =>
                    {
                        _controls?.SetTitle(display);
                        _controls?.SetQuickInfo(info.Title, info.Subtitle, info.Meta, info.Overview);
                    });
                }
            }
            else if (session.MediaId > 0)
            {
                var info = await PlayerApiClient.GetMovieInfoAsync(session.MediaId).ConfigureAwait(false);
                if (info is not null && !string.IsNullOrWhiteSpace(info.Title))
                {
                    string display = string.IsNullOrWhiteSpace(info.Subtitle)
                        ? info.Title
                        : $"{info.Title}  ({info.Subtitle})";
                    _subtitleSearchTitle = info.Title;
                    await Dispatcher.InvokeAsync(() =>
                    {
                        _controls?.SetTitle(display);
                        _controls?.SetQuickInfo(info.Title, null, info.Meta, info.Overview);
                    });
                }
            }
        }
        catch (Exception ex)
        {
            App.Log($"ApplyMetadataTitle: {ex.Message} (falling back to filename)");
        }
    }

    /// <summary>Fetches GET /api/skip/episode/{id} once and caches it on ControlsWindow —
    /// see the fileChanged branch in ProcessWsMessage for the single call site.</summary>
    private async Task FetchAndApplySkipDataAsync(int episodeId)
    {
        try
        {
            var skip = await PlayerApiClient.GetEpisodeSkipAsync(episodeId).ConfigureAwait(false);
            App.Log($"skip: episodeId={episodeId} intro={DescribeSkipSegment(skip.Intro)} outro={DescribeSkipSegment(skip.Outro)}");
            await Dispatcher.InvokeAsync(() => _controls?.SetIntroOutroSkipData(skip));
        }
        catch (Exception ex)
        {
            App.Log($"GetEpisodeSkipAsync failed: {ex.Message}");
        }
    }

    private static string DescribeSkipSegment(SkipSegment? seg) =>
        seg is null ? "null" : $"[{seg.Start:F1}-{seg.End:F1}s conf={seg.Confidence:F2} src={seg.Source}]";

    private void OpenSubtitleSearchOverlay()
    {
        if (_ipc is null || _currentSession is null) return;

        if (_subtitleOverlay is { IsVisible: true })
        {
            _subtitleOverlay.Activate();
            return;
        }

        string title = string.IsNullOrWhiteSpace(_subtitleSearchTitle)
            ? FileBasename(_currentSession.FilePath)
            : _subtitleSearchTitle;

        _subtitleOverlay = new SubtitleSearchOverlay(
            this,
            _ipc,
            title,
            imdbId: null,
            _currentSession.EpisodeId,
            _currentSession.MediaId,
            _currentSession.FilePath);
        _subtitleOverlay.Closed += (_, _) => _subtitleOverlay = null;
        _subtitleOverlay.Show();
    }

#if WINDOWS
    private void InitializeTaskbarThumbButtons()
    {
        if (!TaskbarThumbButtons.IsSupported)
        {
            App.Log("TaskbarThumbButtons: not supported on this OS");
            return;
        }

        try
        {
            _taskbarThumbButtons = new TaskbarThumbButtons(this);
            _taskbarThumbButtons.OnPrevious = () =>
            {
                _controls?.AbortThumbBulk();
                _ = _ipc?.SendAsync("playlist-prev");
            };
            _taskbarThumbButtons.OnPlayPause = () =>
            {
                if (_controls is null) return;
                _controls.OptimisticTogglePause();
                _ = _ipc?.SendAsync("cycle", "pause");
                UpdateTaskbarPlaybackState();
            };
            _taskbarThumbButtons.OnNext = () =>
            {
                _controls?.AbortThumbBulk();
                _ = _ipc?.SendAsync("playlist-next");
            };
            UpdateTaskbarPlaybackState();
        }
        catch (Exception ex)
        {
            App.Log($"InitializeTaskbarThumbButtons failed: {ex.Message}");
        }
    }

    private void UpdateTaskbarPlaybackState()
    {
        if (_taskbarThumbButtons is null) return;

        bool isPlaying = _controls is not null && !_controls.IsPaused;
        bool hasPrev   = _taskbarPlaylistIndex > 0;
        bool hasNext   = _taskbarPlaylistIndex >= 0
                      && _taskbarPlaylistIndex < _taskbarPlaylistFiles.Count - 1;
        _taskbarThumbButtons.UpdatePlaybackState(isPlaying, hasPrev, hasNext);
    }
#endif
}
