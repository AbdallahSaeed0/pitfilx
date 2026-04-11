using System.Text.RegularExpressions;

namespace Pitflix.Core.Scanner;

public sealed class FileScanner
{
    private static readonly Regex ArabicCharRegex = new(@"\p{IsArabic}", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly HashSet<string> VideoExtensions =
    [
        ".mkv", ".mp4", ".avi", ".m4v", ".wmv", ".webm", ".mov", ".mpeg", ".mpg", ".flv"
    ];

    public IReadOnlyList<string> ScanDirectory(string rootPath, bool recursive = true, IReadOnlyList<string>? excludedPaths = null)
    {
        if (string.IsNullOrWhiteSpace(rootPath))
            throw new ArgumentException("Root path is required.", nameof(rootPath));

        var root = Path.GetFullPath(rootPath);
        if (!Directory.Exists(root))
            return Array.Empty<string>();

        var list = new List<string>();
        var excludedFullPaths = excludedPaths?
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => Path.GetFullPath(p.Trim()))
            .ToHashSet(StringComparer.OrdinalIgnoreCase) ?? new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        // Directory.EnumerateFiles(..., AllDirectories) can throw and abort the whole scan on a single
        // access-denied / reparse-point / transient IO issue. We want "best effort": keep scanning
        // other folders.
        if (!recursive)
        {
            try
            {
                foreach (var path in Directory.EnumerateFiles(root, "*", SearchOption.TopDirectoryOnly))
                {
                    var ext = Path.GetExtension(path);
                    if (VideoExtensions.Contains(ext, StringComparer.OrdinalIgnoreCase))
                        list.Add(path);
                }
            }
            catch
            {
                return Array.Empty<string>();
            }
        }
        else
        {
            var pending = new Stack<string>();
            pending.Push(root);

            while (pending.Count > 0)
            {
                var dir = pending.Pop();

                // Skip if this directory is in the excluded list or is a subdirectory of an excluded path
                if (IsPathExcluded(dir, excludedFullPaths))
                    continue;

                try
                {
                    foreach (var path in Directory.EnumerateFiles(dir, "*", SearchOption.TopDirectoryOnly))
                    {
                        var ext = Path.GetExtension(path);
                        if (VideoExtensions.Contains(ext, StringComparer.OrdinalIgnoreCase))
                            list.Add(path);
                    }
                }
                catch
                {
                    // ignore this directory and continue
                }

                try
                {
                    foreach (var sub in Directory.EnumerateDirectories(dir, "*", SearchOption.TopDirectoryOnly))
                        pending.Push(sub);
                }
                catch
                {
                    // ignore this directory and continue
                }
            }
        }

        list.Sort(StringComparer.OrdinalIgnoreCase);
        return list;
    }

    private static bool IsPathExcluded(string path, HashSet<string> excludedPaths)
    {
        if (excludedPaths.Count == 0)
            return false;

        var fullPath = Path.GetFullPath(path);
        
        // Check if the path itself is excluded
        if (excludedPaths.Contains(fullPath))
            return true;

        // Check if the path is a subdirectory of any excluded path
        foreach (var excluded in excludedPaths)
        {
            if (fullPath.StartsWith(excluded + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                fullPath.StartsWith(excluded + Path.AltDirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    /// <summary>
    /// True if any parent folder name contains Arabic script, or the filename does.
    /// Parent folders take precedence for library paths like <c>...\عربي\...</c>.
    /// </summary>
    public static bool IsArabicForMediaPath(string filePath)
    {
        if (string.IsNullOrEmpty(filePath))
            return false;

        for (var dir = Path.GetDirectoryName(filePath);
             !string.IsNullOrEmpty(dir);
             dir = Path.GetDirectoryName(dir))
        {
            var segment = Path.GetFileName(dir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (!string.IsNullOrEmpty(segment) && ArabicCharRegex.IsMatch(segment))
                return true;
        }

        var name = Path.GetFileNameWithoutExtension(filePath);
        return !string.IsNullOrEmpty(name) && ArabicCharRegex.IsMatch(name);
    }

    /// <summary>
    /// "Movie" if path contains a <c>Movies</c> segment, "Series" if <c>Series</c> (case-insensitive). First match wins.
    /// </summary>
    public static string InferMediaType(string filePath)
    {
        if (string.IsNullOrEmpty(filePath))
            return "";

        foreach (var raw in filePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
        {
            var part = raw.Trim();
            if (part.Length == 0)
                continue;

            if (part.Equals("Movies", StringComparison.OrdinalIgnoreCase))
                return "Movie";

            if (part.Equals("Series", StringComparison.OrdinalIgnoreCase))
                return "Series";
        }

        return "";
    }
}
