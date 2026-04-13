using System.Text.RegularExpressions;

namespace Pitflix.API.Services.Trailers;

/// <summary>
/// Strips noisy suffixes from YouTube/TMDB video names for display. Canonical titles still come from TMDB discover/details.
/// </summary>
public static class TrailerTitleNormalizer
{
    private static readonly Regex[] NoisePatterns =
    {
        new(@"\s*[\[\(]\s*(4K|8K|HDR|UHD|DOLBY|IMAX|DUBBED|SUBBED|SUBTITLES?|MULTI|DUAL)[^\]\)]*[\]\)]",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant),
        new(@"\b(official|final|main|domestic|international)\s+(trailer|teaser|clip|preview|sneak\s*peek)\b",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant),
        new(@"\b(trailer|teaser|sneak\s*peek|clip|preview|featurette)\s*(#?\d+)?\b",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant),
    };

    public static string NormalizeClipTitle(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return "Trailer";
        var t = raw.Trim();
        foreach (var rx in NoisePatterns)
            t = rx.Replace(t, " ");
        t = Regex.Replace(t, @"\s{2,}", " ").Trim();
        return string.IsNullOrWhiteSpace(t) ? raw.Trim() : t;
    }

    /// <summary>Strip noise for TMDB multi-search; never use as display title.</summary>
    public static string NormalizeForTmdbSearch(string? raw)
    {
        var t = NormalizeClipTitle(raw);
        t = Regex.Replace(t, @"^\s*[^|]{0,80}\|\s*", "", RegexOptions.None);
        t = Regex.Replace(t, @"\s*[-–—]\s*(Official\s*)?(Trailer|Teaser)\s*$", "", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"\s{2,}", " ").Trim();
        return t.Length < 2 ? (raw?.Trim() ?? "") : t;
    }

    public static int? TryExtractYear(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;
        var m = Regex.Match(text, @"\b(19|20)\d{2}\b");
        if (m.Success && int.TryParse(m.Value, out var y) && y is >= 1900 and <= 2100)
            return y;
        return null;
    }
}
