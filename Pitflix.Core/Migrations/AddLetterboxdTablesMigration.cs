using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

public static class AddLetterboxdTablesMigration
{
    public const string SettingKey = "AddLetterboxdTables_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS LetterboxdFilmCache (
                    ImdbId    TEXT NOT NULL PRIMARY KEY,
                    LetterboxdFilmLid TEXT NULL,
                    CommunityRating REAL NULL,
                    RatingCount INTEGER NULL,
                    CachedAt TEXT NOT NULL
                );
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS LetterboxdReviewCache (
                    Id        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    LetterboxdFilmLid TEXT NOT NULL,
                    ReviewerUsername TEXT NOT NULL,
                    ReviewerDisplayName TEXT NULL,
                    ReviewerAvatarUrl TEXT NULL,
                    Rating REAL NULL,
                    ReviewText TEXT NULL,
                    WatchedDate TEXT NULL,
                    LogEntryUrl TEXT NULL,
                    IsFollowing INTEGER NOT NULL,
                    CachedAt TEXT NOT NULL
                );
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE INDEX IF NOT EXISTS IX_LetterboxdReviewCache_Lid ON LetterboxdReviewCache(LetterboxdFilmLid);
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
