using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services.Supabase;

/// <summary>Data access for the mobile-sync module. Reads <see cref="UserList"/>/<see cref="ListItem"/>/
/// <see cref="WatchHistory"/> read-only for the push side, and owns its own tables
/// (<see cref="SupabaseSyncMap"/>, <see cref="SupabaseWatchEvent"/>) plus a handful of
/// <see cref="Setting"/> keys for the toggle and pull cursors. Never mutates WatchHistory, and only
/// ever inserts new UserList/ListItem rows (never edits/deletes existing ones).</summary>
public sealed class SupabaseSyncRepository
{
    private readonly LibraryContext _db;

    public const string SyncEnabledSettingKey = "SupabaseSyncEnabled";
    private const string ListsCursorKey = "SupabaseListsPullCursor";
    private const string WatchEventsCursorKey = "SupabaseWatchEventsPullCursor";
    private const string ListItemsCursorKey = "SupabaseListItemsPullCursor";

    public SupabaseSyncRepository(LibraryContext db)
    {
        _db = db;
    }

    // ── toggle + cursors (stored in the generic Setting key/value table) ──────────────────

    public async Task<bool> GetSyncEnabledAsync(CancellationToken ct = default)
    {
        var raw = await GetSettingAsync(SyncEnabledSettingKey, ct).ConfigureAwait(false);
        return string.Equals(raw, "true", StringComparison.OrdinalIgnoreCase);
    }

    public Task SetSyncEnabledAsync(bool enabled, CancellationToken ct = default) =>
        SaveSettingAsync(SyncEnabledSettingKey, enabled ? "true" : "false", ct);

    public Task<DateTime?> GetListsPullCursorAsync(CancellationToken ct = default) => GetCursorAsync(ListsCursorKey, ct);
    public Task SetListsPullCursorAsync(DateTime value, CancellationToken ct = default) => SetCursorAsync(ListsCursorKey, value, ct);

    public Task<DateTime?> GetListItemsPullCursorAsync(CancellationToken ct = default) => GetCursorAsync(ListItemsCursorKey, ct);
    public Task SetListItemsPullCursorAsync(DateTime value, CancellationToken ct = default) => SetCursorAsync(ListItemsCursorKey, value, ct);

    public Task<DateTime?> GetWatchEventsPullCursorAsync(CancellationToken ct = default) => GetCursorAsync(WatchEventsCursorKey, ct);
    public Task SetWatchEventsPullCursorAsync(DateTime value, CancellationToken ct = default) => SetCursorAsync(WatchEventsCursorKey, value, ct);

    private async Task<DateTime?> GetCursorAsync(string key, CancellationToken ct)
    {
        var raw = await GetSettingAsync(key, ct).ConfigureAwait(false);
        return DateTime.TryParse(raw, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt)
            ? dt.ToUniversalTime()
            : null;
    }

    private Task SetCursorAsync(string key, DateTime value, CancellationToken ct) =>
        SaveSettingAsync(key, DateTime.SpecifyKind(value, DateTimeKind.Utc).ToString("O"), ct);

    private async Task<string?> GetSettingAsync(string key, CancellationToken ct)
    {
        var s = await _db.Settings.AsNoTracking().FirstOrDefaultAsync(x => x.Key == key, ct).ConfigureAwait(false);
        return s?.Value;
    }

    private async Task SaveSettingAsync(string key, string value, CancellationToken ct)
    {
        var existing = await _db.Settings.FirstOrDefaultAsync(x => x.Key == key, ct).ConfigureAwait(false);
        if (existing != null)
            existing.Value = value;
        else
            _db.Settings.Add(new Setting { Key = key, Value = value });
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    // ── push: local rows not yet mapped/mirrored ──────────────────────────────────────────

    public async Task<List<UserList>> GetUnsyncedUserListsAsync(CancellationToken ct = default)
    {
        var mappedLocalIds = await _db.SupabaseSyncMaps.AsNoTracking()
            .Where(m => m.EntityType == SupabaseSyncEntityTypes.List)
            .Select(m => m.LocalId)
            .ToListAsync(ct).ConfigureAwait(false);

        return await _db.UserLists.AsNoTracking()
            .Where(l => !mappedLocalIds.Contains(l.Id))
            .ToListAsync(ct).ConfigureAwait(false);
    }

    /// <summary>Local list items not yet mapped, restricted to lists whose parent already has a
    /// remote id (so the item's list_id foreign key can be filled in). Returns each item paired
    /// with its parent list's remote id.</summary>
    public async Task<List<(ListItem Item, string RemoteListId)>> GetUnsyncedListItemsAsync(
        int batchSize, CancellationToken ct = default)
    {
        var listMap = await _db.SupabaseSyncMaps.AsNoTracking()
            .Where(m => m.EntityType == SupabaseSyncEntityTypes.List)
            .ToDictionaryAsync(m => m.LocalId, m => m.RemoteId, ct).ConfigureAwait(false);
        if (listMap.Count == 0)
            return new List<(ListItem, string)>();

        var mappedItemIds = await _db.SupabaseSyncMaps.AsNoTracking()
            .Where(m => m.EntityType == SupabaseSyncEntityTypes.ListItem)
            .Select(m => m.LocalId)
            .ToListAsync(ct).ConfigureAwait(false);
        var mappedItemIdSet = mappedItemIds.ToHashSet();

        var listIds = listMap.Keys.ToList();
        var candidates = await _db.ListItems.AsNoTracking()
            .Where(i => listIds.Contains(i.ListId))
            .OrderBy(i => i.AddedAt)
            .ToListAsync(ct).ConfigureAwait(false);

        var result = new List<(ListItem, string)>(batchSize);
        foreach (var item in candidates)
        {
            if (mappedItemIdSet.Contains(item.Id))
                continue;
            if (!listMap.TryGetValue(item.ListId, out var remoteListId))
                continue;
            result.Add((item, remoteListId));
            if (result.Count >= batchSize)
                break;
        }

        return result;
    }

    /// <summary>Completed watch-history rows (with a TMDB id) that don't yet have a
    /// <see cref="SupabaseWatchEvent"/> pointing back at them.</summary>
    public async Task<List<WatchHistory>> GetUnsyncedWatchHistoryAsync(int batchSize, CancellationToken ct = default)
    {
        var linkedIds = await _db.SupabaseWatchEvents.AsNoTracking()
            .Where(e => e.LocalWatchHistoryId != null)
            .Select(e => e.LocalWatchHistoryId!.Value)
            .ToListAsync(ct).ConfigureAwait(false);
        var linkedIdSet = linkedIds.ToHashSet();

        var candidates = await _db.WatchHistories.AsNoTracking()
            .Where(w => w.IsCompleted && w.TmdbId != null)
            .OrderBy(w => w.Id)
            .ToListAsync(ct).ConfigureAwait(false);

        return candidates.Where(w => !linkedIdSet.Contains(w.Id)).Take(batchSize).ToList();
    }

    public async Task RecordSyncMapAsync(string entityType, int localId, string remoteId, string origin,
        CancellationToken ct = default)
    {
        _db.SupabaseSyncMaps.Add(new SupabaseSyncMap
        {
            EntityType = entityType,
            LocalId = localId,
            RemoteId = remoteId,
            Origin = origin,
            LastSyncedAtUtc = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    public async Task RecordPushedWatchEventAsync(
        int localWatchHistoryId, string remoteId, int tmdbId, string mediaType, string? title,
        string? posterPath, DateTime watchedAt, CancellationToken ct = default)
    {
        _db.SupabaseWatchEvents.Add(new SupabaseWatchEvent
        {
            RemoteId = remoteId,
            TmdbId = tmdbId,
            MediaType = mediaType,
            Title = title,
            PosterPath = posterPath,
            WatchedAt = watchedAt,
            Rating = null,
            Source = SupabaseSourceValues.Desktop,
            SyncedAtUtc = DateTime.UtcNow,
            LocalWatchHistoryId = localWatchHistoryId
        });
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    // ── pull: materialize remote-originated rows locally ──────────────────────────────────

    public async Task<SupabaseSyncMap?> FindListMapByRemoteIdAsync(string remoteId, CancellationToken ct = default) =>
        await _db.SupabaseSyncMaps.AsNoTracking()
            .FirstOrDefaultAsync(m => m.EntityType == SupabaseSyncEntityTypes.List && m.RemoteId == remoteId, ct)
            .ConfigureAwait(false);

    /// <summary>Resolves (creating if needed) the local <see cref="UserList"/> a remote list should
    /// map onto: built-in "favorites"/"watchlist" types reuse the existing desktop built-in list by
    /// name; "custom" reuses an exact name match or creates a new list.</summary>
    public async Task<int> FindOrCreateLocalListForRemoteAsync(SupabaseListDto dto, CancellationToken ct = default)
    {
        string targetName = dto.Type switch
        {
            SupabaseListTypes.Favorites => BuiltinLists.FavoritesName,
            SupabaseListTypes.Watchlist => BuiltinLists.WatchLaterName,
            _ => dto.Name
        };

        var existing = await _db.UserLists.FirstOrDefaultAsync(
            l => l.Name.ToLower() == targetName.ToLower(), ct).ConfigureAwait(false);
        if (existing != null)
            return existing.Id;

        var list = new UserList
        {
            Name = targetName,
            CreatedAt = dto.CreatedAt,
            IsDefault = false
        };
        _db.UserLists.Add(list);
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
        return list.Id;
    }

    public async Task<bool> LocalListItemExistsAsync(int localListId, int tmdbId, string mediaType,
        CancellationToken ct = default) =>
        await _db.ListItems.AsNoTracking().AnyAsync(
            i => i.ListId == localListId && i.TmdbId == tmdbId && i.MediaType == mediaType, ct)
            .ConfigureAwait(false);

    public async Task<int> CreateLocalListItemAsync(int localListId, int tmdbId, string mediaType,
        DateTime addedAt, CancellationToken ct = default)
    {
        var item = new ListItem
        {
            ListId = localListId,
            TmdbId = tmdbId,
            MediaType = mediaType,
            AddedAt = addedAt
        };
        _db.ListItems.Add(item);
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
        return item.Id;
    }

    /// <summary>Last-write-wins merge of a remote watch event, keyed by (TmdbId, MediaType).
    /// Inserts if unseen locally; overwrites only if the remote row is newer than what we have.</summary>
    public async Task UpsertRemoteWatchEventAsync(SupabaseWatchEventDto dto, CancellationToken ct = default)
    {
        var existing = await _db.SupabaseWatchEvents.FirstOrDefaultAsync(
            e => e.TmdbId == dto.TmdbId && e.MediaType == dto.MediaType, ct).ConfigureAwait(false);

        if (existing == null)
        {
            _db.SupabaseWatchEvents.Add(new SupabaseWatchEvent
            {
                RemoteId = dto.Id,
                TmdbId = dto.TmdbId,
                MediaType = dto.MediaType,
                Title = dto.Title,
                PosterPath = dto.PosterPath,
                WatchedAt = dto.WatchedAt,
                Rating = dto.Rating,
                Source = dto.Source,
                SyncedAtUtc = dto.SyncedAt
            });
            await _db.SaveChangesAsync(ct).ConfigureAwait(false);
            return;
        }

        if (dto.SyncedAt > existing.SyncedAtUtc)
        {
            existing.RemoteId = dto.Id ?? existing.RemoteId;
            existing.Title = dto.Title;
            existing.PosterPath = dto.PosterPath;
            existing.WatchedAt = dto.WatchedAt;
            existing.Rating = dto.Rating;
            existing.Source = dto.Source;
            existing.SyncedAtUtc = dto.SyncedAt;
            await _db.SaveChangesAsync(ct).ConfigureAwait(false);
        }
    }
}
