namespace Pitflix.Core;

/// <summary>Library folder conventions for Arabic vs English shelves.</summary>
public static class LibraryPathHelper
{
    private const string ArabicSegment = "عربي";

    /// <summary>
    /// True when <paramref name="path"/> is the same directory as <paramref name="libraryRoot"/> or a file/folder
    /// nested under it (normalized with <see cref="Path.GetFullPath"/>).
    /// </summary>
    public static bool MediaPathIsUnderLibraryRoot(string libraryRoot, string path)
    {
        if (string.IsNullOrWhiteSpace(libraryRoot) || string.IsNullOrWhiteSpace(path))
            return false;
        try
        {
            var root = Path.GetFullPath(libraryRoot.Trim())
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var full = Path.GetFullPath(path.Trim());
            if (full.Equals(root, StringComparison.OrdinalIgnoreCase))
                return true;
            return full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
                   || full.StartsWith(root + Path.AltDirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

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
