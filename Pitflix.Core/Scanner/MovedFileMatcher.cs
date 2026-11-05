namespace Pitflix.Core.Scanner;

/// <summary>A library movie/episode whose file is no longer at its stored path.</summary>
public sealed record MissingLibraryFile(bool IsEpisode, int Id, string FilePath, long? FileSize);

/// <summary>
/// Recognizes a file a scan just found as a library file that was moved or renamed, so the scan can
/// re-point the existing movie/episode (keeping a manual match, watch state, history and lists) instead
/// of matching the new path from scratch — which loses a manual match and left the old entry pointing
/// at a missing file.
/// </summary>
public static class MovedFileMatcher
{
    /// <summary>
    /// Picks the missing library file <paramref name="newPath"/> most likely is, or null when nothing is a
    /// confident, unambiguous match:
    /// <list type="number">
    /// <item>same size in bytes and extension (survives move + rename) — a tie is broken by file name;</item>
    /// <item>otherwise the same file name, but only against rows whose size was never recorded (a known,
    /// different size means a different file, e.g. a re-download in another quality).</item>
    /// </list>
    /// </summary>
    public static MissingLibraryFile? FindMatch(string newPath, long? newSize, IReadOnlyList<MissingLibraryFile> missing)
    {
        if (missing.Count == 0 || string.IsNullOrWhiteSpace(newPath))
            return null;

        var name = Path.GetFileName(newPath);
        var ext = Path.GetExtension(newPath);

        if (newSize is > 0)
        {
            var bySize = missing
                .Where(m => m.FileSize == newSize &&
                            string.Equals(Path.GetExtension(m.FilePath), ext, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (bySize.Count == 1)
                return bySize[0];
            if (bySize.Count > 1)
                return SingleOrNull(bySize.Where(m => SameName(m.FilePath, name)));
        }

        return SingleOrNull(missing.Where(m => m.FileSize == null && SameName(m.FilePath, name)));
    }

    /// <summary>
    /// True when <paramref name="path"/> is gone although its drive/share is reachable. A file on an
    /// unplugged drive or offline share is not "moved" — relinking it elsewhere would be wrong.
    /// </summary>
    public static bool IsMissingOnReachableVolume(string? path, Dictionary<string, bool>? rootCache = null)
    {
        if (string.IsNullOrWhiteSpace(path))
            return false;
        try
        {
            if (File.Exists(path))
                return false;
            var root = Path.GetPathRoot(path);
            if (string.IsNullOrEmpty(root))
                return false;
            if (rootCache == null)
                return Directory.Exists(root);
            if (!rootCache.TryGetValue(root, out var reachable))
                rootCache[root] = reachable = Directory.Exists(root);
            return reachable;
        }
        catch
        {
            return false;
        }
    }

    private static bool SameName(string path, string name) =>
        string.Equals(Path.GetFileName(path), name, StringComparison.OrdinalIgnoreCase);

    private static MissingLibraryFile? SingleOrNull(IEnumerable<MissingLibraryFile> items)
    {
        MissingLibraryFile? found = null;
        foreach (var m in items)
        {
            if (found != null)
                return null;
            found = m;
        }
        return found;
    }
}
