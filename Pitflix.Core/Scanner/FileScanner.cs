using System.Text.RegularExpressions;

namespace Pitflix.Core.Scanner;

public sealed class FileScanner
{
    private static readonly Regex ArabicCharRegex = new(@"\p{IsArabic}", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly HashSet<string> VideoExtensions =
    [
        ".mkv", ".mp4", ".avi", ".m4v", ".wmv", ".webm", ".mov", ".mpeg", ".mpg", ".flv",
        ".ts", ".m2ts", ".mts", ".divx"
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
    /// Organiser/sort folders that are written in Arabic but denote <b>non-Arabic</b> content
    /// (<c>اجنبي</c>/<c>أجنبي</c> = "foreign", <c>عالمية</c> = "international"). A file under one of
    /// these must not be flagged as Arabic just because the bucket label happens to be Arabic script —
    /// that used to misclassify English movies (e.g. under <c>Movies\اجنبي\…</c>) and doubled TMDB
    /// search calls.
    /// </summary>
    private static readonly HashSet<string> ForeignBucketSegments = new(StringComparer.OrdinalIgnoreCase)
    {
        "اجنبي", "اجنبى", "أجنبي", "أجنبى", "عالمية",
        "Foreign", "Foreign Films", "Western", "International",
    };

    /// <summary>
    /// True when the media is Arabic-language. The <b>filename</b> (the real title) is the strongest
    /// signal; otherwise a parent folder written in Arabic script counts — except explicit "foreign"
    /// buckets (see <see cref="ForeignBucketSegments"/>), which mean the opposite.
    /// </summary>
    public static bool IsArabicForMediaPath(string filePath)
    {
        if (string.IsNullOrEmpty(filePath))
            return false;

        // The title itself being Arabic is decisive, regardless of how the library is organised.
        var name = Path.GetFileNameWithoutExtension(filePath);
        if (!string.IsNullOrEmpty(name) && ArabicCharRegex.IsMatch(name))
            return true;

        for (var dir = Path.GetDirectoryName(filePath);
             !string.IsNullOrEmpty(dir);
             dir = Path.GetDirectoryName(dir))
        {
            var segment = Path.GetFileName(dir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (string.IsNullOrEmpty(segment))
                continue;

            // A "foreign / international" bucket explicitly marks its contents as non-Arabic.
            if (ForeignBucketSegments.Contains(segment))
                return false;

            if (ArabicCharRegex.IsMatch(segment))
                return true;
        }

        return false;
    }

    /// <summary>
    /// Infers TMDB bucket from common library folder names: <c>Movies</c>, <c>Films</c>, <c>TV</c>, <c>Series</c>, Arabic equivalents, etc.
    /// Movie classification is checked before series so hybrid trees resolve predictably.
    /// </summary>
    private static readonly HashSet<string> MovieFolderSegments = new(StringComparer.OrdinalIgnoreCase)
    {
        "Movies", "Movie", "Films", "Film",
        "أفلام", "افلام", // Arabic: films — matches NameParser library layout hints
    };

    /// <summary>TV-style roots (Anime is treated as series for TMDB TV).</summary>
    private static readonly HashSet<string> SeriesFolderSegments = new(StringComparer.OrdinalIgnoreCase)
    {
        "Series", "TV", "Television", "Shows",
        "مسلسلات", // Arabic: series
        "Anime",
    };

    public static string InferMediaType(string filePath)
    {
        if (string.IsNullOrEmpty(filePath))
            return "";

        foreach (var raw in filePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
        {
            var part = raw.Trim();
            if (part.Length == 0)
                continue;
            if (MovieFolderSegments.Contains(part))
                return "Movie";
        }

        foreach (var raw in filePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
        {
            var part = raw.Trim();
            if (part.Length == 0)
                continue;
            if (SeriesFolderSegments.Contains(part))
                return "Series";
        }

        return "";
    }
}
