using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

public static class AddTvdbArtworkCacheMigration
{
    public const string SettingKey = "AddTvdbArtworkCache_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS TvdbArtworkCache (
                    TmdbId       INTEGER NOT NULL,
                    MediaType    TEXT NOT NULL,
                    ArtworksJson TEXT NULL,
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
