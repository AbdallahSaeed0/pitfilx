namespace Pitflix.Core;

public static class StringDistance
{
    /// <summary>Classic Levenshtein distance (minimum single-character edits).</summary>
    public static int Levenshtein(string? a, string? b)
    {
        a ??= "";
        b ??= "";
        var n = a.Length;
        var m = b.Length;
        if (n == 0)
            return m;
        if (m == 0)
            return n;

        var row0 = new int[m + 1];
        var row1 = new int[m + 1];
        for (var j = 0; j <= m; j++)
            row0[j] = j;

        for (var i = 1; i <= n; i++)
        {
            row1[0] = i;
            for (var j = 1; j <= m; j++)
            {
                var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                row1[j] = Math.Min(Math.Min(row1[j - 1] + 1, row0[j] + 1), row0[j - 1] + cost);
            }

            (row0, row1) = (row1, row0);
        }

        return row0[m];
    }
}
