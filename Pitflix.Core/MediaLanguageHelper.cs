namespace Pitflix.Core;

/// <summary>Classifies library language using TMDB <c>original_language</c> first, then path (عربي / Arabic).</summary>
public static class MediaLanguageHelper
{
    /// <summary>
    /// If TMDB provides a 2-letter code: <c>ar</c> → Arabic; any other code → not Arabic.
    /// If missing/empty → fall back to folder path (Arabic shelf).
    /// </summary>
    public static bool ComputeIsArabic(string? tmdbOriginalLanguage, string filePathForFallback)
    {
        var lang = tmdbOriginalLanguage?.Trim();
        if (!string.IsNullOrEmpty(lang))
        {
            if (lang.Equals("ar", StringComparison.OrdinalIgnoreCase))
                return true;
            if (lang.Length == 2)
                return false;
        }

        return LibraryPathHelper.DeriveIsArabicFromMediaPath(filePathForFallback);
    }
}
