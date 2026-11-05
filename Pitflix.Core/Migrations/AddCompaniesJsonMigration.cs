using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

/// <summary>
/// Adds <c>CompaniesJson</c> to Movies/Shows so the detail page's Studio/Network row (and, for
/// movies, the belongs_to_collection lookup) is fetched from TMDB once and cached, instead of live
/// on every single detail-page open — previously the two were separate uncached TMDB calls hitting
/// the exact same <c>movie/{id}</c> endpoint on every visit.
/// </summary>
public static class AddCompaniesJsonMigration
{
    public const string SettingKey = "AddCompaniesJson_v1";

    public static async Task RunIfNeededAsync(LibraryRepository repo, CancellationToken ct = default)
    {
        if (await repo.GetSettingAsync(SettingKey, ct).ConfigureAwait(false) == "1")
            return;

        foreach (var table in new[] { "Movies", "Shows" })
        {
            try
            {
                using var db = LibraryContext.Create();
                string sql = $"ALTER TABLE {table} ADD COLUMN CompaniesJson TEXT NULL;";
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
