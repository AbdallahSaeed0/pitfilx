using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

/// <summary>
/// Adds a persistent cache for per-episode MDBList IMDb ratings. Without it, opening a season page
/// re-fetched every episode's rating live from MDBList on every visit — and MDBList enforces a
/// 1-request-per-second rate limit, so an N-episode season took N+ seconds to load every single time.
/// </summary>
public static class AddMdbListEpisodeRatingsCacheMigration
{
    public const string SettingKey = "AddMdbListEpisodeRatingsCache_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS MdbListEpisodeRatingsCache (
                    ShowImdbId   TEXT NOT NULL,
                    Season       INTEGER NOT NULL,
                    Episode      INTEGER NOT NULL,
                    ImdbRating   REAL NULL,
                    FetchedAtUtc TEXT NOT NULL,
                    PRIMARY KEY (ShowImdbId, Season, Episode)
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
