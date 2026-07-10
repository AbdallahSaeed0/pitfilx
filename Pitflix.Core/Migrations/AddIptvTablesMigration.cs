using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

public static class AddIptvTablesMigration
{
    public const string SettingKey = "AddIptvTables_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS IptvProviders (
                    Id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    DisplayName TEXT    NOT NULL DEFAULT '',
                    Type        INTEGER NOT NULL DEFAULT 0,
                    M3uUrl      TEXT    NULL,
                    ServerUrl   TEXT    NULL,
                    Username    TEXT    NULL,
                    Password    TEXT    NULL,
                    EpgUrl      TEXT    NULL,
                    CreatedAt       TEXT NOT NULL DEFAULT (datetime('now')),
                    LastRefreshedAt TEXT NULL,
                    ChannelCount    INTEGER NOT NULL DEFAULT 0
                );
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS IptvChannels (
                    Id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    ProviderId  INTEGER NOT NULL,
                    Name        TEXT    NOT NULL DEFAULT '',
                    StreamUrl   TEXT    NOT NULL DEFAULT '',
                    LogoUrl     TEXT    NULL,
                    "Group"     TEXT    NULL,
                    TvgId       TEXT    NULL,
                    TvgName     TEXT    NULL,
                    StreamId    TEXT    NULL,
                    SortOrder   INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (ProviderId) REFERENCES IptvProviders(Id) ON DELETE CASCADE
                );
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE INDEX IF NOT EXISTS IX_IptvChannels_ProviderId ON IptvChannels(ProviderId);
                CREATE INDEX IF NOT EXISTS IX_IptvChannels_Group ON IptvChannels("Group");
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
