namespace Pitflix.Core;

/// <summary>Library folder conventions for Arabic vs English shelves.</summary>
public static class LibraryPathHelper
{
    private const string ArabicSegment = "عربي";

    /// <summary>
    /// True when path contains <c>\عربي\</c> or <c>\Arabic\</c> (any casing).
    /// Used for tab placement (Arabic vs English).
    /// </summary>
    public static bool DeriveIsArabicFromMediaPath(string? path)
    {
        if (string.IsNullOrEmpty(path))
            return false;

        var norm = path.Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar);

        if (norm.Contains($"{Path.DirectorySeparatorChar}{ArabicSegment}{Path.DirectorySeparatorChar}",
                StringComparison.Ordinal))
            return true;

        foreach (var raw in norm.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            if (raw.Equals("Arabic", StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }
}
