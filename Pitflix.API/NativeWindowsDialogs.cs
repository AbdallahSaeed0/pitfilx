using System.Runtime.Versioning;

namespace Pitflix.API;

/// <summary>STA-thread Win32 folder/file dialogs so the browser UI can obtain real paths via the local API process.</summary>
[SupportedOSPlatform("windows")]
internal static class NativeWindowsDialogs
{
    public static string? PickFolder(string title)
    {
        string? result = null;
        Exception? threadEx = null;
        var thread = new Thread(() =>
        {
            try
            {
                System.Windows.Forms.Application.EnableVisualStyles();
                using var dlg = new System.Windows.Forms.FolderBrowserDialog
                {
                    Description = title,
                    UseDescriptionForTitle = true,
                };
                if (dlg.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                    result = dlg.SelectedPath;
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

    public static string? PickExecutable(string title)
    {
        string? result = null;
        Exception? threadEx = null;
        var thread = new Thread(() =>
        {
            try
            {
                System.Windows.Forms.Application.EnableVisualStyles();
                using var dlg = new System.Windows.Forms.OpenFileDialog
                {
                    Title = title,
                    Filter = "Programs (*.exe)|*.exe|All files (*.*)|*.*",
                    CheckFileExists = true,
                };
                if (dlg.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                    result = dlg.FileName;
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
}
