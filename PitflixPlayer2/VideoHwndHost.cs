using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace PitflixPlayer;

/// <summary>
/// HwndHost that creates a native Win32 child window with a custom window class.
/// The custom class uses CS_OWNDC (required for D3D11/OpenGL) and a minimal WndProc
/// that does NOT intercept WM_PAINT or WM_SIZE — letting mpv handle all rendering.
/// Pass <see cref="ChildHwnd"/> to the backend as the <c>--wid</c> HWND for mpv.
/// </summary>
internal sealed class VideoHwndHost : HwndHost
{
    private const string ClassName = "PitflixVideoHost";
    private IntPtr _childHwnd;

    // Keep the delegate alive for the lifetime of the process so GC doesn't collect it
    private static readonly NativeMethods.WndProcDelegate _wndProcDelegate = VideoWndProc;
    private static bool _classRegistered;
    private static readonly object _classLock = new();

    /// <summary>
    /// The HWND of the native child window — valid after the WPF visual tree is loaded.
    /// This is the value to send to <c>POST /api/player/attach</c> as <c>hwnd</c>.
    /// </summary>
    public IntPtr ChildHwnd => _childHwnd;

    // ── Custom WndProc ────────────────────────────────────────────────────────
    // We handle only the messages that would otherwise cause rendering conflicts:
    //   WM_ERASEBKGND (0x0014): return 1 → suppress background erase (avoids flicker)
    //   WM_PAINT      (0x000F): validate the region and return — mpv owns painting
    // Everything else is forwarded to DefWindowProc.

    private static IntPtr VideoWndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        switch (msg)
        {
            case 0x0014: // WM_ERASEBKGND
                return new IntPtr(1); // claim we erased — do nothing

            case 0x000F: // WM_PAINT
                // Validate the dirty region so Windows stops sending WM_PAINT,
                // but don't actually paint anything — mpv handles all rendering.
                ValidateRect(hwnd, IntPtr.Zero);
                return IntPtr.Zero;

            case 0x0021: // WM_MOUSEACTIVATE
                // MA_NOACTIVATE (3): deliver the mouse message but do NOT give this
                // child window keyboard focus.  This keeps WPF's MainWindow as the
                // active window so KeyDown events keep firing there (Fix 3).
                return new IntPtr(3);
        }
        return NativeMethods.DefWindowProc(hwnd, msg, wParam, lParam);
    }

    [DllImport("user32.dll")]
    private static extern bool ValidateRect(IntPtr hWnd, IntPtr lpRect);

    // ── Class registration ────────────────────────────────────────────────────

    private static void EnsureClassRegistered()
    {
        lock (_classLock)
        {
            if (_classRegistered) return;

            var wc = new NativeMethods.WNDCLASSEX
            {
                cbSize        = (uint)Marshal.SizeOf<NativeMethods.WNDCLASSEX>(),
                // CS_OWNDC    — each window gets its own DC; required for D3D11/GL contexts
                // CS_HREDRAW  — repaint on horizontal resize
                // CS_VREDRAW  — repaint on vertical resize
                style         = NativeMethods.CS_OWNDC | NativeMethods.CS_HREDRAW | NativeMethods.CS_VREDRAW,
                lpfnWndProc   = Marshal.GetFunctionPointerForDelegate(_wndProcDelegate),
                hInstance     = NativeMethods.GetModuleHandle(null),
                hbrBackground = IntPtr.Zero, // no background brush
                lpszClassName = ClassName,
            };

            var atom = NativeMethods.RegisterClassEx(ref wc);
            if (atom == 0)
            {
                var err = Marshal.GetLastWin32Error();
                // 1410 = ERROR_CLASS_ALREADY_EXISTS — safe to ignore (multi-instance scenario)
                if (err != 1410)
                    throw new InvalidOperationException(
                        $"RegisterClassEx failed (Win32 error {err}).");
            }

            _classRegistered = true;
        }
    }

    // ── HwndHost overrides ────────────────────────────────────────────────────

    /// <summary>
    /// Called by WPF's layout engine on every arrange pass (including after
    /// maximize/restore and DPI changes).  We call MoveWindow explicitly with
    /// physical-pixel dimensions so the native child fills the WPF client area
    /// exactly, eliminating any white bars caused by DPI rounding in the base class.
    /// </summary>
    protected override Size ArrangeOverride(Size finalSize)
    {
        var arranged = base.ArrangeOverride(finalSize);

        // Use Math.Ceiling instead of Math.Round so we round UP — under-
        // sizing by even 1 px leaves a black hairline along the edge of
        // the video where MainWindow's black background shows through.
        // Over-sizing by 1 px gets clipped by the parent WPF visual host
        // and is invisible.  Also size to the EXACT finalSize × DPI scale
        // so the child fills wherever WPF placed us, without DPI rounding
        // drift between BiV's pre-DPI logical pixels and post-DPI device
        // pixels.
        if (_childHwnd != IntPtr.Zero)
        {
            var src   = PresentationSource.FromVisual(this);
            double dpiX = src?.CompositionTarget?.TransformToDevice.M11 ?? 1.0;
            double dpiY = src?.CompositionTarget?.TransformToDevice.M22 ?? 1.0;
            int physW = (int)Math.Ceiling(finalSize.Width  * dpiX);
            int physH = (int)Math.Ceiling(finalSize.Height * dpiY);
            if (physW > 0 && physH > 0)
                NativeMethods.MoveWindow(_childHwnd, 0, 0, physW, physH, true);
        }
        return finalSize;
    }

    /// <summary>
    /// Public entry point so MainWindow can force a re-arrange when the
    /// window changes state (maximize / restore / DPI change on monitor
    /// move).  Mpv occasionally fails to resize on certain state
    /// transitions if we don't explicitly poke the host.
    /// </summary>
    public void ForceResize()
    {
        if (_childHwnd == IntPtr.Zero) return;
        var src   = PresentationSource.FromVisual(this);
        double dpiX = src?.CompositionTarget?.TransformToDevice.M11 ?? 1.0;
        double dpiY = src?.CompositionTarget?.TransformToDevice.M22 ?? 1.0;
        int w = (int)Math.Ceiling(ActualWidth  * dpiX);
        int h = (int)Math.Ceiling(ActualHeight * dpiY);
        if (w > 0 && h > 0)
            NativeMethods.MoveWindow(_childHwnd, 0, 0, w, h, true);
    }

    protected override HandleRef BuildWindowCore(HandleRef hwndParent)
    {
        EnsureClassRegistered();

        _childHwnd = NativeMethods.CreateWindowEx(
            dwExStyle:    0,
            lpClassName:  ClassName,
            lpWindowName: "",
            dwStyle:      NativeMethods.WS_CHILD    |
                          NativeMethods.WS_VISIBLE   |
                          NativeMethods.WS_CLIPCHILDREN |
                          NativeMethods.WS_CLIPSIBLINGS,
            x: 0, y: 0, nWidth: 1, nHeight: 1,
            hWndParent: hwndParent.Handle,
            hMenu:      IntPtr.Zero,
            hInstance:  NativeMethods.GetModuleHandle(null),
            lpParam:    IntPtr.Zero);

        if (_childHwnd == IntPtr.Zero)
        {
            var err = Marshal.GetLastWin32Error();
            throw new InvalidOperationException(
                $"CreateWindowEx failed for class '{ClassName}' (Win32 error {err}).");
        }

        return new HandleRef(this, _childHwnd);
    }

    protected override void DestroyWindowCore(HandleRef hwnd)
    {
        if (hwnd.Handle != IntPtr.Zero)
            NativeMethods.DestroyWindow(hwnd.Handle);
        _childHwnd = IntPtr.Zero;
    }
}
