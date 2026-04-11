using Pitflix.Core.Api;
using Pitflix.Core.Database;

namespace Pitflix.Core.Migrations;

public static class OriginalLanguageMigration
{
    public const string SettingKey = "OriginalLanguageMigration_v1";
    public const string SummarySettingKey = "LanguageMigrationLastSummary";

    public sealed record Result(
        bool Ran,
        bool SkippedNoApiKey,
        int ShowsUpdated,
        int MoviesUpdated,
        int ArabicShows,
        int NonArabicShows,
        int ArabicMovies,
        int NonArabicMovies);

    /// <summary>Runs once per DB: refreshes <see cref="Models.Show.IsArabic"/> / <see cref="Models.Movie.IsArabic"/> from TMDB <c>original_language</c>.</summary>
    public static async Task<Result> RunIfNeededAsync(LibraryRepository repo, TmdbClient? tmdb,
        CancellationToken cancellationToken = default)
    {
        var counts = await repo.GetLanguageClassificationCountsAsync(cancellationToken).ConfigureAwait(false);

        if (await repo.GetSettingAsync(SettingKey, cancellationToken).ConfigureAwait(false) == "1")
        {
            return new Result(false, false, 0, 0, counts.ArabicShows, counts.NonArabicShows, counts.ArabicMovies,
                counts.NonArabicMovies);
        }

        if (tmdb == null)
        {
            return new Result(false, true, 0, 0, counts.ArabicShows, counts.NonArabicShows, counts.ArabicMovies,
                counts.NonArabicMovies);
        }

        var (showsU, moviesU) =
            await repo.MigrateIsArabicFromTmdbOriginalLanguageAsync(tmdb, cancellationToken).ConfigureAwait(false);

        await repo.SaveSettingAsync(SettingKey, "1", cancellationToken).ConfigureAwait(false);

        counts = await repo.GetLanguageClassificationCountsAsync(cancellationToken).ConfigureAwait(false);

        var summary =
            $"Arabic shows: {counts.ArabicShows}, other: {counts.NonArabicShows} | " +
            $"Arabic movies: {counts.ArabicMovies}, other: {counts.NonArabicMovies} | " +
            $"Updated: {showsU} shows, {moviesU} movies (TMDB original_language migration)";
        await repo.SaveSettingAsync(SummarySettingKey, summary, cancellationToken).ConfigureAwait(false);

        return new Result(true, false, showsU, moviesU, counts.ArabicShows, counts.NonArabicShows, counts.ArabicMovies,
            counts.NonArabicMovies);
    }
}
