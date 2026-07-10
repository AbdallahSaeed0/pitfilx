using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Pitflix.API.Services.Supabase;
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

        var payload = await _exportBuilder.BuildAsync(ct).ConfigureAwait(false);
        var token = session.AccessToken;
        var userId = session.UserId;
        var nowIso = DateTime.UtcNow.ToString("O");

        var moviesOk = await _rest.UpsertAsync(
            token, "watch_records", "user_id,tmdb_id,media_type",
            payload.Movies.Select(m => (object)new
            {
                user_id = userId,
                tmdb_id = m.TmdbId,
                media_type = "movie",
                title = m.Title,
                poster_path = m.PosterPath,
                genres = m.Genres,
                release_year = m.Year,
                status = "completed",
                updated_at = nowIso,
            }).ToList(),
            ct).ConfigureAwait(false);

        var seriesOk = await _rest.UpsertAsync(
            token, "watch_records", "user_id,tmdb_id,media_type",
            payload.Series.Select(s => (object)new
            {
                user_id = userId,
                tmdb_id = s.TmdbId,
                media_type = "series",
                title = s.Title,
                poster_path = s.PosterPath,
                genres = s.Genres,
                network = s.Network,
                release_year = s.Year,
                status = string.Equals(s.Status, "Watching", StringComparison.OrdinalIgnoreCase)
                    ? "watching"
                    : "completed",
                updated_at = nowIso,
            }).ToList(),
            ct).ConfigureAwait(false);

        var episodesOk = await _rest.UpsertAsync(
            token, "episode_watch_status", "user_id,show_tmdb_id,season_number,episode_number",
            payload.Episodes.Select(e => (object)new
            {
                user_id = userId,
                show_tmdb_id = e.ShowTmdbId,
                season_number = e.Season,
                episode_number = e.Episode,
            }).ToList(),
            ct).ConfigureAwait(false);

        var watchLogOk = await PushWatchLogAsync(token, userId, payload, ct).ConfigureAwait(false);
        var listsOk = await PushListsAsync(token, userId, payload.Lists, ct).ConfigureAwait(false);

        var allOk = moviesOk && seriesOk && episodesOk && watchLogOk && listsOk;
        if (allOk)
            await _repo.SaveSettingAsync(LastSyncedAtKey, nowIso, ct).ConfigureAwait(false);
        else
            _log.LogWarning("Mobile account sync: one or more writes failed this cycle");

        return (allOk, allOk ? null : "One or more writes failed — check server logs.");
    }

    // Movies rarely carry a stored runtime for older/unmatched entries; episodes have no
    // runtime field on desktop at all — both fall back to a flat estimate, same "no real
    // playback telemetry" caveat the schema itself documents.
    private const int DefaultMovieRuntimeMinutes = 120;
    private const int DefaultEpisodeRuntimeMinutes = 45;
    private static readonly TimeSpan WatchLogWindow = TimeSpan.FromDays(90);

    /// <summary>Pushes one `watch_log` row per completed movie/episode from the last 90 days —
    /// feeds the mobile Stats page's "Last 7 Days" bar chart and week/month totals with the
    /// same completions the desktop's own "Last 7 days" widget shows. Upserts against
    /// (user_id, tmdb_id, media_type, logged_at) — see 006_pitflix_watch_log_unique.sql — so
    /// re-pushing the same completions every cycle doesn't create duplicates.</summary>
    private async Task<bool> PushWatchLogAsync(
        string accessToken, string userId, LibraryExportPayload payload, CancellationToken ct)
    {
        var cutoff = DateTime.UtcNow - WatchLogWindow;

        var rows = payload.Movies
            .Where(m => m.CompletedAt is { } at && at >= cutoff)
            .Select(m => (object)new
            {
                user_id = userId,
                tmdb_id = m.TmdbId,
                media_type = "movie",
                minutes = m.Runtime is > 0 ? m.Runtime.Value : DefaultMovieRuntimeMinutes,
                logged_at = m.CompletedAt!.Value.ToString("O"),
            })
            .Concat(payload.Episodes
                .Where(e => e.CompletedAt is { } at && at >= cutoff)
                .Select(e => (object)new
                {
                    user_id = userId,
                    tmdb_id = e.ShowTmdbId,
                    media_type = "series",
                    minutes = DefaultEpisodeRuntimeMinutes,
                    logged_at = e.CompletedAt!.Value.ToString("O"),
                }))
            .ToList();

        return await _rest.UpsertAsync(accessToken, "watch_log", "user_id,tmdb_id,media_type,logged_at", rows, ct)
            .ConfigureAwait(false);
    }

    private async Task<bool> PushListsAsync(
        string accessToken, string userId, List<ExportList> lists, CancellationToken ct)
    {
        var listsWithItems = lists.Where(l => l.Items.Count > 0).ToList();
        if (listsWithItems.Count == 0)
            return true;

        var existing = await _rest.GetAsync<UserListRow>(
            accessToken, "user_lists", $"user_id=eq.{userId}&select=id,name,type", ct).ConfigureAwait(false);
        existing ??= [];

        var watchlistId = existing.FirstOrDefault(l => l.Type == "watchlist")?.Id;
        var favoritesId = existing.FirstOrDefault(l => l.Type == "favorites")?.Id;
        var customByTitle = existing
            .Where(l => l.Type == "custom")
            .ToDictionary(l => DecodeTitle(l.Name), l => l.Id, StringComparer.Ordinal);

        var allOk = true;
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
                poster_path = i.PosterPath,
            }).ToList();
            var ok = await _rest.UpsertAsync(accessToken, "user_list_items", "list_id,tmdb_id,media_type", rows, ct)
                .ConfigureAwait(false);
            allOk &= ok;
        }
        return allOk;
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
