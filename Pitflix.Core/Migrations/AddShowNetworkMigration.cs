using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

/// <summary>
/// Adds <see cref="Models.Show.Network"/> so Statistics can break series down by originating
/// network/streaming service (Netflix, HBO, etc.), lazily backfilled from TMDB.
/// </summary>
public static class AddShowNetworkMigration
{
    public const string SettingKey = "AddShowNetwork_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE Shows ADD COLUMN Network TEXT;",
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
