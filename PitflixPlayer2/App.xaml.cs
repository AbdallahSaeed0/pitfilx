using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace PitflixPlayer;

public partial class App : Application
{
    // Log file next to the exe so we can inspect it even after a native crash
    internal static readonly string LogPath = Path.Combine(
        AppContext.BaseDirectory, "PitflixPlayer.log");

    // Persistent user preferences (subtitle language, etc.).  Loaded once at
    // startup; ControlsWindow saves through this same instance whenever the
    // user changes a tracked preference.  See AppSettings.cs.
    internal static AppSettings Settings { get; } = AppSettings.Load();

    public App()
    {
        Log("App starting");
        Log($"Subtitle preference loaded: mode={Settings.PreferredSubMode}, lang={Settings.PreferredSubLang ?? "(none)"}");
        DispatcherUnhandledException          += OnDispatcherException;
        AppDomain.CurrentDomain.UnhandledException += OnDomainException;
        TaskScheduler.UnobservedTaskException += OnTaskException;
    }

    private static void OnDispatcherException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        e.Handled = true;
        Log($"[Dispatcher] {e.Exception}");
        ShowError("Dispatcher", e.Exception);
    }

    private static void OnDomainException(object sender, UnhandledExceptionEventArgs e)
    {
        Log($"[AppDomain] {e.ExceptionObject}");
        ShowError("AppDomain", e.ExceptionObject as Exception);
    }

    private static void OnTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
    {
        e.SetObserved();
        Log($"[Task] {e.Exception}");
        ShowError("Task", e.Exception);
    }

    private static void ShowError(string source, Exception? ex)
    {
        var msg = ex?.ToString() ?? "Unknown error";
        MessageBox.Show($"[{source}]\n\n{msg}",
                        "PitflixPlayer — Unhandled Exception",
                        MessageBoxButton.OK, MessageBoxImage.Error);
    }

    internal static void Log(string message)
    {
        try
        {
            File.AppendAllText(LogPath,
                $"[{DateTime.Now:HH:mm:ss.fff}] {message}{Environment.NewLine}");
        }
        catch { /* never crash the app trying to log */ }
    }
}
