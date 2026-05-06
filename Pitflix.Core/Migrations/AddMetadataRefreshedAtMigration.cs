using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

public static class AddMetadataRefreshedAtMigration
{
    public const string SettingKey = "AddMetadataRefreshedAt_v1";

    /// <summary>Adds MetadataRefreshedAt columns to Movies and Shows tables to track when metadata was last synced from TMDB.</summary>
    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken cancellationToken = default)
    {
        try
        {
            if (await repo.GetSettingAsync(SettingKey, cancellationToken).ConfigureAwait(false) == "1")
                return;

            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE Movies ADD COLUMN MetadataRefreshedAt TEXT;",
                cancellationToken: cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            // Column likely already exists, ignore
        }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE Shows ADD COLUMN MetadataRefreshedAt TEXT;",
                cancellationToken: cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            // Column likely already exists, ignore
        }

        try
        {
            await repo.SaveSettingAsync(SettingKey, "1", cancellationToken).ConfigureAwait(false);
        }
        catch { }
    }
}

