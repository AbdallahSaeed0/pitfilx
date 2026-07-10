using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Pitflix.API;

/// <summary>STA-thread Win32 folder/file dialogs so the browser UI can obtain real paths via the local API process.</summary>
[SupportedOSPlatform("windows")]
internal static class NativeWindowsDialogs
{
    public static string? PickFolder(string title) =>
        RunOnStaThread(() => ShowPicker(title, pickFolders: true, executableFilter: false));

    public static string? PickExecutable(string title) =>
        RunOnStaThread(() => ShowPicker(title, pickFolders: false, executableFilter: true));

    private static string? RunOnStaThread(Func<string?> action)
    {
        string? result = null;
        Exception? threadEx = null;
        var thread = new Thread(() =>
        {
            try
            {
                result = action();
            }
            catch (Exception ex)
            {
                threadEx = ex;
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        if (threadEx != null)
            throw threadEx;
        return string.IsNullOrWhiteSpace(result) ? null : result.Trim();
    }

    private static string? ShowPicker(string title, bool pickFolders, bool executableFilter)
    {
        IFileOpenDialog? dialog = null;
        try
        {
            dialog = (IFileOpenDialog)new FileOpenDialog();
            var options = (uint)FOS.FOS_FORCEFILESYSTEM | (uint)FOS.FOS_PATHMUSTEXIST;
            if (pickFolders)
                options |= (uint)FOS.FOS_PICKFOLDERS;
            else if (executableFilter)
                options |= (uint)FOS.FOS_FILEMUSTEXIST;

            dialog.SetOptions(options);
            dialog.SetTitle(title);

            if (!pickFolders && executableFilter)
            {
                var filter = new[] { new COMDLG_FILTERSPEC("Programs (*.exe)", "*.exe") };
                dialog.SetFileTypes((uint)filter.Length, filter);
                dialog.SetFileTypeIndex(1);
            }

            var owner = GetForegroundWindow();
            var hr = dialog.Show(owner);
            if (hr == HRESULT.ERROR_CANCELLED)
                return null;
            if (hr < 0)
                Marshal.ThrowExceptionForHR(hr);

            dialog.GetResult(out var item);
            item.GetDisplayName(SIGDN.SIGDN_FILESYSPATH, out var path);
            return path;
        }
        finally
        {
            if (dialog != null)
                Marshal.ReleaseComObject(dialog);
        }
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [Flags]
    private enum FOS : uint
    {
        FOS_PICKFOLDERS = 0x00000020,
        FOS_FORCEFILESYSTEM = 0x00000040,
        FOS_FILEMUSTEXIST = 0x00001000,
        FOS_PATHMUSTEXIST = 0x00000800,
    }

    private static class HRESULT
    {
        public const int ERROR_CANCELLED = unchecked((int)0x800704C7);
    }

    private enum SIGDN : uint
    {
        SIGDN_FILESYSPATH = 0x80058000,
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct COMDLG_FILTERSPEC
    {
        public string pszName;
        public string pszSpec;

        public COMDLG_FILTERSPEC(string name, string spec)
        {
            pszName = name;
            pszSpec = spec;
        }
    }

    [ComImport]
    [Guid("DC1C5A9C-E88A-4DDE-B5A1-30F1BB574331")]
    private class FileOpenDialog;

    [ComImport]
    [Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog
    {
        [PreserveSig]
        int Show(IntPtr hwndOwner);
        void SetFileTypes(uint cFileTypes, [In] COMDLG_FILTERSPEC[] rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, uint fdap);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr pFilter);
    }

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(SIGDN sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }
}
