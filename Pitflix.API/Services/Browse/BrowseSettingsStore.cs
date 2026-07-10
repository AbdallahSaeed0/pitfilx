using System.Text.Json;

namespace Pitflix.API.Services.Browse;

/// <summary>
/// Tiny, isolated settings store for the Browse feature — deliberately its own JSON file
/// rather than the shared LibraryRepository settings table, so this feature has no DB
/// dependency and shares no state with existing services.
/// </summary>
public sealed class BrowseSettingsStore
{
    private sealed record BrowseSettings(string? DownloadPath);

    private static string FilePath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Pitflix", "browse-settings.json");

    /// <summary>Configured download folder, falling back to the OS Downloads folder if unset,
    /// missing, or unreadable. Never throws.</summary>
    public string GetDownloadPath()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var json = File.ReadAllText(FilePath);
                var settings = JsonSerializer.Deserialize<BrowseSettings>(json);
                if (!string.IsNullOrWhiteSpace(settings?.DownloadPath) && Directory.Exists(settings.DownloadPath))
                    return settings.DownloadPath;
            }
        }
        catch
        {
            // Fall through to the default below.
        }

        return DefaultDownloadsFolder();
    }

    private static string DefaultDownloadsFolder() =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
}
