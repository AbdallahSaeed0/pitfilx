using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

public static class AddTraktTablesMigration
{
    public const string SettingKey = "AddTraktTables_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS TraktSettings (
                    Id              INTEGER NOT NULL PRIMARY KEY,
                    AccessToken     TEXT    NULL,
                    RefreshToken    TEXT    NULL,
                    TokenExpiresAt  TEXT    NULL,
                    IsConnected     INTEGER NOT NULL DEFAULT 0,
                    AutoSyncEnabled INTEGER NOT NULL DEFAULT 0
                );
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS TraktIdMaps (
                    Id       INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    TmdbId   INTEGER NOT NULL,
                    MediaType TEXT   NOT NULL,
                    TraktId  INTEGER NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS IX_TraktIdMaps_TmdbId_MediaType ON TraktIdMaps(TmdbId, MediaType);
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync(
                "INSERT OR IGNORE INTO TraktSettings (Id, IsConnected, AutoSyncEnabled) VALUES (1, 0, 0);", ct)
                .ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            await repo.SaveSettingAsync(SettingKey, "1", ct).ConfigureAwait(false);
        }
        catch { }
    }
}
