using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

/// <summary>
/// Adds <c>CompletedFromPlayback</c> to Movies/Shows/Episodes so Statistics' "Recently completed"
/// feed can distinguish titles actually finished by playing them in-app from ones a user manually
/// marked watched (dropdown status change, or "mark completed" on dismiss from Continue Watching).
/// </summary>
public static class AddCompletedFromPlaybackMigration
{
    public const string SettingKey = "AddCompletedFromPlayback_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        foreach (var table in new[] { "Movies", "Shows", "Episodes" })
        {
            try
            {
                using var db = LibraryContext.Create();
                string sql = $"ALTER TABLE {table} ADD COLUMN CompletedFromPlayback INTEGER NOT NULL DEFAULT 0;";
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
