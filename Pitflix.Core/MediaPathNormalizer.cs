using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace Pitflix.Core;

/// <summary>Aligns filesystem paths across scans (slash/casing drift on Windows) so duplicate library toasts do not fire.</summary>
public static class MediaPathNormalizer
{
    public static string PreferredPhysicalPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return path?.Trim() ?? "";
        var t = path.Trim();
        try
        {
            return Path.GetFullPath(t);
        }
        catch
        {
            return t;
        }
    }

    /// <summary>Candidate path strings for SQL IN-style lookups (EF translates <c>Contains</c> on a small list).</summary>
    public static IReadOnlyList<string> EquivalenceVariants(string path)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var s in GatherRawVariants(path))
        {
            if (!string.IsNullOrEmpty(s))
                set.Add(s);
        }

        // SQLite string equality can be case-sensitive depending on environment/collation.
        // Include lower-cased variants so queries can match `ToLower()` comparisons.
        foreach (var s in set.ToList())
        {
            var lower = s.ToLowerInvariant();
            if (!string.Equals(lower, s, StringComparison.Ordinal))
                set.Add(lower);
        }

        return set.ToList();
    }

    private static IEnumerable<string> GatherRawVariants(string path)
    {
        var t = path?.Trim() ?? "";
        if (t.Length == 0)
            yield break;
        yield return t;
        var pref = PreferredPhysicalPath(t);
        yield return pref;
        yield return pref.Replace('\\', '/');
        yield return pref.Replace('/', '\\');
        yield return t.Replace('\\', '/');
        yield return t.Replace('/', '\\');
    }
}
