using Pitflix.Core.Models;

namespace Pitflix.API.Services.Supabase;

/// <summary>Orchestrates push (local → Supabase) and pull (Supabase → local) for the mobile-sync
/// module. Push doubles as the one-time backfill: the very first sweep finds every existing local
/// list/list-item/completed-watch row unmapped and pushes all of it; every sweep after that only
/// finds what's new. No separate "backfill" code path is needed.</summary>
public sealed class SupabaseSyncService
{
    private readonly SupabaseSyncRepository _repo;
    private readonly SupabaseRestClient _client;
    private readonly ILogger<SupabaseSyncService> _log;

    public SupabaseSyncService(SupabaseSyncRepository repo, SupabaseRestClient client,
        ILogger<SupabaseSyncService> log)
    {
        _repo = repo;
        _client = client;
        _log = log;
    }

    public async Task<(int Lists, int ListItems, int WatchEvents)> PushLocalChangesAsync(
        int batchSize, CancellationToken ct)
    {
        if (!_client.IsConfigured)
            return (0, 0, 0);

        var lists = await PushListsAsync(ct).ConfigureAwait(false);
        var items = await PushListItemsAsync(batchSize, ct).ConfigureAwait(false);
        var events = await PushWatchEventsAsync(batchSize, ct).ConfigureAwait(false);

        if (lists + items + events > 0)
            _log.LogInformation(
                "Supabase sync: pushed {Lists} list(s), {Items} list item(s), {Events} watch event(s)",
                lists, items, events);

        return (lists, items, events);
    }

    public async Task<(int Lists, int ListItems, int WatchEvents)> PullRemoteChangesAsync(
        int batchSize, CancellationToken ct)
    {
        if (!_client.IsConfigured)
            return (0, 0, 0);

        var lists = await PullListsAsync(batchSize, ct).ConfigureAwait(false);
        var items = await PullListItemsAsync(batchSize, ct).ConfigureAwait(false);
        var events = await PullWatchEventsAsync(batchSize, ct).ConfigureAwait(false);

        if (lists + items + events > 0)
            _log.LogInformation(
                "Supabase sync: pulled {Lists} list(s), {Items} list item(s), {Events} watch event(s)",
                lists, items, events);

        return (lists, items, events);
    }

    // ── push ───────────────────────────────────────────────────────────────────────────────

    private async Task<int> PushListsAsync(CancellationToken ct)
    {
        var unsynced = await _repo.GetUnsyncedUserListsAsync(ct).ConfigureAwait(false);
        var pushed = 0;
        foreach (var list in unsynced)
        {
            ct.ThrowIfCancellationRequested();
            var type = list.Name == BuiltinLists.FavoritesName ? SupabaseListTypes.Favorites
                : list.Name == BuiltinLists.WatchLaterName ? SupabaseListTypes.Watchlist
                : SupabaseListTypes.Custom;

            var payload = new
            {
                name = list.Name,
                type,
                source = SupabaseSourceValues.Desktop,
                created_at = list.CreatedAt
            };

            var inserted = await _client.InsertAsync<SupabaseListDto>("lists", payload, ct).ConfigureAwait(false);
            if (inserted?.Id == null)
                continue;

            await _repo.RecordSyncMapAsync(SupabaseSyncEntityTypes.List, list.Id, inserted.Id,
                SupabaseSourceValues.Desktop, ct).ConfigureAwait(false);
            pushed++;
        }

        return pushed;
    }

    private async Task<int> PushListItemsAsync(int batchSize, CancellationToken ct)
    {
        var unsynced = await _repo.GetUnsyncedListItemsAsync(batchSize, ct).ConfigureAwait(false);
        var pushed = 0;
        foreach (var (item, remoteListId) in unsynced)
        {
            ct.ThrowIfCancellationRequested();
            var payload = new
            {
                list_id = remoteListId,
                tmdb_id = item.TmdbId,
                media_type = item.MediaType,
                added_at = item.AddedAt
            };

            var inserted = await _client.InsertAsync<SupabaseListItemDto>("list_items", payload, ct)
                .ConfigureAwait(false);
            if (inserted?.Id == null)
                continue;

            await _repo.RecordSyncMapAsync(SupabaseSyncEntityTypes.ListItem, item.Id, inserted.Id,
                SupabaseSourceValues.Desktop, ct).ConfigureAwait(false);
            pushed++;
        }

        return pushed;
    }

    private async Task<int> PushWatchEventsAsync(int batchSize, CancellationToken ct)
    {
        var unsynced = await _repo.GetUnsyncedWatchHistoryAsync(batchSize, ct).ConfigureAwait(false);
        var pushed = 0;
        foreach (var history in unsynced)
        {
            ct.ThrowIfCancellationRequested();
            if (history.TmdbId is not int tmdbId)
                continue;

            var watchedAt = history.StoppedAt ?? history.OpenedAt;
            var payload = new
            {
                tmdb_id = tmdbId,
                media_type = history.MediaType,
                title = history.Title,
                poster_path = history.PosterUrl,
                watched_at = watchedAt,
                rating = (short?)null,
                source = SupabaseSourceValues.Desktop
            };

            var inserted = await _client.InsertAsync<SupabaseWatchEventDto>("watch_events", payload, ct)
                .ConfigureAwait(false);
            if (inserted?.Id == null)
                continue;

            await _repo.RecordPushedWatchEventAsync(history.Id, inserted.Id, tmdbId, history.MediaType,
                history.Title, history.PosterUrl, watchedAt, ct).ConfigureAwait(false);
            pushed++;
        }

        return pushed;
    }

    // ── pull ───────────────────────────────────────────────────────────────────────────────

    private async Task<int> PullListsAsync(int batchSize, CancellationToken ct)
    {
        var cursor = await _repo.GetListsPullCursorAsync(ct).ConfigureAwait(false) ?? DateTime.UnixEpoch;
        var query = $"source=neq.{SupabaseSourceValues.Desktop}" +
                    $"&created_at=gt.{SupabaseRestClient.FormatTimestampFilterValue(cursor)}" +
                    $"&order=created_at.asc&limit={batchSize}";

        var remoteLists = await _client.GetAsync<SupabaseListDto>("lists", query, ct).ConfigureAwait(false);
        if (remoteLists == null || remoteLists.Count == 0)
            return 0;

        var processed = 0;
        var maxSeen = cursor;
        foreach (var dto in remoteLists)
        {
            ct.ThrowIfCancellationRequested();
            if (dto.Id == null)
                continue;

            // Already known — either we pushed it ourselves, or we've pulled it before.
            var existingMap = await _repo.FindListMapByRemoteIdAsync(dto.Id, ct).ConfigureAwait(false);
            if (existingMap == null)
            {
                var localListId = await _repo.FindOrCreateLocalListForRemoteAsync(dto, ct).ConfigureAwait(false);
                await _repo.RecordSyncMapAsync(SupabaseSyncEntityTypes.List, localListId, dto.Id,
                    SupabaseSourceValues.Mobile, ct).ConfigureAwait(false);
                processed++;
            }

            if (dto.CreatedAt > maxSeen)
                maxSeen = dto.CreatedAt;
        }

        await _repo.SetListsPullCursorAsync(maxSeen, ct).ConfigureAwait(false);
        return processed;
    }

    private async Task<int> PullListItemsAsync(int batchSize, CancellationToken ct)
    {
        var cursor = await _repo.GetListItemsPullCursorAsync(ct).ConfigureAwait(false) ?? DateTime.UnixEpoch;
        var query = $"added_at=gt.{SupabaseRestClient.FormatTimestampFilterValue(cursor)}" +
                    $"&order=added_at.asc&limit={batchSize}";

        var remoteItems = await _client.GetAsync<SupabaseListItemDto>("list_items", query, ct).ConfigureAwait(false);
        if (remoteItems == null || remoteItems.Count == 0)
            return 0;

        var processed = 0;
        var cursorAdvance = cursor;
        foreach (var dto in remoteItems)
        {
            ct.ThrowIfCancellationRequested();
            if (dto.Id == null)
                continue;

            var listMap = await _repo.FindListMapByRemoteIdAsync(dto.ListId, ct).ConfigureAwait(false);
            if (listMap == null)
            {
                // Parent list not synced yet — stop here so we don't skip past this item;
                // it (and anything after it) will be retried once the parent list arrives.
                break;
            }

            if (!await _repo.LocalListItemExistsAsync(listMap.LocalId, dto.TmdbId, dto.MediaType, ct)
                    .ConfigureAwait(false))
            {
                var localItemId = await _repo.CreateLocalListItemAsync(
                    listMap.LocalId, dto.TmdbId, dto.MediaType, dto.AddedAt, ct).ConfigureAwait(false);
                await _repo.RecordSyncMapAsync(SupabaseSyncEntityTypes.ListItem, localItemId, dto.Id,
                    SupabaseSourceValues.Mobile, ct).ConfigureAwait(false);
            }

            processed++;
            cursorAdvance = dto.AddedAt;
        }

        if (cursorAdvance > cursor)
            await _repo.SetListItemsPullCursorAsync(cursorAdvance, ct).ConfigureAwait(false);
        return processed;
    }

    private async Task<int> PullWatchEventsAsync(int batchSize, CancellationToken ct)
    {
        var cursor = await _repo.GetWatchEventsPullCursorAsync(ct).ConfigureAwait(false) ?? DateTime.UnixEpoch;
        var query = $"source=neq.{SupabaseSourceValues.Desktop}" +
                    $"&synced_at=gt.{SupabaseRestClient.FormatTimestampFilterValue(cursor)}" +
                    $"&order=synced_at.asc&limit={batchSize}";

        var remoteEvents = await _client.GetAsync<SupabaseWatchEventDto>("watch_events", query, ct)
            .ConfigureAwait(false);
        if (remoteEvents == null || remoteEvents.Count == 0)
            return 0;

        var maxSeen = cursor;
        foreach (var dto in remoteEvents)
        {
            ct.ThrowIfCancellationRequested();
            await _repo.UpsertRemoteWatchEventAsync(dto, ct).ConfigureAwait(false);
            if (dto.SyncedAt > maxSeen)
                maxSeen = dto.SyncedAt;
        }

        await _repo.SetWatchEventsPullCursorAsync(maxSeen, ct).ConfigureAwait(false);
        return remoteEvents.Count;
    }
}
