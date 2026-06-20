using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PitflixPlayer;

// ── Model mirroring Pitflix.API.Models.PlayerSession ─────────────────────────

public sealed class PlayerSession
{
    public Guid    SessionId     { get; set; }
    public int     MediaId       { get; set; }
    public int?    EpisodeId     { get; set; }
    public string  FilePath      { get; set; } = "";
    public double  Position      { get; set; }
    public double  Duration      { get; set; }
    public bool    IsPaused      { get; set; }
    public bool    IsStopped     { get; set; }
    public string? SubtitleTrack { get; set; }
    public DateTime StartedAt    { get; set; }
    public DateTime LastUpdatedAt { get; set; }
    public string  PipeName      { get; set; } = "";
}

// ── Intro/outro skip (Group 3) ───────────────────────────────────────────────

public sealed class SkipSegment
{
    public double Start { get; set; }
    public double End { get; set; }
    public double? Confidence { get; set; }
    public string? Source { get; set; }
}

public sealed class SkipData
{
    public SkipSegment? Intro { get; set; }
    public SkipSegment? Outro { get; set; }
}

public sealed class SubtitleTrack
{
    public int    Index    { get; set; }
    public string Language { get; set; } = "";
    public string Title    { get; set; } = "";
    /// <summary>"sub", "audio", or "video" — used to filter by type client-side.</summary>
    public string Type     { get; set; } = "sub";
}

// ── Client ────────────────────────────────────────────────────────────────────

internal static class PlayerApiClient
{
    private const string BaseUrl = "http://localhost:5280/api/player";

    private static readonly HttpClient Http = new()
    {
        Timeout = TimeSpan.FromSeconds(10)
    };

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy        = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    // ── Session ───────────────────────────────────────────────────────────────

    /// <summary>Returns the current session, or null if none is active (404).</summary>
    public static async Task<PlayerSession?> GetSessionAsync(CancellationToken ct = default)
    {
        try
        {
            var resp = await Http.GetAsync($"{BaseUrl}/session", ct).ConfigureAwait(false);
            if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
                return null;
            resp.EnsureSuccessStatusCode();
            var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            return JsonSerializer.Deserialize<PlayerSession>(json, JsonOpts);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return null;
        }
    }

    /// <summary>
    /// Tells the backend to restart mpv targeting the given HWND.
    /// <paramref name="childHwnd"/> must be the child HwndHost window — NOT the WPF window.
    /// </summary>
    public static async Task<PlayerSession?> AttachAsync(long childHwnd, CancellationToken ct = default)
    {
        var body    = JsonSerializer.Serialize(new { hwnd = childHwnd }, JsonOpts);
        var content = new StringContent(body, Encoding.UTF8, "application/json");
        var resp    = await Http.PostAsync($"{BaseUrl}/attach", content, ct).ConfigureAwait(false);
        resp.EnsureSuccessStatusCode();
        var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        return JsonSerializer.Deserialize<PlayerSession>(json, JsonOpts);
    }

    // ── Commands ──────────────────────────────────────────────────────────────
    //
    // Realtime commands (pause, seek, volume, speed, sid, aid, next, prev) now
    // go direct to mpv via MpvIpcClient for zero-latency response.
    // SendCommandAsync is kept only for call-sites that haven't been migrated yet;
    // it will be removed once the IPC path is fully validated.

    [Obsolete("Use MpvIpcClient.SendAsync() instead — direct IPC is instant.")]
    public static async Task SendCommandAsync(string command, double? value = null,
                                              CancellationToken ct = default)
    {
        var payload = value.HasValue
            ? (object)new { command, value = value.Value }
            : new { command };
        var body    = JsonSerializer.Serialize(payload, JsonOpts);
        var content = new StringContent(body, Encoding.UTF8, "application/json");
        try
        {
            await Http.PostAsync($"{BaseUrl}/command", content, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort; command failures are non-fatal for the UI
        }
    }

    // ── Subtitle tracks ───────────────────────────────────────────────────────

    /// <summary>
    /// Returns available subtitle tracks for the current session from the backend.
    /// Falls back to an empty list if the endpoint is unavailable.
    /// </summary>
    public static async Task<List<SubtitleTrack>> GetSubtitleTracksAsync(
        CancellationToken ct = default)
    {
        try
        {
            var resp = await Http.GetAsync($"{BaseUrl}/tracks", ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return [];
            var json   = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            var result = JsonSerializer.Deserialize<List<SubtitleTrack>>(json, JsonOpts);
            return result ?? [];
        }
        catch
        {
            return [];
        }
    }

    // ── Stop ─────────────────────────────────────────────────────────────────

    /// <summary>Tells the backend to stop the current playback session.</summary>
    public static async Task StopAsync(CancellationToken ct = default)
    {
        try
        {
            await Http.PostAsync($"{BaseUrl}/stop",
                new StringContent(string.Empty, Encoding.UTF8, "application/json"), ct)
                .ConfigureAwait(false);
        }
        catch { /* best-effort */ }
    }

    // ── Media metadata ────────────────────────────────────────────────────────
    //
    // Looks up display info (show/title/episode info) so the player can show
    // "The Pitt · S1 E8 · The Long Night" instead of "The.Pitt.S01E08.x265.mkv"
    // in the titlebar.  All failure modes return null so the caller can fall
    // back to the filename — episode/movie endpoints may not exist on every
    // backend build, and we never want to block playback over chrome text.

    /// <summary><paramref name="Meta"/> is a short metadata line (year · rating · runtime / air date)
    /// and <paramref name="Overview"/> the synopsis — both for the title quick-info popup.</summary>
    public sealed record MediaInfo(string Title, string? Subtitle, string? Meta = null, string? Overview = null);

    private const string ApiRoot = "http://localhost:5280/api";

    public static async Task<MediaInfo?> GetEpisodeInfoAsync(int episodeId,
                                                              CancellationToken ct = default)
    {
        try
        {
            var resp = await Http.GetAsync($"{ApiRoot}/episodes/{episodeId}", ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return null;
            var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            string? showName  = TryGetString(root, "showName") ?? TryGetString(root, "show")
                              ?? TryGetString(root, "seriesName");
            int?    season    = TryGetInt(root, "season")        ?? TryGetInt(root, "seasonNumber");
            int?    episodeNo = TryGetInt(root, "episodeNumber") ?? TryGetInt(root, "episode");
            string? epTitle   = TryGetString(root, "title")      ?? TryGetString(root, "episodeTitle");
            string? overview  = TryGetString(root, "overview")   ?? TryGetString(root, "synopsis");
            string? airDate   = TryGetString(root, "airDate")    ?? TryGetString(root, "airdate");
            double? rating    = TryGetDouble(root, "voteAverage") ?? TryGetDouble(root, "rating");

            var sub = new StringBuilder();
            if (season is int sn && episodeNo is int en) sub.Append($"S{sn} E{en}");
            if (!string.IsNullOrWhiteSpace(epTitle))
            {
                if (sub.Length > 0) sub.Append(" · ");
                sub.Append(epTitle);
            }
            var meta = new StringBuilder();
            if (!string.IsNullOrWhiteSpace(airDate)) meta.Append(airDate);
            if (rating is double r && r > 0) { if (meta.Length > 0) meta.Append("  ·  "); meta.Append($"{r:0.0}/10"); }
            return new MediaInfo(showName ?? "", sub.Length == 0 ? null : sub.ToString(),
                                 meta.Length == 0 ? null : meta.ToString(), overview);
        }
        catch { return null; }
    }

    public static async Task<MediaInfo?> GetMovieInfoAsync(int mediaId,
                                                            CancellationToken ct = default)
    {
        try
        {
            var resp = await Http.GetAsync($"{ApiRoot}/movies/{mediaId}", ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return null;
            var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            // /api/movies/{id} returns { movie: {...}, ... } — drill in if present.
            var root = doc.RootElement;
            if (root.TryGetProperty("movie", out var movieEl) && movieEl.ValueKind == JsonValueKind.Object)
                root = movieEl;
            string? title    = TryGetString(root, "title") ?? TryGetString(root, "name");
            int?    year     = TryGetInt(root, "year")     ?? TryGetInt(root, "releaseYear");
            int?    runtime  = TryGetInt(root, "runtime");
            string? overview = TryGetString(root, "overview") ?? TryGetString(root, "synopsis");
            double? rating   = TryGetDouble(root, "voteAverage") ?? TryGetDouble(root, "rating");

            var meta = new StringBuilder();
            if (year is int y) meta.Append(y.ToString());
            if (runtime is int rt && rt > 0) { if (meta.Length > 0) meta.Append("  ·  "); meta.Append($"{rt}m"); }
            if (rating is double r && r > 0) { if (meta.Length > 0) meta.Append("  ·  "); meta.Append($"{r:0.0}/10"); }
            return new MediaInfo(title ?? "", year?.ToString(),
                                 meta.Length == 0 ? null : meta.ToString(), overview);
        }
        catch { return null; }
    }

    /// <summary>
    /// Best-effort next-episode lookup.  Used by the auto-advance overlay
    /// when a session ends naturally.  Returns null on 404 (endpoint may
    /// not exist on this backend) or any other failure.
    /// </summary>
    public sealed record NextEpisodeInfo(int EpisodeId, string Title, string? Subtitle);

    public static async Task<NextEpisodeInfo?> GetNextEpisodeAsync(int currentEpisodeId,
                                                                    CancellationToken ct = default)
    {
        try
        {
            var resp = await Http.GetAsync($"{ApiRoot}/episodes/{currentEpisodeId}/next", ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return null;
            var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            int? id   = TryGetInt(root, "id") ?? TryGetInt(root, "episodeId");
            if (id is not int eid) return null;

            string? title = TryGetString(root, "title") ?? TryGetString(root, "episodeTitle");
            int? sn       = TryGetInt(root, "season")        ?? TryGetInt(root, "seasonNumber");
            int? en       = TryGetInt(root, "episodeNumber") ?? TryGetInt(root, "episode");
            string? sub   = (sn is int s && en is int e) ? $"S{s} E{e}" : null;
            return new NextEpisodeInfo(eid, title ?? "", sub);
        }
        catch { return null; }
    }

    /// <summary>
    /// Fetches cached/lazily-computed intro+outro ranges for one episode. Call once per
    /// episode (right after attach/episode change), never per-frame — the caller is
    /// responsible for caching the result for the session. Returns a SkipData with both
    /// fields null on any failure or 404, never throws.
    /// </summary>
    public static async Task<SkipData> GetEpisodeSkipAsync(int episodeId, CancellationToken ct = default)
    {
        try
        {
            var resp = await Http.GetAsync($"{ApiRoot}/skip/episode/{episodeId}", ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return new SkipData();
            var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            return JsonSerializer.Deserialize<SkipData>(json, JsonOpts) ?? new SkipData();
        }
        catch
        {
            return new SkipData();
        }
    }

    private static string? TryGetString(JsonElement el, string prop)
    {
        if (!el.TryGetProperty(prop, out var p)) return null;
        return p.ValueKind == JsonValueKind.String ? p.GetString() : null;
    }
    private static int? TryGetInt(JsonElement el, string prop)
    {
        if (!el.TryGetProperty(prop, out var p)) return null;
        return p.ValueKind == JsonValueKind.Number && p.TryGetInt32(out var v) ? v : null;
    }
    private static double? TryGetDouble(JsonElement el, string prop)
    {
        if (!el.TryGetProperty(prop, out var p)) return null;
        return p.ValueKind == JsonValueKind.Number && p.TryGetDouble(out var v) ? v : null;
    }

    // ── WebSocket ─────────────────────────────────────────────────────────────

    public static Uri WebSocketUri { get; } =
        new(BaseUrl.Replace("http://", "ws://") + "/ws");

    /// <summary>
    /// POST endpoint invoked synchronously by MainWindow.OnClosed so the
    /// user's final position is committed to history before the window
    /// fully closes — see the long-form comment in OnClosed for why.
    /// </summary>
    public static Uri SaveProgressNowUri { get; } =
        new(BaseUrl + "/save-progress-now");
}
