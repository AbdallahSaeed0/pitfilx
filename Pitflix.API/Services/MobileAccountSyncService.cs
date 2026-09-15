using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Pitflix.API.Services.Supabase;
using Pitflix.Core.Config;
using Pitflix.Core.Database;

namespace Pitflix.API.Services;

/// <summary>
/// Pushes this desktop's watch history/lists straight into a specific mobile account's
/// Supabase tables — the desktop signs in as that account (see SupabaseAuthClient) so writes
/// go through the same RLS the mobile app itself is bound by, no service-role bypass needed.
/// Replaces the old model where the mobile app had to reach this desktop over LAN to pull the
/// same data (GET /api/library/watched-export, still kept for that direct-pull path too).
/// </summary>
public sealed partial class MobileAccountSyncService
{
    private const string RefreshTokenKey = "MobileSyncRefreshToken";
    private const string EmailKey = "MobileSyncEmail";
    private const string UserIdKey = "MobileSyncUserId";
    private const string LastSyncedAtKey = "MobileSyncLastSyncedAt";

    private readonly SupabaseAuthClient _auth;
    private readonly SupabaseUserClient _rest;
    private readonly LibraryExportBuilder _exportBuilder;
    private readonly LibraryRepository _repo;
    private readonly ILogger<MobileAccountSyncService> _log;

    public MobileAccountSyncService(
        SupabaseAuthClient auth,
        SupabaseUserClient rest,
        LibraryExportBuilder exportBuilder,
        LibraryRepository repo,
        ILogger<MobileAccountSyncService> log)
    {
        _auth = auth;
        _rest = rest;
        _exportBuilder = exportBuilder;
        _repo = repo;
        _log = log;
    }

    public async Task<bool> IsLinkedAsync(CancellationToken ct) =>
        !string.IsNullOrWhiteSpace(await _repo.GetSettingAsync(RefreshTokenKey, ct).ConfigureAwait(false));

    public async Task<(bool ok, string? email, string? error)> LinkAsync(
        string email, string password, CancellationToken ct)
    {
        if (!_auth.IsConfigured)
            return (false, null, "Set the Supabase URL and anon key first.");

        var session = await _auth.SignInWithPasswordAsync(email, password, ct).ConfigureAwait(false);
        if (session == null)
            return (false, null, "Sign-in failed — check the email/password and Supabase config.");

        await _repo.SaveSettingAsync(RefreshTokenKey, session.RefreshToken, ct).ConfigureAwait(false);
        await _repo.SaveSettingAsync(EmailKey, session.Email, ct).ConfigureAwait(false);
        await _repo.SaveSettingAsync(UserIdKey, session.UserId, ct).ConfigureAwait(false);
        return (true, session.Email, null);
    }

    public async Task UnlinkAsync(CancellationToken ct)
    {
        await _repo.SaveSettingAsync(RefreshTokenKey, "", ct).ConfigureAwait(false);
        await _repo.SaveSettingAsync(EmailKey, "", ct).ConfigureAwait(false);
        await _repo.SaveSettingAsync(UserIdKey, "", ct).ConfigureAwait(false);
    }

    public async Task<(string? email, DateTime? lastSyncedAt)> GetStatusAsync(CancellationToken ct)
    {
        var email = await _repo.GetSettingAsync(EmailKey, ct).ConfigureAwait(false);
        var lastRaw = await _repo.GetSettingAsync(LastSyncedAtKey, ct).ConfigureAwait(false);
        var last = DateTime.TryParse(
            lastRaw, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt) ? dt : (DateTime?)null;
        return (string.IsNullOrWhiteSpace(email) ? null : email, last);
    }

    public async Task<(bool ok, string? error)> PushAsync(CancellationToken ct)
    {
        var refreshToken = await _repo.GetSettingAsync(RefreshTokenKey, ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(refreshToken))
            return (false, "Not linked.");

        var session = await _auth.RefreshAsync(refreshToken, ct).ConfigureAwait(false);
        if (session == null)
            return (false, "Couldn't refresh the linked session — re-link in Settings.");

        // Refresh tokens rotate on use — always persist the new one, or the next push fails.
        await _repo.SaveSettingAsync(RefreshTokenKey, session.RefreshToken, ct).ConfigureAwait(false);

        // Self-heals any show whose WatchStatus drifted out of sync with its episodes (see
        // ReconcileAllShowWatchStatusesAsync) before exporting, so a show stuck at Unwatched from
        // a past file-rematch gap doesn't silently keep being excluded from the export.
        await _repo.ReconcileAllShowWatchStatusesAsync(ct).ConfigureAwait(false);

        var payload = await _exportBuilder.BuildAsync(ct).ConfigureAwait(false);
        var token = session.AccessToken;
        var userId = session.UserId;
        var nowIso = DateTime.UtcNow.ToString("O");

        // Removes anything on the Supabase side this desktop no longer accounts for (a show
        // watched/tested directly on mobile that was never in the desktop library, an episode
        // unmarked on desktop after an earlier push already wrote it, etc.) — otherwise the
        // upserts below only ever add/update, so mobile permanently accumulates data that no
        // longer matches the desktop it's supposed to mirror. Best-effort: a failure here just
        // means this cycle's cleanup didn't happen, not that the watch-data push itself failed.
        var reconcile = await ReconcileStaleWatchDataAsync(token, userId, payload, ct).ConfigureAwait(false);

        var errors = new List<string>(reconcile.errors);

        // Rewatch counts merge as max(desktop local, whatever Supabase already had before the
        // wipe above) so this push can never regress a count either side already reached —
        // see ReconcileStaleWatchDataAsync's doc comment for why the pre-wipe read is required.
        // Where the remote side was ahead (e.g. incremented on mobile since the last sync), the
        // merged value is also written back into desktop's local SQLite below, so a rewatch
        // logged on the phone shows up on desktop too instead of only surviving on Supabase.
        int MergedMovieOrSeriesRewatchCount(int tmdbId, string mediaType, int localCount) =>
            Math.Max(localCount, reconcile.watchRecordRewatchCounts.GetValueOrDefault((tmdbId, mediaType), 0));
        int MergedEpisodeRewatchCount(int showTmdbId, int season, int episode, int localCount) =>
            Math.Max(localCount, reconcile.episodeRewatchCounts.GetValueOrDefault((showTmdbId, season, episode), 0));

        foreach (var m in payload.Movies)
        {
            var merged = MergedMovieOrSeriesRewatchCount(m.TmdbId, "movie", m.RewatchCount);
            if (merged > m.RewatchCount)
                await _repo.RaiseMovieRewatchCountByTmdbIdAsync(m.TmdbId, merged, ct).ConfigureAwait(false);
        }
        foreach (var e in payload.Episodes)
        {
            var merged = MergedEpisodeRewatchCount(e.ShowTmdbId, e.Season, e.Episode, e.RewatchCount);
            if (merged > e.RewatchCount)
                await _repo.RaiseEpisodeRewatchCountByShowTmdbIdAsync(e.ShowTmdbId, e.Season, e.Episode, merged, ct)
                    .ConfigureAwait(false);
        }

        var (moviesOk, moviesErr) = await _rest.UpsertAsync(
            token, "watch_records", "user_id,tmdb_id,media_type",
            payload.Movies.Select(m => (object)new
            {
                user_id = userId,
                tmdb_id = m.TmdbId,
                media_type = "movie",
                title = m.Title,
                poster_path = m.RemotePosterPath,
                genres = m.Genres,
                release_year = m.Year,
                status = "completed",
                rewatch_count = MergedMovieOrSeriesRewatchCount(m.TmdbId, "movie", m.RewatchCount),
                updated_at = nowIso,
            }).ToList(),
            ct).ConfigureAwait(false);
        if (moviesErr != null) errors.Add(moviesErr);

        var (seriesOk, seriesErr) = await _rest.UpsertAsync(
            token, "watch_records", "user_id,tmdb_id,media_type",
            payload.Series.Select(s => (object)new
            {
                user_id = userId,
                tmdb_id = s.TmdbId,
                media_type = "series",
                title = s.Title,
                poster_path = s.RemotePosterPath,
                genres = s.Genres,
                network = s.Network,
                release_year = s.Year,
                status = string.Equals(s.Status, "Watching", StringComparison.OrdinalIgnoreCase)
                    ? "watching"
                    : "completed",
                // Desktop never touches this (no per-series counter — see ExportSeries' doc
                // comment), so localCount is always 0 here and this always resolves to whatever
                // was already on Supabase, preserving a mobile-set series rewatch count untouched.
                rewatch_count = MergedMovieOrSeriesRewatchCount(s.TmdbId, "series", 0),
                updated_at = nowIso,
            }).ToList(),
            ct).ConfigureAwait(false);
        if (seriesErr != null) errors.Add(seriesErr);

        var (episodesOk, episodesErr) = await _rest.UpsertAsync(
            token, "episode_watch_status", "user_id,show_tmdb_id,season_number,episode_number",
            payload.Episodes.Select(e => (object)new
            {
                user_id = userId,
                show_tmdb_id = e.ShowTmdbId,
                season_number = e.Season,
                episode_number = e.Episode,
                rewatch_count = MergedEpisodeRewatchCount(e.ShowTmdbId, e.Season, e.Episode, e.RewatchCount),
            }).ToList(),
            ct).ConfigureAwait(false);
        if (episodesErr != null) errors.Add(episodesErr);

        var (watchLogOk, watchLogErr) = await PushWatchLogAsync(token, userId, payload, ct).ConfigureAwait(false);
        if (watchLogErr != null) errors.Add(watchLogErr);

        var (listsOk, listsErr) = await PushListsAsync(token, userId, payload.Lists, ct).ConfigureAwait(false);
        if (listsErr != null) errors.Add(listsErr);

        // Also pushes this desktop's own configured TMDB/MDBList/OpenSubtitles/SubDL API keys
        // (see 015_pitflix_synced_api_keys.sql, 016_pitflix_subtitle_api_keys.sql) — the mobile
        // app then uses these instead of whatever is baked into its own build (or, for the
        // subtitle keys, instead of requiring a second manual entry in My Device's own Settings
        // screen), so a key rotated on desktop doesn't need a matching manual update on the
        // mobile side too. Best-effort like the other pushes below: a failure here doesn't block
        // the watch-data sync that's this method's main job.
        var mdblistApiKey = await _repo.GetSettingAsync("MdblistApiKey", ct).ConfigureAwait(false);
        var openSubtitlesApiKey = await _repo.GetSettingAsync("OpenSubtitlesApiKey", ct).ConfigureAwait(false);
        var subDlApiKey = await _repo.GetSettingAsync("SubDlApiKey", ct).ConfigureAwait(false);
        var (apiKeysOk, apiKeysErr) = await _rest.UpsertAsync(
            token, "user_api_keys", "user_id",
            new List<object>
            {
                new
                {
                    user_id = userId,
                    tmdb_api_key = AppSettings.ResolvedTmdbApiKey,
                    mdblist_api_key = string.IsNullOrWhiteSpace(mdblistApiKey) ? null : mdblistApiKey,
                    opensubtitles_api_key = string.IsNullOrWhiteSpace(openSubtitlesApiKey) ? null : openSubtitlesApiKey,
                    subdl_api_key = string.IsNullOrWhiteSpace(subDlApiKey) ? null : subDlApiKey,
                    updated_at = nowIso,
                },
            },
            ct).ConfigureAwait(false);
        if (!apiKeysOk)
            _log.LogWarning("Mobile account sync: failed to push API keys: {Error}", apiKeysErr);

        var allOk = moviesOk && seriesOk && episodesOk && watchLogOk && listsOk;
        if (allOk)
        {
            await _repo.SaveSettingAsync(LastSyncedAtKey, nowIso, ct).ConfigureAwait(false);

            // Also visible from the mobile side (see 009_pitflix_sync_status.sql) — the local
            // LastSyncedAtKey setting above only tells the desktop itself; this is what lets the
            // phone show "Connected" without any LAN/IP dependency.
            var (statusOk, statusErr) = await _rest.UpsertAsync(
                token, "user_sync_status", "user_id",
                new List<object> { new { user_id = userId, last_synced_at = nowIso } },
                ct).ConfigureAwait(false);
            if (!statusOk)
                _log.LogWarning("Mobile account sync: failed to write sync status: {Error}", statusErr);
        }
        else
            _log.LogWarning("Mobile account sync: one or more writes failed this cycle: {Errors}", string.Join(" | ", errors));

        // Surfaced even on success — otherwise there's no way to tell from Settings' "Sync Now"
        // button whether the wipe-and-replace pass actually reset anything, instead of it only
        // ever showing up in server logs nobody's watching. The "Export:" line specifically
        // isolates whether a count mismatch against mobile originates in LibraryExportBuilder
        // (this desktop-side count would already be short) or in the push to Supabase (this
        // count matches Stats but Supabase ends up with fewer rows anyway).
        var reconcileSummary =
            $"Export: {payload.Movies.Count} movies, {payload.Series.Count} series, {payload.Episodes.Count} episodes. " +
            $"Wiped-then-mirrored: {reconcile.existingWatchRecords} watch_records, " +
            $"{reconcile.existingEpisodeRows} episodes, " +
            $"{reconcile.existingWatchLogRows} watch_log rows replaced.";

        return (allOk, allOk ? reconcileSummary : $"{string.Join(" | ", errors)} — {reconcileSummary}");
    }

    /// <summary>Wipes every `watch_records`/`episode_watch_status`/`watch_log` row this account
    /// has on Supabase, so the upserts that follow in <see cref="PushAsync"/> repopulate a clean,
    /// exact mirror of the desktop's current watch history. Replaces the earlier diff-based
    /// approach (compute which specific rows are stale and delete only those) — that never
    /// actually cleared out shows watched directly on mobile, for reasons we couldn't
    /// diagnose without more instrumentation, and there's no data on these tables the
    /// desktop-side sync isn't the source of truth for anyway, so a full wipe is safe and
    /// leaves no room for the same divergence to survive. `user_lists`/`user_list_items` are
    /// deliberately NOT touched — those can contain items added via the mobile app itself
    /// (e.g. the "Dropped" list from Title Detail's Drop action).</summary>
    private async Task<(int existingWatchRecords, int existingEpisodeRows,
        int existingWatchLogRows, List<string> errors,
        Dictionary<(int TmdbId, string MediaType), int> watchRecordRewatchCounts,
        Dictionary<(int ShowTmdbId, int Season, int Episode), int> episodeRewatchCounts)>
        ReconcileStaleWatchDataAsync(
            string accessToken, string userId, LibraryExportPayload payload, CancellationToken ct)
    {
        _ = payload; // Full-wipe path doesn't need the payload; kept in the signature so the
                     // caller still reads as "reconcile against this desired state".
        var errors = new List<string>();

        // Read counts (and, importantly, rewatch_count) first, before the wipe below deletes
        // these rows — this is the only place PushAsync can still see what Supabase already had,
        // so it can carry rewatch_count forward into the upserts instead of losing it to the
        // wipe-then-reinsert cycle every 5 minutes (that bug is what this dictionary exists to fix).
        var existingWatchRecords = await _rest.GetAsync<WatchRecordKeyRow>(
            accessToken, "watch_records",
            $"user_id=eq.{userId}&select=tmdb_id,media_type,rewatch_count", ct).ConfigureAwait(false);
        var existingEpisodes = await _rest.GetAsync<EpisodeWatchKeyRow>(
            accessToken, "episode_watch_status",
            $"user_id=eq.{userId}&select=show_tmdb_id,season_number,episode_number,rewatch_count", ct).ConfigureAwait(false);
        var existingWatchLog = await _rest.GetAsync<WatchRecordKeyRow>(
            accessToken, "watch_log",
            $"user_id=eq.{userId}&select=tmdb_id,media_type", ct).ConfigureAwait(false);

        var watchRecordRewatchCounts = (existingWatchRecords ?? [])
            .GroupBy(r => (r.TmdbId, r.MediaType))
            .ToDictionary(g => g.Key, g => g.Max(r => r.RewatchCount));
        var episodeRewatchCounts = (existingEpisodes ?? [])
            .GroupBy(r => (r.ShowTmdbId, r.SeasonNumber, r.EpisodeNumber))
            .ToDictionary(g => g.Key, g => g.Max(r => r.RewatchCount));

        async Task WipeAsync(string table)
        {
            var (ok, err) = await _rest.DeleteAsync(
                accessToken, table, $"user_id=eq.{userId}", ct).ConfigureAwait(false);
            if (!ok)
            {
                _log.LogWarning("Mobile account sync: failed to wipe {Table}: {Error}", table, err);
                errors.Add($"{table} wipe: {err}");
            }
        }

        await WipeAsync("watch_records").ConfigureAwait(false);
        await WipeAsync("episode_watch_status").ConfigureAwait(false);
        await WipeAsync("watch_log").ConfigureAwait(false);

        return (
            existingWatchRecords?.Count ?? 0,
            existingEpisodes?.Count ?? 0,
            existingWatchLog?.Count ?? 0,
            errors,
            watchRecordRewatchCounts,
            episodeRewatchCounts);
    }

    private sealed class WatchRecordKeyRow
    {
        [JsonPropertyName("tmdb_id")] public int TmdbId { get; set; }
        [JsonPropertyName("media_type")] public string MediaType { get; set; } = "";
        [JsonPropertyName("rewatch_count")] public int RewatchCount { get; set; }
    }

    private sealed class EpisodeWatchKeyRow
    {
        [JsonPropertyName("show_tmdb_id")] public int ShowTmdbId { get; set; }
        [JsonPropertyName("season_number")] public int SeasonNumber { get; set; }
        [JsonPropertyName("episode_number")] public int EpisodeNumber { get; set; }
        [JsonPropertyName("rewatch_count")] public int RewatchCount { get; set; }
    }

    // Movies rarely carry a stored runtime for older/unmatched entries; episodes have no
    // runtime field on desktop at all — both fall back to a flat estimate, same "no real
    // playback telemetry" caveat the schema itself documents.
    private const int DefaultMovieRuntimeMinutes = 120;
    private const int DefaultEpisodeRuntimeMinutes = 45;

    /// <summary>Pushes one `watch_log` row per completed movie/episode — the mobile Stats page
    /// sums these `minutes` values to show total "Time Watched", so this needs to cover the
    /// whole watch history for those numbers to match the desktop's own totals, not just a
    /// rolling recent window. Upserts against (user_id, tmdb_id, media_type, logged_at) —
    /// see 006_pitflix_watch_log_unique.sql — so re-pushing the same completions every cycle
    /// doesn't create duplicates.
    ///
    /// Entries with no known CompletedAt (older bulk-imports, pre-scan-history rows) are still
    /// included, bucketed to a synthetic "unknown when" timestamp per (tmdb_id, media_type) so
    /// they contribute to lifetime totals without polluting the "Last 7 Days" chart (which
    /// filters by real dates). Without this, `4553.8h` of series watch time on desktop shows
    /// up as only the last 90 days' worth on mobile — the exact gap this method was previously
    /// causing.
    ///
    /// The key has no per-episode column, so two episodes of the same show completed within
    /// the same instant (e.g. a bulk "mark season watched") collide — Postgres rejects an
    /// upsert batch that touches the same conflict target twice in one statement. Truncated to
    /// whole seconds before grouping since .NET's DateTime ticks (100ns) are finer than
    /// Postgres's timestamptz (microsecond) precision — two distinct-in-C# timestamps a few
    /// ticks apart can still collide once stored, so grouping on the untruncated value isn't
    /// enough. Summed (rather than deduped to one) so the total minutes for that instant still
    /// reflects every episode, not just one.</summary>
    private async Task<(bool ok, string? error)> PushWatchLogAsync(
        string accessToken, string userId, LibraryExportPayload payload, CancellationToken ct)
    {
        static DateTime TruncateToSecond(DateTime dt) =>
            new(dt.Ticks - (dt.Ticks % TimeSpan.TicksPerSecond), dt.Kind);

        // Sentinel for "we know this was watched, don't know when" — Unix epoch so it sorts
        // outside any real recent-history window on the mobile Stats side.
        var unknownWhen = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        var entries = payload.Movies
            .Select(m => (
                tmdbId: m.TmdbId,
                mediaType: "movie",
                minutes: m.Runtime is > 0 ? m.Runtime.Value : DefaultMovieRuntimeMinutes,
                loggedAt: m.CompletedAt is { } at ? TruncateToSecond(at) : unknownWhen))
            .Concat(payload.Episodes
                .Select(e => (
                    tmdbId: e.ShowTmdbId,
                    mediaType: "series",
                    minutes: DefaultEpisodeRuntimeMinutes,
                    loggedAt: e.CompletedAt is { } at ? TruncateToSecond(at) : unknownWhen)));

        var rows = entries
            .GroupBy(e => (e.tmdbId, e.mediaType, e.loggedAt))
            .Select(g => (object)new
            {
                user_id = userId,
                tmdb_id = g.Key.tmdbId,
                media_type = g.Key.mediaType,
                minutes = g.Sum(e => e.minutes),
                logged_at = g.Key.loggedAt.ToString("O"),
            })
            .ToList();

        return await _rest.UpsertAsync(accessToken, "watch_log", "user_id,tmdb_id,media_type,logged_at", rows, ct)
            .ConfigureAwait(false);
    }

    private async Task<(bool ok, string? error)> PushListsAsync(
        string accessToken, string userId, List<ExportList> lists, CancellationToken ct)
    {
        var listsWithItems = lists.Where(l => l.Items.Count > 0).ToList();
        if (listsWithItems.Count == 0)
            return (true, null);

        var existing = await _rest.GetAsync<UserListRow>(
            accessToken, "user_lists", $"user_id=eq.{userId}&select=id,name,type", ct).ConfigureAwait(false);
        existing ??= [];

        var watchlistId = existing.FirstOrDefault(l => l.Type == "watchlist")?.Id;
        var favoritesId = existing.FirstOrDefault(l => l.Type == "favorites")?.Id;
        var customByTitle = existing
            .Where(l => l.Type == "custom")
            .ToDictionary(l => DecodeTitle(l.Name), l => l.Id, StringComparer.Ordinal);

        var allOk = true;
        var errors = new List<string>();
        foreach (var list in listsWithItems)
        {
            string? targetListId;
            if (list.Type == "watchlist")
            {
                watchlistId ??= await EnsureBuiltinListAsync(accessToken, userId, "Watch Later", "watchlist", ct)
                    .ConfigureAwait(false);
                targetListId = watchlistId;
            }
            else if (list.Type == "favorites")
            {
                favoritesId ??= await EnsureBuiltinListAsync(accessToken, userId, "Favorites", "favorites", ct)
                    .ConfigureAwait(false);
                targetListId = favoritesId;
            }
            else
            {
                var title = DecodeTitle(list.Name);
                if (!customByTitle.TryGetValue(title, out targetListId))
                {
                    var created = await _rest.InsertAsync<UserListRow>(
                        accessToken, "user_lists",
                        new { user_id = userId, name = list.Name, type = "custom" },
                        ct).ConfigureAwait(false);
                    targetListId = created?.Id;
                    if (targetListId != null) customByTitle[title] = targetListId;
                }
            }

            if (targetListId == null)
            {
                allOk = false;
                errors.Add($"user_lists: couldn't resolve/create list '{list.Name}'");
                continue;
            }

            var rows = list.Items.Select(i => (object)new
            {
                list_id = targetListId,
                tmdb_id = i.TmdbId,
                media_type = string.Equals(i.MediaType, "Series", StringComparison.OrdinalIgnoreCase)
                    ? "series"
                    : "movie",
                title = i.Title,
                poster_path = i.RemotePosterPath,
            }).ToList();
            var (ok, err) = await _rest.UpsertAsync(accessToken, "user_list_items", "list_id,tmdb_id,media_type", rows, ct)
                .ConfigureAwait(false);
            allOk &= ok;
            if (err != null) errors.Add(err);
        }
        return (allOk, errors.Count > 0 ? string.Join(" | ", errors) : null);
    }

    private async Task<string?> EnsureBuiltinListAsync(
        string accessToken, string userId, string name, string type, CancellationToken ct)
    {
        var created = await _rest.InsertAsync<UserListRow>(
            accessToken, "user_lists", new { user_id = userId, name, type }, ct).ConfigureAwait(false);
        return created?.Id;
    }

    [GeneratedRegex(@"^::([a-z]+)::\s*")]
    private static partial Regex IconPrefixRegex();

    /// <summary>Mirrors PitflixAndroid's ListMarks.decode — strips a `::icon:: ` prefix so a
    /// custom list created on either platform matches by its actual title, not the raw
    /// icon-encoded name.</summary>
    private static string DecodeTitle(string rawName)
    {
        var match = IconPrefixRegex().Match(rawName);
        return match.Success ? rawName[match.Length..] : rawName;
    }

    private sealed class UserListRow
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("type")] public string Type { get; set; } = "";
    }
}
