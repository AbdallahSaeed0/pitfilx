#if WINDOWS
using System.Runtime.InteropServices;

namespace PitflixPlayer;

/// <summary>Raw COM interop for ITaskbarList3 thumbnail-toolbar buttons.</summary>
internal static class TaskbarInterop
{
    internal const int WM_COMMAND    = 0x0111;
    internal const int THBN_CLICKED  = 0x1800;

    internal const int ThbIcon     = 0x2;
    internal const int ThbTooltip  = 0x4;
    internal const int ThbFlags    = 0x8;

    internal const int ThbfEnabled  = 0x0;
    internal const int ThbfDisabled = 0x1;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct ThumbButton
    {
        public int    dwMask;
        public uint   iId;
        public int    iBitmap;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szTip;
        public int    dwFlags;
    }

    [ComImport]
    [Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ITaskbarList
    {
        void HrInit();
        void AddTab(IntPtr hwnd);
        void DeleteTab(IntPtr hwnd);
        void ActivateTab(IntPtr hwnd);
        void SetActiveAlt(IntPtr hwnd);
    }

    [ComImport]
    [Guid("602d4995-b13a-429b-a66e-1935e44f4317")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ITaskbarList2 : ITaskbarList
    {
        new void HrInit();
        new void AddTab(IntPtr hwnd);
        new void DeleteTab(IntPtr hwnd);
        new void ActivateTab(IntPtr hwnd);
        new void SetActiveAlt(IntPtr hwnd);
        void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fullscreen);
    }

    [ComImport]
    [Guid("c43dc798-95d1-4bea-9030-bb99e2983a1a")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ITaskbarList3 : ITaskbarList2
    {
        new void HrInit();
        new void AddTab(IntPtr hwnd);
        new void DeleteTab(IntPtr hwnd);
        new void ActivateTab(IntPtr hwnd);
        new void SetActiveAlt(IntPtr hwnd);
        new void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fullscreen);
        void SetProgressValue(IntPtr hwnd, ulong completed, ulong total);
        void SetProgressState(IntPtr hwnd, int state);
        void RegisterTab(IntPtr hwndTab, IntPtr hwndMDI);
        void UnregisterTab(IntPtr hwndTab);
        void SetTabOrder(IntPtr hwndTab, IntPtr hwndInsertBefore);
        void SetTabActive(IntPtr hwndTab, IntPtr hwndMDI, int flags);
        void ThumbBarAddButtons(IntPtr hwnd, uint cButtons, [MarshalAs(UnmanagedType.LPArray)] ThumbButton[] buttons);
        void ThumbBarUpdateButtons(IntPtr hwnd, uint cButtons, [MarshalAs(UnmanagedType.LPArray)] ThumbButton[] buttons);
        void ThumbBarSetImageList(IntPtr hwnd, IntPtr himl);
        void SetOverlayIcon(IntPtr hwnd, IntPtr hIcon, [MarshalAs(UnmanagedType.LPWStr)] string? description);
        void SetThumbnailTooltip(IntPtr hwnd, [MarshalAs(UnmanagedType.LPWStr)] string? tooltip);
        void SetThumbnailClip(IntPtr hwnd, IntPtr clip);
    }

    [ComImport]
    [Guid("56FDF344-FD6D-11d0-958A-006097C9A090")]
    private class TaskbarList { }

    private static ITaskbarList3? Create()
    {
        try
        {
            var taskbar = (ITaskbarList3)new TaskbarList();
            taskbar.HrInit();
            return taskbar;
        }
        catch (Exception ex)
        {
            App.Log($"TaskbarInterop: CoCreateInstance failed: {ex.Message}");
            return null;
        }
    }

    internal static bool AddButtons(IntPtr hwnd, ThumbButton[] buttons)
    {
        if (hwnd == IntPtr.Zero || buttons.Length == 0) return false;
        var taskbar = Create();
        if (taskbar is null) return false;
        try
        {
            taskbar.ThumbBarAddButtons(hwnd, (uint)buttons.Length, buttons);
            return true;
        }
        catch (Exception ex)
        {
            App.Log($"TaskbarInterop.AddButtons failed: {ex.Message}");
            return false;
        }
    }

    internal static void UpdateButtons(IntPtr hwnd, ThumbButton[] buttons)
    {
        if (hwnd == IntPtr.Zero || buttons.Length == 0) return;
        var taskbar = Create();
        if (taskbar is null) return;
        try
        {
            taskbar.ThumbBarUpdateButtons(hwnd, (uint)buttons.Length, buttons);
        }
        catch (Exception ex)
        {
            App.Log($"TaskbarInterop.UpdateButtons failed: {ex.Message}");
        }
    }
}
#endif
