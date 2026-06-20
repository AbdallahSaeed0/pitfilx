using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

/// <summary>
/// Adds the intro/outro skip-detection schema: one SeasonSkipSegments row per
/// (Show, Season) — there is no first-class Season entity, so it's keyed the
/// same way Episode already is — plus EpisodeSkipOverrides for per-episode
/// exceptions, and a nullable MalId column on Shows for the future AniSkip
/// lookup layer.
/// </summary>
public static class AddSkipSegmentsMigration
{
    public const string SettingKey = "AddSkipSegments_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS SeasonSkipSegments (
                    Id                  INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    ShowId              INTEGER NOT NULL,
                    SeasonNumber        INTEGER NOT NULL,
                    IntroStartSeconds   REAL    NULL,
                    IntroEndSeconds     REAL    NULL,
                    IntroConfidence     REAL    NULL,
                    IntroSource         TEXT    NULL,
                    OutroStartSeconds   REAL    NULL,
                    OutroEndSeconds     REAL    NULL,
                    OutroConfidence     REAL    NULL,
                    OutroSource         TEXT    NULL,
                    SampleEpisodeCount  INTEGER NOT NULL DEFAULT 0,
                    ComputedAt          TEXT    NOT NULL,
                    FOREIGN KEY (ShowId) REFERENCES Shows(Id) ON DELETE CASCADE
                );
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE UNIQUE INDEX IF NOT EXISTS IX_SeasonSkipSegments_ShowId_SeasonNumber
                    ON SeasonSkipSegments(ShowId, SeasonNumber);
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS EpisodeSkipOverrides (
                    Id                  INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    EpisodeId           INTEGER NOT NULL,
                    IntroStartSeconds   REAL    NULL,
                    IntroEndSeconds     REAL    NULL,
                    OutroStartSeconds   REAL    NULL,
                    OutroEndSeconds     REAL    NULL,
                    SuppressIntro       INTEGER NOT NULL DEFAULT 0,
                    SuppressOutro       INTEGER NOT NULL DEFAULT 0,
                    Source              TEXT    NOT NULL DEFAULT 'manual',
                    FOREIGN KEY (EpisodeId) REFERENCES Episodes(Id) ON DELETE CASCADE
                );
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE UNIQUE INDEX IF NOT EXISTS IX_EpisodeSkipOverrides_EpisodeId
                    ON EpisodeSkipOverrides(EpisodeId);
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE Shows ADD COLUMN MalId INTEGER;",
                ct).ConfigureAwait(false);
        }
        catch { /* column likely already exists */ }

        try
        {
            await repo.SaveSettingAsync(SettingKey, "1", ct).ConfigureAwait(false);
        }
        catch { }
    }
}
