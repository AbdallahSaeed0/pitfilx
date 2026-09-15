using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

/// <summary>
/// Adds persisted "next episode airing" fields to Shows so /api/home/next-episodes ("Up Next")
/// can read straight from the database instead of doing a live TMDB lookup per show on every
/// request — that was the actual source of its multi-second load time. A background service
/// (NextAiringRefreshHostedService) keeps these columns warm; the endpoint only falls back to a
/// live lookup for a show it has genuinely never checked yet.
/// </summary>
public static class AddNextAiringCacheMigration
{
    public const string SettingKey = "AddNextAiringCache_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        var columns = new (string Name, string Sql)[]
        {
            ("NextEpisodeName", "ALTER TABLE Shows ADD COLUMN NextEpisodeName TEXT;"),
            ("NextEpisodeSeason", "ALTER TABLE Shows ADD COLUMN NextEpisodeSeason INTEGER;"),
            ("NextEpisodeNumber", "ALTER TABLE Shows ADD COLUMN NextEpisodeNumber INTEGER;"),
            ("NextEpisodeAirDate", "ALTER TABLE Shows ADD COLUMN NextEpisodeAirDate TEXT;"),
            ("NextAiringFetchedAtUtc", "ALTER TABLE Shows ADD COLUMN NextAiringFetchedAtUtc TEXT;"),
        };

        foreach (var (_, sql) in columns)
        {
            try
            {
                using var db = LibraryContext.Create();
                await db.Database.ExecuteSqlRawAsync(sql, ct).ConfigureAwait(false);
            }
            catch { /* column likely already exists */ }
        }

        try
        {
            await repo.SaveSettingAsync(SettingKey, "1", ct).ConfigureAwait(false);
        }
        catch { }
    }
}
