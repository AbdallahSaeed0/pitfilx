using System.Collections.Concurrent;
using Pitflix.Core.Api;
using Pitflix.Core.Models;
using Pitflix.Core.Services;

namespace Pitflix.API;

/// <summary>Maps local cache paths under %LocalAppData%\Pitflix\Images to public HTTP URLs.</summary>
public static class ImageUrls
{
    public static string ImagesRoot => ImageCacheService.CacheRoot;

    /// <summary>Base URL with no trailing slash (e.g. http://localhost:5280).</summary>
    public static string PublicBase { get; set; } = "http://localhost:5280";

    /// <summary>
    /// Existence cache for files under the image root. <see cref="ToImageUrl"/> verifies the file is
    /// really on disk before handing out a URL, which meant up to four synchronous <c>File.Exists</c>
    /// calls per card — 160+ syscalls to render one 40-item catalog page, repeated on every request.
    ///
    /// A hit is cached for good: cached artwork is only ever added or replaced in place, never deleted
    /// out from under us during a session (and a stale-but-present URL is harmless anyway — the UI
    /// falls back to the remote poster on a 404). A miss is cached only briefly, because the scanner
    /// and enrichment paths do fill these files in while the app is running.
    /// </summary>
    private static readonly ConcurrentDictionary<string, bool> ExistingFiles = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, DateTime> MissingFiles = new(StringComparer.OrdinalIgnoreCase);
    private static readonly TimeSpan MissingFileTtl = TimeSpan.FromSeconds(30);

    private static bool FileExistsCached(string fullPath)
    {
        if (ExistingFiles.ContainsKey(fullPath))
            return true;
        if (MissingFiles.TryGetValue(fullPath, out var checkedAt) && DateTime.UtcNow - checkedAt < MissingFileTtl)
            return false;

        if (File.Exists(fullPath))
        {
            MissingFiles.TryRemove(fullPath, out _);
            ExistingFiles[fullPath] = true;
            return true;
        }

        MissingFiles[fullPath] = DateTime.UtcNow;
        return false;
    }

    /// <summary>Drops the cached existence results. Call after bulk artwork changes (image-cache wipe,
    /// poster re-selection) so the next mapping re-checks the disk instead of trusting stale hits.</summary>
    public static void InvalidateFileExistenceCache()
    {
        ExistingFiles.Clear();
        MissingFiles.Clear();
    }

    /// <summary>
    /// Maps paths under the image cache to <c>/images/...</c>. Uses relative path when possible
    /// (flat or subfolders like Cast/); otherwise falls back to filename only.
    /// </summary>
    public static string? ToImageUrl(string? localPath)
    {
        if (string.IsNullOrWhiteSpace(localPath))
            return null;

        var trimmed = localPath.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return trimmed;

        var normalized = trimmed.Replace('\\', '/');
        var fileName = Path.GetFileName(normalized);
        if (string.IsNullOrEmpty(fileName))
            return null;

        string root;
        string rootWithSep;
        try
        {
            root = Path.GetFullPath(
                ImagesRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            rootWithSep = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
        }
        catch
        {
            return null;
        }

        string? VerifiedUrl(string fullPathOnDisk, string relativeUrlPath)
        {
            try
            {
                var full = Path.GetFullPath(fullPathOnDisk);
                if (!full.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase) &&
                    !full.Equals(root, StringComparison.OrdinalIgnoreCase))
                    return null;
                if (!FileExistsCached(full))
                    return null;
                return $"{PublicBase.TrimEnd('/')}/images/{relativeUrlPath}";
            }
            catch
            {
                return null;
            }
        }

        string? detectedFolder = normalized.IndexOf("/Posters/", StringComparison.OrdinalIgnoreCase) >= 0
            ? "Posters"
            : normalized.IndexOf("/Backdrops/", StringComparison.OrdinalIgnoreCase) >= 0
                ? "Backdrops"
                : normalized.IndexOf("/Cast/", StringComparison.OrdinalIgnoreCase) >= 0
                    ? "Cast"
                    : normalized.IndexOf("/Crew/", StringComparison.OrdinalIgnoreCase) >= 0
                        ? "Crew"
                        : null;

        if (detectedFolder != null)
        {
            var full = Path.Combine(root, detectedFolder, fileName);
            var rel = $"{detectedFolder}/{Uri.EscapeDataString(fileName)}";
            var u = VerifiedUrl(full, rel);
            if (u != null)
                return u;
        }

        try
        {
            var full = Path.GetFullPath(trimmed);
            if (full.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase) ||
                full.Equals(root, StringComparison.OrdinalIgnoreCase))
            {
                var rel = Path.GetRelativePath(root, full);
                if (!rel.StartsWith("..", StringComparison.Ordinal) && !string.IsNullOrEmpty(rel))
                {
                    var parts = rel.Split(
                        new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar },
                        StringSplitOptions.RemoveEmptyEntries);
                    var urlPath = string.Join("/", parts.Select(Uri.EscapeDataString));
                    return VerifiedUrl(full, urlPath);
                }
            }
        }
        catch
        {
            /* filename fallback below */
        }

        var fallbackFull = Path.Combine(root, fileName);
        return VerifiedUrl(fallbackFull, Uri.EscapeDataString(fileName));
    }

    public static MediaCardDto MapMediaCard(MediaCardDto d) =>
        new()
        {
            Id = d.Id,
            TmdbId = d.TmdbId,
            Title = d.Title,
            Year = d.Year,
            VoteAverage = d.VoteAverage,
            PosterLocalPath = ToImageUrl(d.PosterLocalPath),
            SelectedPosterPath = ToImageUrl(d.SelectedPosterPath),
            IsArabic = d.IsArabic,
            WatchStatus = d.WatchStatus,
            DateAdded = d.DateAdded,
            GenresCsv = d.GenresCsv,
            Overview = d.Overview,
            BackdropLocalPath = ToImageUrl(d.BackdropLocalPath),
            SelectedBackdropPath = ToImageUrl(d.SelectedBackdropPath),
            MediaFilePath = d.MediaFilePath,
            TmdbMediaType = d.TmdbMediaType,
            PosterRemoteUrl = d.PosterRemoteUrl,
            ImdbId = d.ImdbId
        };

    public static Movie MapMovie(Movie m) =>
        new()
        {
            Id = m.Id,
            TmdbId = m.TmdbId,
            Title = m.Title,
            TitleAr = m.TitleAr,
            Year = m.Year,
            Overview = m.Overview,
            PosterLocalPath = ToImageUrl(m.PosterLocalPath),
            BackdropLocalPath = ToImageUrl(m.BackdropLocalPath),
            SelectedPosterPath = ToImageUrl(m.SelectedPosterPath),
            SelectedBackdropPath = ToImageUrl(m.SelectedBackdropPath),
            Genres = m.Genres,
            VoteAverage = m.VoteAverage,
            Runtime = m.Runtime,
            FilePath = m.FilePath,
            IsArabic = m.IsArabic,
            IsMatched = m.IsMatched,
            DateAdded = m.DateAdded,
            WatchStatus = m.WatchStatus,
            CompletedAt = m.CompletedAt,
            RewatchCount = m.RewatchCount,
            PosterRemoteUrl = m.PosterRemoteUrl
        };

    public static Show MapShow(Show s) =>
        new()
        {
            Id = s.Id,
            TmdbId = s.TmdbId,
            Title = s.Title,
            TitleAr = s.TitleAr,
            Year = s.Year,
            Overview = s.Overview,
            PosterLocalPath = ToImageUrl(s.PosterLocalPath),
            BackdropLocalPath = ToImageUrl(s.BackdropLocalPath),
            SelectedPosterPath = ToImageUrl(s.SelectedPosterPath),
            SelectedBackdropPath = ToImageUrl(s.SelectedBackdropPath),
            Genres = s.Genres,
            VoteAverage = s.VoteAverage,
            FolderPath = s.FolderPath,
            IsArabic = s.IsArabic,
            IsMatched = s.IsMatched,
            DateAdded = s.DateAdded,
            WatchStatus = s.WatchStatus,
            CompletedAt = s.CompletedAt,
            Episodes = s.Episodes,
            PosterRemoteUrl = s.PosterRemoteUrl
        };

    public static CastMember MapCastMember(CastMember c)
    {
        var name = string.IsNullOrWhiteSpace(c.Name) ? "Unknown" : c.Name.Trim();
        var character = string.IsNullOrWhiteSpace(c.Character) ? "—" : c.Character.Trim();
        var remote = TmdbImageUrls.ProfileUrl(c.ProfilePath);
        return new CastMember
        {
            Id = c.Id,
            PersonTmdbId = c.PersonTmdbId,
            MediaId = c.MediaId,
            MediaType = c.MediaType,
            Name = name,
            Character = character,
            ProfilePath = c.ProfilePath,
            BillingOrder = c.BillingOrder,
            ProfileLocalPath = ToImageUrl(c.ProfileLocalPath),
            ProfileRemoteUrl = remote
        };
    }

    public static TmdbCrewMember MapCrewMember(TmdbCrewMember c) =>
        new()
        {
            Id = c.Id,
            Name = c.Name,
            Job = c.Job,
            ProfilePath = c.ProfilePath,
            ProfileLocalPath = ToImageUrl(c.ProfileLocalPath),
            ProfileRemoteUrl = TmdbImageUrls.ProfileUrl(c.ProfilePath),
            EpisodeCount = c.EpisodeCount,
        };

    public static WatchHistory MapWatchHistory(WatchHistory h) =>
        new()
        {
            Id = h.Id,
            FilePath = h.FilePath,
            Title = h.Title,
            PosterLocalPath = ToImageUrl(h.PosterLocalPath),
            PosterRemoteUrl = ToImageUrl(h.PosterRemoteUrl),
            MediaType = h.MediaType,
            OpenedAt = h.OpenedAt,
            StartedAt = h.StartedAt,
            StoppedAt = h.StoppedAt,
            EstimatedSeconds = h.EstimatedSeconds,
            MaxKnownPositionSeconds = h.MaxKnownPositionSeconds,
            LastExplicitPositionSeconds = h.LastExplicitPositionSeconds,
            TrustedResumeSeconds = h.TrustedResumeSeconds,
            IsStopFinalized = h.IsStopFinalized,
            FileDurationSeconds = h.FileDurationSeconds,
            IsCompleted = h.IsCompleted,
            NextUpLabel = h.NextUpLabel,
            EpisodeTitle = h.EpisodeTitle,
            BackdropLocalPath = ToImageUrl(h.BackdropLocalPath),
            LibraryMovieId = h.LibraryMovieId,
            LibraryShowId = h.LibraryShowId,
            LibraryEpisodeId = h.LibraryEpisodeId
        };

    public static LocalSimilarRow MapLocalSimilar(LocalSimilarRow r) =>
        new()
        {
            MediaKind = r.MediaKind,
            DatabaseId = r.DatabaseId,
            TmdbId = r.TmdbId,
            Title = r.Title,
            Year = r.Year,
            PosterLocalPath = ToImageUrl(r.PosterLocalPath)
        };
}
