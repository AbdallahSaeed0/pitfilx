using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;

namespace PitflixPlayer;

/// <summary>
/// Transparent overlay window: custom titlebar (top 40 px) + compact single-row
/// transport controls (bottom 80 px).  Lives in a separate Win32 window above
/// MainWindow to avoid the WPF airspace conflict with the mpv HwndHost child.
/// </summary>
public partial class ControlsWindow : Window
{
    // ── Win32 ─────────────────────────────────────────────────────────────────
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT pt);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct RECT  { public int Left, Top, Right, Bottom; }

    // ── Cached frozen brushes ───────────────────────────────────────────────
    //
    // Each `new SolidColorBrush(...)` allocates a DependencyObject and the
    // Freezable infrastructure that goes with it.  BuildPlaylistPopup
    // previously created ~5 brushes per row × N rows × every open — a
    // 29-episode folder cost 145+ allocations + the corresponding GC churn.
    // Freezing a brush makes it safe to share across threads / call sites
    // with effectively zero runtime cost.  Reuse these for any color we hit
    // more than once.
    private static readonly SolidColorBrush BrushPurple        = MakeFrozen(0x7C, 0x3A, 0xED);
    private static readonly SolidColorBrush BrushPurpleWash    = MakeFrozen(0x2A, 0x1F, 0x40);
    private static readonly SolidColorBrush BrushHoverGray     = MakeFrozen(0x2A, 0x2A, 0x2A);
    private static readonly SolidColorBrush BrushTextGray      = MakeFrozen(0x99, 0x99, 0x99);
    private static readonly SolidColorBrush BrushBorderGray    = MakeFrozen(0x33, 0x33, 0x33);
    private static readonly SolidColorBrush BrushPanelGray     = MakeFrozen(0xCC, 0xCC, 0xCC);
    private static readonly SolidColorBrush BrushThumbBg       = MakeFrozen(0x1A, 0x1A, 0x1A);

    private static SolidColorBrush MakeFrozen(byte r, byte g, byte b)
    {
        var b1 = new SolidColorBrush(Color.FromRgb(r, g, b));
        b1.Freeze();
        return b1;
    }

    // ── IPC client (set by MainWindow after connecting) ──────────────────────
    private MpvIpcClient? _ipc;

    /// <summary>Called by MainWindow once MpvIpcClient has connected.</summary>
    internal void SetIpc(MpvIpcClient ipc) => _ipc = ipc;

    // ── Session state ─────────────────────────────────────────────────────────
    private bool   _isPaused  = false;

    // After an optimistic pause flip, the very next WS push from the backend
    // can arrive BEFORE mpv has processed our IPC set_property — so it carries
    // the *old* pause state, and UpdateFromSession would flip our icon back
    // (the "click pause, nothing happens / flickers / delayed" bug).
    // We stash our intended state here on every optimistic toggle; incoming WS
    // updates whose IsPaused doesn't match are treated as stale and ignored
    // until the backend catches up.  Once the WS state matches our target we
    // know it's confirmed and clear the sentinel so future updates apply.
    private bool? _pendingPauseTarget = null;
    private double _duration  = 0;
    private double _position  = 0;

    // ── Seek state ────────────────────────────────────────────────────────────
    private bool     _isSeeking  = false;
    private double   _seekTarget = 0;
    // After a seek IPC fires, hold the requested target here until the WS-
    // pushed Position catches up to within ~3 s.  The 0/+1/+2 polls after a
    // seek may still carry the pre-seek time-pos (mpv → backend → WS round-
    // trip), and applying those would yank the slider/label backward — the
    // "drag the slider, video jumps but the time label updates a second
    // later" lag the user reported.  Suppressing stale pushes during the
    // window keeps the optimistic value pinned until backend confirms.
    private double?  _pendingSeekTarget;
    private DateTime _pendingSeekUntilUtc;

    // ── Volume drag + throttle ────────────────────────────────────────────────
    private bool     _isVolumeDragging = false;
    private DateTime _lastVolumeSent   = DateTime.MinValue;

    // ── Volume indicator timer (separate from skip-indicator timer) ───────────
    private DispatcherTimer? _volumeTimer;

    // ── Subtitle / audio ─────────────────────────────────────────────────────
    private int _activeSubtitleIndex = 0;  // 0 = Off
    private int _activeAudioIndex    = -1; // -1 = not set

    // ── Playback speed ────────────────────────────────────────────────────────
    private double _currentSpeed = 1.0;
    private static readonly double[] SpeedOptions = { 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0 };

    // ── Auto-hide ─────────────────────────────────────────────────────────────
    private bool   _controlsVisible = true;
    private readonly DispatcherTimer _hideTimer;
    private readonly DispatcherTimer _cursorPollTimer;
    private POINT  _lastCursorPos;
    private IntPtr _ownerHandle = IntPtr.Zero;

    // ── Fade self-heal ──────────────────────────────────────────────────────
    // WPF opacity DoubleAnimations run on the composition clock, which can
    // STALL partway on an AllowsTransparency (layered) window while heavy
    // video is playing — leaving ControlsOverlay/TitlebarOverlay frozen at a
    // partial opacity (the intermittent "translucent control bar" bug, where
    // whatever is behind the whole app shows through the half-painted bar).
    // We record what the controls' opacity SHOULD settle to and by WHEN; the
    // always-running cursor-poll tick then snaps any drifted value back to
    // target once that deadline has passed.  Self-corrects within ~200 ms no
    // matter why the clock stalled.
    private double   _fadeTargetControls = 1.0;
    private DateTime _fadeDeadlineUtc    = DateTime.MinValue;

    // ── Skip indicator ────────────────────────────────────────────────────────
    private DispatcherTimer? _skipTimer;

    // ── Intro/outro skip (Group 3) ────────────────────────────────────────────
    // Unrelated to _skipTimer/SkipIndicator above (the ±seconds seek toast).
    private SkipData? _introOutroSkipData;
    private readonly HashSet<string> _dismissedSkipKinds = new();
    private string? _activeSkipKind;
    private DispatcherTimer? _skipButtonAutoHideTimer;

    // ── Window chrome / maximize (Fix 1 / 5) ─────────────────────────────────
    private bool   _isMaximized  = false;
    private double _normalLeft   = 0, _normalTop    = 0;
    private double _normalWidth  = 1280, _normalHeight = 720;
    private bool   _syncingPosition = false;

    // ── WM_NCHITTEST ─────────────────────────────────────────────────────────
    private const int WM_NCHITTEST  = 0x0084;
    private const int HTTRANSPARENT = -1;

    // ── Maximize/restore icon geometry strings (16×16 coordinate space) ──────
    private const string MaximizeGeometry = "M2,2 H14 V14 H2 Z";
    private const string RestoreGeometry  = "M4,0 H14 V10 H4 Z M0,4 H10 V14 H0 Z";

    // ── Expose state for MainWindow keyboard handler ──────────────────────────
    public double CurrentVolume   => VolumeSlider.Value;
    public double CurrentPosition => _position;
    public double CurrentDuration => _duration;
    public bool   IsMaximized     => _isMaximized;
    /// <summary>The confirmed pause state (updated by WS + local optimistic toggle).</summary>
    public bool   IsPaused        => _isPaused;

    // =========================================================================
    // Construction
    // =========================================================================

    public ControlsWindow()
    {
        InitializeComponent();

        _hideTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        _hideTimer.Tick += (_, _) =>
        {
            if (!_isPaused && !IsCursorOverControls()) HideControls();
        };

        // 200 ms cursor poll = 5 ticks/sec.  150 ms was unnecessarily frequent
        // (controls fade in/out is a 100-300 ms animation; an extra 50 ms of
        // detection latency on motion is imperceptible).  Lower frequency =
        // smaller CPU footprint = smoother video playback under load.
        _cursorPollTimer = new DispatcherTimer
            { Interval = TimeSpan.FromMilliseconds(200) };
        _cursorPollTimer.Tick += OnCursorPoll;

        Loaded += (_, _) =>
        {
            if (Owner != null)
                _ownerHandle = new WindowInteropHelper(Owner).Handle;
            UpdateVolumeLabel();
            _cursorPollTimer.Start();
        };

        // The layered (AllowsTransparency) surface often comes up with the
        // control-bar background NOT yet composited — it reads transparent
        // until the user moves the window, which is exactly what the user
        // reported.  ContentRendered fires once after the first real paint;
        // force the move-equivalent recomposite there (and once more shortly
        // after, since the video-attach/owner-resize that happens right around
        // launch can re-stale the surface).
        ContentRendered += (_, _) =>
        {
            ForceLayeredRepaint();
            Dispatcher.BeginInvoke(new Action(ForceLayeredRepaint),
                                   DispatcherPriority.ApplicationIdle);
            Dispatcher.BeginInvoke(new Action(() => ShowControls(animate: false)),
                                   DispatcherPriority.Render);
        };

        Closed += (_, _) => _cursorPollTimer.Stop();
    }

    /// <summary>
    /// Forces the Win32 layered window to re-present its per-pixel-alpha
    /// surface — the programmatic equivalent of the user nudging the window,
    /// which is what makes the transparent control-bar background snap to its
    /// proper black.
    ///
    /// A zero-move SWP_FRAMECHANGED is NOT enough: with the window rect
    /// unchanged the DWM has no reason to re-blit the layered surface.  Only an
    /// ACTUAL position change triggers the re-present.  So we move the window
    /// 1 px, let it render at the new position (which repaints the surface),
    /// then move it straight back — net-zero displacement, no visible jump.
    /// </summary>
    public void ForceLayeredRepaint()
    {
        // ── Primary: toggle the WINDOW's opacity ──
        // Any change to a layered window's Opacity marks its per-pixel-alpha
        // surface dirty, forcing WPF to re-run UpdateLayeredWindow on the next
        // composite — even if the 0.99 value never visibly lands.  This is the
        // most reliable re-present trigger because, unlike a net-zero move, it
        // can't be coalesced away by the window manager.  0.99 for one frame is
        // imperceptible.
        BeginAnimation(OpacityProperty, null);   // drop any clock holding Opacity
        Opacity = 0.99;
        InvalidateVisual();
        Dispatcher.BeginInvoke(new Action(() => Opacity = 1.0),
                               DispatcherPriority.Render);

        // ── Secondary: an actual 1 px move-and-restore ──
        // Belt-and-suspenders: a real rect change asks the DWM to re-blit too.
        var hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero || !NativeMethods.GetWindowRect(hwnd, out var r)) return;
        const uint flags = NativeMethods.SWP_NOSIZE |
                           NativeMethods.SWP_NOZORDER |
                           NativeMethods.SWP_NOACTIVATE;
        int origLeft = r.Left, origTop = r.Top;
        NativeMethods.SetWindowPos(hwnd, IntPtr.Zero, origLeft, origTop + 1, 0, 0, flags);
        Dispatcher.BeginInvoke(new Action(() =>
            NativeMethods.SetWindowPos(hwnd, IntPtr.Zero, origLeft, origTop, 0, 0, flags)),
            DispatcherPriority.Render);
    }

    // =========================================================================
    // Win32 hit-test hook + source init
    // =========================================================================

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);

        if (Owner != null)
        {
            SyncFromOwner();

            // Window now opens in NORMAL state (Width/Height set on MainWindow
            // XAML, centred via WindowStartupLocation).  Capture the Owner's
            // current windowed bounds as our "restore" target so the very first
            // ToggleMaximize() correctly returns to the centred 1280×720 layout
            // rather than a stale wa.Width*0.8 default that may not match.
            _normalLeft   = Owner.Left;
            _normalTop    = Owner.Top;
            _normalWidth  = Owner.Width;
            _normalHeight = Owner.Height;
            _isMaximized  = false;

            // Keep ControlsWindow geometry in sync whenever Owner moves or resizes
            Owner.LocationChanged += (_, _) => { if (!_syncingPosition) SyncFromOwner(); };
            Owner.SizeChanged     += (_, _) => { if (!_syncingPosition) SyncFromOwner(); };

            // (No reverse this→Owner LocationChanged sync needed — the new
            // drag flow drags MainWindow directly via its HitTestHook, and
            // Owner.LocationChanged → SyncFromOwner above pulls us along.)
            Owner.StateChanged    += (_, _) =>
            {
                if (Owner.WindowState == WindowState.Minimized)
                    WindowState = WindowState.Minimized;
                else
                {
                    WindowState = WindowState.Normal;
                    SyncFromOwner();
                    // A fade-out (HideControls) that was mid-flight at the
                    // moment of minimizing keeps running on its own clock —
                    // WPF animation clocks are time-based, not render-based,
                    // so they keep ticking while the window is minimized and
                    // can land ControlsOverlay/TitlebarOverlay at a partial
                    // opacity by the time we restore.  Force a clean re-show,
                    // instantly (no fade) — animating here would itself show
                    // a brief translucent bar right as the window reappears.
                    ShowControls(animate: false);
                    // …and AGAIN, deferred.  This handler runs mid-transition:
                    // WPF finishes the minimized→restored render AFTER we return,
                    // and on a layered (AllowsTransparency) window that final
                    // pass was clobbering the opacity we just set / failing to
                    // recomposite — leaving the bar stuck translucent.  Re-apply
                    // at Loaded priority so it lands after the window has fully
                    // settled, which is what actually makes it stick opaque.
                    Dispatcher.BeginInvoke(
                        new Action(() =>
                        {
                            if (Owner is not null && Owner.WindowState != WindowState.Minimized)
                            {
                                ShowControls(animate: false);
                                ForceLayeredRepaint();   // re-present after restore
                                // None of the opacity/recomposite fixes above
                                // touch the REAL cause when this is hit: after
                                // minimizing and restoring, the desktop's
                                // previously-focused window (e.g. the IDE) can
                                // legitimately be sitting ABOVE us in z-order —
                                // restoring from Minimized doesn't itself
                                // guarantee foreground.  This is the "control
                                // bar shows the IDE through it" bug, not a
                                // transparency bug.  Force both windows to the
                                // front, same proven pattern used at app launch.
                                Owner.Topmost = true;
                                Owner.Activate();
                                Topmost = true;
                                Activate();
                                _ = Dispatcher.InvokeAsync(async () =>
                                {
                                    await Task.Delay(400).ConfigureAwait(true);
                                    if (Owner is not null) Owner.Topmost = false;
                                    Topmost = false;
                                }, DispatcherPriority.Background);
                            }
                        }),
                        DispatcherPriority.Loaded);
                    if (!_isPaused) { _hideTimer.Stop(); _hideTimer.Start(); }
                }
            };
        }

        if (PresentationSource.FromVisual(this) is HwndSource src)
            src.AddHook(HitTestHook);
    }

    /// <summary>
    /// Public entry point so MainWindow can nudge a re-sync right after
    /// Show() — needed because LocationChanged doesn't fire on the initial
    /// position, leaving ControlsWindow stranded on the wrong monitor in
    /// multi-display setups when Owner starts on a non-primary screen.
    /// </summary>
    public void ForceSyncFromOwner() => SyncFromOwner();

    /// <summary>
    /// True if the playlist popup is open AND the screen-space point falls
    /// inside its content area.  MainWindow's global mouse-wheel hook uses
    /// this to back off when the user is scrolling INSIDE the popup —
    /// otherwise every scroll-tick would change the volume too.
    /// </summary>
    public bool IsScreenPointInPlaylistPopup(Point screen)
    {
        if (!PlaylistPopup.IsOpen) return false;
        if (PlaylistPopup.Child is not FrameworkElement child) return false;
        try
        {
            var local = child.PointFromScreen(screen);
            return local.X >= 0 && local.Y >= 0
                && local.X <= child.ActualWidth
                && local.Y <= child.ActualHeight;
        }
        catch { return false; }
    }

    /// <summary>
    /// Explicitly asserts that ControlsWindow sits above MainWindow in the
    /// Win32 z-order — the bars (and the rest of this window) must ALWAYS
    /// render in front of the video, never behind it.  WPF/Windows normally
    /// keeps an OWNED window above its owner automatically, but that's an
    /// implicit convention, not something this app enforces — and every
    /// "video showing where the bar should be" bug investigated so far
    /// turned out to be something else entirely (geometry, compositing,
    /// focus).  Rather than keep chasing individual causes, this makes the
    /// stacking order itself a hard guarantee: called every time we already
    /// touch geometry (SyncFromOwner), so it's continuously reasserted, not
    /// just set once at startup.
    /// </summary>
    private void EnsureAboveOwner()
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;
        NativeMethods.SetWindowPos(
            hwnd, NativeMethods.HWND_TOP, 0, 0, 0, 0,
            NativeMethods.SWP_NOMOVE | NativeMethods.SWP_NOSIZE | NativeMethods.SWP_NOACTIVATE);
    }

    /// <summary>Reads Owner's Win32 rect and applies it to ControlsWindow.</summary>
    private void SyncFromOwner()
    {
        if (Owner == null || Owner.WindowState == WindowState.Minimized) return;
        _syncingPosition = true;
        try
        {
            if (Owner.WindowState == WindowState.Maximized)
            {
                // Multi-monitor: cover the screen Owner is actually ON, not
                // always the primary.  Querying DWM-extended bounds works here
                // too — for a maximized window it returns the work-area-ish
                // rect of the host monitor (no shadow margin since maximized
                // windows have none).  This fixes "controls on one monitor,
                // video on the other" when MainWindow is maximized on a non-
                // primary display.  Falls back to GetWindowRect if DWM call
                // fails; final fallback is the old primary-screen behaviour.
                var helper = new WindowInteropHelper(Owner);
                int left = 0, top = 0;
                double w = SystemParameters.PrimaryScreenWidth;
                double h = SystemParameters.PrimaryScreenHeight;
                if (NativeMethods.DwmGetWindowAttribute(
                        helper.Handle,
                        NativeMethods.DWMWA_EXTENDED_FRAME_BOUNDS,
                        out var dwmR,
                        System.Runtime.InteropServices.Marshal.SizeOf<NativeMethods.RECT>()) == 0)
                {
                    left = dwmR.Left; top = dwmR.Top;
                    w = dwmR.Right - dwmR.Left;
                    h = dwmR.Bottom - dwmR.Top;
                }
                else if (GetWindowRect(helper.Handle, out var wr))
                {
                    left = wr.Left; top = wr.Top;
                    w = wr.Right - wr.Left;
                    h = wr.Bottom - wr.Top;
                }
                var src2 = PresentationSource.FromVisual(Owner);
                double dx = src2?.CompositionTarget?.TransformFromDevice.M11 ?? 1.0;
                double dy = src2?.CompositionTarget?.TransformFromDevice.M22 ?? 1.0;
                Left   = left * dx;
                Top    = top  * dy;
                Width  = w    * dx;
                Height = h    * dy;
            }
            else
            {
                // Use DWMWA_EXTENDED_FRAME_BOUNDS for the VISIBLE rect — not
                // GetWindowRect, which on WindowStyle=None windows includes
                // ~8 px of invisible DWM shadow margin on every side.  Sizing
                // ControlsWindow to the shadow-inflated rect would make our
                // transparent regions overhang MainWindow and show whatever
                // sits behind on the desktop (the "control bar wider than
                // video" + other-window-bleed-through bug).  DWM bounds give
                // pixel-perfect alignment with what the user sees as the
                // MainWindow.  Falls back to GetWindowRect on the rare case
                // the DWM call fails (returns non-zero HRESULT).
                var helper = new WindowInteropHelper(Owner);
                int left, top, right, bottom;
                if (NativeMethods.DwmGetWindowAttribute(
                        helper.Handle,
                        NativeMethods.DWMWA_EXTENDED_FRAME_BOUNDS,
                        out var dwmR,
                        System.Runtime.InteropServices.Marshal.SizeOf<NativeMethods.RECT>()) == 0)
                {
                    left = dwmR.Left; top = dwmR.Top;
                    right = dwmR.Right; bottom = dwmR.Bottom;
                }
                else if (GetWindowRect(helper.Handle, out var winR))
                {
                    left = winR.Left; top = winR.Top;
                    right = winR.Right; bottom = winR.Bottom;
                }
                else { return; }

                var src2 = PresentationSource.FromVisual(Owner);
                double dx = src2?.CompositionTarget?.TransformFromDevice.M11 ?? 1.0;
                double dy = src2?.CompositionTarget?.TransformFromDevice.M22 ?? 1.0;
                Left   = left          * dx;
                Top    = top           * dy;
                Width  = (right - left) * dx;
                Height = (bottom - top) * dy;
            }
        }
        finally { _syncingPosition = false; }
        EnsureAboveOwner();
    }

    private IntPtr HitTestHook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam,
                                ref bool handled)
    {
        if (msg != WM_NCHITTEST) return IntPtr.Zero;
        int raw    = lParam.ToInt32();
        var screen = new Point((short)(raw & 0xFFFF), (short)((raw >> 16) & 0xFFFF));
        try
        {
            // ── Click-through: outside any UI → fall through to MainWindow ──
            if (!IsScreenPointOverUi(screen))
            {
                handled = true;
                return new IntPtr(HTTRANSPARENT);
            }

            // ── Drag area: fall through to MainWindow ──────────────────────
            //
            // We can't drag this ControlsWindow itself reliably (transparent
            // WPF windows have flaky native-drag behaviour, and the previous
            // attempt fought with the resize border on the top edge — that
            // was the user's "drag just resizes" bug).
            //
            // Instead, make titlebar drag-zone clicks HTTRANSPARENT so they
            // fall through to MainWindow, which installs its OWN HitTestHook
            // returning HTCAPTION for that zone — the OS then performs a
            // clean native drag on MainWindow.  Our existing
            // Owner.LocationChanged → SyncFromOwner pipe keeps us aligned
            // throughout the drag.  Buttons in the titlebar still get
            // HTCLIENT (default) so click handlers fire.
            if (_controlsVisible && IsScreenPointOverTitlebarDragArea(screen))
            {
                handled = true;
                return new IntPtr(HTTRANSPARENT);
            }
        }
        catch { }
        return IntPtr.Zero;
    }

    /// <summary>
    /// True if the point is inside the TitlebarOverlay but NOT over the
    /// right-side chrome buttons — i.e. it's the "drag this window by the
    /// title bar" zone.  Used to decide whether WM_NCHITTEST should answer
    /// HTCAPTION (drag) or HTCLIENT (button click).
    /// </summary>
    private bool IsScreenPointOverTitlebarDragArea(Point screen)
    {
        try
        {
            var lt = TitlebarOverlay.PointFromScreen(screen);
            bool inTitlebar = lt.X >= 0 && lt.Y >= 0
                           && lt.X <= TitlebarOverlay.ActualWidth
                           && lt.Y <= TitlebarOverlay.ActualHeight;
            if (!inTitlebar) return false;

            // Excluded: the right-side button cluster (min/max/close +
            // volume/speed/more indicators).  Anywhere else in the titlebar
            // is fair game for native drag.
            var lb = TitlebarChromeButtons.PointFromScreen(screen);
            bool inButtons = lb.X >= 0 && lb.Y >= 0
                          && lb.X <= TitlebarChromeButtons.ActualWidth
                          && lb.Y <= TitlebarChromeButtons.ActualHeight;
            return !inButtons;
        }
        catch { return false; }
    }

    /// <summary>
    /// True if the given physical-pixel screen point lies over a visible,
    /// interactive part of this overlay (titlebar or transport controls).
    /// Used both by the WM_NCHITTEST click-through hook (so video clicks fall
    /// through to MainWindow) and by MainWindow's global mouse-wheel handler
    /// (so scroll-to-seek/volume only fires over the "video" area — everywhere
    /// ControlsWindow nominally covers but isn't actually showing a control).
    /// </summary>
    public bool IsScreenPointOverUi(Point screen)
    {
        try
        {
            var lc = ControlsOverlay.PointFromScreen(screen);
            bool inControls = lc.X >= 0 && lc.Y >= 0
                           && lc.X <= ControlsOverlay.ActualWidth
                           && lc.Y <= ControlsOverlay.ActualHeight;

            bool inTitlebar = false;
            if (_controlsVisible)
            {
                var lt = TitlebarOverlay.PointFromScreen(screen);
                inTitlebar = lt.X >= 0 && lt.Y >= 0
                          && lt.X <= TitlebarOverlay.ActualWidth
                          && lt.Y <= TitlebarOverlay.ActualHeight;
            }
            return inControls || inTitlebar;
        }
        catch { return false; }
    }

    // =========================================================================
    // Timer control (called by MainWindow)
    // =========================================================================

    public void StartHideTimer()
    {
        GetCursorPos(out _lastCursorPos);
        _hideTimer.Start();
    }

    public void StopHideTimer() => _hideTimer.Stop();

    // =========================================================================
    // Session updates (called from WebSocket loop via Dispatcher)
    // =========================================================================

    public void UpdateFromSession(PlayerSession session)
    {
        _duration = session.Duration;
        if (session.Duration > 0) _lastKnownDuration = session.Duration;

        // ── Position update gated by two suppression states ──
        //   • _isSeeking      : user is currently dragging the slider; never
        //                       let WS overwrite while their finger is down
        //   • _pendingSeekTarget: a recent seek IPC was sent but the WS
        //                       hasn't confirmed yet — ignore pushes that
        //                       still carry the pre-seek position, but once
        //                       the WS catches up to within ~3 s of target,
        //                       clear the suppression and resume normal sync.
        bool applyPos = !_isSeeking;
        if (applyPos && _pendingSeekTarget is double seekTarget)
        {
            if (DateTime.UtcNow > _pendingSeekUntilUtc ||
                Math.Abs(session.Position - seekTarget) <= 3.0)
            {
                // backend has caught up — release the optimistic pin
                _pendingSeekTarget = null;
            }
            else
            {
                applyPos = false;     // still stale, keep showing target
            }
        }

        if (applyPos)
        {
            _position = session.Position;
            TimelineSlider.Value = session.Duration > 0
                ? session.Position / session.Duration * 100.0
                : 0;
            PositionLabel.Text = FormatTime(session.Position);
        }

        DurationLabel.Text = FormatTime(session.Duration);

        // Stale-update suppression: if we recently flipped the pause state
        // optimistically, the very next WS push may carry the pre-flip state
        // (backend hasn't observed mpv's pause-event yet).  Honour the WS
        // only once it agrees with what we asked for; until then keep our
        // optimistic icon so the user doesn't see a flicker / "didn't work".
        bool applyPause = true;
        if (_pendingPauseTarget is bool target)
        {
            if (session.IsPaused == target)
                _pendingPauseTarget = null;        // backend caught up — resume normal follow
            else
                applyPause = false;                // still stale, ignore this WS value
        }
        if (applyPause)
        {
            _isPaused            = session.IsPaused;
            PauseResumeIcon.Text = _isPaused ? "▶" : "⏸";
        }

        UpdateProgressBar();
        EvaluateIntroOutroSkip();

        if (_isPaused)
        {
            _hideTimer.Stop();
            if (!_controlsVisible) ShowControls();
        }
    }

    public void SetTitle(string title)
    {
        TitlebarTitleLabel.Text = title;
        // Keep the resume overlay's title in sync if the metadata-driven title
        // resolves while the overlay is still showing.
        if (ResumeOverlay.Visibility == Visibility.Visible)
            ResumeTitleLabel.Text = title;
    }

    // ── Title quick-info popup ──────────────────────────────────────────────────
    private string? _quickInfoTitle;
    private string? _quickInfoMeta;
    private string? _quickInfoOverview;

    /// <summary>Feeds the title quick-info popup (synopsis / rating / air date).</summary>
    public void SetQuickInfo(string title, string? subtitle, string? meta, string? overview)
    {
        _quickInfoTitle = title;
        string composed = subtitle ?? "";
        if (!string.IsNullOrWhiteSpace(meta))
            composed = string.IsNullOrWhiteSpace(composed) ? meta : $"{composed}   ·   {meta}";
        _quickInfoMeta = string.IsNullOrWhiteSpace(composed) ? null : composed;
        _quickInfoOverview = overview;
    }

    private void OnTitleInfoClick(object sender, RoutedEventArgs e)
    {
        QuickInfoTitle.Text = string.IsNullOrWhiteSpace(_quickInfoTitle)
            ? TitlebarTitleLabel.Text : _quickInfoTitle;
        QuickInfoMeta.Text = _quickInfoMeta ?? "";
        QuickInfoMeta.Visibility = string.IsNullOrWhiteSpace(_quickInfoMeta)
            ? Visibility.Collapsed : Visibility.Visible;
        QuickInfoOverview.Text = string.IsNullOrWhiteSpace(_quickInfoOverview)
            ? "No description available." : _quickInfoOverview;
        QuickInfoPopup.IsOpen = !QuickInfoPopup.IsOpen;
    }

    // ── Loading overlay ─────────────────────────────────────────────────────────
    public bool IsLoadingOverlayVisible => LoadingOverlay.Visibility == Visibility.Visible;

    public void ShowLoadingOverlay(string? title)
    {
        LoadingTitleLabel.Text = title ?? "";
        LoadingOverlay.Visibility = Visibility.Visible;
    }

    public void HideLoadingOverlay() => LoadingOverlay.Visibility = Visibility.Collapsed;

    // ── Resume overlay ("Pick up where you left off") ───────────────────────────
    private Action? _onResumeChosen;
    private Action? _onStartOverChosen;
    private Action? _onResumeCancel;

    public bool IsResumeOverlayVisible => ResumeOverlay.Visibility == Visibility.Visible;

    /// <summary>
    /// Shows the resume choice overlay. mpv is expected to be PAUSED and already
    /// seeked to <paramref name="position"/> (via --start) when this is called;
    /// the chosen action decides whether to unpause as-is or seek to 0 first.
    /// </summary>
    public void ShowResumeOverlay(double position, double duration,
        Action onResume, Action onStartOver, Action onCancel)
    {
        _onResumeChosen   = onResume;
        _onStartOverChosen = onStartOver;
        _onResumeCancel   = onCancel;

        ResumeTitleLabel.Text = TitlebarTitleLabel.Text;

        double pct = duration > 0 ? Math.Clamp(position / duration, 0.0, 1.0) : 0.0;
        int pctInt = (int)Math.Round(pct * 100);
        ResumeWatchedLabel.Text = duration > 0
            ? $"{FormatTime(position)} of {FormatTime(duration)} watched ({pctInt}%)."
            : $"{FormatTime(position)} watched.";
        ResumeBtnText.Text = $"Resume from {FormatTime(position)}";

        ResumeProgressFilledCol.Width = new GridLength(pct, GridUnitType.Star);
        ResumeProgressEmptyCol.Width  = new GridLength(1.0 - pct, GridUnitType.Star);

        ResumeOverlay.Visibility = Visibility.Visible;
    }

    public void HideResumeOverlay() => ResumeOverlay.Visibility = Visibility.Collapsed;

    private void OnResumeClick(object sender, RoutedEventArgs e)
    {
        HideResumeOverlay();
        _onResumeChosen?.Invoke();
    }

    private void OnStartOverClick(object sender, RoutedEventArgs e)
    {
        HideResumeOverlay();
        _onStartOverChosen?.Invoke();
    }

    private void OnResumeCancelClick(object sender, RoutedEventArgs e)
    {
        HideResumeOverlay();
        _onResumeCancel?.Invoke();
    }

    /// <summary>
    /// Show/hide the prev/next playlist nav buttons.  Called by MainWindow
    /// after the folder-playlist build completes — if the session is an
    /// episode and we successfully appended sibling video files to mpv's
    /// playlist, we show the buttons; for movies (or solo files in their
    /// folder) we leave them hidden since they'd be no-ops.
    /// </summary>
    public void SetPlaylistNavVisible(bool visible)
    {
        var v = visible ? Visibility.Visible : Visibility.Collapsed;
        PrevBtn.Visibility = v;
        NextBtn.Visibility = v;
    }

    // ── Playlist data (populated by MainWindow.BuildFolderPlaylistAsync) ────
    //
    // Cached locally so the Playlist popup can render instantly without
    // doing its own mpv IPC query (which would also need response parsing
    // we don't currently do).  Files are stored in the *final* playlist
    // order — same order mpv has after playlist-clear + appends + move —
    // so the index in this list matches mpv's playlist-pos exactly.  That
    // way, click row N → set_property playlist-pos N just works.
    private List<string> _playlistFiles = new();
    private string?      _currentPlaylistFile;

    /// <summary>
    /// Called by MainWindow once mpv's playlist is fully built.  files MUST
    /// be in the same order as mpv's playlist (folder-sorted with current
    /// at currentIdx).  After this returns, the Playlist popup is wired and
    /// the ⋮ menu's "Playlist" row is functional.
    /// </summary>
    public void SetPlaylist(List<string> files, string currentFile)
    {
        _playlistFiles       = files;
        _currentPlaylistFile = currentFile;
    }

    /// <summary>
    /// Tracks the currently-playing file as mpv moves through the playlist
    /// (via WS state pushes from the backend).  Re-render highlight on each
    /// change so the popup stays in sync if it's already open.  Called by
    /// MainWindow when the WS-pushed session.FilePath changes.
    /// </summary>
    public void UpdateCurrentPlaylistFile(string newFile)
    {
        if (string.Equals(_currentPlaylistFile, newFile, StringComparison.OrdinalIgnoreCase))
            return;
        _currentPlaylistFile = newFile;
        if (PlaylistPopup.IsOpen) BuildPlaylistPopup();
    }

    private void ShowPlaylistPopup(double anchorX, double anchorY)
    {
        BuildPlaylistPopup();
        PlaylistPopup.PlacementTarget   = this;
        PlaylistPopup.HorizontalOffset  = anchorX;
        PlaylistPopup.VerticalOffset    = anchorY;
        PlaylistPopup.IsOpen            = true;
    }

    private void BuildPlaylistPopup()
    {
        PlaylistItems.Children.Clear();

        if (_playlistFiles.Count == 0)
        {
            PlaylistItems.Children.Add(new TextBlock
            {
                Text       = "No playlist available",
                Foreground = Brushes.Gray,
                FontFamily = new FontFamily("Segoe UI"),
                FontSize   = 13,
                Margin     = new Thickness(12, 10, 12, 10),
            });
            return;
        }

        // Active index for highlighting.  Falls back to -1 (no row highlighted)
        // if we haven't received a current-file update yet.
        int activeIdx = _currentPlaylistFile is null ? -1
            : _playlistFiles.FindIndex(f =>
                string.Equals(f, _currentPlaylistFile, StringComparison.OrdinalIgnoreCase));

        for (int i = 0; i < _playlistFiles.Count; i++)
        {
            int capturedIdx  = i;                                  // for click closure
            bool isActive    = i == activeIdx;
            string fullPath  = _playlistFiles[i];
            string filename  = System.IO.Path.GetFileName(fullPath);

            // ── Thumbnail (96×54, 16:9) — Shell-extracted off the UI thread.
            // First-time files take ~100 ms; subsequent renders hit the
            // Windows thumbcache and return effectively instantly.
            var thumbImage = new System.Windows.Controls.Image
            {
                Width             = 96,
                Height            = 54,
                Stretch           = System.Windows.Media.Stretch.UniformToFill,
                VerticalAlignment = VerticalAlignment.Center,
            };
            var thumbBorder = new Border
            {
                Child           = thumbImage,
                Background      = BrushThumbBg,
                BorderBrush     = BrushBorderGray,
                BorderThickness = new Thickness(1),
                CornerRadius    = new CornerRadius(3),
                Width           = 98,
                Height          = 56,
                ClipToBounds    = true,
                VerticalAlignment = VerticalAlignment.Center,
                Margin          = new Thickness(0, 0, 10, 0),
            };
            string pathForLoader = fullPath;
            _ = System.Threading.Tasks.Task.Run(() =>
            {
                var img = ShellThumbnail.Get(pathForLoader, 256);
                if (img is null) return;
                _ = Dispatcher.InvokeAsync(() => thumbImage.Source = img);
            });

            var indexLabel = new TextBlock
            {
                Text              = $"{i + 1}",
                Foreground        = BrushTextGray,
                FontFamily        = new FontFamily("Segoe UI"),
                FontSize          = 11,
                VerticalAlignment = VerticalAlignment.Center,
                Width             = 24,
                TextAlignment     = TextAlignment.Right,
                Margin            = new Thickness(0, 0, 8, 0),
            };
            var nameLabel = new TextBlock
            {
                Text              = filename,
                Foreground        = isActive
                    ? BrushPurple   // purple = current
                    : Brushes.White,
                FontFamily        = new FontFamily("Segoe UI"),
                FontSize          = 13,
                FontWeight        = isActive ? FontWeights.SemiBold : FontWeights.Normal,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming      = TextTrimming.CharacterEllipsis,
            };
            var marker = new TextBlock
            {
                Text              = isActive ? "▶" : "",
                Foreground        = BrushPurple,
                FontSize          = 10,
                VerticalAlignment = VerticalAlignment.Center,
                Width             = 14,
                Margin            = new Thickness(0, 0, 4, 0),
            };

            var stack = new StackPanel { Orientation = Orientation.Horizontal };
            stack.Children.Add(marker);
            stack.Children.Add(indexLabel);
            stack.Children.Add(thumbBorder);
            stack.Children.Add(nameLabel);

            var row = new Border
            {
                Child      = stack,
                Background = isActive
                    ? BrushPurpleWash   // subtle purple wash
                    : Brushes.Transparent,
                Cursor     = Cursors.Hand,
                Padding    = new Thickness(8, 6, 8, 6),
                CornerRadius = new CornerRadius(4),
                Margin     = new Thickness(0, 1, 0, 1),
            };
            row.MouseEnter += (_, _) =>
            {
                if (!isActive) row.Background = BrushHoverGray;
            };
            row.MouseLeave += (_, _) =>
            {
                row.Background = isActive
                    ? BrushPurpleWash
                    : Brushes.Transparent;
            };
            row.MouseLeftButtonDown += async (_, e) =>
            {
                // Use MouseLeftButtonDown rather than Up so the click fires
                // even if WPF's popup focus-management eats the matching Up
                // event (that was likely what kept "click doesn't start" from
                // working — Up never reached this handler).
                e.Handled = true;
                if (!_playlistPinned) PlaylistPopup.IsOpen = false;

                App.Log($"Playlist: jumping to index {capturedIdx} (ipc={(_ipc != null)})");
                // Free the disk: tear down ALL thumbnail work (warm mpv +
                // ffmpeg) so mpv can load the target file without HDD
                // contention.  It re-creates itself once the file settles.
                SuspendThumbServer();
                var ipc = _ipc;
                if (ipc is null) return;
                // Send the three commands SEQUENTIALLY (awaited) so they reach
                // mpv in a deterministic order.  Fire-and-forget previously let
                // them race for the IPC write-lock, so `pause false` /
                // `start none` could land before or after the jump
                // unpredictably.  Order: clear `start` (so the new file begins
                // at 0, not the previous file's resume offset) → jump → unpause.
                await ipc.SendAsync("set_property", "start", "none").ConfigureAwait(true);
                await ipc.SendAsync("playlist-play-index", capturedIdx).ConfigureAwait(true);
                await ipc.SendAsync("set_property", "pause", false).ConfigureAwait(true);
            };

            PlaylistItems.Children.Add(row);
        }
    }

    // ── Playlist popup: pin + close handlers ─────────────────────────────────

    private bool _playlistPinned = false;

    private void OnPlaylistPinClick(object sender, RoutedEventArgs e)
    {
        _playlistPinned = !_playlistPinned;
        // StaysOpen=true keeps the popup visible regardless of focus loss
        // (clicking elsewhere in the player won't dismiss it).
        PlaylistPopup.StaysOpen = _playlistPinned;
        PlaylistPinIcon.Text    = _playlistPinned ? "📍" : "📌";
        PlaylistPinBtn.ToolTip  = _playlistPinned
            ? "Unpin (auto-close on focus loss)"
            : "Pin (keep playlist open)";
    }

    private void OnPlaylistCloseClick(object sender, RoutedEventArgs e)
        => PlaylistPopup.IsOpen = false;

    // ── Playlist popup drag ──────────────────────────────────────────────────
    //
    // WPF Popups don't have built-in window-drag like a Window does, but
    // they DO expose HorizontalOffset / VerticalOffset that we can update
    // live.  Capture the cursor on MouseLeftButtonDown, track delta on
    // MouseMove, release on MouseLeftButtonUp.  The "≡" grip glyph in the
    // header signals the affordance; the SizeAll cursor reinforces it.
    private bool   _playlistDragging;
    private Point  _playlistDragStartScreen;
    private double _playlistDragStartX;
    private double _playlistDragStartY;

    private void OnPlaylistHeaderMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.LeftButton != MouseButtonState.Pressed) return;
        _playlistDragging        = true;
        _playlistDragStartScreen = PointToScreenViaWin32();
        _playlistDragStartX      = PlaylistPopup.HorizontalOffset;
        _playlistDragStartY      = PlaylistPopup.VerticalOffset;
        if (sender is FrameworkElement fe) fe.CaptureMouse();
    }

    private void OnPlaylistHeaderMouseMove(object sender, MouseEventArgs e)
    {
        if (!_playlistDragging) return;
        var now = PointToScreenViaWin32();
        PlaylistPopup.HorizontalOffset = _playlistDragStartX + (now.X - _playlistDragStartScreen.X);
        PlaylistPopup.VerticalOffset   = _playlistDragStartY + (now.Y - _playlistDragStartScreen.Y);
    }

    private void OnPlaylistHeaderMouseUp(object sender, MouseButtonEventArgs e)
    {
        if (!_playlistDragging) return;
        _playlistDragging = false;
        if (sender is FrameworkElement fe) fe.ReleaseMouseCapture();
    }

    /// <summary>
    /// Returns the current cursor screen position in DIPs.  Uses Win32
    /// GetCursorPos rather than Mouse.GetPosition so the values match the
    /// coordinate space that Popup.HorizontalOffset / VerticalOffset use
    /// (screen-space, in DIPs).
    /// </summary>
    private static Point PointToScreenViaWin32()
    {
        GetCursorPos(out var p);
        return new Point(p.X, p.Y);
    }

    // =========================================================================
    // Helpers exposed to MainWindow keyboard handler
    // =========================================================================

    public void OptimisticTogglePause()
    {
        // IPC is fire-and-forget to mpv's own pipe — round-trip is < 50 ms.
        // Toggle the local state immediately and mark this as our pending
        // target so UpdateFromSession ignores stale WS pushes that still
        // carry the pre-flip state until the backend catches up.
        _isPaused            = !_isPaused;
        _pendingPauseTarget  = _isPaused;
        PauseResumeIcon.Text = _isPaused ? "▶" : "⏸";

        if (_isPaused) { _hideTimer.Stop(); ShowControls(); }
        else           { _hideTimer.Stop(); _hideTimer.Start(); }
    }

    public void SetVolume(double v)
    {
        // Volume range 0-200: 100 = 100% (unity), 200 = 200% (amplified).
        VolumeSlider.Value = Math.Clamp(v, 0, 200);
        // VolumeSlider.ValueChanged → OnVolumeChanged → IPC send
    }

    // =========================================================================
    // Auto-hide (Fix 4)
    // =========================================================================

    private void OnCursorPoll(object? sender, EventArgs e)
    {
        // ── Fade self-heal (runs EVERY tick, before any early-return) ──
        // If a fade's time budget has elapsed but the overlay opacity hasn't
        // actually reached its target, the composition clock stalled (common
        // on this layered transparent window during heavy playback) — snap the
        // value home so the bar can't get stuck translucent.  Kept above the
        // IsCursorInsideOwner gate so it heals even when the cursor is parked
        // outside the window.
        HealStalledFade();
        // Same self-heal philosophy, for z-order: re-assert ControlsWindow is
        // above MainWindow every tick (cheap no-op when it already is), so
        // the bars can't end up rendering behind the video even if something
        // outside our control momentarily disrupts the stacking order.
        EnsureAboveOwner();

        GetCursorPos(out var current);
        bool moved = current.X != _lastCursorPos.X || current.Y != _lastCursorPos.Y;
        _lastCursorPos = current;

        if (!IsCursorInsideOwner()) return; // outside window → do nothing

        if (moved)
        {
            if (!_controlsVisible) ShowControls();
            _hideTimer.Stop();
            if (!_isPaused) _hideTimer.Start();
        }
    }

    /// <summary>
    /// Safety net for stalled opacity fades on the layered transparent window.
    /// Once a fade's deadline has passed, the overlays MUST be sitting at
    /// <see cref="_fadeTargetControls"/> (and the thin progress strip at its
    /// inverse).  If they've drifted — the composition clock stalled mid-fade —
    /// clear the animation and hard-set the final values so nothing stays stuck
    /// translucent.  Cheap: only acts when there's an actual mismatch.
    /// </summary>
    private void HealStalledFade()
    {
        if (DateTime.UtcNow < _fadeDeadlineUtc) return;   // fade still legitimately in progress

        double target = _fadeTargetControls;
        if (Math.Abs(ControlsOverlay.Opacity - target) < 0.001
            && Math.Abs(TitlebarOverlay.Opacity - target) < 0.001)
            return;                                       // already settled — nothing to do

        ControlsOverlay.BeginAnimation(OpacityProperty, null);
        TitlebarOverlay.BeginAnimation(OpacityProperty, null);
        ProgressBarStrip.BeginAnimation(OpacityProperty, null);
        ControlsOverlay.Opacity  = target;
        TitlebarOverlay.Opacity  = target;
        // Progress strip is the inverse: shown only when controls are hidden.
        ProgressBarStrip.Opacity = 1.0 - target;
    }

    private bool IsCursorInsideOwner()
    {
        if (_ownerHandle == IntPtr.Zero) return true;
        GetCursorPos(out var pt);
        if (!GetWindowRect(_ownerHandle, out var r)) return false;
        return pt.X >= r.Left && pt.X <= r.Right
            && pt.Y >= r.Top  && pt.Y <= r.Bottom;
    }

    private bool IsCursorOverControls()
    {
        try
        {
            GetCursorPos(out var pt);
            var local = ControlsOverlay.PointFromScreen(new Point(pt.X, pt.Y));
            return local.X >= 0 && local.Y >= 0
                && local.X <= ControlsOverlay.ActualWidth
                && local.Y <= ControlsOverlay.ActualHeight;
        }
        catch { return false; }
    }

    internal void ShowControls(bool animate = true)
    {
        _controlsVisible = true;
        // Target = fully opaque; record the deadline so the self-heal poll can
        // rescue a stalled fade (see _fadeTargetControls field comment).
        _fadeTargetControls = 1.0;
        _fadeDeadlineUtc    = DateTime.UtcNow.AddMilliseconds(animate ? 140 : 0);
        if (animate)
        {
            var fadeIn = new DoubleAnimation(1.0, TimeSpan.FromMilliseconds(100));
            ControlsOverlay.BeginAnimation(OpacityProperty, fadeIn);
            TitlebarOverlay.BeginAnimation(OpacityProperty, fadeIn);
            // Hide the thin progress bar while full controls are visible
            var hideBar = new DoubleAnimation(0.0, TimeSpan.FromMilliseconds(100));
            ProgressBarStrip.BeginAnimation(OpacityProperty, hideBar);
        }
        else
        {
            // Snap instantly — no fade.  Used right after restoring from
            // Minimized: a 100 ms fade-in here is exactly the "translucent
            // bar over the video" glitch the user is seeing, since the
            // overlay briefly renders at less than full opacity while the
            // animation plays right as the window becomes visible again.
            ControlsOverlay.BeginAnimation(OpacityProperty, null);
            TitlebarOverlay.BeginAnimation(OpacityProperty, null);
            ProgressBarStrip.BeginAnimation(OpacityProperty, null);
            ControlsOverlay.Opacity = 1.0;
            TitlebarOverlay.Opacity = 1.0;
            ProgressBarStrip.Opacity = 0.0;
            // Nudge the layered (AllowsTransparency) window to recomposite.
            // After a minimize→restore the per-pixel alpha surface can keep
            // showing the stale (translucent) frame even though the element
            // opacity is now 1.0; forcing a re-render refreshes it.
            ControlsOverlay.InvalidateVisual();
            TitlebarOverlay.InvalidateVisual();
        }
    }

    private void HideControls()
    {
        _controlsVisible = false;
        _fadeTargetControls = 0.0;
        _fadeDeadlineUtc    = DateTime.UtcNow.AddMilliseconds(440);
        var fadeOut = new DoubleAnimation(0.0, TimeSpan.FromMilliseconds(400));
        ControlsOverlay.BeginAnimation(OpacityProperty, fadeOut);
        TitlebarOverlay.BeginAnimation(OpacityProperty, fadeOut);
        // Show the thin progress bar when controls fade out
        var showBar = new DoubleAnimation(1.0, TimeSpan.FromMilliseconds(400));
        ProgressBarStrip.BeginAnimation(OpacityProperty, showBar);
    }

    // =========================================================================
    // Progress bar (Fix 5)
    // =========================================================================

    private void UpdateProgressBar()
    {
        if (ProgressFill == null || ProgressBarStrip == null) return;
        double w = ProgressBarStrip.ActualWidth;
        if (w < 1 || _duration <= 0) { ProgressFill.Width = 0; return; }
        ProgressFill.Width = Math.Clamp(_position / _duration, 0, 1) * w;
    }

    // =========================================================================
    // Skip indicator (Fix 2 / Fix 3)
    // =========================================================================

    public void ShowSkipIndicator(int seconds)
    {
        SkipLabel.Text = seconds >= 0 ? $"+{seconds}s" : $"{seconds}s";
        SkipIndicator.BeginAnimation(OpacityProperty, null);
        SkipIndicator.Opacity = 1.0;

        _skipTimer?.Stop();
        _skipTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(800) };
        _skipTimer.Tick += (_, _) =>
        {
            _skipTimer!.Stop();
            var fade = new DoubleAnimation(0.0, TimeSpan.FromMilliseconds(300));
            SkipIndicator.BeginAnimation(OpacityProperty, fade);
        };
        _skipTimer.Start();
    }

    // ── Audio delay indicator (FIX 6) ────────────────────────────────────────
    //
    // Mirrors the volume side-bar pattern: pops in for 1.5 s, fades out
    // 300 ms.  Fill bar centres on zero — extends left/right by amount of
    // delay (clamped to ±2.0 s for the visual; mpv accepts any value).
    private DispatcherTimer? _audioDelayTimer;

    public void ShowAudioDelayIndicator(double delaySec)
    {
        AudioDelayLabel.Text = (delaySec >= 0 ? "+" : "")
                             + delaySec.ToString("F1") + "s";

        // Bar: 120 px wide total, centred zero point.  Each side = 60 px.
        // Cap visual at ±2 s — beyond that the bar saturates.
        const double maxBar = 60.0;
        const double maxSec = 2.0;
        double frac    = Math.Clamp(Math.Abs(delaySec) / maxSec, 0, 1);
        double fillPx  = frac * maxBar;
        AudioDelayFill.Width = fillPx;
        // Re-anchor: positive delay extends right from centre, negative left.
        AudioDelayFill.HorizontalAlignment = delaySec >= 0
            ? HorizontalAlignment.Left
            : HorizontalAlignment.Right;
        AudioDelayFill.Margin = delaySec >= 0
            ? new Thickness(60, 0, 0, 0)
            : new Thickness(0, 0, 60, 0);

        AudioDelayPanel.BeginAnimation(OpacityProperty, null);
        AudioDelayPanel.Opacity = 1.0;
        _audioDelayTimer?.Stop();
        _audioDelayTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1500) };
        _audioDelayTimer.Tick += (_, _) =>
        {
            _audioDelayTimer!.Stop();
            AudioDelayPanel.BeginAnimation(OpacityProperty,
                new DoubleAnimation(0.0, TimeSpan.FromMilliseconds(300)));
        };
        _audioDelayTimer.Start();
    }

    // ── Timeline hover tooltip (FIX 2: thumbnail/time preview) ───────────────
    //
    // When the cursor hovers over the seek slider, we follow it with a small
    // floating tooltip that shows the position the slider would seek to if
    // the user clicked there.  Just the time for now; the thumbnail-preview
    // version of this would extract an mpv frame at that timestamp and
    // display it in the tooltip — same Border, just add an Image above the
    // time label.

    private void OnTimelineHoverEnter(object sender, MouseEventArgs e)
    {
        if (_duration <= 0) return;
        TimelineHoverTip.Visibility = Visibility.Visible;
        UpdateTimelineHoverPosition(e);
    }

    private void OnTimelineHoverMove(object sender, MouseEventArgs e)
    {
        if (_duration <= 0 || TimelineHoverTip.Visibility != Visibility.Visible) return;
        UpdateTimelineHoverPosition(e);
    }

    private void OnTimelineHoverLeave(object sender, MouseEventArgs e)
    {
        TimelineHoverTip.Visibility = Visibility.Collapsed;
        // Reset the thumb so the next hover doesn't briefly show the OLD
        // frame from a different timestamp until the new one loads.
        TimelineHoverThumbBorder.Visibility = Visibility.Collapsed;
        TimelineHoverThumb.Source = null;
    }

    // Throttle thumbnail polling so we don't try to load the cached file
    // on every single MouseMove event — once every 120 ms is more than
    // enough to feel responsive.
    private DateTime _lastTimelineThumbPoll = DateTime.MinValue;
    private string?   _currentSessionFilePath;

    private double _lastKnownDuration;

    /// <summary>Set by MainWindow whenever the playing file changes.  Just
    /// notes it as the background thumbnail worker's current target — a cheap,
    /// non-blocking call that does NO disk or process work on the UI thread
    /// (the old per-file ThumbServer did, which froze the controls on HDD
    /// media during rapid navigation).</summary>
    public void SetSessionFilePath(string? path)
    {
        if (string.Equals(_currentSessionFilePath, path, StringComparison.OrdinalIgnoreCase))
            return;
        _currentSessionFilePath = path;
        ThumbWorker.NoteCurrentFile(path, _lastKnownDuration);
    }

    /// <summary>No-op retained for call-site compatibility.  The thumbnail
    /// worker is app-lifetime and decoupled from the session, so there is
    /// nothing per-session to suspend on navigation anymore — navigation does
    /// zero thumbnail work, which is the whole point of the redesign.</summary>
    public void SuspendThumbServer() { }

    /// <summary>No-op retained for call-site compatibility (see above).</summary>
    public void DisposeThumbServer()
    {
        _currentSessionFilePath = null;
    }

    /// <summary>No-op retained for call-site compatibility.  Navigation no
    /// longer does any thumbnail work, so there is nothing to abort.</summary>
    public void AbortThumbBulk() { }

    protected override void OnClosed(EventArgs e)
    {
        base.OnClosed(e);
    }

    private void UpdateTimelineHoverPosition(MouseEventArgs e)
    {
        var mouseLocal = e.GetPosition(TimelineSlider);
        double width   = Math.Max(1, TimelineSlider.ActualWidth);
        double ratio   = Math.Clamp(mouseLocal.X / width, 0, 1);
        double seekSec = ratio * _duration;

        TimelineHoverLabel.Text = FormatTime(seekSec);

        // Show the nearest cached frame for this position.  Pure disk read
        // (no process work) — the background ThumbWorker fills the cache once
        // per file.  Lightly throttled so we don't re-read the cache on every
        // MouseMove.  If the file hasn't been scanned yet the preview is just
        // hidden (time label still shows).
        if ((DateTime.UtcNow - _lastTimelineThumbPoll).TotalMilliseconds > 25)
        {
            _lastTimelineThumbPoll = DateTime.UtcNow;
            var img = ThumbWorker.TryGetFrameNear(_currentSessionFilePath, seekSec);
            if (img is not null)
            {
                TimelineHoverThumb.Source = img;
                TimelineHoverThumbBorder.Visibility = Visibility.Visible;
            }
        }

        // Position the tooltip ABOVE the timeline, horizontally tracking the
        // cursor.  Translate the local cursor X up into ControlsWindow root
        // coordinates so HorizontalAlignment=Left + Margin can place it.
        try
        {
            var sliderRoot = TimelineSlider.TranslatePoint(new Point(0, 0), this);
            double tipLeft = sliderRoot.X + mouseLocal.X - TimelineHoverTip.ActualWidth / 2;
            // Clamp to stay on-screen
            double maxLeft = ActualWidth - TimelineHoverTip.ActualWidth - 4;
            tipLeft = Math.Max(4, Math.Min(maxLeft, tipLeft));
            double tipBottom = ActualHeight - sliderRoot.Y + 6;   // 6 px gap above slider
            TimelineHoverTip.Margin = new Thickness(tipLeft, 0, 0, tipBottom);
        }
        catch { }
    }

    // ── Keyboard shortcuts help overlay (H) ──────────────────────────────────
    public bool IsShortcutsHelpVisible { get; private set; }

    public void ToggleShortcutsHelp()
    {
        if (IsShortcutsHelpVisible)
        {
            IsShortcutsHelpVisible = false;
            var fade = new DoubleAnimation(0.0, TimeSpan.FromMilliseconds(200));
            fade.Completed += (_, _) =>
            {
                if (!IsShortcutsHelpVisible) ShortcutsOverlay.Visibility = Visibility.Collapsed;
            };
            ShortcutsOverlay.BeginAnimation(OpacityProperty, fade);
        }
        else
        {
            IsShortcutsHelpVisible = true;
            ShortcutsOverlay.Visibility = Visibility.Visible;
            ShortcutsOverlay.BeginAnimation(OpacityProperty,
                new DoubleAnimation(1.0, TimeSpan.FromMilliseconds(200)));
        }
    }

    // ── Toast overlay (FIX 7 — screenshot, future general messages) ──────────
    private DispatcherTimer? _toastTimer;

    public void ShowToastOverlay(string text, int holdMs = 1500)
    {
        ToastLabel.Text = text;
        ToastOverlay.BeginAnimation(OpacityProperty, null);
        ToastOverlay.Opacity = 1.0;
        _toastTimer?.Stop();
        _toastTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(holdMs) };
        _toastTimer.Tick += (_, _) =>
        {
            _toastTimer!.Stop();
            ToastOverlay.BeginAnimation(OpacityProperty,
                new DoubleAnimation(0.0, TimeSpan.FromMilliseconds(300)));
        };
        _toastTimer.Start();
    }

    // =========================================================================
    // Transport
    // =========================================================================

    private void OnPauseResumeClick(object sender, RoutedEventArgs e)
    {
        OptimisticTogglePause();
        // After the optimistic toggle _isPaused is already flipped; send the new state.
        _ = _ipc?.SendAsync("set_property", "pause", _isPaused);
    }

    private async void OnPrevClick(object sender, RoutedEventArgs e)
    {
        SuspendThumbServer();        // free the disk for the file load
        var ipc = _ipc;
        if (ipc is null) return;
        // Same pattern as the playlist popup: clear `start` so this previous
        // episode begins at 00:00 rather than inheriting the current file's
        // --start=<userResumePos>.  See the long-form note in MainWindow.
        await ipc.SendAsync("set_property", "start", "none").ConfigureAwait(true);
        await ipc.SendAsync("playlist-prev").ConfigureAwait(true);
        await ipc.SendAsync("set_property", "pause", false).ConfigureAwait(true);
    }

    private async void OnNextClick(object sender, RoutedEventArgs e)
    {
        SuspendThumbServer();        // free the disk for the file load
        var ipc = _ipc;
        if (ipc is null) return;
        await ipc.SendAsync("set_property", "start", "none").ConfigureAwait(true);
        await ipc.SendAsync("playlist-next").ConfigureAwait(true);
        await ipc.SendAsync("set_property", "pause", false).ConfigureAwait(true);
    }

    // =========================================================================
    // Seek — mouse-down/move/up, no CaptureMouse (Fix 2)
    // =========================================================================

    private void OnSeekMouseDown(object sender, MouseButtonEventArgs e)
    {
        _isSeeking = true;
        UpdateSeekFromMouseX(e.GetPosition(TimelineSlider).X);
        e.Handled = true;
    }

    private void OnSeekMouseMove(object sender, MouseEventArgs e)
    {
        // Track drag only while left button stays pressed (no mouse capture needed)
        if (!_isSeeking || e.LeftButton != MouseButtonState.Pressed) return;
        UpdateSeekFromMouseX(e.GetPosition(TimelineSlider).X);
    }

    private void OnSeekMouseUp(object sender, MouseButtonEventArgs e)
    {
        if (!_isSeeking) return;
        _isSeeking = false;
        if (_duration <= 0)
            App.Log($"Seek IGNORED on mouse-up: _duration={_duration:F1} (timeline disabled — backend never reported a duration for this file)");
        if (_duration > 0)
        {
            // Optimistically lock the slider + time-label at the requested
            // target so the UI matches what the user just did; the WS-pushed
            // confirmation arrives ≤1 s later and clears the suppression.
            _pendingSeekTarget   = _seekTarget;
            _pendingSeekUntilUtc = DateTime.UtcNow.AddSeconds(3);
            _position            = _seekTarget;
            PositionLabel.Text   = FormatTime(_seekTarget);
            if (_duration > 0)
                TimelineSlider.Value = _seekTarget / _duration * 100.0;

            _ = _ipc?.SendAsync("seek", _seekTarget, "absolute");
        }
        e.Handled = true;
    }

    private void UpdateSeekFromMouseX(double mouseX)
    {
        double ratio      = Math.Clamp(mouseX / Math.Max(1, TimelineSlider.ActualWidth), 0, 1);
        _seekTarget       = ratio * _duration;
        _position         = _seekTarget;
        TimelineSlider.Value = ratio * 100;
        if (_duration > 0) PositionLabel.Text = FormatTime(_seekTarget);
    }

    // =========================================================================
    // Volume
    // =========================================================================

    private void OnVolumeChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (!IsLoaded) return;
        UpdateVolumeLabel();
        // While the user is dragging, the mouse handlers send (with throttling).
        // ValueChanged fires but we skip the command here to avoid double-sends.
        if (!_isVolumeDragging)
            _ = _ipc?.SendAsync("set_property", "volume", e.NewValue);
    }

    private void UpdateVolumeLabel()
    {
        int pct = (int)Math.Round(VolumeSlider.Value);
        VolumePctLabel.Text = $"🔊 {pct}%";
    }

    // =========================================================================
    // Volume — mouse click/drag + scroll wheel (Fix 1)
    // =========================================================================

    private void OnVolumeMouseDown(object sender, MouseButtonEventArgs e)
    {
        _isVolumeDragging = true;

        // Capture the mouse to VolumeSlider so Move and Up events are delivered
        // to *this* element even when the cursor leaves the 80 px slider bounds.
        // Without capture, e.Handled=true prevents Slider's own Thumb from capturing,
        // and any sub-pixel mouse movement during a click causes MouseUp to fire on
        // the parent instead — leaving _isVolumeDragging=true and freezing the volume.
        Mouse.Capture(VolumeSlider);

        UpdateVolumeFromMouseX(e.GetPosition(VolumeSlider).X);
        // Send immediately on the initial click
        _lastVolumeSent = DateTime.UtcNow;
        _ = _ipc?.SendAsync("set_property", "volume", VolumeSlider.Value);
        e.Handled = true;
    }

    private void OnVolumeMouseMove(object sender, MouseEventArgs e)
    {
        if (!_isVolumeDragging || e.LeftButton != MouseButtonState.Pressed) return;
        UpdateVolumeFromMouseX(e.GetPosition(VolumeSlider).X);
        // Throttle to at most one command per 150 ms during drag
        var now = DateTime.UtcNow;
        if ((now - _lastVolumeSent).TotalMilliseconds >= 150)
        {
            _lastVolumeSent = now;
            _ = _ipc?.SendAsync("set_property", "volume", VolumeSlider.Value);
        }
    }

    private void OnVolumeMouseUp(object sender, MouseButtonEventArgs e)
    {
        if (!_isVolumeDragging) return;
        _isVolumeDragging = false;
        VolumeSlider.ReleaseMouseCapture(); // release the Win32 SetCapture from OnVolumeMouseDown
        // Always send the final value on release
        _lastVolumeSent = DateTime.UtcNow;
        _ = _ipc?.SendAsync("set_property", "volume", VolumeSlider.Value);
        e.Handled = true;
    }

    private void OnVolumeMouseWheel(object sender, MouseWheelEventArgs e)
    {
        double delta = e.Delta > 0 ? 5.0 : -5.0;
        // Volume range is now 0-200; clamp accordingly
        VolumeSlider.Value = Math.Clamp(VolumeSlider.Value + delta, 0, 200);
        // OnVolumeChanged fires (label update) + sends IPC command via !_isVolumeDragging path
        e.Handled = true;
    }

    private void UpdateVolumeFromMouseX(double mouseX)
    {
        double ratio     = Math.Clamp(mouseX / Math.Max(1, VolumeSlider.ActualWidth), 0, 1);
        VolumeSlider.Value = ratio * 200; // 0-200 range; triggers ValueChanged → label update + IPC
    }

    // =========================================================================
    // Volume indicator — left-side vertical bar (0-200 range)
    // =========================================================================

    /// <summary>
    /// Updates the left-side volume bar and shows it for 1500 ms.
    /// <paramref name="pct"/> is the raw mpv volume value (0 = silent, 100 = unity, 200 = max).
    /// Fill colour is purple ≤ 100, coral red above.
    /// </summary>
    public void ShowVolumeIndicator(int pct)
    {
        // Label: show raw value so the user knows they're above unity gain
        VolumeIndicatorLabel.Text = $"{pct}%";

        // Fill height: maps 0-200 → 0-120 px, grows from the bottom
        VolumeIndicatorFill.Height = Math.Clamp(pct / 200.0, 0, 1.0) * 120.0;

        // Colour: purple ≤ 100 %, coral > 100 %
        VolumeIndicatorFill.Fill = pct <= 100
            ? new SolidColorBrush(Color.FromRgb(0x7C, 0x3A, 0xED))
            : new SolidColorBrush(Color.FromRgb(0xFF, 0x6B, 0x6B));

        // Show instantly, keep for 1500 ms, then fade 300 ms
        VolumeIndicatorPanel.BeginAnimation(OpacityProperty, null);
        VolumeIndicatorPanel.Opacity = 1.0;

        _volumeTimer?.Stop();
        _volumeTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1500) };
        _volumeTimer.Tick += (_, _) =>
        {
            _volumeTimer!.Stop();
            VolumeIndicatorPanel.BeginAnimation(OpacityProperty,
                new DoubleAnimation(0.0, TimeSpan.FromMilliseconds(300)));
        };
        _volumeTimer.Start();
    }

    // =========================================================================
    // Local seek update (Fix 3 — visual update while paused)
    // =========================================================================

    /// <summary>
    /// Immediately updates the timeline slider and position label to
    /// <paramref name="newPosition"/> without waiting for a WebSocket push.
    /// Called by the keyboard hook handler after issuing a seek command so the
    /// thumb moves even when mpv is paused and the WS position is not updating.
    /// </summary>
    public void ApplyLocalSeek(double newPosition)
    {
        _position = Math.Clamp(newPosition, 0, _duration);
        if (_duration > 0)
            TimelineSlider.Value = _position / _duration * 100.0;
        PositionLabel.Text = FormatTime(_position);
        UpdateProgressBar();
    }

    // =========================================================================
    // Subtitle popup (Fix 1 — fetch on click)
    // =========================================================================

    // Cache the most recent subtitle track list so OnSubtitleTrackClick can
    // look up the picked track's language without re-querying.  This is also
    // used by ApplyPreferredSubtitleAsync on every file load.
    private List<SubtitleTrack> _cachedSubTracks = new();

    private async void OnSubtitleButtonClick(object sender, RoutedEventArgs e)
    {
        SubtitleTrackList.Children.Clear();
        SubtitleTrackList.Children.Add(MakeSubBtn("Loading…", -99));

        var subTracks = await FetchSubTracksAsync().ConfigureAwait(false);
        _cachedSubTracks = subTracks;

        await Dispatcher.InvokeAsync(() =>
        {
            SubtitleTrackList.Children.Clear();
            SubtitleTrackList.Children.Add(MakeSubBtn("Off", 0));
            foreach (var t in subTracks)
            {
                string label = string.IsNullOrWhiteSpace(t.Title)
                    ? t.Language
                    : $"{t.Language} · {t.Title}";
                SubtitleTrackList.Children.Add(MakeSubBtn(label, t.Index));
            }
            SubtitlePopup.IsOpen = true;
        });
    }

    private static async Task<List<SubtitleTrack>> FetchSubTracksAsync()
    {
        List<SubtitleTrack> tracks;
        try { tracks = await PlayerApiClient.GetSubtitleTracksAsync().ConfigureAwait(false); }
        catch { tracks = new(); }
        return tracks.Where(t =>
            string.IsNullOrEmpty(t.Type) ||
            t.Type.Equals("sub", StringComparison.OrdinalIgnoreCase) ||
            (t.Type.Equals("video", StringComparison.OrdinalIgnoreCase) == false &&
             t.Type.Equals("audio", StringComparison.OrdinalIgnoreCase) == false)
        ).ToList();
    }

    private Button MakeSubBtn(string label, int index)
    {
        bool isActive  = index == _activeSubtitleIndex && index >= 0;
        bool isLoading = index == -99;
        bool isOff     = index == 0;

        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // Active marker — a drawn dot (vector, not a glyph → safe under
        // invariant globalization, which disallows the typography/culture path).
        var check = new System.Windows.Shapes.Ellipse
        {
            Width               = 7,
            Height              = 7,
            Fill                = isActive
                                    ? new SolidColorBrush(Color.FromRgb(0x34, 0xD3, 0x99))
                                    : Brushes.Transparent,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment   = VerticalAlignment.Center,
        };
        Grid.SetColumn(check, 0);
        row.Children.Add(check);

        var text = new TextBlock
        {
            Text                = label,
            Foreground          = Brushes.White,
            FontFamily          = new FontFamily("Segoe UI"),
            FontSize            = 13,
            VerticalAlignment   = VerticalAlignment.Center,
            TextTrimming        = TextTrimming.CharacterEllipsis,
        };
        Grid.SetColumn(text, 1);
        row.Children.Add(text);

        if (!isOff && !isLoading)
        {
            var badges = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            var lower = label.ToLowerInvariant();
            if (lower.Contains("forced"))
                badges.Children.Add(MakeSubBadge("FORCED", 0xF5, 0x9E, 0x0B));
            if (lower.Contains("sdh") || lower.Contains("hearing"))
                badges.Children.Add(MakeSubBadge("SDH", 0x38, 0xBD, 0xF8));
            Grid.SetColumn(badges, 2);
            row.Children.Add(badges);
        }

        var btn = new Button
        {
            Style      = (Style)FindResource("SubRowButton"),
            Content    = row,
            Tag        = index,
            Background = isActive
                            ? new SolidColorBrush(Color.FromArgb(0x33, 0x7B, 0x2F, 0xBE))
                            : Brushes.Transparent,
        };
        if (!isLoading) btn.Click += OnSubtitleTrackClick;
        return btn;
    }

    private static Border MakeSubBadge(string text, byte r, byte g, byte b)
    {
        return new Border
        {
            Background   = new SolidColorBrush(Color.FromArgb(0x33, r, g, b)),
            CornerRadius = new CornerRadius(3),
            Padding      = new Thickness(4, 1, 4, 1),
            Margin       = new Thickness(4, 0, 0, 0),
            Child        = new TextBlock
            {
                Text       = text,
                Foreground = new SolidColorBrush(Color.FromRgb(r, g, b)),
                FontSize   = 8,
                FontWeight = FontWeights.Bold,
            },
        };
    }

    private void OnSubtitleTrackClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: int idx } || idx < 0) return;
        _activeSubtitleIndex = idx;
        SubtitlePopup.IsOpen = false;
        _ = _ipc?.SendAsync("set_property", "sid", idx == 0 ? (object)"no" : idx);

        // Persist this choice so the next file (within the playlist OR after
        // a fresh launch) re-applies the same subtitle preference.  "Off"
        // sticks as Off; a real track sticks by LANGUAGE so changes between
        // episodes still pick the right language even when the track INDEX
        // shifts (which it often does between episodes / releases).
        if (idx == 0)
        {
            App.Settings.PreferredSubMode = "off";
            App.Settings.PreferredSubLang = null;
        }
        else
        {
            var picked = _cachedSubTracks.FirstOrDefault(t => t.Index == idx);
            if (picked is not null && !string.IsNullOrWhiteSpace(picked.Language))
            {
                App.Settings.PreferredSubMode = "lang";
                App.Settings.PreferredSubLang = picked.Language;
                // Push the preference to mpv so future loadfiles auto-pick
                // a matching track without us having to intervene.
                _ = _ipc?.SendAsync("set_property", "slang", picked.Language);
            }
            else
            {
                // No language metadata — index-only memory has little value
                // across files (indices drift), so fall back to "default".
                App.Settings.PreferredSubMode = "default";
                App.Settings.PreferredSubLang = null;
            }
        }
        App.Settings.Save();
    }

    /// <summary>
    /// Re-apply the persisted subtitle preference to the currently-loaded
    /// file.  Called by MainWindow after every file change detected via WS
    /// (playlist-next, popup jump, etc.) — by that point mpv has populated
    /// its new track list, so we can pick the best language match and send
    /// the corresponding sid.  No-op when the user's mode is "default".
    /// </summary>
    public async Task ApplyPreferredSubtitleAsync()
    {
        if (_ipc is null) return;
        string mode = App.Settings.PreferredSubMode;
        if (mode == "default") return;

        if (mode == "off")
        {
            await _ipc.SendAsync("set_property", "sid", "no").ConfigureAwait(false);
            await Dispatcher.InvokeAsync(() => _activeSubtitleIndex = 0);
            return;
        }

        if (mode == "lang" && !string.IsNullOrWhiteSpace(App.Settings.PreferredSubLang))
        {
            // Give mpv a moment to populate its track list after the file
            // change before we query — querying too early returns the OLD
            // list and we'd pick the wrong (or non-existent) sid.  200 ms is
            // empirically enough; the previous 400 ms was overly conservative
            // and contributed to the user-visible open delay.
            await Task.Delay(200).ConfigureAwait(false);

            var tracks = await FetchSubTracksAsync().ConfigureAwait(false);
            _cachedSubTracks = tracks;
            var match = tracks.FirstOrDefault(t =>
                string.Equals(t.Language, App.Settings.PreferredSubLang,
                              StringComparison.OrdinalIgnoreCase));
            if (match is not null)
            {
                await _ipc.SendAsync("set_property", "sid", match.Index).ConfigureAwait(false);
                await Dispatcher.InvokeAsync(() => _activeSubtitleIndex = match.Index);
                App.Log($"ApplyPreferredSubtitle: picked sid={match.Index} for lang='{App.Settings.PreferredSubLang}'");
            }
            else
            {
                App.Log($"ApplyPreferredSubtitle: no track matches lang='{App.Settings.PreferredSubLang}' — leaving mpv default");
            }
        }
    }

    // =========================================================================
    // Context menu (Fix 6)
    // =========================================================================

    public void ShowContextMenu(Point screenPhysicalPt)
    {
        BuildContextMenu();
        // PlacementTarget anchors the popup's logical owner so StaysOpen=False
        // focus management works correctly inside an AllowsTransparency window.
        ContextMenuPopup.PlacementTarget = this;
        var src  = PresentationSource.FromVisual(this);
        double dx = src?.CompositionTarget?.TransformFromDevice.M11 ?? 1.0;
        double dy = src?.CompositionTarget?.TransformFromDevice.M22 ?? 1.0;
        // screenPhysicalPt is in physical pixels; Placement="Absolute" wants WPF DIPs
        ContextMenuPopup.HorizontalOffset = screenPhysicalPt.X * dx;
        ContextMenuPopup.VerticalOffset   = screenPhysicalPt.Y * dy;
        ContextMenuPopup.IsOpen = true;
    }

    private void BuildContextMenu()
    {
        ContextMenuItems.Children.Clear();

        // Subtitles — same as CC button
        ContextMenuItems.Children.Add(MakeMenuRow(
            Geometry.Parse("M3,4 H29 V20 H17 L13,26 V20 H3 Z"),
            "Subtitles",
            () =>
            {
                ContextMenuPopup.IsOpen = false;
                OnSubtitleButtonClick(this, new RoutedEventArgs());
            }
        ));

        // Playlist — opens the folder-playlist popup (built by MainWindow's
        // BuildFolderPlaylistAsync).  If no playlist was built (solo file in
        // its folder), the popup row still works but shows "No playlist
        // available" instead of a list, so the menu item is never a dead end.
        var playlistLabel = _playlistFiles.Count > 0
            ? $"Playlist  ({_playlistFiles.Count})"
            : "Playlist";
        ContextMenuItems.Children.Add(MakeMenuRow(
            Geometry.Parse("M4,9 H28 M4,16 H28 M4,23 H28"),
            playlistLabel,
            () =>
            {
                double ox = ContextMenuPopup.HorizontalOffset;
                double oy = ContextMenuPopup.VerticalOffset;
                ContextMenuPopup.IsOpen = false;
                ShowPlaylistPopup(ox, oy);
            }
        ));

        // Audio Tracks
        ContextMenuItems.Children.Add(MakeMenuRow(
            Geometry.Parse("M6,11 H12 L20,5 V27 L12,21 H6 Z M23,11 Q27,16 23,21"),
            "Audio Tracks",
            () =>
            {
                double ox = ContextMenuPopup.HorizontalOffset;
                double oy = ContextMenuPopup.VerticalOffset;
                ContextMenuPopup.IsOpen = false;
                _ = ShowAudioMenuAsync(ox, oy);
            }
        ));

        // Separator
        ContextMenuItems.Children.Add(new Border
        {
            Height     = 1,
            Background = new SolidColorBrush(Color.FromRgb(0x33, 0x33, 0x33)),
            Margin     = new Thickness(4, 2, 4, 2)
        });

        // Playback Speed
        string speedHint = Math.Abs(_currentSpeed - 1.0) < 0.01
            ? "Playback Speed"
            : $"Playback Speed  {_currentSpeed}×";
        ContextMenuItems.Children.Add(MakeMenuRow(
            Geometry.Parse("M18,3 L10,17 H16 L11,29 L25,13 H19 Z"),
            speedHint,
            () =>
            {
                double ox = ContextMenuPopup.HorizontalOffset;
                double oy = ContextMenuPopup.VerticalOffset;
                ContextMenuPopup.IsOpen = false;
                ShowSpeedMenu(ox, oy);
            }
        ));

        // Separator
        ContextMenuItems.Children.Add(new Border
        {
            Height     = 1,
            Background = new SolidColorBrush(Color.FromRgb(0x33, 0x33, 0x33)),
            Margin     = new Thickness(4, 2, 4, 2)
        });

        // Always on top — toggles MainWindow.Topmost (which propagates to us
        // since we're its Owner).  Label shows current state with a ✓ prefix
        // when active, matching the existing speed-row indicator pattern.
        bool alwaysOnTop = Owner?.Topmost == true;
        ContextMenuItems.Children.Add(MakeMenuRow(
            Geometry.Parse("M16,3 L16,21 M9,10 L16,3 L23,10 M5,26 H27"),  // pin/arrow-up icon
            alwaysOnTop ? "✓ Always on top" : "Always on top",
            () =>
            {
                ContextMenuPopup.IsOpen = false;
                if (Owner is not null) Owner.Topmost = !Owner.Topmost;
                // Our window inherits Topmost from Owner automatically when
                // Owner is set, but force it for the case where Owner is null.
                this.Topmost = Owner?.Topmost ?? this.Topmost;
                // Toggling Topmost changes z-order but doesn't fire
                // StateChanged, so the mpv child window (VideoHwndHost) never
                // gets re-poked — left the video frame frozen/stale until an
                // unrelated resize happened.  Force the same re-sync here.
                if (Owner is MainWindow mw) mw.RefitVideoChildExternal();
            }
        ));

        // Screenshot — mpv IPC command.  `screenshot` with arg "video" saves
        // the un-rendered video frame (no OSD/subtitles), giving the cleanest
        // capture.  mpv writes it to its `--screenshot-directory` (default:
        // the working directory, which the backend launches from a user-
        // visible folder).  No PNG-path negotiation needed from our side.
        ContextMenuItems.Children.Add(MakeMenuRow(
            Geometry.Parse("M4,8 H10 L12,5 H20 L22,8 H28 V25 H4 Z M16,12 A5,5 0 1 1 15.99,12.01"),
            "Screenshot",
            () =>
            {
                ContextMenuPopup.IsOpen = false;
                // async = don't block IPC pump on disk I/O; "video" = no OSD/subs
                _ = _ipc?.SendAsync("async", "screenshot", "video");
            }
        ));
    }

    // =========================================================================
    // Mute toggle (clickable speaker icon)
    // =========================================================================

    // Pre-mute volume cached so unmute restores the user's previous level
    // instead of jumping to whatever mpv reports back (which would be 0 while
    // muted).  When the user drags the slider while muted, we treat that as
    // an explicit unmute — see OnVolumeChanged in the existing handlers.
    private bool   _isMuted        = false;
    private double _preMuteVolume  = 80;

    private void OnMuteClick(object sender, RoutedEventArgs e)
    {
        if (_isMuted)
        {
            // Unmute: restore previous volume on both the slider and mpv.
            _isMuted        = false;
            MuteIcon.Text   = "🔊";
            VolumeSlider.Value = _preMuteVolume;
            _ = _ipc?.SendAsync("set_property", "mute", false);
            // Volume slider's own ValueChanged sends set_property volume.
        }
        else
        {
            _preMuteVolume  = VolumeSlider.Value;
            _isMuted        = true;
            MuteIcon.Text   = "🔇";
            _ = _ipc?.SendAsync("set_property", "mute", true);
        }
    }

    private Border MakeMenuRow(Geometry iconData, string label, Action onClick)
    {
        var icon = new System.Windows.Shapes.Path
        {
            Data            = iconData,
            Stroke          = new SolidColorBrush(Color.FromRgb(0xCC, 0xCC, 0xCC)),
            StrokeThickness = 1.5,
            Fill            = Brushes.Transparent,
            Width           = 16,
            Height          = 16,
            Stretch         = Stretch.Uniform,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var tb = new TextBlock
        {
            Text              = label,
            Foreground        = Brushes.White,
            FontFamily        = new FontFamily("Segoe UI"),
            FontSize          = 13,
            VerticalAlignment = VerticalAlignment.Center,
            Margin            = new Thickness(10, 0, 0, 0),
        };
        var sp = new StackPanel
        {
            Orientation       = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
            Margin            = new Thickness(10, 0, 12, 0),
        };
        sp.Children.Add(icon);
        sp.Children.Add(tb);

        var row = new Border
        {
            Height            = 36,
            Background        = Brushes.Transparent,
            Cursor            = Cursors.Hand,
            Child             = sp,
        };
        row.MouseEnter += (_, _) => row.Background =
            new SolidColorBrush(Color.FromRgb(0x2A, 0x2A, 0x2A));
        row.MouseLeave += (_, _) => row.Background = Brushes.Transparent;
        row.MouseLeftButtonUp += (_, _) => onClick();
        return row;
    }

    // ── ⋯ / ⋮ more button ───────────────────────────────────────────────────

    private void OnMoreClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn)
        {
            // Place context menu just below the button
            var screenPt = btn.PointToScreen(new Point(0, btn.ActualHeight));
            ShowContextMenu(screenPt);
        }
    }

    // =========================================================================
    // Speed submenu (Fix 6)
    // =========================================================================

    private void ShowSpeedMenu(double ox, double oy)
    {
        SpeedMenuItems.Children.Clear();
        foreach (var speed in SpeedOptions)
        {
            bool active = Math.Abs(_currentSpeed - speed) < 0.01;
            string label = speed == 1.0 ? "1× (Normal)" : $"{speed}×";

            var check = new TextBlock
            {
                Text              = "✓",
                Foreground        = BrushPurple,
                FontSize          = 13,
                Width             = 18,
                VerticalAlignment = VerticalAlignment.Center,
                Visibility        = active ? Visibility.Visible : Visibility.Collapsed,
            };
            var tb = new TextBlock
            {
                Text              = label,
                Foreground        = Brushes.White,
                FontFamily        = new FontFamily("Segoe UI"),
                FontSize          = 13,
                VerticalAlignment = VerticalAlignment.Center,
                Margin            = new Thickness(6, 0, 0, 0),
            };
            var sp = new StackPanel
            {
                Orientation       = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
                Margin            = new Thickness(10, 0, 12, 0),
            };
            sp.Children.Add(check);
            sp.Children.Add(tb);

            var captured = speed;
            var row = new Border { Height = 34, Background = Brushes.Transparent,
                                   Cursor = Cursors.Hand, Child = sp };
            row.MouseEnter += (_, _) => row.Background =
                new SolidColorBrush(Color.FromRgb(0x2A, 0x2A, 0x2A));
            row.MouseLeave += (_, _) => row.Background = Brushes.Transparent;
            row.MouseLeftButtonUp += (_, _) =>
            {
                SpeedPopup.IsOpen = false;
                _currentSpeed = captured;
                UpdateSpeedLabels();
                _ = _ipc?.SendAsync("set_property", "speed", captured);
            };
            SpeedMenuItems.Children.Add(row);
        }

        SpeedPopup.HorizontalOffset = ox;
        SpeedPopup.VerticalOffset   = oy;
        SpeedPopup.IsOpen = true;
    }

    private void UpdateSpeedLabels()
    {
        bool atNormal = Math.Abs(_currentSpeed - 1.0) < 0.01;
        string text   = $"{_currentSpeed}×";

        SpeedLabelTitlebar.Visibility  = atNormal ? Visibility.Collapsed : Visibility.Visible;
        SpeedLabelTitlebar.Text        = text;
        SpeedLabelControls.Visibility  = atNormal ? Visibility.Collapsed : Visibility.Visible;
        SpeedLabelControls.Text        = text;
    }

    // =========================================================================
    // Audio tracks submenu (Fix 6)
    // =========================================================================

    private async Task ShowAudioMenuAsync(double ox, double oy)
    {
        AudioTrackList.Children.Clear();
        AudioTrackList.Children.Add(new TextBlock
        {
            Text = "Loading…", Foreground = new SolidColorBrush(Color.FromRgb(0x99, 0x99, 0x99)),
            FontFamily = new FontFamily("Segoe UI"), FontSize = 13,
            Margin = new Thickness(12, 8, 12, 8)
        });
        AudioPopup.HorizontalOffset = ox;
        AudioPopup.VerticalOffset   = oy;
        AudioPopup.IsOpen = true;

        List<SubtitleTrack> all;
        try { all = await PlayerApiClient.GetSubtitleTracksAsync().ConfigureAwait(false); }
        catch { all = []; }

        var audioTracks = all
            .Where(t => t.Type.Equals("audio", StringComparison.OrdinalIgnoreCase))
            .ToList();

        await Dispatcher.InvokeAsync(() =>
        {
            AudioTrackList.Children.Clear();
            if (audioTracks.Count == 0)
            {
                AudioTrackList.Children.Add(new TextBlock
                {
                    Text = "No audio tracks found",
                    Foreground = new SolidColorBrush(Color.FromRgb(0x99, 0x99, 0x99)),
                    FontFamily = new FontFamily("Segoe UI"), FontSize = 13,
                    Margin = new Thickness(12, 8, 12, 8)
                });
                return;
            }
            foreach (var t in audioTracks)
            {
                bool active = t.Index == _activeAudioIndex;
                string label = string.IsNullOrWhiteSpace(t.Title)
                    ? t.Language : $"{t.Language} · {t.Title}";
                var btn = new Button
                {
                    Content         = label,
                    Tag             = t.Index,
                    Background      = Brushes.Transparent,
                    Foreground      = Brushes.White,
                    BorderBrush     = active
                                        ? new SolidColorBrush(Color.FromRgb(0x7C, 0x3A, 0xED))
                                        : Brushes.Transparent,
                    BorderThickness = new Thickness(active ? 3 : 0, 0, 0, 0),
                    HorizontalContentAlignment = HorizontalAlignment.Left,
                    Padding         = new Thickness(active ? 5 : 8, 6, 8, 6),
                    FontFamily      = new FontFamily("Segoe UI"),
                    FontSize        = 13,
                    Cursor          = Cursors.Hand,
                };
                btn.Click += OnAudioTrackClick;
                AudioTrackList.Children.Add(btn);
            }
        });
    }

    private void OnAudioTrackClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: int idx }) return;
        _activeAudioIndex = idx;
        AudioPopup.IsOpen = false;
        _ = _ipc?.SendAsync("set_property", "aid", idx);
    }

    // =========================================================================
    // Window chrome (Fix 1 / Fix 5)
    // =========================================================================

    public void ToggleMaximize()
    {
        if (_isMaximized)
        {
            // ── Restore ──────────────────────────────────────────────────────
            _isMaximized = false;
            _syncingPosition = true;
            try
            {
                if (Owner != null)
                {
                    Owner.WindowState = WindowState.Normal;
                    Owner.Left  = _normalLeft;  Owner.Top    = _normalTop;
                    Owner.Width = _normalWidth; Owner.Height = _normalHeight;
                }
                Left = _normalLeft;  Top    = _normalTop;
                Width = _normalWidth; Height = _normalHeight;
            }
            finally { _syncingPosition = false; }
            UpdateMaxRestoreIcon(false);
            // Restoring resized the layered window; re-present so the bar's
            // background doesn't come back transparent (case 2 the user hit:
            // fullscreen → double-click to restore).  Deferred so it runs
            // after WPF finishes the resize/layout.
            _ = Dispatcher.BeginInvoke(new Action(ForceLayeredRepaint),
                                       DispatcherPriority.Loaded);
            _ = Dispatcher.BeginInvoke(new Action(() => ShowControls(animate: false)),
                                       DispatcherPriority.Render);
            // Restoring from fullscreen via double-click-titlebar — same
            // z-order risk as the Owner.StateChanged minimize-restore path:
            // whatever app was focused isn't guaranteed to end up behind us.
            if (Owner is not null) { Owner.Topmost = true; Owner.Activate(); }
            Topmost = true;
            Activate();
            _ = Dispatcher.InvokeAsync(async () =>
            {
                await Task.Delay(400).ConfigureAwait(true);
                if (Owner is not null) Owner.Topmost = false;
                Topmost = false;
            }, DispatcherPriority.Background);
        }
        else
        {
            // ── Maximize (true fullscreen — covers taskbar) ───────────────────
            _normalLeft = Left; _normalTop = Top;
            _normalWidth = Width; _normalHeight = Height;
            _isMaximized = true;
            // Maximize MainWindow; then delegate the ControlsWindow sizing
            // to SyncFromOwner — which uses DWM-extended bounds to cover
            // the screen Owner is ACTUALLY on (multi-monitor correct),
            // not always the primary.  The previous hard-coded
            // SystemParameters.PrimaryScreen{Width,Height} was the source
            // of the regression: on a non-primary monitor, ControlsWindow
            // ended up on monitor 1 while the video maximized on monitor 2.
            if (Owner != null)
                Owner.WindowState = WindowState.Maximized;
            SyncFromOwner();
            UpdateMaxRestoreIcon(true);
            _ = Dispatcher.BeginInvoke(new Action(ForceLayeredRepaint),
                                       DispatcherPriority.Loaded);
        }
    }

    private void UpdateMaxRestoreIcon(bool maximized)
    {
        MaxRestoreIcon.Data        = Geometry.Parse(maximized ? RestoreGeometry : MaximizeGeometry);
        MaximizeRestoreBtn.ToolTip = maximized ? "Restore" : "Maximize";
    }

    private void OnTitlebarMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.LeftButton != MouseButtonState.Pressed) return;
        if (Owner is null) return;

        // If currently maximized, "restore-then-drag" feels janky on the same
        // click — just restore and let the user click again to drag.
        if (_isMaximized) { ToggleMaximize(); return; }

        // Direct Win32 drag.  Window.DragMove() is unreliable when called
        // from ANOTHER window's event handler (mouse capture stays on the
        // event's source window, so the OS drag-loop never starts).  Sending
        // WM_NCLBUTTONDOWN with HTCAPTION directly to MainWindow's HWND — and
        // releasing capture first so the OS owns the mouse — works regardless
        // of which window's event delivered us here.  This is the standard
        // borderless-WPF drag pattern.
        var helper = new WindowInteropHelper(Owner);
        var hwnd = helper.Handle;
        if (hwnd == IntPtr.Zero) return;

        NativeMethods.ReleaseCapture();
        NativeMethods.SendMessage(
            hwnd,
            NativeMethods.WM_NCLBUTTONDOWN,
            (IntPtr)NativeMethods.HTCAPTION,
            IntPtr.Zero);

        // OS-level drag finished; Owner.LocationChanged fired throughout and
        // kept ControlsWindow glued to MainWindow in real time, so nothing
        // further to do on the WPF side.
        e.Handled = true;
    }

    private void OnMinimizeClick(object sender, RoutedEventArgs e)
    {
        if (Owner != null) Owner.WindowState = WindowState.Minimized;
        WindowState = WindowState.Minimized;
    }

    private void OnMaximizeRestoreClick(object sender, RoutedEventArgs e)
        => ToggleMaximize();

    private void OnCloseClick(object sender, RoutedEventArgs e)
    {
        // Close the windows IMMEDIATELY for instant feedback.  The backend stop
        // — which saves the final position AND waits up to 3 s for mpv to exit
        // — runs in the BACKGROUND.  Previously we awaited StopAsync before
        // closing, so the video stayed on screen for seconds after the click
        // ("closing takes sooo much").  StopAsync persists the resume position
        // before it tears mpv down, so closing first doesn't lose the place.
        _ = Task.Run(() => PlayerApiClient.StopAsync());
        Owner?.Close();
        Close();
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    // ── Next Episode overlay (FIX 8) ─────────────────────────────────────────
    //
    // Counts down 10 seconds then triggers playlist-next.  User can hit
    // "Play Now" to skip the wait or "Cancel" to dismiss (player closes
    // normally afterwards).

    private DispatcherTimer? _nextEpisodeTimer;
    private int  _nextEpisodeRemainingSec;
    private Action? _nextEpisodePlayNowAction;
    private Action? _nextEpisodeCancelAction;

    public void ShowNextEpisodeOverlay(string nextTitle, string? nextSubtitle,
                                        System.Windows.Media.Imaging.BitmapSource? thumbnail,
                                        Action onPlayNow, Action onCancel)
    {
        NextEpisodeTitle.Text = string.IsNullOrWhiteSpace(nextSubtitle)
            ? nextTitle
            : $"{nextTitle}  ·  {nextSubtitle}";
        NextEpisodeThumb.Source = thumbnail;
        _nextEpisodePlayNowAction = onPlayNow;
        _nextEpisodeCancelAction  = onCancel;

        _nextEpisodeRemainingSec = 10;
        UpdateNextEpisodeCountdownDisplay();
        NextEpisodeOverlay.Visibility = Visibility.Visible;
        NextEpisodeOverlay.BeginAnimation(OpacityProperty,
            new DoubleAnimation(1.0, TimeSpan.FromMilliseconds(300)));

        _nextEpisodeTimer?.Stop();
        _nextEpisodeTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _nextEpisodeTimer.Tick += (_, _) =>
        {
            _nextEpisodeRemainingSec--;
            if (_nextEpisodeRemainingSec <= 0)
            {
                _nextEpisodeTimer!.Stop();
                HideNextEpisodeOverlay();
                _nextEpisodePlayNowAction?.Invoke();
                return;
            }
            UpdateNextEpisodeCountdownDisplay();
        };
        _nextEpisodeTimer.Start();
    }

    private void UpdateNextEpisodeCountdownDisplay()
    {
        NextEpisodeCountdown.Text = $"Playing in {_nextEpisodeRemainingSec}s";
        // Progress strip depletes left-to-right.
        double frac = 1.0 - (_nextEpisodeRemainingSec / 10.0);
        NextEpisodeProgress.Width = Math.Max(0, frac * 300);   // visual width
    }

    private void HideNextEpisodeOverlay()
    {
        _nextEpisodeTimer?.Stop();
        var fade = new DoubleAnimation(0.0, TimeSpan.FromMilliseconds(300));
        fade.Completed += (_, _) => NextEpisodeOverlay.Visibility = Visibility.Collapsed;
        NextEpisodeOverlay.BeginAnimation(OpacityProperty, fade);
    }

    private void OnNextEpisodePlayClick(object sender, RoutedEventArgs e)
    {
        HideNextEpisodeOverlay();
        _nextEpisodePlayNowAction?.Invoke();
    }

    private void OnNextEpisodeCancelClick(object sender, RoutedEventArgs e)
    {
        HideNextEpisodeOverlay();
        _nextEpisodeCancelAction?.Invoke();
    }

    // ── Intro/Outro skip overlay (Group 3) ───────────────────────────────────
    //
    // MainWindow calls SetIntroOutroSkipData() once per episode, right after
    // fetching GET /api/skip/episode/{id} (cached for the session — never
    // re-fetched per-frame). From there, every WS-driven position update
    // (UpdateFromSession → EvaluateIntroOutroSkip) checks the cached ranges
    // client-side — there's no second polling path, just a check riding the
    // position push that already exists for the timeline slider.

    /// <summary>Caches the episode's skip data and resets dismiss/visibility state —
    /// call once per episode, not per frame.</summary>
    public void SetIntroOutroSkipData(SkipData? data)
    {
        _introOutroSkipData = data;
        _dismissedSkipKinds.Clear();
        _activeSkipKind = null;
        _skipButtonAutoHideTimer?.Stop();
        IntroOutroSkipButton.BeginAnimation(OpacityProperty, null);
        IntroOutroSkipButton.Opacity = 0;
        IntroOutroSkipButton.Visibility = Visibility.Collapsed;
    }

    // Kill switch for the intro/outro skip button — fingerprint-sourced segments have shown
    // wrong skip windows even at confidence >= 0.75 (energy-envelope correlation getting fooled
    // by similar speech rhythm across unrelated scenes, not just low-confidence heuristic
    // guesses). SetIntroOutroSkipData still caches fetched data; only the UI is suppressed.
    // Flip back to false once fingerprinting is more discriminating.
    private const bool SkipOverlayDisabled = false;

    private void EvaluateIntroOutroSkip()
    {
        if (SkipOverlayDisabled) return;
        if (_introOutroSkipData is null) return;

        string? kind = null;
        SkipSegment? seg = null;

        // Heuristic-sourced segments (confidence 0.3, a fixed-offset guess with no real
        // signal from this file) are too unreliable to surface — same rule as the React
        // overlay. The outro case is exactly why: it's computed once from whichever
        // sampled episode's duration was known at detection time, then reused unchanged
        // across every episode in the season — wrong by however many seconds this
        // episode's runtime differs from that reference.
        //
        // Outro checked first — rarer/more important near the end, mirrors the
        // equivalent React overlay's priority order.
        if (_introOutroSkipData.Outro is { } outro && outro.Source != "heuristic" &&
            !_dismissedSkipKinds.Contains("outro") &&
            _position >= outro.Start && _position < outro.End)
        {
            kind = "outro";
            seg = outro;
        }
        else if (_introOutroSkipData.Intro is { } intro && intro.Source != "heuristic" &&
                 !_dismissedSkipKinds.Contains("intro") &&
                 _position >= intro.Start && _position < intro.End)
        {
            kind = "intro";
            seg = intro;
        }

        if (kind == _activeSkipKind) return; // no state change this tick
        _activeSkipKind = kind;

        if (kind is null || seg is null)
        {
            HideIntroOutroSkipButton();
            return;
        }

        // Heuristic-sourced segments (confidence 0.3, a fixed-offset guess) are filtered out
        // upstream by the backend response shaping — anything that reaches here with
        // confidence below 0.6 is a borderline fingerprint/AniSkip result, not a heuristic one.
        IntroOutroSkipLabel.Text = kind == "intro" ? "Skip Intro" : "Skip Credits";
        var lowConfidence = seg.Confidence is double c && c < 0.6;
        IntroOutroSkipEstimatedLabel.Visibility = lowConfidence ? Visibility.Visible : Visibility.Collapsed;
        ShowIntroOutroSkipButton();
    }

    private void ShowIntroOutroSkipButton()
    {
        IntroOutroSkipButton.Visibility = Visibility.Visible;
        IntroOutroSkipButton.BeginAnimation(OpacityProperty, new DoubleAnimation(1.0, TimeSpan.FromMilliseconds(250)));

        _skipButtonAutoHideTimer?.Stop();
        _skipButtonAutoHideTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
        _skipButtonAutoHideTimer.Tick += (_, _) =>
        {
            _skipButtonAutoHideTimer!.Stop();
            // Auto-hide counts as a dismiss — don't re-show for the rest of this range.
            if (_activeSkipKind is { } k) _dismissedSkipKinds.Add(k);
            HideIntroOutroSkipButton();
        };
        _skipButtonAutoHideTimer.Start();
    }

    private void HideIntroOutroSkipButton()
    {
        _skipButtonAutoHideTimer?.Stop();
        var fade = new DoubleAnimation(0.0, TimeSpan.FromMilliseconds(200));
        fade.Completed += (_, _) => IntroOutroSkipButton.Visibility = Visibility.Collapsed;
        IntroOutroSkipButton.BeginAnimation(OpacityProperty, fade);
    }

    private void OnIntroOutroSkipClick(object sender, RoutedEventArgs e)
    {
        if (_activeSkipKind is not { } kind || _introOutroSkipData is null) return;
        var seg = kind == "intro" ? _introOutroSkipData.Intro : _introOutroSkipData.Outro;
        if (seg is null) return;

        _dismissedSkipKinds.Add(kind);
        HideIntroOutroSkipButton();
        // Same direct-to-mpv path the scrub bar uses — no new IPC surface.
        _ = _ipc?.SendAsync("seek", seg.End, "absolute");
    }

    private void OnIntroOutroSkipDismissClick(object sender, RoutedEventArgs e)
    {
        if (_activeSkipKind is { } kind) _dismissedSkipKinds.Add(kind);
        HideIntroOutroSkipButton();
    }

    /// <summary>
    /// Formats a duration in seconds.  Long-form movies hit ≥1 hour where
    /// the old "MM:SS" formatter would overflow (e.g. 102:21 instead of
    /// 1:42:21).  We now branch on whether hours are present:
    ///   t < 1 h  → "M:SS"   (e.g. "7:14",  "25:39")
    ///   t ≥ 1 h  → "H:MM:SS" (e.g. "1:25:39")
    /// Negative inputs are clamped to 0.
    /// </summary>
    public static string FormatTime(double sec)
    {
        int total = (int)Math.Max(0, sec);
        int h = total / 3600;
        int m = (total % 3600) / 60;
        int s = total % 60;
        return h > 0
            ? $"{h}:{m:D2}:{s:D2}"
            : $"{m}:{s:D2}";
    }
}
