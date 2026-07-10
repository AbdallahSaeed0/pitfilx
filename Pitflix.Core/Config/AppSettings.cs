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

    /// <summary>Trakt OAuth app client id/secret (DB → appsettings.local.json → env). DB is the primary
    /// path — these are entered once in Settings → Trakt, so anyone running their own Pitflix install
    /// (e.g. a friend) can self-serve without editing config files.</summary>
    public static string? ResolvedTraktClientId { get; set; }

    public static string? ResolvedTraktClientSecret { get; set; }

    /// <summary>Supabase project URL for the mobile-sync module (DB → appsettings.local.json → env).</summary>
    public static string? ResolvedSupabaseUrl { get; set; }

    /// <summary>Supabase service-role (or anon, in the no-auth phase) key for the mobile-sync module.</summary>
    public static string? ResolvedSupabaseServiceRoleKey { get; set; }

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

    /// <summary>Order: DB <c>TraktClientId</c>/<c>TraktClientSecret</c>, then appsettings.local.json
    /// (<c>Pitflix:Trakt:ClientId</c>/<c>ClientSecret</c>), then <c>TRAKT_CLIENT_ID</c>/<c>TRAKT_CLIENT_SECRET</c> env.</summary>
    public static void ResolveTraktCredentialsFromSources(LibraryRepository repository)
    {
        string? id;
        string? secret;
        try
        {
            id = repository.GetSettingAsync("TraktClientId").GetAwaiter().GetResult();
            secret = repository.GetSettingAsync("TraktClientSecret").GetAwaiter().GetResult();
        }
        catch
        {
            id = null;
            secret = null;
        }

        if (!string.IsNullOrWhiteSpace(id) && !string.IsNullOrWhiteSpace(secret))
        {
            ResolvedTraktClientId = id.Trim();
            ResolvedTraktClientSecret = secret.Trim();
            return;
        }

        TryLoadTraktCredentialsFromLocalFile(out var fileId, out var fileSecret);
        if (!string.IsNullOrWhiteSpace(fileId) && !string.IsNullOrWhiteSpace(fileSecret))
        {
            ResolvedTraktClientId = fileId;
            ResolvedTraktClientSecret = fileSecret;
            return;
        }

        ResolvedTraktClientId = Environment.GetEnvironmentVariable("TRAKT_CLIENT_ID");
        ResolvedTraktClientSecret = Environment.GetEnvironmentVariable("TRAKT_CLIENT_SECRET");
    }

    private static void TryLoadTraktCredentialsFromLocalFile(out string? clientId, out string? clientSecret)
    {
        clientId = null;
        clientSecret = null;
        foreach (var path in AppLocalConfigFileCandidates())
        {
            if (!File.Exists(path))
                continue;
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(path));
                if (doc.RootElement.TryGetProperty("Pitflix", out var pitflix) &&
                    pitflix.TryGetProperty("Trakt", out var trakt))
                {
                    if (trakt.TryGetProperty("ClientId", out var idEl))
                        clientId = idEl.GetString()?.Trim();
                    if (trakt.TryGetProperty("ClientSecret", out var secretEl))
                        clientSecret = secretEl.GetString()?.Trim();
                }
            }
            catch
            {
                // ignore malformed file
            }

            if (!string.IsNullOrEmpty(clientId) && !string.IsNullOrEmpty(clientSecret))
                return;
        }
    }

    /// <summary>Order: DB <c>SupabaseUrl</c>/<c>SupabaseServiceRoleKey</c>, then appsettings.local.json
    /// (<c>Pitflix:Supabase:Url</c>/<c>ServiceRoleKey</c>), then <c>SUPABASE_URL</c>/<c>SUPABASE_SERVICE_ROLE_KEY</c> env.</summary>
    public static void ResolveSupabaseCredentialsFromSources(LibraryRepository repository)
    {
        string? url;
        string? key;
        try
        {
            url = repository.GetSettingAsync("SupabaseUrl").GetAwaiter().GetResult();
            key = repository.GetSettingAsync("SupabaseServiceRoleKey").GetAwaiter().GetResult();
        }
        catch
        {
            url = null;
            key = null;
        }

        if (!string.IsNullOrWhiteSpace(url) && !string.IsNullOrWhiteSpace(key))
        {
            ResolvedSupabaseUrl = url.Trim().TrimEnd('/');
            ResolvedSupabaseServiceRoleKey = key.Trim();
            return;
        }

        TryLoadSupabaseCredentialsFromLocalFile(out var fileUrl, out var fileKey);
        if (!string.IsNullOrWhiteSpace(fileUrl) && !string.IsNullOrWhiteSpace(fileKey))
        {
            ResolvedSupabaseUrl = fileUrl.TrimEnd('/');
            ResolvedSupabaseServiceRoleKey = fileKey;
            return;
        }

        var envUrl = Environment.GetEnvironmentVariable("SUPABASE_URL");
        ResolvedSupabaseUrl = string.IsNullOrWhiteSpace(envUrl) ? null : envUrl.Trim().TrimEnd('/');
        ResolvedSupabaseServiceRoleKey = Environment.GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY");
    }

    private static void TryLoadSupabaseCredentialsFromLocalFile(out string? url, out string? serviceRoleKey)
    {
        url = null;
        serviceRoleKey = null;
        foreach (var path in AppLocalConfigFileCandidates())
        {
            if (!File.Exists(path))
                continue;
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(path));
                if (doc.RootElement.TryGetProperty("Pitflix", out var pitflix) &&
                    pitflix.TryGetProperty("Supabase", out var supabase))
                {
                    if (supabase.TryGetProperty("Url", out var urlEl))
                        url = urlEl.GetString()?.Trim();
                    if (supabase.TryGetProperty("ServiceRoleKey", out var keyEl))
                        serviceRoleKey = keyEl.GetString()?.Trim();
                }
            }
            catch
            {
                // ignore malformed file
            }

            if (!string.IsNullOrEmpty(url) && !string.IsNullOrEmpty(serviceRoleKey))
                return;
        }
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
