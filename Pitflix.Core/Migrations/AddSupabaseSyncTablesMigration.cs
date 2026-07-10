using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

/// <summary>Creates the local tables backing the Supabase mobile-sync module. Fully additive —
/// does not touch UserLists, ListItems, or WatchHistory.</summary>
public static class AddSupabaseSyncTablesMigration
{
    public const string SettingKey = "AddSupabaseSyncTables_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS SupabaseSyncMaps (
                    Id              INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    EntityType      TEXT    NOT NULL,
                    LocalId         INTEGER NOT NULL,
                    RemoteId        TEXT    NOT NULL,
                    Origin          TEXT    NOT NULL DEFAULT 'desktop',
                    LastSyncedAtUtc TEXT    NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS IX_SupabaseSyncMaps_EntityType_RemoteId ON SupabaseSyncMaps(EntityType, RemoteId);
                CREATE UNIQUE INDEX IF NOT EXISTS IX_SupabaseSyncMaps_EntityType_LocalId ON SupabaseSyncMaps(EntityType, LocalId);
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS SupabaseWatchEvents (
                    Id                  INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    RemoteId            TEXT    NULL,
                    TmdbId              INTEGER NOT NULL,
                    MediaType           TEXT    NOT NULL,
                    Title               TEXT    NULL,
                    PosterPath          TEXT    NULL,
                    WatchedAt           TEXT    NOT NULL,
                    Rating              INTEGER NULL,
                    Source              TEXT    NOT NULL DEFAULT 'desktop',
                    SyncedAtUtc         TEXT    NOT NULL,
                    LocalWatchHistoryId INTEGER NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS IX_SupabaseWatchEvents_TmdbId_MediaType ON SupabaseWatchEvents(TmdbId, MediaType);
                CREATE UNIQUE INDEX IF NOT EXISTS IX_SupabaseWatchEvents_RemoteId ON SupabaseWatchEvents(RemoteId);
                CREATE INDEX IF NOT EXISTS IX_SupabaseWatchEvents_SyncedAtUtc ON SupabaseWatchEvents(SyncedAtUtc);
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            await repo.SaveSettingAsync(SettingKey, "1", ct).ConfigureAwait(false);
        }
        catch { }
    }
}
