using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

/// <summary>
/// Adds <see cref="Models.SeasonSkipSegment.DetectionSource"/> for Tier-3 skip diagnostics and
/// backfills existing fingerprint rows that already have an intro window.
/// </summary>
public static class AddDetectionSourceMigration
{
    public const string SettingKey = "AddDetectionSource_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE SeasonSkipSegments ADD COLUMN DetectionSource TEXT;",
                ct).ConfigureAwait(false);
        }
        catch { /* column likely already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync(
                """
                UPDATE SeasonSkipSegments
                SET DetectionSource = 'chromaprint'
                WHERE IntroStartSeconds IS NOT NULL
                  AND (DetectionSource IS NULL OR DetectionSource = '');
                """,
                ct).ConfigureAwait(false);
        }
        catch { /* best effort */ }

        try
        {
            await repo.SaveSettingAsync(SettingKey, "1", ct).ConfigureAwait(false);
        }
        catch { }
    }
}
