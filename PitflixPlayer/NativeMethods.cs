using System.Runtime.InteropServices;

namespace PitflixPlayer;

internal static class NativeMethods
{
    internal const int WS_CHILD        = 0x40000000;
    internal const int WS_VISIBLE      = 0x10000000;
    internal const int WS_CLIPCHILDREN = 0x02000000;
    internal const int WS_CLIPSIBLINGS = 0x04000000;

    // Window class style — CS_OWNDC gives each window its own DC, required for OpenGL/D3D
    internal const uint CS_OWNDC       = 0x0020;
    internal const uint CS_HREDRAW     = 0x0002;
    internal const uint CS_VREDRAW     = 0x0001;

    // WndProc delegate
    internal delegate IntPtr WndProcDelegate(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct WNDCLASSEX
    {
        public uint      cbSize;
        public uint      style;
        public IntPtr    lpfnWndProc;
        public int       cbClsExtra;
        public int       cbWndExtra;
        public IntPtr    hInstance;
        public IntPtr    hIcon;
        public IntPtr    hCursor;
        public IntPtr    hbrBackground;
        public string?   lpszMenuName;
        public string    lpszClassName;
        public IntPtr    hIconSm;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern ushort RegisterClassEx(ref WNDCLASSEX lpWndClass);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern IntPtr CreateWindowEx(
        int    dwExStyle,
        string lpClassName,
        string lpWindowName,
        int    dwStyle,
        int x, int y,
        int nWidth, int nHeight,
        IntPtr hWndParent,
        IntPtr hMenu,
        IntPtr hInstance,
        IntPtr lpParam);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DestroyWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    internal static extern bool MoveWindow(IntPtr hWnd, int x, int y, int nWidth, int nHeight, bool bRepaint);

    // ── SetWindowPos — used to force a layered-window recomposite ─────────────
    //
    // A WPF AllowsTransparency (WS_EX_LAYERED) window can come up with its
    // per-pixel-alpha surface NOT yet showing the painted background — the bar
    // reads fully transparent until the user moves the window, which is what
    // makes the background "snap" to black.  A zero-move/zero-size SetWindowPos
    // with SWP_FRAMECHANGED reproduces that move's WM_WINDOWPOSCHANGED, forcing
    // the DWM to re-present the layered bitmap — no visible jump.
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetWindowPos(
        IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);

    internal const uint SWP_NOMOVE     = 0x0002;
    internal const uint SWP_NOSIZE     = 0x0001;
    internal const uint SWP_NOZORDER   = 0x0004;
    internal const uint SWP_NOACTIVATE = 0x0010;

    /// <summary>hWndInsertAfter value meaning "bring to the very top of the
    /// z-order" — used to explicitly assert ControlsWindow sits above
    /// MainWindow, rather than relying solely on the implicit "owned windows
    /// stay above their owner" OS convention.</summary>
    internal static readonly IntPtr HWND_TOP = IntPtr.Zero;
    internal const uint SWP_FRAMECHANGED = 0x0020;

    [DllImport("user32.dll")]
    internal static extern IntPtr DefWindowProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    internal static extern IntPtr GetModuleHandle(string? lpModuleName);

    // ── Low-level keyboard hook (WH_KEYBOARD_LL) ─────────────────────────────

    internal const int WH_KEYBOARD_LL = 13;
    internal const int WM_KEYDOWN     = 0x0100;
    internal const int WM_SYSKEYDOWN  = 0x0104;

    internal delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    internal struct KBDLLHOOKSTRUCT
    {
        public uint   vkCode;
        public uint   scanCode;
        public uint   flags;
        public uint   time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr SetWindowsHookEx(
        int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    // ── Low-level mouse hook (WH_MOUSE_LL) ───────────────────────────────────

    internal const int WH_MOUSE_LL    = 14;
    internal const int WM_LBUTTONDOWN = 0x0201;
    internal const int WM_RBUTTONDOWN = 0x0204;
    internal const int WM_MOUSEWHEEL  = 0x020A;

    internal delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

    /// <summary>
    /// MSLLHOOKSTRUCT — payload of every WH_MOUSE_LL callback.
    /// pt.X/pt.Y are screen coordinates in physical pixels.
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    internal struct MSLLHOOKSTRUCT
    {
        public int    ptX;          // POINT.x  (physical screen pixels)
        public int    ptY;          // POINT.y
        public uint   mouseData;
        public uint   flags;
        public uint   time;
        public IntPtr dwExtraInfo;
    }

    /// <summary>Second overload of SetWindowsHookEx typed for mouse procs.</summary>
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr SetWindowsHookEx(
        int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

    // ── Common hook helpers ───────────────────────────────────────────────────

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    internal static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    internal static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    // ── Hit-testing / geometry helpers ───────────────────────────────────────

    /// <summary>Returns the HWND of the topmost window covering a physical-pixel point.</summary>
    [DllImport("user32.dll")]
    internal static extern IntPtr WindowFromPoint(int xPoint, int yPoint);

    /// <summary>
    /// Walks the window parent chain.
    /// GA_ROOT (2) = topmost ancestor that is not a child window.
    /// </summary>
    [DllImport("user32.dll")]
    internal static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);

    internal const uint GA_ROOT = 2;

    [StructLayout(LayoutKind.Sequential)]
    internal struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    // ── WM_GETMINMAXINFO — clamp maximize bounds to the real monitor rect ───
    //
    // A borderless (WindowStyle=None), resizable (ResizeMode=CanResize) WPF
    // window that natively maximizes gets positioned a few pixels OFF-SCREEN
    // on each edge by default — Windows reserves room for the invisible
    // resize border even though nothing is drawn there.  That overhang gets
    // silently clipped by the monitor edge, so MainWindow itself still LOOKS
    // fullscreen, but ControlsWindow.SyncFromOwner reads the unclipped
    // DWMWA_EXTENDED_FRAME_BOUNDS rect and ends up offset from MainWindow's
    // actual visible/painted bounds — exactly the kind of persistent (non-
    // resize-triggered) left/top-edge gap reported.  Handling WM_GETMINMAXINFO
    // and clamping ptMaxPosition/ptMaxSize to the monitor's full rect is the
    // standard, documented fix for this WPF quirk.
    internal const int WM_GETMINMAXINFO = 0x0024;

    [StructLayout(LayoutKind.Sequential)]
    internal struct POINT32 { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    internal struct MINMAXINFO
    {
        public POINT32 ptReserved;
        public POINT32 ptMaxSize;
        public POINT32 ptMaxPosition;
        public POINT32 ptMinTrackSize;
        public POINT32 ptMaxTrackSize;
    }

    internal const uint MONITOR_DEFAULTTONEAREST = 2;

    [DllImport("user32.dll")]
    internal static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [StructLayout(LayoutKind.Sequential)]
    internal struct MONITORINFO
    {
        public uint cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    // ── Window drag (Win32 native, no WPF DragMove) ──────────────────────────
    //
    // The standard trick for borderless WPF windows: send WM_NCLBUTTONDOWN
    // with HTCAPTION as wParam → Windows treats the click as if it landed
    // on a native titlebar and starts a drag-move operation.  Unlike
    // Window.DragMove(), this works correctly when the originating mouse-
    // down event happened on a DIFFERENT window (e.g. ControlsWindow's
    // titlebar overlay) than the window being dragged (MainWindow).
    internal const int WM_NCLBUTTONDOWN = 0x00A1;
    internal const int HTCAPTION        = 0x0002;

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    internal static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ReleaseCapture();

    // ── DWM bounds (visible-rect minus invisible drop-shadow) ────────────────
    //
    // GetWindowRect for a WindowStyle=None window includes the DWM-extended
    // frame (~8 px shadow margin around the actual painted area).  Sizing
    // ControlsWindow to that rect makes its transparent regions extend past
    // MainWindow's visible bounds and show whatever is behind on the desktop
    // (the "control bar wider than video" + other-app-bleed-through bug).
    // DWMWA_EXTENDED_FRAME_BOUNDS returns the visible rect, so ControlsWindow
    // sits exactly on top of MainWindow's painted area with no overhang.
    internal const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    [DllImport("dwmapi.dll")]
    internal static extern int DwmGetWindowAttribute(
        IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    // ── Modifier key state (Shift+S subtitle search vs plain S screenshot) ───

    internal const int VK_SHIFT = 0x10;

    [DllImport("user32.dll")]
    internal static extern short GetAsyncKeyState(int vKey);
}
