using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

/// <summary>
/// Every row written to MdbListEpisodeRatingsCache before this fix landed is bad, in two waves:
/// (1) the original bug queried MDBList with the show's IMDb id plus season/episode numbers
/// (<c>i=showId&amp;s=&amp;e=</c>), which MDBList silently answers with the show's own rating for
/// every episode; (2) the first attempted fix resolved each episode's own IMDb id via TMDB and queried
/// MDBList with that instead, but MDBList has no per-episode lookup by IMDb id (404s), so every row
/// from that attempt cached a null rating. The real fix uses MDBList's bulk per-show endpoint
/// (<see cref="Pitflix.API.Services.MdbListService.GetShowEpisodeRatingsAsync"/>, not referenced here to
/// avoid a Core-&gt;API dependency) which returns real varying per-episode numbers in one request.
/// Purges the table (again) so the season page re-fetches instead of serving stale/null values for up
/// to the 7-day cache TTL.
/// </summary>
public static class FixEpisodeImdbRatingCacheMigration
{
    public const string SettingKey = "FixEpisodeImdbRatingCache_v2";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("DELETE FROM MdbListEpisodeRatingsCache;", ct)
                .ConfigureAwait(false);
        }
        catch { /* table may not exist yet on a fresh install */ }

        try
        {
            await repo.SaveSettingAsync(SettingKey, "1", ct).ConfigureAwait(false);
        }
        catch { }
    }
}
