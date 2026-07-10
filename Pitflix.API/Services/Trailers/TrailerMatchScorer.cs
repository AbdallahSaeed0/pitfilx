using System.Text.RegularExpressions;
using Pitflix.Core.Models;

namespace Pitflix.API.Services.Trailers;

/// <summary>
/// Pure title-matching and quality-scoring math used by <see cref="TrailerIngestionService"/> to decide
/// which YouTube candidate best represents a TMDB title, and how good a match/trailer it is.
/// Extracted as a self-contained, stateless class so the scoring algorithm can be reasoned about
/// (and tested) independently of the ingestion pipeline's I/O and retry logic.
/// </summary>
internal static class TrailerMatchScorer
{
    private static readonly Regex OfficialTrailerPattern =
        new(@"\bofficial\s+trailer\b", RegexOptions.IgnoreCase | RegexOptions.Compiled, TimeSpan.FromMilliseconds(200));

    // Pre-TMDB gate only; scoring still uses OfficialTrailerPattern ("official trailer").
    private static readonly Regex OfficialTrailerOrTeaserGatePattern =
        new(@"\bofficial\s+(trailer|teaser)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled, TimeSpan.FromMilliseconds(200));

    private static readonly Regex OfficialFinalTrailerGatePattern =
        new(@"\bofficial\s+final\s+trailer\b", RegexOptions.IgnoreCase | RegexOptions.Compiled, TimeSpan.FromMilliseconds(200));

    private static readonly Regex TrailerNumberedPattern =
        new(@"\btrailer\s*#?\s*[2-9]\b|\b(trailer|teaser)\s*(ii|2|iii|3)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled, TimeSpan.FromMilliseconds(200));

    private static readonly Regex TrailerWordPattern =
        new(@"\btrailer\b", RegexOptions.IgnoreCase | RegexOptions.Compiled, TimeSpan.FromMilliseconds(200));

    private const double MinTitleMatchRatio = 0.38;
    private const int MaxReleaseYearSkew = 2;
    private const int MaxReleaseYearSkewTier1 = 3;

    private static readonly char[] SpaceDash = { ' ', '-', '–', '—', '&', '/' };

    public static string NormalizeTitle(string title)
    {
        var lower = title.Trim().ToLowerInvariant();
        lower = Regex.Replace(lower, @"\s+", " ");
        return lower;
    }

    public static double ScoreCandidatePreMatch(TrailerIngestionService.YoutubeVideoCandidate c)
    {
        var tierBoost = (4 - Math.Clamp(c.TrustTier, 1, 3)) * 0.35;
        var n = NormalizeTitle(c.Title);
        var titleBoost = OfficialTrailerPattern.IsMatch(n) || OfficialFinalTrailerGatePattern.IsMatch(n)
            ? 0.85
            : TrailerWordPattern.IsMatch(n) || TrailerNumberedPattern.IsMatch(n)
                ? 0.45
                : 0;
        if (Regex.IsMatch(n, @"\bteaser\b", RegexOptions.IgnoreCase) && !OfficialTrailerPattern.IsMatch(n))
            titleBoost -= 0.12;
        var sourceBoost = string.Equals(c.IngestionSourceTag, "yt_channel_uploads", StringComparison.Ordinal)
            ? 0.28
            : 0;
        return tierBoost + titleBoost + sourceBoost + c.ChannelPriority / 200.0;
    }

    public static double ComputeQualityScore(int trustTier, double matchConfidence, string rawTitle,
        DateTime publishedAtUtc)
    {
        var tierWeight = (4 - Math.Clamp(trustTier, 1, 3)) * 0.55;
        var n = NormalizeTitle(rawTitle);
        var title = OfficialTrailerPattern.IsMatch(n) || OfficialFinalTrailerGatePattern.IsMatch(n)
            ? 0.35
            : OfficialTrailerOrTeaserGatePattern.IsMatch(n)
                ? 0.26
                : 0.18;
        var recency = 0.0;
        if (trustTier <= 2)
        {
            var days = (DateTime.UtcNow - publishedAtUtc).TotalDays;
            if (days is >= 0 and <= 14)
                recency = 0.14;
            else if (days <= 45)
                recency = 0.09;
            else if (days <= 90)
                recency = 0.05;
            else if (days <= 120)
                recency = 0.02;
        }

        return tierWeight + matchConfidence * 0.65 + title + recency;
    }

    public static double ComputeMatchConfidence((string CleanTitle, int? Year) parsed, TmdbDiscoverItem d,
        int trustTier)
    {
        var ratio = TitleBlendedRatio(parsed.CleanTitle, d.Title, trustTier);
        var baseScore = 0.38 + ratio * 0.48;
        if (parsed.Year is { } py && TryReleaseYear(d.ReleaseDate, out var ry) && Math.Abs(py - ry) <= 1)
            baseScore += 0.12;
        return Math.Clamp(baseScore, 0, 1);
    }

    public static bool YearGate(int? queryYear, string releaseDate, int trustTier)
    {
        if (queryYear is null || !TryReleaseYear(releaseDate, out var ry))
            return true;
        var skew = trustTier <= 1 ? MaxReleaseYearSkewTier1 : MaxReleaseYearSkew;
        return Math.Abs(queryYear.Value - ry) <= skew;
    }

    private static bool TryReleaseYear(string? releaseDate, out int year)
    {
        year = 0;
        if (string.IsNullOrWhiteSpace(releaseDate) || releaseDate.Length < 4)
            return false;
        return int.TryParse(releaseDate.AsSpan(0, 4), out year) && year is >= 1900 and <= 2100;
    }

    public static bool TitleLikelyMatches(string query, string tmdbTitle, double minRatio, int trustTier)
    {
        if (string.IsNullOrWhiteSpace(tmdbTitle))
            return false;
        return TitleBlendedRatio(query, tmdbTitle, trustTier) >= minRatio;
    }

    private static double TitleBlendedRatio(string query, string tmdbTitle, int trustTier)
    {
        var forward = TitleMatchRatio(query, tmdbTitle);
        if (trustTier > 1)
            return forward;
        var backward = TitleMatchRatio(tmdbTitle, query);
        return Math.Max(forward, backward * 0.92);
    }

    public static double MinTitleRatioFor(int trustTier) =>
        trustTier <= 1 ? 0.36 : trustTier == 2 ? 0.38 : MinTitleMatchRatio;

    public static double MinMatchConfidenceToAccept(TrailerIngestionService.YoutubeVideoCandidate c)
    {
        var n = NormalizeTitle(c.Title);
        if (c.TrustTier <= 1 && (OfficialTrailerPattern.IsMatch(n) || OfficialFinalTrailerGatePattern.IsMatch(n)))
            return 0.52;
        return 0.55;
    }

    private static double TitleMatchRatio(string query, string tmdbTitle)
    {
        var qWords = SplitWords(query);
        var tWords = SplitWords(tmdbTitle);
        if (qWords.Count == 0 || tWords.Count == 0)
            return 0;
        var hit = qWords.Count(w => tWords.Contains(w));
        return (double)hit / Math.Max(1, qWords.Count);
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
}
