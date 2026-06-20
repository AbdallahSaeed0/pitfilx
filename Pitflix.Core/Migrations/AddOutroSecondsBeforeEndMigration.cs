using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

/// <summary>
/// Fixes a real bug found via end-to-end testing: fingerprint-sourced outro timestamps were
/// stored as one absolute season-wide value, computed from whichever sampled episode's duration
/// happened to be known at detection time — wrong for any other episode whose runtime differs
/// (real TV seasons vary episode to episode, sometimes by 100+ seconds). These two new columns
/// store the outro window as seconds-before-file-end instead, which is duration-independent;
/// it's resolved to an absolute timestamp per-episode at serve time using that specific
/// episode's own duration. Chapter-sourced outro is unaffected — chapter detection already
/// probes each file's own duration individually, so it doesn't have this problem.
/// </summary>
public static class AddOutroSecondsBeforeEndMigration
{
    public const string SettingKey = "AddOutroSecondsBeforeEnd_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE SeasonSkipSegments ADD COLUMN OutroSecondsBeforeEndStart REAL;",
                ct).ConfigureAwait(false);
        }
        catch { /* column likely already exists */ }

        try
        {
            using var db = LibraryContext.Create();
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE SeasonSkipSegments ADD COLUMN OutroSecondsBeforeEndEnd REAL;",
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
