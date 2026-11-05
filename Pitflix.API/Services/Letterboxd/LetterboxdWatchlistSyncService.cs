using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;
using Pitflix.Core.Net;

namespace Pitflix.API.Services.Letterboxd;

/// <summary>
/// Keeps a Pitflix list in step with the user's Letterboxd watchlist.
///
/// Every 6 h (and on demand) it reads the whole watchlist, resolves each new film's TMDB id once from
/// its Letterboxd film page (remembered in <c>LetterboxdWatchlistItems</c>), and adds anything new to
/// the chosen list. Films the sync itself added are removed again once they leave the Letterboxd
/// watchlist — but only after a complete, unblocked read, so a Cloudflare hiccup can never empty the
/// list. Items the user added by hand are never touched.
/// </summary>
public sealed class LetterboxdWatchlistSyncService : BackgroundService
{
    public const string EnabledKey = "LetterboxdWatchlistSyncEnabled";
    public const string ListIdKey = "LetterboxdWatchlistTargetListId";
    private const string LastRunKey = "LetterboxdWatchlistLastRunUtc";
    private static readonly TimeSpan Interval = TimeSpan.FromHours(6);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly LetterboxdService _letterboxd;
    private readonly ILogger<LetterboxdWatchlistSyncService> _log;
    private readonly SemaphoreSlim _runGate = new(1, 1);

    public LetterboxdWatchlistSyncService(IServiceScopeFactory scopeFactory, LetterboxdService letterboxd,
        ILogger<LetterboxdWatchlistSyncService> log)
    {
        _scopeFactory = scopeFactory;
        _letterboxd = letterboxd;
        _log = log;
    }

    public sealed record SyncStatus(
        bool Running, string? Phase, DateTime? LastRunUtc, int OnWatchlist, int Added, int Removed,
        int Unresolved, string? LastError);

    private volatile SyncStatus _status = new(false, null, null, 0, 0, 0, 0, null);
    public SyncStatus Status => _status;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken).ConfigureAwait(false); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try { await RunIfEnabledAsync(force: false, stoppingToken).ConfigureAwait(false); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception ex)
            {
                _log.LogWarning("Letterboxd watchlist sync failed: {Msg}", ex.Message);
                _status = _status with { Running = false, Phase = null, LastError = ex.Message };
            }

            // Check every 30 min whether 6 h have passed — keeps the schedule across restarts.
            // "Sync now" in Settings calls RunIfEnabledAsync(force: true) directly.
            try { await Task.Delay(TimeSpan.FromMinutes(30), stoppingToken).ConfigureAwait(false); }
            catch (OperationCanceledException) { return; }
        }
    }

    /// <summary>Runs a sync now if enabled; `force` skips the 6-hour schedule check.</summary>
    public async Task RunIfEnabledAsync(bool force, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        if (await repo.GetSettingAsync(EnabledKey, ct).ConfigureAwait(false) != "1") return;
        if (NetworkStatus.IsOffline) return;

        var lastRunStr = await repo.GetSettingAsync(LastRunKey, ct).ConfigureAwait(false);
        var lastRun = DateTime.TryParse(lastRunStr, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var lr)
            ? lr : (DateTime?)null;
        _status = _status with { LastRunUtc = lastRun };
        if (!force && lastRun is { } l && DateTime.UtcNow - l < Interval) return;

        if (!await _runGate.WaitAsync(0, ct).ConfigureAwait(false)) return;
        try
        {
            await SyncAsync(repo, scope.ServiceProvider.GetRequiredService<LibraryContext>(), ct).ConfigureAwait(false);
        }
        finally
        {
            _runGate.Release();
        }
    }

    private async Task SyncAsync(LibraryRepository repo, LibraryContext db, CancellationToken ct)
    {
        var username = await _letterboxd.GetConfiguredUsernameAsync(ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(username))
        {
            _status = _status with { LastError = "Set your Letterboxd username first." };
            return;
        }
        var listId = await ResolveTargetListIdAsync(repo, ct).ConfigureAwait(false);
        if (listId is null)
        {
            _status = _status with { LastError = "The chosen list no longer exists — pick one in Settings." };
            return;
        }

        _status = _status with { Running = true, Phase = "Reading your Letterboxd watchlist…", LastError = null };
        await EnsureTableAsync(db, ct).ConfigureAwait(false);

        var (complete, entries) = await _letterboxd.FetchWatchlistAsync(username!, ct).ConfigureAwait(false);
        if (entries.Count == 0 && !complete)
        {
            _status = _status with
            {
                Running = false, Phase = null,
                LastError = _letterboxd.LastRequestWasBlocked
                    ? "Letterboxd blocked the request (Cloudflare). Refresh your session cookie in Settings and try again."
                    : "Couldn't read your Letterboxd watchlist.",
            };
            return;
        }

        var known = await LoadKnownAsync(db, ct).ConfigureAwait(false);
        var now = DateTime.UtcNow.ToString("O");

        // Resolve TMDB ids for films seen for the first time (one Letterboxd page each, rate-limited).
        var unresolved = 0;
        var toResolve = entries.Where(e => !known.ContainsKey(e.Slug)).ToList();
        for (var i = 0; i < toResolve.Count; i++)
        {
            ct.ThrowIfCancellationRequested();
            var e = toResolve[i];
            _status = _status with { Phase = $"Matching new films {i + 1}/{toResolve.Count}…" };
            var resolved = await _letterboxd.ResolveSlugToTmdbAsync(e.Slug, ct).ConfigureAwait(false);
            if (resolved is null)
            {
                unresolved++;
                if (_letterboxd.LastRequestWasBlocked) break; // stop hammering a block; retry next run
                continue;
            }
            await UpsertAsync(db, e.Slug, resolved.Value.TmdbId, resolved.Value.MediaType, e.Name, now, ct).ConfigureAwait(false);
            known[e.Slug] = new Known(resolved.Value.TmdbId, resolved.Value.MediaType, e.Name, null);
        }

        _status = _status with { Phase = "Updating your list…" };
        var inList = (await db.Database.SqlQueryRaw<ListKey>(
                "SELECT TmdbId, MediaType FROM ListItems WHERE ListId = {0}", listId.Value)
            .ToListAsync(ct).ConfigureAwait(false))
            .Select(k => (k.TmdbId, k.MediaType)).ToHashSet();

        var added = 0;
        var onWatchlist = new HashSet<string>(entries.Select(e => e.Slug), StringComparer.OrdinalIgnoreCase);
        foreach (var e in entries)
        {
            if (!known.TryGetValue(e.Slug, out var k)) continue;
            if (!inList.Contains((k.TmdbId, k.MediaType)))
            {
                await repo.AddListItemAsync(listId.Value, k.TmdbId, k.MediaType, CleanTitle(e.Name), null, null, ct)
                    .ConfigureAwait(false);
                await MarkAddedAsync(db, e.Slug, listId.Value, ct).ConfigureAwait(false);
                inList.Add((k.TmdbId, k.MediaType));
                added++;
            }
            await TouchAsync(db, e.Slug, now, ct).ConfigureAwait(false);
        }

        // Mirror removals — only for items this sync added, and only after a full, unblocked read.
        var removed = 0;
        if (complete && !_letterboxd.LastRequestWasBlocked)
        {
            foreach (var (slug, k) in known)
            {
                if (onWatchlist.Contains(slug) || k.AddedListId != listId.Value) continue;
                await repo.RemoveListItemAsync(listId.Value, k.TmdbId, k.MediaType, ct).ConfigureAwait(false);
                await MarkAddedAsync(db, slug, null, ct).ConfigureAwait(false);
                removed++;
            }
        }

        await repo.SaveSettingAsync(LastRunKey, DateTime.UtcNow.ToString("O"), ct).ConfigureAwait(false);
        _status = new SyncStatus(false, null, DateTime.UtcNow, entries.Count, added, removed, unresolved,
            complete ? null : "Only part of the watchlist could be read — removals were skipped this time.");
        _log.LogInformation("Letterboxd watchlist sync: {Count} on watchlist, +{Added} / -{Removed} (unresolved {Unresolved})",
            entries.Count, added, removed, unresolved);
    }

    /// <summary>The chosen list, defaulting to the built-in "Watch Later" list.</summary>
    private static async Task<int?> ResolveTargetListIdAsync(LibraryRepository repo, CancellationToken ct)
    {
        var lists = await repo.GetUserListsOrderedAsync(ct).ConfigureAwait(false);
        if (int.TryParse(await repo.GetSettingAsync(ListIdKey, ct).ConfigureAwait(false), out var chosen))
            return lists.Any(l => l.Id == chosen) ? chosen : null;
        return lists.FirstOrDefault(l => l.Name.Contains("Watch Later", StringComparison.OrdinalIgnoreCase))?.Id
               ?? lists.FirstOrDefault()?.Id;
    }

    /// <summary>"Drawn Together (2026)" → "Drawn Together".</summary>
    private static string CleanTitle(string name) =>
        System.Text.RegularExpressions.Regex.Replace(name, @"\s*\(\d{4}\)\s*$", "");

    // ── Storage ──────────────────────────────────────────────────────────────

    private sealed record Known(int TmdbId, string MediaType, string Name, int? AddedListId);
    private sealed class ListKey { public int TmdbId { get; set; } public string MediaType { get; set; } = ""; }
    private sealed class Row
    {
        public string Slug { get; set; } = "";
        public int TmdbId { get; set; }
        public string MediaType { get; set; } = "";
        public string Name { get; set; } = "";
        public int? AddedListId { get; set; }
    }

    private static Task EnsureTableAsync(LibraryContext db, CancellationToken ct) =>
        db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS LetterboxdWatchlistItems (
                Slug         TEXT PRIMARY KEY,
                TmdbId       INTEGER NOT NULL,
                MediaType    TEXT NOT NULL,
                Name         TEXT NOT NULL,
                AddedListId  INTEGER NULL,
                FirstSeenUtc TEXT NOT NULL,
                LastSeenUtc  TEXT NOT NULL);
            """, ct);

    private static async Task<Dictionary<string, Known>> LoadKnownAsync(LibraryContext db, CancellationToken ct)
    {
        var rows = await db.Database.SqlQueryRaw<Row>(
                "SELECT Slug, TmdbId, MediaType, Name, AddedListId FROM LetterboxdWatchlistItems")
            .ToListAsync(ct).ConfigureAwait(false);
        return rows.ToDictionary(r => r.Slug, r => new Known(r.TmdbId, r.MediaType, r.Name, r.AddedListId),
            StringComparer.OrdinalIgnoreCase);
    }

    private static Task UpsertAsync(LibraryContext db, string slug, int tmdbId, string mediaType, string name, string now,
        CancellationToken ct) =>
        db.Database.ExecuteSqlRawAsync(
            "INSERT INTO LetterboxdWatchlistItems (Slug, TmdbId, MediaType, Name, AddedListId, FirstSeenUtc, LastSeenUtc) " +
            "VALUES ({0}, {1}, {2}, {3}, NULL, {4}, {4}) " +
            "ON CONFLICT(Slug) DO UPDATE SET TmdbId = excluded.TmdbId, MediaType = excluded.MediaType, Name = excluded.Name",
            new object[] { slug, tmdbId, mediaType, name, now }, ct);

    private static Task MarkAddedAsync(LibraryContext db, string slug, int? listId, CancellationToken ct) =>
        listId is int id
            ? db.Database.ExecuteSqlRawAsync("UPDATE LetterboxdWatchlistItems SET AddedListId = {0} WHERE Slug = {1}",
                new object[] { id, slug }, ct)
            // EF can't bind DBNull as a raw parameter — clear with a literal NULL instead.
            : db.Database.ExecuteSqlRawAsync("UPDATE LetterboxdWatchlistItems SET AddedListId = NULL WHERE Slug = {0}",
                new object[] { slug }, ct);

    private static Task TouchAsync(LibraryContext db, string slug, string now, CancellationToken ct) =>
        db.Database.ExecuteSqlRawAsync("UPDATE LetterboxdWatchlistItems SET LastSeenUtc = {0} WHERE Slug = {1}",
            new object[] { now, slug }, ct);
}
