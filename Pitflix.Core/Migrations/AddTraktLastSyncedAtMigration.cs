using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

/// <summary>
/// Adds <see cref="Models.TraktSettings.LastSyncedAtUtc"/> so the Settings > Trakt tab can show
/// "Last synced" and offer a manual sync button, matching the Mobile Sync tab's pattern.
/// </summary>
public static class AddTraktLastSyncedAtMigration
{
    public const string SettingKey = "AddTraktLastSyncedAt_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE TraktSettings ADD COLUMN LastSyncedAtUtc TEXT;",
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
