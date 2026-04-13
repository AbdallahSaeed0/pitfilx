using Pitflix.Core.Api;
using Pitflix.Core.Models;

namespace Pitflix.API.Services.Trailers;

/// <summary>
/// Maps noisy RSS/YouTube titles to TMDB catalog rows — TMDB remains source of truth for ids and metadata.
/// </summary>
public static class ScrapedTrailerTmdbResolver
{
    public static async Task<TmdbDiscoverItem?> TryResolveAsync(
        RawTrailerCandidate raw,
        TmdbClient tmdb,
        CancellationToken ct)
    {
        var q = TrailerTitleNormalizer.NormalizeForTmdbSearch(raw.RawTitle);
        if (string.IsNullOrWhiteSpace(q) || q.Length < 2)
            return null;

        var year = TrailerTitleNormalizer.TryExtractYear(raw.RawTitle);

        var movieId = await tmdb.TryFindMovieIdBySearchAsync(q, year, ct).ConfigureAwait(false);
        if (movieId is > 0)
        {
            var d = await tmdb.TryGetDiscoverItemAsync(movieId.Value, "Movie", ct).ConfigureAwait(false);
            if (d != null && TitleLikelyMatches(q, d.Title))
                return d;
        }

        var tvId = await tmdb.TryFindTvIdBySearchAsync(q, year, ct).ConfigureAwait(false);
        if (tvId is > 0)
        {
            var d = await tmdb.TryGetDiscoverItemAsync(tvId.Value, "Series", ct).ConfigureAwait(false);
            if (d != null && TitleLikelyMatches(q, d.Title))
                return d;
        }

        return null;
    }

    /// <summary>Rejects obvious wrong-first-hit cases when query words barely overlap TMDB title.</summary>
    private static bool TitleLikelyMatches(string query, string tmdbTitle)
    {
        if (string.IsNullOrWhiteSpace(tmdbTitle))
            return false;
        var qWords = SplitWords(query);
        var tWords = SplitWords(tmdbTitle);
        if (qWords.Count == 0 || tWords.Count == 0)
            return true;
        var hit = qWords.Count(w => tWords.Contains(w));
        var ratio = (double)hit / Math.Max(1, qWords.Count);
        return ratio >= 0.34 || tmdbTitle.Contains(query, StringComparison.OrdinalIgnoreCase);
    }

    private static HashSet<string> SplitWords(string s)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in s.Split(SpaceDash, StringSplitOptions.RemoveEmptyEntries))
        {
            var w = part.Trim(".,!?\"'()[]".ToCharArray());
            if (w.Length >= 3)
                set.Add(w);
        }

        return set;
    }

    private static readonly char[] SpaceDash = { ' ', '-', '–', '—' };
}
