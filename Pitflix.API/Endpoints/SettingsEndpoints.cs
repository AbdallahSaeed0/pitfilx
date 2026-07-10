using System.Diagnostics;
using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitflix.API.Services;
using Pitflix.Core.Config;
using Pitflix.Core.Database;

namespace Pitflix.API.Endpoints;

public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
app.MapGet("/api/settings", async (LibraryRepository repo, LibraryContext db, CancellationToken ct) =>
{
    await repo.EnsureLibraryFoldersTableAsync(ct).ConfigureAwait(false);
    var key = await repo.GetSettingAsync("TmdbApiKey", ct).ConfigureAwait(false);
    var masked = MaskKey(key);
    var osKey = await repo.GetSettingAsync("OpenSubtitlesApiKey", ct).ConfigureAwait(false);
    var osMasked = MaskKey(osKey);
    var sdlKey = await repo.GetSettingAsync("SubDlApiKey", ct).ConfigureAwait(false);
    var sdlMasked = MaskKey(sdlKey);
    var ssKey = await repo.GetSettingAsync("SubSourceApiKey", ct).ConfigureAwait(false);
    var ssMasked = MaskKey(ssKey);
    var mdblistKey = await repo.GetSettingAsync("MdblistApiKey", ct).ConfigureAwait(false);
    var mdblistMasked = MaskKey(mdblistKey);
    var tvdbKey = await repo.GetSettingAsync("TvdbApiKey", ct).ConfigureAwait(false);
    var tvdbMasked = MaskKey(tvdbKey);
    var letterboxdUsername = await repo.GetSettingAsync("LetterboxdUsername", ct).ConfigureAwait(false);
    var qbittorrentBaseUrl = await repo.GetSettingAsync("QBittorrentBaseUrl", ct).ConfigureAwait(false);
    var qbittorrentUsername = await repo.GetSettingAsync("QBittorrentUsername", ct).ConfigureAwait(false);
    var qbittorrentPassword = await repo.GetSettingAsync("QBittorrentPassword", ct).ConfigureAwait(false);
    var qbittorrentPasswordMasked = MaskKey(qbittorrentPassword);
    var paths = await repo.GetAllLibraryPathsAsync(ct).ConfigureAwait(false);
    var pinnedScanPaths = (await repo.GetPinnedScanPathsAsync(ct).ConfigureAwait(false)).ToList();
    var excludedScanPaths = (await repo.GetExcludedScanPathsAsync(ct).ConfigureAwait(false)).ToList();
    var matchedMovies = await repo.CountMatchedMoviesAsync(ct).ConfigureAwait(false);
    var matchedSeries = await repo.CountMatchedShowsAsync(ct).ConfigureAwait(false);
    var unmatchedCount = await db.ScanLogs.AsNoTracking().CountAsync(x => x.Status == "Unmatched", ct)
        .ConfigureAwait(false);
    var mediaPlayerPath = await repo.GetSettingAsync("MediaPlayerPath", ct).ConfigureAwait(false) ?? "";
    var useBuiltinRaw = await repo.GetSettingAsync("UseBuiltinPlayer", ct).ConfigureAwait(false);
    var useBuiltinPlayer = string.IsNullOrWhiteSpace(useBuiltinRaw) ||
                           string.Equals(useBuiltinRaw, "true", StringComparison.OrdinalIgnoreCase);
    var playerMode = await repo.GetSettingAsync("PlayerMode", ct).ConfigureAwait(false) ?? "detached";

    var hdrMode = await repo.GetSettingAsync("HdrMode", ct).ConfigureAwait(false);
    if (hdrMode is not ("auto" or "true_hdr" or "tonemap_sdr"))
        hdrMode = "auto";
    var audioPassthroughRaw = await repo.GetSettingAsync("AudioPassthrough", ct).ConfigureAwait(false);
    var audioPassthrough = string.Equals(audioPassthroughRaw, "true", StringComparison.OrdinalIgnoreCase);

    var scanToastsRaw = await repo.GetSettingAsync("LibraryScanDesktopToasts", ct).ConfigureAwait(false);
    var libraryScanDesktopToasts = string.IsNullOrWhiteSpace(scanToastsRaw) ||
                                   string.Equals(scanToastsRaw, "true", StringComparison.OrdinalIgnoreCase);

    var supabaseSyncEnabledRaw = await repo.GetSettingAsync("SupabaseSyncEnabled", ct).ConfigureAwait(false);
    var supabaseSyncEnabled = string.Equals(supabaseSyncEnabledRaw, "true", StringComparison.OrdinalIgnoreCase);
    var supabaseUrl = await repo.GetSettingAsync("SupabaseUrl", ct).ConfigureAwait(false);
    var supabaseServiceRoleKeyMasked = MaskKey(await repo.GetSettingAsync("SupabaseServiceRoleKey", ct)
        .ConfigureAwait(false));

    var setupRaw = await repo.GetSettingAsync("SetupComplete", ct).ConfigureAwait(false);
    var setupComplete = string.Equals(setupRaw, "true", StringComparison.OrdinalIgnoreCase);

    var stepRaw = await repo.GetSettingAsync("SetupWizardStep", ct).ConfigureAwait(false);
    int? setupWizardStep = int.TryParse(stepRaw, out var ws) ? ws : null;
    var wizardJson = await repo.GetSettingAsync("SetupWizardState", ct).ConfigureAwait(false);
    object? setupWizardState = null;
    if (!string.IsNullOrWhiteSpace(wizardJson))
    {
        try
        {
            setupWizardState = JsonSerializer.Deserialize<object>(wizardJson);
        }
        catch
        {
            setupWizardState = null;
        }
    }

    return Results.Json(new
    {
        tmdbApiKey = masked,
        openSubtitlesApiKey = osMasked,
        subDlApiKey = sdlMasked,
        subSourceApiKey = ssMasked,
        mdblistApiKey = mdblistMasked,
        tvdbApiKey = tvdbMasked,
        letterboxdUsername,
        qbittorrentBaseUrl,
        qbittorrentUsername,
        qbittorrentPassword = qbittorrentPasswordMasked,
        libraryPaths = paths,
        pinnedScanPaths,
        excludedScanPaths,
        matchedMovies,
        matchedSeries,
        unmatchedCount,
        mediaPlayerPath,
        useBuiltinPlayer,
        playerMode,
        hdrMode,
        audioPassthrough,
        libraryScanDesktopToasts,
        supabaseSyncEnabled,
        supabaseUrl,
        supabaseServiceRoleKey = supabaseServiceRoleKeyMasked,
        setupComplete,
        setupWizardStep,
        setupWizardState
    });
});

app.MapPost("/api/settings", async (SettingsBody body, LibraryRepository repo, CancellationToken ct) =>
{
    if (body.LibraryPaths != null)
    {
        var existing = await repo.GetAllLibraryPathsAsync(ct).ConfigureAwait(false);
        foreach (var p in existing)
        {
            if (!body.LibraryPaths.Contains(p, StringComparer.OrdinalIgnoreCase))
                await repo.RemoveLibraryPathAsync(p, ct).ConfigureAwait(false);
        }

        foreach (var p in body.LibraryPaths)
        {
            if (!string.IsNullOrWhiteSpace(p))
                await repo.SaveLibraryPathAsync(p.Trim(), ct).ConfigureAwait(false);
        }
    }

    if (!string.IsNullOrWhiteSpace(body.TmdbApiKey) &&
        !body.TmdbApiKey.Contains("PASTE_YOUR_KEY", StringComparison.OrdinalIgnoreCase))
        await repo.SaveSettingAsync("TmdbApiKey", body.TmdbApiKey.Trim(), ct).ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.OpenSubtitlesApiKey))
        await repo.SaveSettingAsync("OpenSubtitlesApiKey", body.OpenSubtitlesApiKey.Trim(), ct).ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.SubDlApiKey))
        await repo.SaveSettingAsync("SubDlApiKey", body.SubDlApiKey.Trim(), ct).ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.SubSourceApiKey))
        await repo.SaveSettingAsync("SubSourceApiKey", body.SubSourceApiKey.Trim(), ct).ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.MdblistApiKey))
        await repo.SaveSettingAsync("MdblistApiKey", body.MdblistApiKey.Trim(), ct).ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.TvdbApiKey))
        await repo.SaveSettingAsync("TvdbApiKey", body.TvdbApiKey.Trim(), ct).ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.LetterboxdUsername))
        await repo.SaveSettingAsync("LetterboxdUsername", body.LetterboxdUsername.Trim(), ct).ConfigureAwait(false);

    if (body.QBittorrentBaseUrl != null)
        await repo.SaveSettingAsync("QBittorrentBaseUrl", body.QBittorrentBaseUrl.Trim(), ct).ConfigureAwait(false);

    if (body.QBittorrentUsername != null)
        await repo.SaveSettingAsync("QBittorrentUsername", body.QBittorrentUsername.Trim(), ct).ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.QBittorrentPassword))
        await repo.SaveSettingAsync("QBittorrentPassword", body.QBittorrentPassword.Trim(), ct).ConfigureAwait(false);

    if (body.OpenSubtitlesAppName != null)
        await repo.SaveSettingAsync("OpenSubtitlesAppName", body.OpenSubtitlesAppName.Trim(), ct).ConfigureAwait(false);

    if (body.MediaPlayerPath != null)
        await repo.SaveSettingAsync("MediaPlayerPath", body.MediaPlayerPath.Trim(), ct).ConfigureAwait(false);

    if (body.UseBuiltinPlayer.HasValue)
        await repo.SaveSettingAsync("UseBuiltinPlayer", body.UseBuiltinPlayer.Value ? "true" : "false", ct)
            .ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.PlayerMode))
        await repo.SaveSettingAsync("PlayerMode", body.PlayerMode.Trim(), ct).ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.HdrMode) &&
        body.HdrMode is "auto" or "true_hdr" or "tonemap_sdr")
        await repo.SaveSettingAsync("HdrMode", body.HdrMode, ct).ConfigureAwait(false);

    if (body.AudioPassthrough.HasValue)
        await repo.SaveSettingAsync("AudioPassthrough", body.AudioPassthrough.Value ? "true" : "false", ct)
            .ConfigureAwait(false);

    if (body.LibraryScanDesktopToasts.HasValue)
        await repo.SaveSettingAsync("LibraryScanDesktopToasts", body.LibraryScanDesktopToasts.Value ? "true" : "false", ct)
            .ConfigureAwait(false);

    if (body.SupabaseSyncEnabled.HasValue)
        await repo.SaveSettingAsync("SupabaseSyncEnabled", body.SupabaseSyncEnabled.Value ? "true" : "false", ct)
            .ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.SupabaseUrl))
        await repo.SaveSettingAsync("SupabaseUrl", body.SupabaseUrl.Trim(), ct).ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.SupabaseServiceRoleKey))
        await repo.SaveSettingAsync("SupabaseServiceRoleKey", body.SupabaseServiceRoleKey.Trim(), ct)
            .ConfigureAwait(false);

    AppSettings.ResolveTmdbApiKeyFromSources(repo);
    AppSettings.ResolveOpenSubtitlesFromSources(repo);
    AppSettings.ResolveSupabaseCredentialsFromSources(repo);
    return Results.Json(new { success = true });
});

app.MapGet("/api/settings/verify-tmdb", async (string? key, CancellationToken ct) =>
{
    var k = key?.Trim();
    if (string.IsNullOrEmpty(k))
        return Results.Json(new { valid = false, error = "Key is required." }, jsonSerializerOptions);

    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        var url = $"https://api.themoviedb.org/3/configuration?api_key={Uri.EscapeDataString(k)}";
        using var res = await http.GetAsync(url, ct).ConfigureAwait(false);
        if (res.IsSuccessStatusCode)
            return Results.Json(new { valid = true, error = (string?)null }, jsonSerializerOptions);

        var err = res.StatusCode == HttpStatusCode.Unauthorized
            ? "Unauthorized — check the key."
            : $"TMDB returned {(int)res.StatusCode}.";
        return Results.Json(new { valid = false, error = err }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "TMDB API key verification failed");
        return Results.Json(new { valid = false, error = ex.Message }, jsonSerializerOptions);
    }
});

app.MapGet("/api/settings/verify-opensubtitles", async (string? key, CancellationToken ct) =>
{
    var k = key?.Trim();
    if (string.IsNullOrEmpty(k))
        return Results.Json(new { valid = false, error = "Key is required." }, jsonSerializerOptions);

    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        http.DefaultRequestHeaders.TryAddWithoutValidation("Api-Key", k);
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix Setup v1.0");
        using var res = await http
            .GetAsync(new Uri("https://api.opensubtitles.com/api/v1/infos/languages"), ct)
            .ConfigureAwait(false);
        if (res.IsSuccessStatusCode)
            return Results.Json(new { valid = true, error = (string?)null }, jsonSerializerOptions);

        var err = res.StatusCode == HttpStatusCode.Unauthorized
            ? "Unauthorized — check the API key."
            : $"OpenSubtitles returned {(int)res.StatusCode}.";
        return Results.Json(new { valid = false, error = err }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "OpenSubtitles API key verification failed");
        return Results.Json(new { valid = false, error = ex.Message }, jsonSerializerOptions);
    }
});

app.MapGet("/api/settings/verify-subdl", async (string? key, CancellationToken ct) =>
{
    var k = key?.Trim();
    if (string.IsNullOrEmpty(k))
        return Results.Json(new { valid = false, error = "Key is required." }, jsonSerializerOptions);

    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        // Use a known IMDB ID (The Godfather) for a reliable probe
        var url = $"https://api.subdl.com/api/v1/subtitles?api_key={Uri.EscapeDataString(k)}&imdb_id=tt0068646&type=movie";
        using var res = await http.GetAsync(url, ct).ConfigureAwait(false);

        if (res.StatusCode == HttpStatusCode.Unauthorized || res.StatusCode == HttpStatusCode.Forbidden)
            return Results.Json(new { valid = false, error = "Unauthorized — check the API key." }, jsonSerializerOptions);

        if (res.IsSuccessStatusCode)
        {
            // SubDL returns {"status":false,...} for invalid keys even on 200
            var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            try
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("status", out var statusEl))
                {
                    // status can be bool true/false or int 1/0
                    var ok = statusEl.ValueKind == JsonValueKind.True
                        || (statusEl.ValueKind == JsonValueKind.Number && statusEl.GetInt32() == 1);
                    if (!ok)
                    {
                        var msg = doc.RootElement.TryGetProperty("message", out var m) ? m.GetString() : null;
                        return Results.Json(new { valid = false, error = msg ?? "Invalid API key." }, jsonSerializerOptions);
                    }
                }
            }
            catch { /* If we can't parse, assume valid (empty result is OK) */ }
            return Results.Json(new { valid = true, error = (string?)null }, jsonSerializerOptions);
        }

        return Results.Json(new { valid = false, error = $"SubDL returned {(int)res.StatusCode}." }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "SubDL API key verification failed");
        return Results.Json(new { valid = false, error = ex.Message }, jsonSerializerOptions);
    }
});

app.MapGet("/api/settings/verify-subsource", async (string? key, CancellationToken ct) =>
{
    var k = key?.Trim();
    if (string.IsNullOrEmpty(k))
        return Results.Json(new { valid = false, error = "Key is required." }, jsonSerializerOptions);

    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        using var req = new HttpRequestMessage(
            HttpMethod.Get, "https://api.subsource.net/api/v1/movies/search?searchType=text&q=The+Godfather");
        req.Headers.TryAddWithoutValidation("X-API-Key", k);
        using var res = await http.SendAsync(req, ct).ConfigureAwait(false);

        if (res.StatusCode == HttpStatusCode.Unauthorized || res.StatusCode == HttpStatusCode.Forbidden)
            return Results.Json(new { valid = false, error = "Unauthorized — check the API key." }, jsonSerializerOptions);

        if (res.IsSuccessStatusCode)
            return Results.Json(new { valid = true, error = (string?)null }, jsonSerializerOptions);

        return Results.Json(new { valid = false, error = $"SubSource returned {(int)res.StatusCode}." }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "SubSource API key verification failed");
        return Results.Json(new { valid = false, error = ex.Message }, jsonSerializerOptions);
    }
});

app.MapGet("/api/settings/verify-mdblist", async (string? key, CancellationToken ct) =>
{
    var k = key?.Trim();
    if (string.IsNullOrEmpty(k))
        return Results.Json(new { valid = false, error = "Key is required." }, jsonSerializerOptions);

    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        // Probe with The Shawshank Redemption (tt0111161)
        var url = $"https://mdblist.com/api/?i=tt0111161&apikey={Uri.EscapeDataString(k)}";
        using var res = await http.GetAsync(url, ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
            return Results.Json(new { valid = false, error = $"MDBList returned {(int)res.StatusCode}." }, jsonSerializerOptions);

        var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(body);
        // MDBList returns { "error": true, "message": "..." } on bad key
        if (doc.RootElement.TryGetProperty("error", out var errEl) && errEl.ValueKind == JsonValueKind.True)
        {
            var msg = doc.RootElement.TryGetProperty("message", out var m) ? m.GetString() : null;
            return Results.Json(new { valid = false, error = msg ?? "Invalid API key." }, jsonSerializerOptions);
        }

        // Extract IMDb score for the toast
        float? imdbScore = null;
        if (doc.RootElement.TryGetProperty("ratings", out var ratingsEl))
        {
            foreach (var item in ratingsEl.EnumerateArray())
            {
                if (!item.TryGetProperty("source", out var src) || src.GetString() != "imdb") continue;
                if (!item.TryGetProperty("value", out var val)) continue;
                if (val.ValueKind == JsonValueKind.Number)
                    imdbScore = val.GetSingle();
                else if (val.ValueKind == JsonValueKind.String &&
                         float.TryParse(val.GetString(), System.Globalization.NumberStyles.Any,
                             System.Globalization.CultureInfo.InvariantCulture, out var parsed))
                    imdbScore = parsed;
            }
        }

        // Include a raw body snippet to help diagnose parsing issues
        var rawSnippet = body.Length > 600 ? body[..600] + "…" : body;
        return Results.Json(new { valid = true, imdbScore, rawSnippet, error = (string?)null }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "MDBList API key verification failed");
        return Results.Json(new { valid = false, error = ex.Message }, jsonSerializerOptions);
    }
});

app.MapGet("/api/settings/verify-tvdb", async (string? key, CancellationToken ct) =>
{
    var k = key?.Trim();
    if (string.IsNullOrEmpty(k))
        return Results.Json(new { valid = false, error = "Key is required." }, jsonSerializerOptions);

    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api4.thetvdb.com/v4/login");
        req.Content = JsonContent.Create(new { apikey = k });
        using var res = await http.SendAsync(req, ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
            return Results.Json(new { valid = false, error = $"TVDB returned {(int)res.StatusCode}." }, jsonSerializerOptions);

        var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(body);
        if (!doc.RootElement.TryGetProperty("data", out var data) ||
            !data.TryGetProperty("token", out _))
            return Results.Json(new { valid = false, error = "TVDB did not return a token." }, jsonSerializerOptions);

        return Results.Json(new { valid = true, error = (string?)null }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "TVDB API key verification failed");
        return Results.Json(new { valid = false, error = ex.Message }, jsonSerializerOptions);
    }
});

app.MapGet("/api/settings/path-exists", (string? path) =>
{
    var p = path?.Trim();
    if (string.IsNullOrEmpty(p))
        return Results.Json(new { exists = false });
    try
    {
        return Results.Json(new { exists = Directory.Exists(p) });
    }
    catch
    {
        return Results.Json(new { exists = false });
    }
});

app.MapPost("/api/settings/wizard-progress", async (WizardProgressBody body, LibraryRepository repo, CancellationToken ct) =>
{
    var step = Math.Clamp(body.Step, 1, 4);
    await repo.SaveSettingAsync("SetupWizardStep", step.ToString(), ct)
        .ConfigureAwait(false);
    var json = string.IsNullOrWhiteSpace(body.StateJson) ? "{}" : body.StateJson!;
    await repo.SaveSettingAsync("SetupWizardState", json, ct).ConfigureAwait(false);
    return Results.Json(new { success = true });
});

app.MapPost("/api/settings/complete-setup",
    async (CompleteSetupBody body, LibraryRepository repo, CancellationToken ct) =>
    {
        await repo.EnsureLibraryFoldersTableAsync(ct).ConfigureAwait(false);

        if (!body.TmdbSkipped && AppSettings.IsValidTmdbKey(body.TmdbApiKey))
            await repo.SaveSettingAsync("TmdbApiKey", body.TmdbApiKey!.Trim(), ct).ConfigureAwait(false);

        if (!body.OpenSubtitlesSkipped && !string.IsNullOrWhiteSpace(body.OpenSubtitlesApiKey))
            await repo.SaveSettingAsync("OpenSubtitlesApiKey", body.OpenSubtitlesApiKey.Trim(), ct)
                .ConfigureAwait(false);

        if (body.LibraryPaths != null)
        {
            foreach (var p in body.LibraryPaths)
            {
                if (string.IsNullOrWhiteSpace(p))
                    continue;
                var t = p.Trim();
                if (Directory.Exists(t))
                    await repo.SaveLibraryPathAsync(t, ct).ConfigureAwait(false);
            }
        }

        await repo.SaveSettingAsync("SetupComplete", "true", ct).ConfigureAwait(false);
        await repo.SaveSettingAsync("SetupWizardStep", "", ct).ConfigureAwait(false);
        await repo.SaveSettingAsync("SetupWizardState", "", ct).ConfigureAwait(false);

        AppSettings.ResolveTmdbApiKeyFromSources(repo);
        AppSettings.ResolveOpenSubtitlesFromSources(repo);
        return Results.Json(new { success = true });
    });

app.MapGet("/api/settings/media-player-candidates", () =>
{
    if (!OperatingSystem.IsWindows())
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);

    return Results.Json(MediaPlayerDiscovery.DiscoverCandidates(), jsonSerializerOptions);
});

// Legacy: autostart is handled by the Tauri desktop app (tauri-plugin-autostart) using the real UI exe.
// These routes are unused by current Settings UI but kept for older clients / tooling.
app.MapGet("/api/settings/autostart-status", () =>
{
    if (!OperatingSystem.IsWindows())
        return Results.Json(new { enabled = false, supported = false }, jsonSerializerOptions);

    try
    {
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false);
        var value = key?.GetValue("Pitflix");
        var enabled = value != null;
        return Results.Json(new { enabled, supported = true }, jsonSerializerOptions);
    }
    catch
    {
        return Results.Json(new { enabled = false, supported = true, error = "Cannot read registry" }, jsonSerializerOptions);
    }
});

app.MapPost("/api/settings/autostart", async (HttpRequest request, CancellationToken ct) =>
{
    if (!OperatingSystem.IsWindows())
        return Results.BadRequest(new { error = "Autostart is only supported on Windows." });

    var req = await request.ReadFromJsonAsync<AutostartRequest>(cancellationToken: ct).ConfigureAwait(false);
    var enable = req?.Enable ?? false;

    try
    {
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
        if (key == null)
            return Results.BadRequest(new { error = "Cannot access Windows startup registry." });

        if (enable)
        {
            // Get the path to the Pitflix executable
            var exePath = Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrEmpty(exePath))
                return Results.BadRequest(new { error = "Cannot determine executable path." });

            // For the Tauri app, we want to launch the UI exe, not the API
            // Check if we're running as the bundled API (inside Pitflix app directory)
            var exeDir = Path.GetDirectoryName(exePath);
            if (exeDir != null)
            {
                // Look for Pitflix.exe in parent or same directory
                var uiExe = Path.Combine(exeDir, "Pitflix.exe");
                if (!File.Exists(uiExe))
                {
                    // Try parent directory
                    var parentDir = Directory.GetParent(exeDir)?.FullName;
                    if (parentDir != null)
                    {
                        uiExe = Path.Combine(parentDir, "Pitflix.exe");
                        if (File.Exists(uiExe))
                            exePath = uiExe;
                    }
                }
                else
                {
                    exePath = uiExe;
                }
            }

            key.SetValue("Pitflix", $"\"{exePath}\"");
        }
        else
        {
            key.DeleteValue("Pitflix", false);
        }

        return Results.Ok(new { success = true, enabled = enable });
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "Failed to update Windows autostart");
        return Results.BadRequest(new { error = $"Failed to update autostart: {ex.Message}" });
    }
});

app.MapPost("/api/settings/paths", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var req = await request.ReadFromJsonAsync<PathRequest>(cancellationToken: ct).ConfigureAwait(false);
    var path = req?.Path?.Trim();
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { error = "Path is required." });
    if (!Directory.Exists(path))
        return Results.BadRequest(new { error = "Folder not found on disk" });

    await repo.EnsureLibraryFoldersTableAsync(ct).ConfigureAwait(false);
    await repo.SaveLibraryPathAsync(path, ct).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

app.MapDelete("/api/settings/paths", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var req = await request.ReadFromJsonAsync<PathRequest>(cancellationToken: ct).ConfigureAwait(false);
    var path = req?.Path?.Trim();
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { error = "Path is required." });

    await repo.EnsureLibraryFoldersTableAsync(ct).ConfigureAwait(false);
    await repo.RemoveLibraryPathAsync(path, ct).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

app.MapPost("/api/settings/pinned-paths", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var req = await request.ReadFromJsonAsync<PathRequest>(cancellationToken: ct).ConfigureAwait(false);
    var path = req?.Path?.Trim();
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { error = "Path is required." });
    if (!Directory.Exists(path))
        return Results.BadRequest(new { error = "Folder not found on disk" });

    await repo.AddPinnedScanPathAsync(path, ct).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

app.MapDelete("/api/settings/pinned-paths", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var req = await request.ReadFromJsonAsync<PathRequest>(cancellationToken: ct).ConfigureAwait(false);
    var path = req?.Path?.Trim();
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { error = "Path is required." });

    await repo.RemovePinnedScanPathAsync(path, ct).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

app.MapPost("/api/settings/excluded-paths", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var req = await request.ReadFromJsonAsync<PathRequest>(cancellationToken: ct).ConfigureAwait(false);
    var path = req?.Path?.Trim();
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { error = "Path is required." });
    if (!Directory.Exists(path))
        return Results.BadRequest(new { error = "Folder not found on disk" });

    await repo.AddExcludedScanPathAsync(path, ct).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

app.MapDelete("/api/settings/excluded-paths", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var req = await request.ReadFromJsonAsync<PathRequest>(cancellationToken: ct).ConfigureAwait(false);
    var path = req?.Path?.Trim();
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { error = "Path is required." });

    await repo.RemoveExcludedScanPathAsync(path, ct).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

app.MapPost("/api/settings/native-pick-folder", () =>
{
    if (!OperatingSystem.IsWindows())
    {
        return Results.Json(
            new { path = (string?)null, error = "Native folder picker needs Pitflix.API running on Windows." },
            jsonSerializerOptions);
    }

    try
    {
        var path = NativeWindowsDialogs.PickFolder("Select a folder to add to your library");
        return Results.Json(new { path, error = (string?)null }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "Native folder picker failed");
        return Results.Json(new { path = (string?)null, error = ex.Message }, jsonSerializerOptions);
    }
});

app.MapPost("/api/settings/native-pick-executable", () =>
{
    if (!OperatingSystem.IsWindows())
    {
        return Results.Json(
            new { path = (string?)null, error = "Native file picker needs Pitflix.API running on Windows." },
            jsonSerializerOptions);
    }

    try
    {
        var path = NativeWindowsDialogs.PickExecutable("Choose media player (.exe)");
        return Results.Json(new { path, error = (string?)null }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "Native executable picker failed");
        return Results.Json(new { path = (string?)null, error = ex.Message }, jsonSerializerOptions);
    }
});

    }

    private static string MaskKey(string? key)
    {
        if (string.IsNullOrEmpty(key))
            return "";
        if (key.Length <= 4)
            return "****";
        return new string('*', Math.Min(12, key.Length - 4)) + key[^4..];
    }
}