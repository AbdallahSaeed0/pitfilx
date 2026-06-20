using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

public static class AddMdbListTvdbTablesMigration
{
    public const string SettingKey = "AddMdbListTvdbTables_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS MdbListRatingsCache (
                    ImdbId    TEXT NOT NULL PRIMARY KEY,
                    TmdbId    INTEGER NULL,
                    RatingsJson TEXT NULL,
                    FetchedAtUtc TEXT NOT NULL
                );
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS TvdbIdCache (
                    TmdbId    INTEGER NOT NULL,
                    MediaType TEXT NOT NULL,
                    TvdbId    INTEGER NULL,
                    FetchedAtUtc TEXT NOT NULL,
                    PRIMARY KEY (TmdbId, MediaType)
                );
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
