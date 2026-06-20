namespace Pitflix.Core;

/// <summary>
/// In-memory set of all filesystem paths already linked to <see cref="Models.Movie"/> or <see cref="Models.Episode"/> rows,
/// including slash/case variants (<see cref="MediaPathNormalizer.EquivalenceVariants"/>), for O(1) lookups during scanning.
/// </summary>
public sealed class LibraryPathPresenceIndex
{
    private readonly HashSet<string> _variants;

    internal LibraryPathPresenceIndex(HashSet<string> variants)
    {
        _variants = variants;
    }

    /// <summary>Returns true if this exact file path (or an equivalent variant) is already stored in the library.</summary>
    public bool IsPhysicalPathInLibrary(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
            return false;

        var preferred = MediaPathNormalizer.PreferredPhysicalPath(filePath.Trim());
        foreach (var v in MediaPathNormalizer.EquivalenceVariants(preferred))
        {
            if (_variants.Contains(v))
                return true;
        }

        return false;
    }
}
