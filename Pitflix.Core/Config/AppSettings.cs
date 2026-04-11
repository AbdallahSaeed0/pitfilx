using System.Text.Json;
using Pitflix.Core.Database;

namespace Pitflix.Core.Config;

public class AppSettings
{
    public string TmdbApiKey { get; set; } = "PASTE_YOUR_KEY_HERE";

    /// <summary>Effective TMDB key after startup resolution (DB → appsettings.local.json → env). Updated when the user saves in Settings or completes setup.</summary>
    public static string? ResolvedTmdbApiKey { get; set; }

    /// <summary>Effective OpenSubtitles API key (same resolution order).</summary>
    public static string? ResolvedOpenSubtitlesApiKey { get; set; }

    /// <summary>App name sent to OpenSubtitles (DB → file → default).</summary>
    public static string? ResolvedOpenSubtitlesAppName { get; set; }

    /// <summary>
    /// Call after <see cref="LibraryRepository"/> is available.
    /// Order: SQLite <c>TmdbApiKey</c>, then appsettings.local.json, then <c>TMDB_API_KEY</c> env.
    /// </summary>
    public static void ResolveTmdbApiKeyFromSources(LibraryRepository repository)
    {
        string? k;
        try
        {
            k = repository.GetSettingAsync("TmdbApiKey").GetAwaiter().GetResult();
        }
        catch
        {
            k = null;
        }

        if (IsValidTmdbKey(k))
        {
            ResolvedTmdbApiKey = k;
            return;
        }

        k = TryLoadTmdbApiKeyFromLocalFile();
        if (IsValidTmdbKey(k))
        {
            ResolvedTmdbApiKey = k;
            return;
        }

        k = Environment.GetEnvironmentVariable("TMDB_API_KEY");
        ResolvedTmdbApiKey = IsValidTmdbKey(k) ? k : null;
    }

    /// <summary>Order: DB <c>OpenSubtitlesApiKey</c>, then appsettings.local.json, then <c>OPENSUBTITLES_API_KEY</c> env.</summary>
    public static void ResolveOpenSubtitlesFromSources(LibraryRepository repository)
    {
        string? key;
        try
        {
            key = repository.GetSettingAsync("OpenSubtitlesApiKey").GetAwaiter().GetResult();
        }
        catch
        {
            key = null;
        }

        if (IsValidOpenSubtitlesKey(key))
        {
            ResolvedOpenSubtitlesApiKey = key;
            ResolvedOpenSubtitlesAppName = TryLoadOpenSubtitlesAppNameFromSources(repository);
            return;
        }

        TryLoadOpenSubtitlesFromLocalFile(out key, out var appName);
        if (IsValidOpenSubtitlesKey(key))
        {
            ResolvedOpenSubtitlesApiKey = key;
            ResolvedOpenSubtitlesAppName = string.IsNullOrWhiteSpace(appName) ? "Pitflix" : appName;
            return;
        }

        key = Environment.GetEnvironmentVariable("OPENSUBTITLES_API_KEY");
        ResolvedOpenSubtitlesApiKey = IsValidOpenSubtitlesKey(key) ? key : null;
        ResolvedOpenSubtitlesAppName = ResolvedOpenSubtitlesApiKey != null
            ? (Environment.GetEnvironmentVariable("OPENSUBTITLES_APP_NAME")?.Trim() is { Length: > 0 } envApp
                ? envApp
                : "Pitflix")
            : null;
    }

    private static string? TryLoadOpenSubtitlesAppNameFromSources(LibraryRepository repository)
    {
        try
        {
            var fromDb = repository.GetSettingAsync("OpenSubtitlesAppName").GetAwaiter().GetResult();
            if (!string.IsNullOrWhiteSpace(fromDb))
                return fromDb.Trim();
        }
        catch
        {
            /* ignore */
        }

        TryLoadOpenSubtitlesFromLocalFile(out _, out var app);
        if (!string.IsNullOrWhiteSpace(app))
            return app.Trim();
        var env = Environment.GetEnvironmentVariable("OPENSUBTITLES_APP_NAME");
        return string.IsNullOrWhiteSpace(env) ? "Pitflix" : env.Trim();
    }

    public static bool IsValidTmdbKey(string? key) =>
        !string.IsNullOrWhiteSpace(key)
        && !key.Contains("PASTE_YOUR_KEY", StringComparison.OrdinalIgnoreCase)
        && !key.Contains("YOUR_", StringComparison.Ordinal);

    public static bool IsValidOpenSubtitlesKey(string? key) =>
        !string.IsNullOrWhiteSpace(key);

    /// <summary>Optional JSON: { "TmdbApiKey": "...", "OpenSubtitlesApiKey": "...", ... }.</summary>
    public static string? TryLoadTmdbApiKeyFromLocalFile()
    {
        foreach (var path in AppLocalConfigFileCandidates())
        {
            if (!File.Exists(path))
                continue;
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(path));
                if (doc.RootElement.TryGetProperty("TmdbApiKey", out var el))
                {
                    var key = el.GetString();
                    if (!string.IsNullOrWhiteSpace(key) && !key.Contains("YOUR_", StringComparison.Ordinal))
                        return key;
                }
            }
            catch
            {
                // ignore malformed file
            }
        }

        return null;
    }

    public static void TryLoadOpenSubtitlesFromLocalFile(out string? apiKey, out string? appName)
    {
        apiKey = null;
        appName = null;
        foreach (var path in AppLocalConfigFileCandidates())
        {
            if (!File.Exists(path))
                continue;
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(path));
                if (doc.RootElement.TryGetProperty("OpenSubtitlesApiKey", out var el))
                {
                    var k = el.GetString()?.Trim();
                    if (!string.IsNullOrEmpty(k))
                        apiKey = k;
                }

                if (doc.RootElement.TryGetProperty("OpenSubtitlesAppName", out var appEl))
                {
                    var a = appEl.GetString()?.Trim();
                    if (!string.IsNullOrEmpty(a))
                        appName = a;
                }

                if (apiKey != null)
                    return;
            }
            catch
            {
                /* ignore */
            }
        }
    }

    private static IEnumerable<string> AppLocalConfigFileCandidates()
    {
        var cwd = Directory.GetCurrentDirectory();
        yield return Path.Combine(cwd, "appsettings.local.json");
        yield return Path.Combine(cwd, "Pitflix.ConsoleTest", "appsettings.local.json");

        var dir = AppContext.BaseDirectory;
        for (var i = 0; i < 12 && !string.IsNullOrEmpty(dir); i++)
        {
            yield return Path.Combine(dir, "appsettings.local.json");
            yield return Path.Combine(dir, "Pitflix.ConsoleTest", "appsettings.local.json");
            var parent = Directory.GetParent(dir);
            dir = parent?.FullName ?? "";
        }
    }

    public List<string> LibraryPaths { get; set; } =
    [
        @"F:\Series\Engilsh",
        @"F:\Movies\اجنبي"
    ];
}
