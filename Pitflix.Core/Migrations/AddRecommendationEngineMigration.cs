using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

/// <summary>
/// Adds storage for the shared smart-recommendation engine: a per-title TTL cache for the
/// detail page's "You may like this" section, a computed/cached feed table for the
/// Recommendations page (populated by a background job), and the TMDB collection id/name
/// columns on Movies needed for franchise-overlap scoring.
/// </summary>
public static class AddRecommendationEngineMigration
{
    public const string SettingKey = "AddRecommendationEngine_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS DetailRecommendationCaches (
                    Id              INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    TmdbId          INTEGER NOT NULL,
                    MediaType       TEXT    NOT NULL,
                    ResultJson      TEXT    NOT NULL,
                    ComputedAtUtc   TEXT    NOT NULL,
                    ExpiresAtUtc    TEXT    NOT NULL
                );
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE UNIQUE INDEX IF NOT EXISTS IX_DetailRecommendationCaches_TmdbId_MediaType
                    ON DetailRecommendationCaches(TmdbId, MediaType);
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS LibraryRecommendations (
                    Id                      INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    TmdbId                  INTEGER NOT NULL,
                    MediaType               TEXT    NOT NULL,
                    Title                   TEXT    NOT NULL,
                    Year                    TEXT    NULL,
                    Overview                TEXT    NULL,
                    PosterUrl               TEXT    NULL,
                    VoteAverage             REAL    NOT NULL DEFAULT 0,
                    VoteCount               INTEGER NOT NULL DEFAULT 0,
                    Score                   REAL    NOT NULL DEFAULT 0,
                    ContributingSeedsJson   TEXT    NOT NULL DEFAULT '[]',
                    SortOrder               INTEGER NOT NULL DEFAULT 0,
                    ComputedAtUtc           TEXT    NOT NULL
                );
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE INDEX IF NOT EXISTS IX_LibraryRecommendations_SortOrder
                    ON LibraryRecommendations(SortOrder);
                """, ct).ConfigureAwait(false);
        }
        catch { /* already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE Movies ADD COLUMN CollectionId INTEGER;",
                ct).ConfigureAwait(false);
        }
        catch { /* column likely already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE Movies ADD COLUMN CollectionName TEXT;",
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
