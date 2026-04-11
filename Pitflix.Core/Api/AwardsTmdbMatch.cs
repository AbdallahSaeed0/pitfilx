using System.Globalization;

namespace Pitflix.Core.Api;

/// <summary>Strict title + year gating for awards nominee TMDB resolution. Wrong poster is worse than none.</summary>
public static class AwardsTmdbMatch
{
    public const int MinTitleScore = 82;
    public const int MinTitleScoreUndated = 94;

    public static string NormalizeTitle(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return "";
        var s = raw.Trim().ToLowerInvariant();
        var chars = s.Select(c => char.IsLetterOrDigit(c) || char.IsWhiteSpace(c) ? c : ' ').ToArray();
        s = new string(chars);
        while (s.Contains("  ", StringComparison.Ordinal))
            s = s.Replace("  ", " ", StringComparison.Ordinal);
        return s.Trim();
    }

    public static int TitleScore(string nomineeTitle, string? hitTitle, string? hitOriginalTitle)
    {
        var q = NormalizeTitle(nomineeTitle);
        if (q.Length == 0)
            return 0;
        var a = NormalizeTitle(hitTitle);
        var b = NormalizeTitle(hitOriginalTitle);
        var best = Math.Max(TokenJaccard(q, a), TokenJaccard(q, b));
        if (q == a || q == b)
            return 100;
        if (a.StartsWith(q, StringComparison.Ordinal) || q.StartsWith(a, StringComparison.Ordinal) ||
            b.StartsWith(q, StringComparison.Ordinal) || q.StartsWith(b, StringComparison.Ordinal))
            return Math.Max(best, 88);
        return best;
    }

    private static int TokenJaccard(string a, string b)
    {
        if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b))
            return 0;
        var ta = a.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.Ordinal);
        var tb = b.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.Ordinal);
        if (ta.Count == 0 || tb.Count == 0)
            return 0;
        var inter = ta.Intersect(tb, StringComparer.Ordinal).Count();
        var union = ta.Union(tb, StringComparer.Ordinal).Count();
        return union == 0 ? 0 : (int)Math.Round(100.0 * inter / union);
    }

    /// <summary> release_ymd: TMDB movie release_date or TV first_air_date (yyyy-MM-dd). </summary>
    public static bool YearConstraintOk(string? releaseYmd, IReadOnlyList<int> candidateYears, int minTitleScore)
    {
        if (candidateYears.Count == 0)
            return false;
        if (string.IsNullOrWhiteSpace(releaseYmd) || releaseYmd.Length < 4)
            return minTitleScore >= MinTitleScoreUndated;
        if (!int.TryParse(releaseYmd.AsSpan(0, 4), NumberStyles.None, CultureInfo.InvariantCulture, out var y))
            return minTitleScore >= MinTitleScoreUndated;

        var expanded = new HashSet<int>();
        foreach (var cy in candidateYears)
        {
            if (cy is < 1870 or > 2100)
                continue;
            expanded.Add(cy);
            expanded.Add(cy - 1);
            expanded.Add(cy + 1);
        }

        return expanded.Contains(y);
    }
}
