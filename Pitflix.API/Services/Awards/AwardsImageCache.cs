using System.Security.Cryptography;
using System.Text;
using Pitflix.Core.Services;

namespace Pitflix.API.Services.Awards;

/// <summary>
/// Files under <see cref="ImageCacheService.CacheRoot"/> / <c>awards-cache</c>, served at <c>/images/awards-cache/...</c>.
/// Populated by <c>scripts/cache_award_posters.py</c> (hash must match Python).
/// </summary>
internal static class AwardsImageCache
{
    private static string Root => Path.Combine(ImageCacheService.CacheRoot, "awards-cache");

    /// <summary>Main awards hub card poster (from <c>catalog.json</c> TMDB path).</summary>
    public static string CatalogPosterPath(string awardId) =>
        Path.Combine(Root, awardId, "catalog-poster.jpg");

    /// <summary>Main awards hub card backdrop (from <c>catalog.json</c> TMDB path).</summary>
    public static string CatalogBackdropPath(string awardId) =>
        Path.Combine(Root, awardId, "catalog-backdrop.jpg");

    /// <summary>Optional ceremony / branding poster (from <c>catalog.json</c> <c>eventPosterPath</c>).</summary>
    public static string EventPosterPath(string awardId) =>
        Path.Combine(Root, awardId, "event-poster.jpg");

    /// <summary>Optional ceremony / branding backdrop (from <c>catalog.json</c> <c>eventBackdropPath</c>).</summary>
    public static string EventBackdropPath(string awardId) =>
        Path.Combine(Root, awardId, "event-backdrop.jpg");

    public static string YearPosterPath(string awardId, int year) =>
        Path.Combine(Root, awardId, $"{year}-poster.jpg");

    public static string YearBackdropPath(string awardId, int year) =>
        Path.Combine(Root, awardId, $"{year}-backdrop.jpg");

    /// <summary>
    /// Ceremony/event poster for a specific year (from edition JSON <c>posterPath</c>).
    /// Kept separate from <see cref="YearPosterPath"/> because that file can be nominee-derived hero art.
    /// </summary>
    public static string YearEventPosterPath(string awardId, int year) =>
        Path.Combine(Root, awardId, $"{year}-event-poster.jpg");

    /// <summary>
    /// Ceremony/event backdrop for a specific year (from edition JSON <c>backdropPath</c>).
    /// </summary>
    public static string YearEventBackdropPath(string awardId, int year) =>
        Path.Combine(Root, awardId, $"{year}-event-backdrop.jpg");

    public static string NomineePosterPath(string awardId, int year, string categoryId, string title, int? resolvedTmdbId) =>
        Path.Combine(Root, awardId, year.ToString(System.Globalization.CultureInfo.InvariantCulture),
            $"{NomineeFileBase(categoryId, title, resolvedTmdbId)}-poster.jpg");

    public static string NomineeBackdropPath(string awardId, int year, string categoryId, string title, int? resolvedTmdbId) =>
        Path.Combine(Root, awardId, year.ToString(System.Globalization.CultureInfo.InvariantCulture),
            $"{NomineeFileBase(categoryId, title, resolvedTmdbId)}-backdrop.jpg");

    /// <summary>Cache key includes TMDB id when known so the same title always maps to the same file after enrichment.</summary>
    private static string NomineeFileBase(string categoryId, string title, int? resolvedTmdbId)
    {
        var key = resolvedTmdbId is > 0
            ? $"{categoryId}:{title}:tmdb:{resolvedTmdbId.Value}"
            : $"{categoryId}:{title}:pending";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(key));
        return Convert.ToHexString(bytes.AsSpan(0, 8)).ToLowerInvariant();
    }
}
