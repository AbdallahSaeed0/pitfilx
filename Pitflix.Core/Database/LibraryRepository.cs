using System.Data;
using System.Data.Common;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Api;
using Pitflix.Core;
using Pitflix.Core.Models;
using Pitflix.Core.Playback;

namespace Pitflix.Core.Database;

public sealed class LibraryRepository
{
    private readonly LibraryContext _db;

    public LibraryRepository(LibraryContext db)
    {
        _db = db;
    }

    public async Task<Show> SaveShowAsync(Show show, CancellationToken cancellationToken = default)
    {
        var existing = await _db.Shows.FirstOrDefaultAsync(s => s.TmdbId == show.TmdbId, cancellationToken)
            .ConfigureAwait(false);
        if (existing != null)
        {
            existing.Title = show.Title;
            existing.TitleAr = show.TitleAr;
            existing.Year = show.Year;
            existing.Overview = show.Overview;
            existing.PosterLocalPath = show.PosterLocalPath;
            existing.BackdropLocalPath = show.BackdropLocalPath;
            if (!string.IsNullOrWhiteSpace(show.SelectedPosterPath))
                existing.SelectedPosterPath = show.SelectedPosterPath;
            if (!string.IsNullOrWhiteSpace(show.SelectedBackdropPath))
                existing.SelectedBackdropPath = show.SelectedBackdropPath;
            existing.Genres = show.Genres;
            existing.VoteAverage = show.VoteAverage;
            existing.FolderPath = show.FolderPath;
            existing.IsArabic = show.IsArabic;
            existing.IsMatched = show.IsMatched;
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            return existing;
        }

        _db.Shows.Add(show);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return show;
    }

    public async Task<IReadOnlyList<Show>> GetAllShowsAsync(CancellationToken cancellationToken = default)
    {
        return await _db.Shows.AsNoTracking().OrderBy(s => s.Title).ToListAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<Show?> GetShowByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        return await _db.Shows.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<Movie?> GetMovieByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        return await _db.Movies.AsNoTracking().FirstOrDefaultAsync(m => m.Id == id, cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<Show?> GetShowByTmdbIdAsync(int tmdbId, CancellationToken cancellationToken = default)
    {
        return await _db.Shows.FirstOrDefaultAsync(s => s.TmdbId == tmdbId, cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<Show>> GetArabicShowsAsync(CancellationToken cancellationToken = default)
    {
        return await _db.Shows.AsNoTracking().Where(s => s.IsArabic).OrderBy(s => s.Title).ToListAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<Show>> GetEnglishShowsAsync(CancellationToken cancellationToken = default)
    {
        return await _db.Shows.AsNoTracking().Where(s => !s.IsArabic).OrderBy(s => s.Title).ToListAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<List<MediaCardDto>> GetShowCardsAsync(bool isArabic, CancellationToken cancellationToken = default)
    {
        return await _db.Shows.AsNoTracking()
            .Where(s => s.IsMatched && s.IsArabic == isArabic)
            .OrderBy(s => s.Title)
            .Select(s => new MediaCardDto
            {
                Id = s.Id,
                TmdbId = s.TmdbId,
                Title = s.Title,
                Year = s.Year,
                VoteAverage = s.VoteAverage,
                PosterLocalPath = s.PosterLocalPath,
                SelectedPosterPath = s.SelectedPosterPath,
                IsArabic = s.IsArabic,
                WatchStatus = s.WatchStatus,
                DateAdded = s.DateAdded,
                GenresCsv = s.Genres,
                Overview = s.Overview == null ? null : (s.Overview.Length > 200 ? s.Overview.Substring(0, 200) : s.Overview),
                BackdropLocalPath = s.BackdropLocalPath,
                SelectedBackdropPath = s.SelectedBackdropPath,
                TmdbMediaType = "Series"
            })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<Movie> SaveMovieAsync(Movie movie, CancellationToken cancellationToken = default)
    {
        var existing = await _db.Movies.FirstOrDefaultAsync(m => m.TmdbId == movie.TmdbId, cancellationToken)
            .ConfigureAwait(false);
        if (existing != null)
        {
            existing.Title = movie.Title;
            existing.TitleAr = movie.TitleAr;
            existing.Year = movie.Year;
            existing.Overview = movie.Overview;
            existing.PosterLocalPath = movie.PosterLocalPath;
            existing.BackdropLocalPath = movie.BackdropLocalPath;
            if (!string.IsNullOrWhiteSpace(movie.SelectedPosterPath))
                existing.SelectedPosterPath = movie.SelectedPosterPath;
            if (!string.IsNullOrWhiteSpace(movie.SelectedBackdropPath))
                existing.SelectedBackdropPath = movie.SelectedBackdropPath;
            existing.Genres = movie.Genres;
            existing.VoteAverage = movie.VoteAverage;
            existing.Runtime = movie.Runtime;
            existing.FilePath = movie.FilePath;
            existing.IsArabic = movie.IsArabic;
            existing.IsMatched = movie.IsMatched;
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            return existing;
        }

        _db.Movies.Add(movie);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return movie;
    }

    public async Task<IReadOnlyList<Movie>> GetAllMoviesAsync(CancellationToken cancellationToken = default)
    {
        return await _db.Movies.AsNoTracking().OrderBy(m => m.Title).ToListAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<Movie?> GetMovieByTmdbIdAsync(int tmdbId, CancellationToken cancellationToken = default)
    {
        return await _db.Movies.FirstOrDefaultAsync(m => m.TmdbId == tmdbId, cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>Distinct matched TMDB ids for ratings backfill (movies + series, each side capped).</summary>
    public async Task<(IReadOnlyList<int> MovieTmdbIds, IReadOnlyList<int> ShowTmdbIds)> GetDistinctMatchedTmdbIdsForRatingsAsync(
        int maxMovies,
        int maxShows,
        CancellationToken cancellationToken = default)
    {
        maxMovies = Math.Clamp(maxMovies, 0, 50_000);
        maxShows = Math.Clamp(maxShows, 0, 50_000);
        var movies = await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.TmdbId > 0)
            .Select(m => m.TmdbId)
            .Distinct()
            .OrderBy(id => id)
            .Take(maxMovies)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        var shows = await _db.Shows.AsNoTracking()
            .Where(s => s.IsMatched && s.TmdbId > 0)
            .Select(s => s.TmdbId)
            .Distinct()
            .OrderBy(id => id)
            .Take(maxShows)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        return (movies, shows);
    }

    public async Task<IReadOnlyList<Movie>> GetArabicMoviesAsync(CancellationToken cancellationToken = default)
    {
        return await _db.Movies.AsNoTracking().Where(m => m.IsArabic).OrderBy(m => m.Title).ToListAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<Movie>> GetEnglishMoviesAsync(CancellationToken cancellationToken = default)
    {
        return await _db.Movies.AsNoTracking().Where(m => !m.IsArabic).OrderBy(m => m.Title).ToListAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<List<MediaCardDto>> GetMovieCardsAsync(bool isArabic, CancellationToken cancellationToken = default)
    {
        return await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.IsArabic == isArabic)
            .OrderBy(m => m.Title)
            .Select(m => new MediaCardDto
            {
                Id = m.Id,
                TmdbId = m.TmdbId,
                Title = m.Title,
                Year = m.Year,
                VoteAverage = m.VoteAverage,
                PosterLocalPath = m.PosterLocalPath,
                SelectedPosterPath = m.SelectedPosterPath,
                IsArabic = m.IsArabic,
                WatchStatus = m.WatchStatus,
                DateAdded = m.DateAdded,
                GenresCsv = m.Genres,
                Overview = m.Overview == null ? null : (m.Overview.Length > 200 ? m.Overview.Substring(0, 200) : m.Overview),
                BackdropLocalPath = m.BackdropLocalPath,
                SelectedBackdropPath = m.SelectedBackdropPath,
                MediaFilePath = m.FilePath,
                TmdbMediaType = "Movie"
            })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<PagedResult<MediaCardDto>> GetMovieCardPageAsync(
        bool isArabic,
        string? search,
        string? genre,
        string? watchStatus,
        string? sortOption,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        var q = _db.Movies.AsNoTracking().Where(m => m.IsMatched && m.IsArabic == isArabic);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            var lower = term.ToLower();
            // SQLite collation can end up case-sensitive depending on environment; normalize to lower-case.
            q = q.Where(m => m.Title.ToLower().Contains(lower));
        }

        if (!string.IsNullOrWhiteSpace(genre) && !string.Equals(genre, "All", StringComparison.OrdinalIgnoreCase))
            q = q.Where(m => m.Genres != null && m.Genres.Contains(genre));

        if (!string.IsNullOrWhiteSpace(watchStatus) && !string.Equals(watchStatus, "All", StringComparison.OrdinalIgnoreCase))
            q = q.Where(m => m.WatchStatus == watchStatus);

        q = sortOption switch
        {
            "Year ↑" => q.OrderBy(m => m.Year ?? 0),
            "Year ↓" => q.OrderByDescending(m => m.Year ?? 0),
            "Rating" => q.OrderByDescending(m => m.VoteAverage),
            "Date added" => q.OrderByDescending(m => m.DateAdded),
            _ => q.OrderBy(m => m.Title)
        };

        var total = await q.CountAsync(cancellationToken).ConfigureAwait(false);
        var skip = Math.Max(0, (Math.Max(1, page) - 1) * Math.Max(1, pageSize));
        var rows = await q.Skip(skip).Take(Math.Max(1, pageSize))
            .Select(m => new MediaCardDto
            {
                Id = m.Id,
                TmdbId = m.TmdbId,
                Title = m.Title,
                Year = m.Year,
                VoteAverage = m.VoteAverage,
                PosterLocalPath = m.PosterLocalPath,
                SelectedPosterPath = m.SelectedPosterPath,
                IsArabic = m.IsArabic,
                WatchStatus = m.WatchStatus,
                DateAdded = m.DateAdded,
                GenresCsv = m.Genres,
                Overview = m.Overview == null ? null : (m.Overview.Length > 200 ? m.Overview.Substring(0, 200) : m.Overview),
                BackdropLocalPath = m.BackdropLocalPath,
                SelectedBackdropPath = m.SelectedBackdropPath,
                MediaFilePath = m.FilePath,
                TmdbMediaType = "Movie"
            })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        return new PagedResult<MediaCardDto>(rows, total);
    }

    public async Task<PagedResult<MediaCardDto>> GetShowCardPageAsync(
        bool isArabic,
        string? search,
        string? genre,
        string? watchStatus,
        string? sortOption,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        var q = _db.Shows.AsNoTracking().Where(s => s.IsMatched && s.IsArabic == isArabic);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            var lower = term.ToLower();
            // SQLite collation can end up case-sensitive depending on environment; normalize to lower-case.
            q = q.Where(s => s.Title.ToLower().Contains(lower));
        }

        if (!string.IsNullOrWhiteSpace(genre) && !string.Equals(genre, "All", StringComparison.OrdinalIgnoreCase))
            q = q.Where(s => s.Genres != null && s.Genres.Contains(genre));

        if (!string.IsNullOrWhiteSpace(watchStatus) && !string.Equals(watchStatus, "All", StringComparison.OrdinalIgnoreCase))
            q = q.Where(s => s.WatchStatus == watchStatus);

        q = sortOption switch
        {
            "Year ↑" => q.OrderBy(s => s.Year ?? 0),
            "Year ↓" => q.OrderByDescending(s => s.Year ?? 0),
            "Rating" => q.OrderByDescending(s => s.VoteAverage),
            "Date added" => q.OrderByDescending(s => s.DateAdded),
            _ => q.OrderBy(s => s.Title)
        };

        var total = await q.CountAsync(cancellationToken).ConfigureAwait(false);
        var skip = Math.Max(0, (Math.Max(1, page) - 1) * Math.Max(1, pageSize));
        var rows = await q.Skip(skip).Take(Math.Max(1, pageSize))
            .Select(s => new MediaCardDto
            {
                Id = s.Id,
                TmdbId = s.TmdbId,
                Title = s.Title,
                Year = s.Year,
                VoteAverage = s.VoteAverage,
                PosterLocalPath = s.PosterLocalPath,
                SelectedPosterPath = s.SelectedPosterPath,
                IsArabic = s.IsArabic,
                WatchStatus = s.WatchStatus,
                DateAdded = s.DateAdded,
                GenresCsv = s.Genres,
                Overview = s.Overview == null ? null : (s.Overview.Length > 200 ? s.Overview.Substring(0, 200) : s.Overview),
                BackdropLocalPath = s.BackdropLocalPath,
                SelectedBackdropPath = s.SelectedBackdropPath,
                TmdbMediaType = "Series"
            })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        return new PagedResult<MediaCardDto>(rows, total);
    }

    public async Task<PagedResult<ScanLog>> GetUnmatchedPageAsync(
        string? search,
        string? shelfFilter,
        int page,
        int pageSize,
        string? sortBy = null,
        string? sortDir = null,
        CancellationToken cancellationToken = default)
    {
        var q = _db.ScanLogs.AsNoTracking().Where(x => x.Status == "Unmatched");
        if (!string.IsNullOrWhiteSpace(search))
        {
            var terms = search
                .Trim()
                .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(t => t.ToLower())
                .Distinct()
                .ToList();
            foreach (var term in terms)
            {
                q = q.Where(x =>
                    x.CleanName.ToLower().Contains(term) ||
                    x.FilePath.ToLower().Contains(term));
            }
        }

        if (!string.IsNullOrWhiteSpace(shelfFilter) && !string.Equals(shelfFilter, "All", StringComparison.OrdinalIgnoreCase))
        {
            q = q.Where(x =>
                string.Equals(shelfFilter, "Movies", StringComparison.OrdinalIgnoreCase) ? x.FilePath.ToLower().Contains("movie") :
                string.Equals(shelfFilter, "Series", StringComparison.OrdinalIgnoreCase) ? x.FilePath.ToLower().Contains("series") :
                string.Equals(shelfFilter, "Arabic", StringComparison.OrdinalIgnoreCase) ? x.FilePath.ToLower().Contains("arab") :
                !x.FilePath.ToLower().Contains("arab"));
        }

        var total = await q.CountAsync(cancellationToken).ConfigureAwait(false);
        var skip = Math.Max(0, (Math.Max(1, page) - 1) * Math.Max(1, pageSize));
        var key = (sortBy ?? "date").Trim().ToLowerInvariant();
        var desc = !string.Equals(sortDir, "asc", StringComparison.OrdinalIgnoreCase);
        IOrderedQueryable<ScanLog> ordered;
        ordered = key switch
        {
            "name" => desc ? q.OrderByDescending(x => x.CleanName) : q.OrderBy(x => x.CleanName),
            "path" => desc ? q.OrderByDescending(x => x.FilePath) : q.OrderBy(x => x.FilePath),
            "media" => desc
                ? q.OrderByDescending(x => x.FilePath.ToLower().Contains("series") ? 1 : 0)
                : q.OrderBy(x => x.FilePath.ToLower().Contains("series") ? 1 : 0),
            "date" or _ => desc ? q.OrderByDescending(x => x.ScannedAt) : q.OrderBy(x => x.ScannedAt),
        };
        var rows = await ordered
            .Skip(skip)
            .Take(Math.Max(1, pageSize))
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        return new PagedResult<ScanLog>(rows, total);
    }

    public async Task<string?> GetFirstEpisodeFilePathByShowIdAsync(int showId, CancellationToken cancellationToken = default)
    {
        return await _db.Episodes.AsNoTracking()
            .Where(e => e.ShowId == showId)
            .OrderBy(e => e.Season)
            .ThenBy(e => e.EpisodeNumber)
            .Select(e => e.FilePath)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task SaveEpisodeAsync(Episode ep, CancellationToken cancellationToken = default)
    {
        var existing = await _db.Episodes.FirstOrDefaultAsync(
            e => e.ShowId == ep.ShowId && e.Season == ep.Season && e.EpisodeNumber == ep.EpisodeNumber,
            cancellationToken).ConfigureAwait(false);
        if (existing != null)
        {
            existing.Title = ep.Title;
            existing.FilePath = ep.FilePath;
            existing.SubtitlePath = ep.SubtitlePath;
            if (!string.IsNullOrWhiteSpace(ep.StillLocalPath))
                existing.StillLocalPath = ep.StillLocalPath;
        }
        else
        {
            _db.Episodes.Add(ep);
        }

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<Episode>> GetEpisodesForShowAsync(int showId,
        CancellationToken cancellationToken = default)
    {
        return await _db.Episodes.AsNoTracking()
            .Where(e => e.ShowId == showId)
            .OrderBy(e => e.Season)
            .ThenBy(e => e.EpisodeNumber)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Resolves a movie using the same path variants as history/poster resolution.</summary>
    public async Task<Movie?> TryGetMovieByFilePathAsync(string filePath,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(filePath))
            return null;

        var fp = filePath.Trim();
        static IEnumerable<string> Variants(string p)
        {
            yield return p;
            var a = p.Replace('\\', '/');
            if (!string.Equals(a, p, StringComparison.Ordinal))
                yield return a;
            var b = p.Replace('/', '\\');
            if (!string.Equals(b, p, StringComparison.Ordinal))
                yield return b;
        }

        foreach (var v in Variants(fp).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var vLower = v.ToLowerInvariant();
            var m = await _db.Movies.AsNoTracking()
                .FirstOrDefaultAsync(x => x.FilePath == v, cancellationToken).ConfigureAwait(false);
            if (m != null)
                return m;

            m = await _db.Movies.AsNoTracking()
                .FirstOrDefaultAsync(x => x.FilePath.ToLower() == vLower, cancellationToken).ConfigureAwait(false);
            if (m != null)
                return m;
        }

        return null;
    }

    /// <summary>Resolves an episode using the same path variants as history/poster resolution.</summary>
    public async Task<Episode?> TryGetEpisodeByFilePathAsync(string filePath,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(filePath))
            return null;

        var fp = filePath.Trim();
        static IEnumerable<string> Variants(string p)
        {
            yield return p;
            var a = p.Replace('\\', '/');
            if (!string.Equals(a, p, StringComparison.Ordinal)) yield return a;
            var b = p.Replace('/', '\\');
            if (!string.Equals(b, p, StringComparison.Ordinal)) yield return b;
        }

        foreach (var v in Variants(fp).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var vLower = v.ToLowerInvariant();
            var ep = await _db.Episodes.AsNoTracking()
                .FirstOrDefaultAsync(e => e.FilePath == v, cancellationToken).ConfigureAwait(false);
            if (ep != null)
                return ep;

            ep = await _db.Episodes.AsNoTracking()
                .FirstOrDefaultAsync(e => e.FilePath.ToLower() == vLower, cancellationToken).ConfigureAwait(false);
            if (ep != null)
                return ep;
        }

        var fileName = Path.GetFileName(fp.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        if (string.IsNullOrEmpty(fileName))
            return null;

        var fl = fileName.ToLowerInvariant();
        return await _db.Episodes.AsNoTracking()
            .FirstOrDefaultAsync(e => e.FilePath.ToLower().EndsWith(fl), cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Next episode to watch: after the latest completed episode in sequence; first episode if none completed;
    /// null if all are completed.
    /// </summary>
    /// <summary>First episode in airing order that is not marked completed (the real “next up” with out-of-order watches).</summary>
    public static Episode? GetNextEpisodeForShow(IReadOnlyList<Episode> episodes)
    {
        if (episodes.Count == 0)
            return null;

        var ordered = episodes.OrderBy(e => e.Season).ThenBy(e => e.EpisodeNumber).ToList();
        return ordered.FirstOrDefault(e =>
            !string.Equals(e.WatchStatus, WatchStatuses.Completed, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Episode immediately before the given episode in season/number order, or null.</summary>
    public static Episode? GetPreviousEpisodeInOrder(IReadOnlyList<Episode> episodes, int currentEpisodeId)
    {
        if (episodes.Count == 0)
            return null;

        var ordered = episodes.OrderBy(e => e.Season).ThenBy(e => e.EpisodeNumber).ToList();
        var idx = ordered.FindIndex(e => e.Id == currentEpisodeId);
        if (idx <= 0)
            return null;

        return ordered[idx - 1];
    }

    /// <summary>Episode immediately after the given episode in season/number order, or null.</summary>
    public static Episode? GetNextEpisodeInOrder(IReadOnlyList<Episode> episodes, int currentEpisodeId)
    {
        if (episodes.Count == 0)
            return null;

        var ordered = episodes.OrderBy(e => e.Season).ThenBy(e => e.EpisodeNumber).ToList();
        var idx = ordered.FindIndex(e => e.Id == currentEpisodeId);
        if (idx < 0 || idx >= ordered.Count - 1)
            return null;

        return ordered[idx + 1];
    }

    public async Task<ScanLog> SaveScanLogAsync(ScanLog log, CancellationToken cancellationToken = default)
    {
        log.FilePath = MediaPathNormalizer.PreferredPhysicalPath(log.FilePath);
        var variants = MediaPathNormalizer.EquivalenceVariants(log.FilePath);
        var existing = variants.Count == 0
            ? null
            : await _db.ScanLogs.FirstOrDefaultAsync(x => variants.Contains(x.FilePath), cancellationToken)
                .ConfigureAwait(false);
        if (existing != null)
        {
            existing.FilePath = log.FilePath;
            existing.CleanName = log.CleanName;
            existing.Status = log.Status;
            existing.MatchedTitle = log.MatchedTitle;
            existing.TmdbId = log.TmdbId;
            existing.Confidence = log.Confidence;
            existing.SuggestionsJson = log.SuggestionsJson;
            existing.ScannedAt = log.ScannedAt;
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            return existing;
        }

        _db.ScanLogs.Add(log);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return log;
    }

    public async Task<bool> IsFileAlreadyMatchedAsync(string filePath,
        CancellationToken cancellationToken = default)
    {
        filePath = MediaPathNormalizer.PreferredPhysicalPath(filePath);
        var variants = MediaPathNormalizer.EquivalenceVariants(filePath);
        if (variants.Count == 0)
            return false;
        var variantsLower = variants.Select(v => v.ToLowerInvariant()).Distinct().ToList();
        var isMovie = await _db.Movies.AsNoTracking()
            .AnyAsync(m =>
                    m.FilePath != null &&
                    (variants.Contains(m.FilePath) || variantsLower.Contains(m.FilePath.ToLower())),
                cancellationToken)
            .ConfigureAwait(false);
        if (isMovie)
            return true;

        return await _db.Episodes.AsNoTracking()
            .AnyAsync(e => variants.Contains(e.FilePath) || variantsLower.Contains(e.FilePath.ToLower()), cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Builds a path index for the current library snapshot (one DB pass). Used by <see cref="Scanner.ScanPipeline"/> to
    /// classify paths without per-file queries and to order work so new files run first.
    /// </summary>
    public async Task<LibraryPathPresenceIndex> CreateLibraryPathPresenceIndexAsync(
        CancellationToken cancellationToken = default)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var episodePaths = await _db.Episodes.AsNoTracking()
            .Where(e => e.FilePath != "")
            .Select(e => e.FilePath)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var moviePaths = await _db.Movies.AsNoTracking()
            .Where(m => m.FilePath != "")
            .Select(m => m.FilePath)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        foreach (var p in episodePaths.Concat(moviePaths))
        {
            foreach (var v in MediaPathNormalizer.EquivalenceVariants(p))
                set.Add(v);
        }

        return new LibraryPathPresenceIndex(set);
    }

    /// <summary>True if this path already has an Unmatched scan log (auto-scans re-hit the same file often).</summary>
    public async Task<bool> HasUnmatchedScanLogAsync(string filePath,
        CancellationToken cancellationToken = default)
    {
        filePath = MediaPathNormalizer.PreferredPhysicalPath(filePath);
        var variants = MediaPathNormalizer.EquivalenceVariants(filePath);
        if (variants.Count == 0)
            return false;
        var variantsLower = variants.Select(v => v.ToLowerInvariant()).Distinct().ToList();
        return await _db.ScanLogs.AsNoTracking()
            .AnyAsync(x =>
                    x.Status == "Unmatched" &&
                    (variants.Contains(x.FilePath) || variantsLower.Contains(x.FilePath.ToLower())),
                cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Full-library scans use this to avoid TMDB churn: same normalized path already Unmatched with the same parsed title.
    /// Rescan-Unmatched runs must not skip (clean name intentionally re-evaluated).
    /// </summary>
    public async Task<bool> HasUnchangedUnmatchedScanLogAsync(string filePath, string parsedCleanName,
        CancellationToken cancellationToken = default)
    {
        parsedCleanName = (parsedCleanName ?? "").Trim();
        if (parsedCleanName.Length == 0)
            return false;

        filePath = MediaPathNormalizer.PreferredPhysicalPath(filePath);
        var variants = MediaPathNormalizer.EquivalenceVariants(filePath);
        if (variants.Count == 0)
            return false;
        var variantsLower = variants.Select(v => v.ToLowerInvariant()).Distinct().ToList();
        var want = parsedCleanName.ToLowerInvariant();
        return await _db.ScanLogs.AsNoTracking()
            .AnyAsync(x =>
                    x.Status == "Unmatched" &&
                    (variants.Contains(x.FilePath) || variantsLower.Contains(x.FilePath.ToLower())) &&
                    (x.CleanName ?? "").ToLower() == want,
                cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>Any scan log row for equivalent paths (avoids duplicate auto-scan desktop toasts).</summary>
    public async Task<bool> HasAnyScanLogForPathVariantsAsync(string filePath,
        CancellationToken cancellationToken = default)
    {
        filePath = MediaPathNormalizer.PreferredPhysicalPath(filePath);
        var variants = MediaPathNormalizer.EquivalenceVariants(filePath);
        if (variants.Count == 0)
            return false;
        var variantsLower = variants.Select(v => v.ToLowerInvariant()).Distinct().ToList();
        return await _db.ScanLogs.AsNoTracking()
            .AnyAsync(x => variants.Contains(x.FilePath) || variantsLower.Contains(x.FilePath.ToLower()), cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>True if this file was already recorded as Matched in scan logs (repeat rescans should not re-toast).</summary>
    public async Task<bool> HasMatchedScanLogForPathVariantsAsync(string filePath,
        CancellationToken cancellationToken = default)
    {
        filePath = MediaPathNormalizer.PreferredPhysicalPath(filePath);
        var variants = MediaPathNormalizer.EquivalenceVariants(filePath);
        if (variants.Count == 0)
            return false;
        var variantsLower = variants.Select(v => v.ToLowerInvariant()).Distinct().ToList();
        // Use SQL-translatable equality — EF Core cannot translate string.Equals(..., OrdinalIgnoreCase).
        return await _db.ScanLogs.AsNoTracking()
            .AnyAsync(
                x =>
                    (variants.Contains(x.FilePath) || variantsLower.Contains(x.FilePath.ToLower())) &&
                    x.Status == "Matched",
                cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Settings: desktop toasts when background scan indexes a path (default on).</summary>
    public async Task<bool> GetLibraryScanDesktopToastsEnabledAsync(CancellationToken cancellationToken = default)
    {
        var raw = await GetSettingAsync("LibraryScanDesktopToasts", cancellationToken).ConfigureAwait(false);
        return string.IsNullOrWhiteSpace(raw) ||
               string.Equals(raw, "true", StringComparison.OrdinalIgnoreCase);
    }

    public async Task<IReadOnlyList<ScanLog>> GetAllScanLogsAsync(CancellationToken cancellationToken = default)
    {
        return await _db.ScanLogs.AsNoTracking().OrderBy(x => x.FilePath).ToListAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<ScanLog>> GetUnmatchedFilesAsync(CancellationToken cancellationToken = default)
    {
        return await _db.ScanLogs.AsNoTracking()
            .Where(x => x.Status == "Unmatched")
            .OrderBy(x => x.FilePath)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<int> DeleteUnmatchedScanLogsAsync(CancellationToken cancellationToken = default)
    {
        return await _db.ScanLogs.Where(x => x.Status == "Unmatched")
            .ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task UpdateScanLogStatusAsync(int id, string status, int? tmdbId, string? title,
        CancellationToken cancellationToken = default)
    {
        var log = await _db.ScanLogs.FirstOrDefaultAsync(x => x.Id == id, cancellationToken).ConfigureAwait(false);
        if (log == null)
            return;

        log.Status = status;
        log.TmdbId = tmdbId;
        log.MatchedTitle = title;
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Adds a history row when playback starts. Returns the new row id.</summary>
    public async Task<int> AddToHistoryAsync(string filePath, string title, string? posterPath, string mediaType,
        int fileDurationSeconds = 0, CancellationToken cancellationToken = default,
        bool suppressContinueWatching = false)
    {
        var now = DateTime.UtcNow;
        var h = new WatchHistory
        {
            FilePath = filePath,
            Title = title,
            PosterLocalPath = posterPath,
            MediaType = mediaType,
            OpenedAt = now,
            StartedAt = now,
            FileDurationSeconds = fileDurationSeconds,
            EstimatedSeconds = 0,
            IsCompleted = false,
            MaxKnownPositionSeconds = 0,
            LastExplicitPositionSeconds = 0,
            LastHeartbeatAtUtc = null,
            IsStopFinalized = false,
            SuppressContinueWatching = suppressContinueWatching
        };
        _db.WatchHistories.Add(h);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return h.Id;
    }

    /// <summary>Recent plays, one entry per distinct file path (latest first).</summary>
    public async Task<IReadOnlyList<WatchHistory>> GetRecentHistoryDistinctByFileAsync(int count = 20,
        bool includeSuppressedForContinueWatching = false, CancellationToken cancellationToken = default)
    {
        var q = _db.WatchHistories.AsNoTracking();
        if (!includeSuppressedForContinueWatching)
            q = q.Where(h => !h.SuppressContinueWatching);
        var batch = await q.OrderByDescending(h => h.OpenedAt)
            .Take(Math.Max(count * 5, 50))
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return CollapseRecentHistoryRows(batch, count);
    }

    public async Task<IReadOnlyList<WatchHistory>> GetRecentHistoryAsync(int count = 10,
        bool includeSuppressedForContinueWatching = false, CancellationToken cancellationToken = default)
    {
        // In-memory dedupe: SQLite + GroupBy(...).First() translation has been flaky.
        // Keep latest row per file path but carry forward max saved resume so reopening never regresses to 0
        // when a fresh "opened" row is created before progress is persisted.
        var q = _db.WatchHistories.AsNoTracking();
        if (!includeSuppressedForContinueWatching)
            q = q.Where(h => !h.SuppressContinueWatching);
        var batch = await q.OrderByDescending(h => h.OpenedAt)
            .Take(Math.Max(count * 10, 100))
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return CollapseRecentHistoryRows(batch, count);
    }

    private static List<WatchHistory> CollapseRecentHistoryRows(IEnumerable<WatchHistory> batch, int count)
    {
        var perFile = new Dictionary<string, WatchHistory>(StringComparer.OrdinalIgnoreCase);
        foreach (var h in batch)
        {
            if (h.IsCompleted)
                continue;

            var key = NormalizeHistoryPath(h.FilePath);
            if (string.IsNullOrWhiteSpace(key))
                key = $"__history_row_{h.Id}";

            if (!perFile.TryGetValue(key, out var current))
            {
                perFile[key] = h;
                continue;
            }

            if (h.OpenedAt > current.OpenedAt)
            {
                h.EstimatedSeconds = Math.Max(h.EstimatedSeconds, current.EstimatedSeconds);
                h.FileDurationSeconds = Math.Max(h.FileDurationSeconds, current.FileDurationSeconds);
                h.MaxKnownPositionSeconds = Math.Max(h.MaxKnownPositionSeconds, current.MaxKnownPositionSeconds);
                h.LastExplicitPositionSeconds =
                    Math.Max(h.LastExplicitPositionSeconds, current.LastExplicitPositionSeconds);
                h.LastHeartbeatAtUtc = MaxUtc(h.LastHeartbeatAtUtc, current.LastHeartbeatAtUtc);
                h.IsStopFinalized = h.IsStopFinalized || current.IsStopFinalized;
                if (!h.StartedAt.HasValue || (current.StartedAt.HasValue && current.StartedAt > h.StartedAt))
                    h.StartedAt = current.StartedAt;
                if (!h.StoppedAt.HasValue || (current.StoppedAt.HasValue && current.StoppedAt > h.StoppedAt))
                    h.StoppedAt = current.StoppedAt;
                perFile[key] = h;
            }
            else
            {
                current.EstimatedSeconds = Math.Max(current.EstimatedSeconds, h.EstimatedSeconds);
                current.FileDurationSeconds = Math.Max(current.FileDurationSeconds, h.FileDurationSeconds);
                current.MaxKnownPositionSeconds = Math.Max(current.MaxKnownPositionSeconds, h.MaxKnownPositionSeconds);
                current.LastExplicitPositionSeconds =
                    Math.Max(current.LastExplicitPositionSeconds, h.LastExplicitPositionSeconds);
                current.LastHeartbeatAtUtc = MaxUtc(current.LastHeartbeatAtUtc, h.LastHeartbeatAtUtc);
                current.IsStopFinalized = current.IsStopFinalized || h.IsStopFinalized;
                if (!current.StartedAt.HasValue || (h.StartedAt.HasValue && h.StartedAt > current.StartedAt))
                    current.StartedAt = h.StartedAt;
                if (!current.StoppedAt.HasValue || (h.StoppedAt.HasValue && h.StoppedAt > current.StoppedAt))
                    current.StoppedAt = h.StoppedAt;
            }
        }

        var merged = perFile.Values.ToList();
        foreach (var h in merged)
            TrustedResumePolicy.ApplyTo(h);

        return merged
            .OrderByDescending(h => h.OpenedAt)
            .Take(Math.Max(1, count))
            .ToList();
    }

    private static string NormalizeHistoryPath(string? path) =>
        (path ?? "").Trim().Replace('\\', '/').ToLowerInvariant();

    private static DateTime? MaxUtc(DateTime? a, DateTime? b)
    {
        if (!a.HasValue)
            return b;
        if (!b.HasValue)
            return a;
        return a.Value >= b.Value ? a : b;
    }

    /// <summary>
    /// All in-progress series: at least one episode started, not fully completed, next episode exists in library.
    /// Grouped per show; sort by latest activity then progress relevance.
    /// </summary>
    public async Task<IReadOnlyList<CurrentlyWatchingRow>> GetCurrentlyWatchingSeriesAsync(int recentDays = 21,
        int maxItems = 200, CancellationToken cancellationToken = default)
    {
        _ = recentDays;

        var histRows = await _db.WatchHistories.AsNoTracking()
            .Where(h => h.MediaType == "Series")
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var pathToMaxPlay = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
        foreach (var h in histRows)
        {
            var fp = (h.FilePath ?? "").Trim();
            if (fp.Length == 0)
                continue;
            foreach (var v in PathVariants(fp))
            {
                if (!pathToMaxPlay.TryGetValue(v, out var prev) || h.OpenedAt > prev)
                    pathToMaxPlay[v] = h.OpenedAt;
            }
        }

        var candidateShowIds = await _db.Shows.AsNoTracking()
            .Where(s => s.IsMatched && s.TmdbId > 0)
            .Select(s => s.Id)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var rows = new List<(CurrentlyWatchingRow Row, double SortKey)>();

        foreach (var sid in candidateShowIds)
        {
            var allEps = (await GetEpisodesForShowAsync(sid, cancellationToken).ConfigureAwait(false)).ToList();
            if (allEps.Count == 0)
                continue;

            var show = await _db.Shows.AsNoTracking()
                .FirstOrDefaultAsync(s => s.Id == sid, cancellationToken)
                .ConfigureAwait(false);
            if (show == null || !show.IsMatched || show.TmdbId <= 0)
                continue;

            var ordered = allEps.OrderBy(e => e.Season).ThenBy(e => e.EpisodeNumber).ToList();
            var completed = ordered.Count(e =>
                string.Equals(e.WatchStatus, WatchStatuses.Completed, StringComparison.OrdinalIgnoreCase));
            var hasHistory = ordered.Any(e => TryMatchHistoryPlayTime(pathToMaxPlay, e.FilePath, out _));
            var hasWatching = ordered.Any(e =>
                string.Equals(e.WatchStatus, WatchStatuses.Watching, StringComparison.OrdinalIgnoreCase));
            var hasStarted = completed > 0 || hasWatching || hasHistory;
            if (!hasStarted)
                continue;

            var next = GetNextEpisodeForShow(ordered);
            if (next == null)
                continue;

            var allEpisodesCompleted = ordered.All(e =>
                string.Equals(e.WatchStatus, WatchStatuses.Completed, StringComparison.OrdinalIgnoreCase));
            if (allEpisodesCompleted)
                continue;

            var total = ordered.Count;
            var remaining = ordered.Count(e =>
                !string.Equals(e.WatchStatus, WatchStatuses.Completed, StringComparison.OrdinalIgnoreCase));
            if (remaining <= 0)
                continue;

            var lastPlayedAt = DateTime.MinValue;
            Episode? lastFromHistory = null;
            foreach (var ep in ordered)
            {
                if (!TryMatchHistoryPlayTime(pathToMaxPlay, ep.FilePath, out var t))
                    continue;
                if (t > lastPlayedAt)
                {
                    lastPlayedAt = t;
                    lastFromHistory = ep;
                }
            }

            Episode? lastWatchedEp = lastFromHistory;
            if (lastWatchedEp == null)
            {
                Episode? bestCompleted = null;
                foreach (var ep in ordered)
                {
                    if (!string.Equals(ep.WatchStatus, WatchStatuses.Completed, StringComparison.OrdinalIgnoreCase))
                        continue;
                    if (bestCompleted == null || ep.Season > bestCompleted.Season ||
                        (ep.Season == bestCompleted.Season && ep.EpisodeNumber > bestCompleted.EpisodeNumber))
                        bestCompleted = ep;
                }

                lastWatchedEp = bestCompleted;
            }

            if (lastWatchedEp == null)
                lastWatchedEp = ordered.FirstOrDefault(e =>
                    string.Equals(e.WatchStatus, WatchStatuses.Watching, StringComparison.OrdinalIgnoreCase));
            if (lastWatchedEp == null)
                lastWatchedEp = ordered[0];

            if (lastPlayedAt == DateTime.MinValue)
            {
                var completedAts = ordered.Where(e => e.CompletedAt.HasValue).Select(e => e.CompletedAt!.Value)
                    .ToList();
                lastPlayedAt = completedAts.Count > 0 ? completedAts.Max() : show.DateAdded;
            }

            var progress = total > 0 ? (double)completed / total : 0.0;
            var inProgressBoost = show.WatchStatus == WatchStatuses.Watching ? 1.0 : 0.0;
            var sortKey = inProgressBoost * 10_000 + progress * 1_000 - remaining;

            rows.Add((new CurrentlyWatchingRow
            {
                LibraryShowId = show.Id,
                ShowTitle = show.Title ?? "",
                ShowTmdbId = show.TmdbId,
                PosterLocalPath = show.PosterLocalPath,
                SelectedPosterPath = show.SelectedPosterPath,
                LastWatchedSeason = lastWatchedEp.Season,
                LastWatchedEpisode = lastWatchedEp.EpisodeNumber,
                NextSeason = next.Season,
                NextEpisode = next.EpisodeNumber,
                EpisodesRemaining = remaining,
                WatchedEpisodes = completed,
                TotalEpisodes = total,
                ProgressFraction = progress,
                LastPlayedAtUtc = lastPlayedAt,
            }, sortKey));
        }

        return rows
            .OrderByDescending(x => x.Row.LastPlayedAtUtc)
            .ThenByDescending(x => x.SortKey)
            .Select(x => x.Row)
            .Take(Math.Clamp(maxItems, 1, 500))
            .ToList();
    }

    private static bool TryMatchHistoryPlayTime(
        Dictionary<string, DateTime> pathToLastPlay,
        string? episodeFilePath,
        out DateTime playedAt)
    {
        playedAt = default;
        var fp = (episodeFilePath ?? "").Trim();
        if (fp.Length == 0)
            return false;
        foreach (var cand in PathVariants(fp))
        {
            if (pathToLastPlay.TryGetValue(cand, out playedAt))
                return true;
        }

        return false;
    }

    private static IEnumerable<string> PathVariants(string path)
    {
        yield return path;
        var a = path.Replace('\\', '/');
        if (!string.Equals(a, path, StringComparison.Ordinal))
            yield return a;
        var b = path.Replace('/', '\\');
        if (!string.Equals(b, path, StringComparison.Ordinal))
            yield return b;
    }

    /// <summary>
    /// Deletes all watch-history rows for the same file as the given row (dismiss from Continue watching).
    /// Uses path variants so Windows/URL layouts still match.
    /// </summary>
    public async Task<bool> RemoveContinueWatchingByHistoryIdAsync(int historyId,
        CancellationToken cancellationToken = default)
    {
        var h = await _db.WatchHistories.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == historyId, cancellationToken).ConfigureAwait(false);
        if (h == null)
            return false;

        var variants = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var fp = (h.FilePath ?? "").Trim();
        if (fp.Length > 0)
        {
            variants.Add(fp);
            variants.Add(fp.Replace('\\', '/'));
            variants.Add(fp.Replace('/', '\\'));
        }

        if (variants.Count == 0)
            return false;

        await _db.WatchHistories.Where(x => variants.Contains(x.FilePath))
            .ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    /// <summary>
    /// Removes Continue watching entries for the file linked to this history row. Optionally marks the library movie or episode completed first.
    /// </summary>
    public async Task<bool> ContinueWatchingDismissAsync(int historyId, bool markLibraryCompleted,
        CancellationToken cancellationToken = default)
    {
        var h = await _db.WatchHistories.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == historyId, cancellationToken).ConfigureAwait(false);
        if (h == null)
            return false;

        if (markLibraryCompleted)
        {
            if (string.Equals(h.MediaType, "Movie", StringComparison.OrdinalIgnoreCase))
            {
                var movie = await TryGetMovieByFilePathAsync(h.FilePath, cancellationToken).ConfigureAwait(false);
                if (movie != null)
                    await UpdateMovieWatchStatusAsync(movie.Id, WatchStatuses.Completed, cancellationToken)
                        .ConfigureAwait(false);
            }
            else if (string.Equals(h.MediaType, "Series", StringComparison.OrdinalIgnoreCase))
            {
                var ep = await TryGetEpisodeByFilePathAsync(h.FilePath, cancellationToken).ConfigureAwait(false);
                if (ep != null)
                    await UpdateEpisodeWatchStatusAsync(ep.Id, WatchStatuses.Completed, cancellationToken)
                        .ConfigureAwait(false);
            }
        }

        return await RemoveContinueWatchingByHistoryIdAsync(historyId, cancellationToken).ConfigureAwait(false);
    }

    public async Task UpdateWatchHistoryAfterReturnAsync(int historyId, DateTime stoppedAtUtc, int sessionSeconds,
        CancellationToken cancellationToken = default)
    {
        if (sessionSeconds <= 0)
            return;

        var h = await _db.WatchHistories.FirstOrDefaultAsync(x => x.Id == historyId, cancellationToken)
            .ConfigureAwait(false);
        if (h == null)
            return;

        if (h.IsStopFinalized)
            return;

        h.StoppedAt = stoppedAtUtc;
        h.LastHeartbeatAtUtc = MaxUtc(h.LastHeartbeatAtUtc, stoppedAtUtc);
        h.IsStopFinalized = true;
        if (sessionSeconds > 60)
            h.EstimatedSeconds = Math.Max(h.EstimatedSeconds, sessionSeconds);

        if (h.FileDurationSeconds > 0 && h.EstimatedSeconds >= h.FileDurationSeconds * 0.9)
            h.IsCompleted = true;

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        if (h.IsCompleted)
            await ApplyCompletedFromHistoryAsync(h, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Built-in player: authoritative position/duration; updates library watch state.</summary>
    public async Task UpdateWatchHistoryProgressAsync(int historyId, int positionSeconds, int? durationSeconds,
        bool markWatching, CancellationToken cancellationToken = default)
    {
        if (positionSeconds < 0)
            return;

        var h = await _db.WatchHistories.FirstOrDefaultAsync(x => x.Id == historyId, cancellationToken)
            .ConfigureAwait(false);
        if (h == null)
            return;

        if (h.IsStopFinalized)
            return;

        if (durationSeconds is int ds && ds > 0)
            h.FileDurationSeconds = Math.Max(h.FileDurationSeconds, ds);

        var now = DateTime.UtcNow;
        h.LastHeartbeatAtUtc = now;
        h.LastExplicitPositionSeconds = positionSeconds;
        h.MaxKnownPositionSeconds = Math.Max(h.MaxKnownPositionSeconds, positionSeconds);
        h.EstimatedSeconds = Math.Max(h.EstimatedSeconds, positionSeconds);

        var dur = h.FileDurationSeconds;
        var nearEnd = dur > 0 && h.EstimatedSeconds >= (int)(dur * 0.9);
        if (nearEnd)
            h.IsCompleted = true;

        if (markWatching && positionSeconds > 60 && !nearEnd)
            await ApplyWatchingFromHistoryAsync(h, cancellationToken).ConfigureAwait(false);

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        if (nearEnd)
            await ApplyCompletedFromHistoryAsync(h, cancellationToken).ConfigureAwait(false);
    }

    private async Task ApplyWatchingFromHistoryAsync(WatchHistory h,
        CancellationToken cancellationToken = default)
    {
        if (string.Equals(h.MediaType, "Movie", StringComparison.OrdinalIgnoreCase))
        {
            var lite = await TryGetMovieByFilePathAsync(h.FilePath, cancellationToken).ConfigureAwait(false);
            if (lite == null)
                return;
            var m = await _db.Movies.FirstOrDefaultAsync(x => x.Id == lite.Id, cancellationToken)
                .ConfigureAwait(false);
            if (m == null)
                return;
            if (m.WatchStatus == WatchStatuses.Unwatched)
            {
                m.WatchStatus = WatchStatuses.Watching;
                m.CompletedAt = null;
                await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            }
        }
        else if (string.Equals(h.MediaType, "Series", StringComparison.OrdinalIgnoreCase))
        {
            var lite = await TryGetEpisodeByFilePathAsync(h.FilePath, cancellationToken).ConfigureAwait(false);
            if (lite == null)
                return;
            if (lite.WatchStatus == WatchStatuses.Unwatched)
                await UpdateEpisodeWatchStatusAsync(lite.Id, WatchStatuses.Watching, cancellationToken)
                    .ConfigureAwait(false);
        }
    }

    /// <summary>End of built-in session: record stop time and final playback position (seconds).</summary>
    public async Task FinalizeWatchHistoryStoppedWithPositionAsync(int historyId, DateTime stoppedAtUtc,
        int positionSeconds, CancellationToken cancellationToken = default)
    {
        var h = await _db.WatchHistories.FirstOrDefaultAsync(x => x.Id == historyId, cancellationToken)
            .ConfigureAwait(false);
        if (h == null)
            return;

        if (h.IsStopFinalized)
            return;

        h.StoppedAt = stoppedAtUtc;
        h.LastHeartbeatAtUtc = MaxUtc(h.LastHeartbeatAtUtc, stoppedAtUtc);
        h.LastExplicitPositionSeconds = Math.Max(h.LastExplicitPositionSeconds, positionSeconds);
        h.MaxKnownPositionSeconds = Math.Max(h.MaxKnownPositionSeconds, positionSeconds);
        h.EstimatedSeconds = Math.Max(h.EstimatedSeconds, positionSeconds);
        h.IsStopFinalized = true;
        if (h.FileDurationSeconds > 0 && h.EstimatedSeconds >= h.FileDurationSeconds * 0.9)
            h.IsCompleted = true;

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        if (h.IsCompleted)
            await ApplyCompletedFromHistoryAsync(h, cancellationToken).ConfigureAwait(false);
    }

    public async Task ApplyCompletedFromHistoryAsync(WatchHistory h,
        CancellationToken cancellationToken = default)
    {
        if (string.Equals(h.MediaType, "Movie", StringComparison.OrdinalIgnoreCase))
        {
            var lite = await TryGetMovieByFilePathAsync(h.FilePath, cancellationToken).ConfigureAwait(false);
            if (lite != null)
                await UpdateMovieWatchStatusAsync(lite.Id, WatchStatuses.Completed, cancellationToken)
                    .ConfigureAwait(false);
        }
        else if (string.Equals(h.MediaType, "Series", StringComparison.OrdinalIgnoreCase))
        {
            var lite = await TryGetEpisodeByFilePathAsync(h.FilePath, cancellationToken).ConfigureAwait(false);
            if (lite != null)
                await UpdateEpisodeWatchStatusAsync(lite.Id, WatchStatuses.Completed, cancellationToken)
                    .ConfigureAwait(false);
        }
    }

    /// <summary>SQLite ALTER for existing DBs created before resume columns existed.</summary>
    public async Task EnsureWatchHistoryResumeColumnsAsync(CancellationToken cancellationToken = default)
    {
        async Task AddIfMissingAsync(string column, string sql)
        {
            if (await SqliteColumnExistsAsync("WatchHistories", column, cancellationToken).ConfigureAwait(false))
                return;
            await _db.Database.ExecuteSqlRawAsync(sql, cancellationToken).ConfigureAwait(false);
        }

        await AddIfMissingAsync("StartedAt", "ALTER TABLE WatchHistories ADD COLUMN StartedAt TEXT NULL")
            .ConfigureAwait(false);
        await AddIfMissingAsync("StoppedAt", "ALTER TABLE WatchHistories ADD COLUMN StoppedAt TEXT NULL")
            .ConfigureAwait(false);
        await AddIfMissingAsync("EstimatedSeconds",
                "ALTER TABLE WatchHistories ADD COLUMN EstimatedSeconds INTEGER NOT NULL DEFAULT 0")
            .ConfigureAwait(false);
        await AddIfMissingAsync("FileDurationSeconds",
                "ALTER TABLE WatchHistories ADD COLUMN FileDurationSeconds INTEGER NOT NULL DEFAULT 0")
            .ConfigureAwait(false);
        await AddIfMissingAsync("IsCompleted",
                "ALTER TABLE WatchHistories ADD COLUMN IsCompleted INTEGER NOT NULL DEFAULT 0")
            .ConfigureAwait(false);
        await AddIfMissingAsync("MaxKnownPositionSeconds",
                "ALTER TABLE WatchHistories ADD COLUMN MaxKnownPositionSeconds INTEGER NOT NULL DEFAULT 0")
            .ConfigureAwait(false);
        await AddIfMissingAsync("LastExplicitPositionSeconds",
                "ALTER TABLE WatchHistories ADD COLUMN LastExplicitPositionSeconds INTEGER NOT NULL DEFAULT 0")
            .ConfigureAwait(false);
        await AddIfMissingAsync("LastHeartbeatAtUtc",
                "ALTER TABLE WatchHistories ADD COLUMN LastHeartbeatAtUtc TEXT NULL")
            .ConfigureAwait(false);
        await AddIfMissingAsync("IsStopFinalized",
                "ALTER TABLE WatchHistories ADD COLUMN IsStopFinalized INTEGER NOT NULL DEFAULT 0")
            .ConfigureAwait(false);
        await AddIfMissingAsync("SuppressContinueWatching",
                "ALTER TABLE WatchHistories ADD COLUMN SuppressContinueWatching INTEGER NOT NULL DEFAULT 0")
            .ConfigureAwait(false);

        await _db.Database.ExecuteSqlRawAsync(
                """
                CREATE INDEX IF NOT EXISTS "IX_WatchHistories_FilePath_OpenedAt" ON "WatchHistories" ("FilePath", "OpenedAt" DESC)
                """,
                cancellationToken)
            .ConfigureAwait(false);
        await _db.Database.ExecuteSqlRawAsync(
                """
                CREATE INDEX IF NOT EXISTS "IX_WatchHistories_IsStopFinalized_LastHeartbeatAtUtc" ON "WatchHistories" ("IsStopFinalized", "LastHeartbeatAtUtc")
                """,
                cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task EnsureWatchStatusColumnsAsync(CancellationToken cancellationToken = default)
    {
        async Task AddIfMissingAsync(string table, string column, string sql)
        {
            if (await SqliteColumnExistsAsync(table, column, cancellationToken).ConfigureAwait(false))
                return;
            await _db.Database.ExecuteSqlRawAsync(sql, cancellationToken).ConfigureAwait(false);
        }

        await AddIfMissingAsync("Shows", "WatchStatus",
                "ALTER TABLE Shows ADD COLUMN WatchStatus TEXT NOT NULL DEFAULT 'Unwatched'")
            .ConfigureAwait(false);
        await AddIfMissingAsync("Shows", "CompletedAt", "ALTER TABLE Shows ADD COLUMN CompletedAt TEXT NULL")
            .ConfigureAwait(false);
        await AddIfMissingAsync("Movies", "WatchStatus",
                "ALTER TABLE Movies ADD COLUMN WatchStatus TEXT NOT NULL DEFAULT 'Unwatched'")
            .ConfigureAwait(false);
        await AddIfMissingAsync("Movies", "CompletedAt", "ALTER TABLE Movies ADD COLUMN CompletedAt TEXT NULL")
            .ConfigureAwait(false);
        await AddIfMissingAsync("Episodes", "WatchStatus",
                "ALTER TABLE Episodes ADD COLUMN WatchStatus TEXT NOT NULL DEFAULT 'Unwatched'")
            .ConfigureAwait(false);
        await AddIfMissingAsync("Episodes", "CompletedAt", "ALTER TABLE Episodes ADD COLUMN CompletedAt TEXT NULL")
            .ConfigureAwait(false);
    }

    public async Task EnsureEpisodeStillLocalPathColumnAsync(CancellationToken cancellationToken = default)
    {
        async Task AddIfMissingAsync(string table, string column, string sql)
        {
            if (await SqliteColumnExistsAsync(table, column, cancellationToken).ConfigureAwait(false))
                return;
            await _db.Database.ExecuteSqlRawAsync(sql, cancellationToken).ConfigureAwait(false);
        }

        await AddIfMissingAsync("Episodes", "StillLocalPath", "ALTER TABLE Episodes ADD COLUMN StillLocalPath TEXT")
            .ConfigureAwait(false);
    }

    public async Task EnsureSelectedImageColumnsAsync(CancellationToken cancellationToken = default)
    {
        async Task AddIfMissingAsync(string table, string column, string sql)
        {
            if (await SqliteColumnExistsAsync(table, column, cancellationToken).ConfigureAwait(false))
                return;
            await _db.Database.ExecuteSqlRawAsync(sql, cancellationToken).ConfigureAwait(false);
        }

        await AddIfMissingAsync("Shows", "SelectedPosterPath",
                "ALTER TABLE Shows ADD COLUMN SelectedPosterPath TEXT")
            .ConfigureAwait(false);
        await AddIfMissingAsync("Shows", "SelectedBackdropPath",
                "ALTER TABLE Shows ADD COLUMN SelectedBackdropPath TEXT")
            .ConfigureAwait(false);
        await AddIfMissingAsync("Movies", "SelectedPosterPath",
                "ALTER TABLE Movies ADD COLUMN SelectedPosterPath TEXT")
            .ConfigureAwait(false);
        await AddIfMissingAsync("Movies", "SelectedBackdropPath",
                "ALTER TABLE Movies ADD COLUMN SelectedBackdropPath TEXT")
            .ConfigureAwait(false);
    }

    public async Task EnsureCrewCacheJsonColumnsAsync(CancellationToken cancellationToken = default)
    {
        async Task AddIfMissingAsync(string table, string column, string sql)
        {
            if (await SqliteColumnExistsAsync(table, column, cancellationToken).ConfigureAwait(false))
                return;
            await _db.Database.ExecuteSqlRawAsync(sql, cancellationToken).ConfigureAwait(false);
        }

        await AddIfMissingAsync("Movies", "CrewCacheJson", "ALTER TABLE Movies ADD COLUMN CrewCacheJson TEXT")
            .ConfigureAwait(false);
        await AddIfMissingAsync("Shows", "CrewCacheJson", "ALTER TABLE Shows ADD COLUMN CrewCacheJson TEXT")
            .ConfigureAwait(false);
    }

    public async Task UpdatePosterAsync(int id, string mediaType, string posterPath,
        CancellationToken cancellationToken = default)
    {
        var p = posterPath?.Trim();
        if (string.IsNullOrWhiteSpace(p))
            return;

        if (string.Equals(mediaType, "Movie", StringComparison.OrdinalIgnoreCase))
        {
            var m = await _db.Movies.FirstOrDefaultAsync(x => x.Id == id, cancellationToken).ConfigureAwait(false);
            if (m == null)
                return;
            m.SelectedPosterPath = p;
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            return;
        }

        var s = await _db.Shows.FirstOrDefaultAsync(x => x.Id == id, cancellationToken).ConfigureAwait(false);
        if (s == null)
            return;
        s.SelectedPosterPath = p;
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public Task UpdateSelectedPosterAsync(int id, string mediaType, string path,
        CancellationToken cancellationToken = default) =>
        UpdatePosterAsync(id, mediaType, path, cancellationToken);

    public async Task UpdateBackdropAsync(int id, string mediaType, string backdropPath,
        CancellationToken cancellationToken = default)
    {
        var p = backdropPath?.Trim();
        if (string.IsNullOrWhiteSpace(p))
            return;

        if (string.Equals(mediaType, "Movie", StringComparison.OrdinalIgnoreCase))
        {
            var m = await _db.Movies.FirstOrDefaultAsync(x => x.Id == id, cancellationToken).ConfigureAwait(false);
            if (m == null)
                return;
            m.SelectedBackdropPath = p;
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            return;
        }

        var s = await _db.Shows.FirstOrDefaultAsync(x => x.Id == id, cancellationToken).ConfigureAwait(false);
        if (s == null)
            return;
        s.SelectedBackdropPath = p;
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public Task UpdateSelectedBackdropAsync(int id, string mediaType, string path,
        CancellationToken cancellationToken = default) =>
        UpdateBackdropAsync(id, mediaType, path, cancellationToken);

    public async Task UpdateMovieWatchStatusAsync(int movieId, string watchStatus,
        CancellationToken cancellationToken = default)
    {
        if (!WatchStatuses.IsValid(watchStatus))
            return;

        var m = await _db.Movies.FirstOrDefaultAsync(x => x.Id == movieId, cancellationToken).ConfigureAwait(false);
        if (m == null)
            return;

        m.WatchStatus = watchStatus;
        m.CompletedAt = watchStatus == WatchStatuses.Completed ? DateTime.UtcNow : null;
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Sets library watch status for a show and applies the same status to every episode row.</summary>
    public async Task UpdateShowWatchStatusAsync(int showId, string watchStatus,
        CancellationToken cancellationToken = default)
    {
        if (!WatchStatuses.IsValid(watchStatus))
            return;

        var show = await _db.Shows.FirstOrDefaultAsync(s => s.Id == showId, cancellationToken).ConfigureAwait(false);
        if (show == null)
            return;

        show.WatchStatus = watchStatus;
        show.CompletedAt = watchStatus == WatchStatuses.Completed ? DateTime.UtcNow : null;

        var eps = await _db.Episodes.Where(e => e.ShowId == showId).ToListAsync(cancellationToken).ConfigureAwait(false);
        foreach (var ep in eps)
        {
            ep.WatchStatus = watchStatus;
            ep.CompletedAt = watchStatus == WatchStatuses.Completed ? DateTime.UtcNow : null;
        }

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task UpdateEpisodeWatchStatusAsync(int episodeId, string watchStatus,
        CancellationToken cancellationToken = default)
    {
        if (!WatchStatuses.IsValid(watchStatus))
            return;

        var ep = await _db.Episodes.FirstOrDefaultAsync(e => e.Id == episodeId, cancellationToken)
            .ConfigureAwait(false);
        if (ep == null)
            return;

        ep.WatchStatus = watchStatus;
        ep.CompletedAt = watchStatus == WatchStatuses.Completed ? DateTime.UtcNow : null;
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        await SyncShowWatchStatusFromEpisodesAsync(ep.ShowId, cancellationToken).ConfigureAwait(false);
    }

    private async Task SyncShowWatchStatusFromEpisodesAsync(int showId, CancellationToken cancellationToken)
    {
        var eps = await _db.Episodes.Where(e => e.ShowId == showId).ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        if (eps.Count == 0)
            return;

        var show = await _db.Shows.FirstOrDefaultAsync(s => s.Id == showId, cancellationToken)
            .ConfigureAwait(false);
        if (show == null)
            return;

        var allCompleted = eps.All(e => e.WatchStatus == WatchStatuses.Completed);
        var anyProgress = eps.Any(e =>
            e.WatchStatus == WatchStatuses.Completed || e.WatchStatus == WatchStatuses.Watching);

        if (allCompleted)
        {
            show.WatchStatus = WatchStatuses.Completed;
            show.CompletedAt = DateTime.UtcNow;
        }
        else if (anyProgress)
        {
            show.WatchStatus = WatchStatuses.Watching;
            show.CompletedAt = null;
        }
        else
        {
            show.WatchStatus = WatchStatuses.Unwatched;
            show.CompletedAt = null;
        }

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<string?> GetSettingAsync(string key, CancellationToken cancellationToken = default)
    {
        var s = await _db.Settings.AsNoTracking().FirstOrDefaultAsync(x => x.Key == key, cancellationToken)
            .ConfigureAwait(false);
        return s?.Value;
    }

    public async Task SaveSettingAsync(string key, string value, CancellationToken cancellationToken = default)
    {
        var existing = await _db.Settings.FirstOrDefaultAsync(x => x.Key == key, cancellationToken)
            .ConfigureAwait(false);
        if (existing != null)
            existing.Value = value;
        else
            _db.Settings.Add(new Setting { Key = key, Value = value });

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    private const string NextEpisodesPinnedKey = "NextEpisodesPinnedV1";

    public async Task<List<int>> GetNextEpisodesPinnedShowIdsAsync(CancellationToken cancellationToken = default)
    {
        var raw = await GetSettingAsync(NextEpisodesPinnedKey, cancellationToken).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(raw))
            return new List<int>();
        try
        {
            var ids = JsonSerializer.Deserialize<List<int>>(raw);
            return ids?.Where(i => i > 0).Distinct().ToList() ?? new List<int>();
        }
        catch
        {
            return new List<int>();
        }
    }

    public async Task SaveNextEpisodesPinnedShowIdsAsync(IReadOnlyList<int> showIds,
        CancellationToken cancellationToken = default)
    {
        var clean = showIds.Where(i => i > 0).Distinct().ToList();
        await SaveSettingAsync(NextEpisodesPinnedKey, JsonSerializer.Serialize(clean), cancellationToken)
            .ConfigureAwait(false);
    }

    private const string NextEpisodesFollowedExternalKey = "NextEpisodesFollowedExternalV1";

    public async Task<IReadOnlyList<FollowedExternalShow>> GetFollowedExternalShowsAsync(
        CancellationToken cancellationToken = default)
    {
        var raw = await GetSettingAsync(NextEpisodesFollowedExternalKey, cancellationToken).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(raw))
            return Array.Empty<FollowedExternalShow>();
        try
        {
            var list = JsonSerializer.Deserialize<List<FollowedExternalShow>>(raw);
            return list?.Where(x => x.TmdbId > 0).OrderByDescending(x => x.AddedAtUtc).ToList()
                   ?? (IReadOnlyList<FollowedExternalShow>)Array.Empty<FollowedExternalShow>();
        }
        catch
        {
            return Array.Empty<FollowedExternalShow>();
        }
    }

    public async Task SaveFollowedExternalShowsAsync(IReadOnlyList<FollowedExternalShow> shows,
        CancellationToken cancellationToken = default)
    {
        var clean = shows
            .Where(x => x.TmdbId > 0 && !string.IsNullOrWhiteSpace(x.Title))
            .GroupBy(x => x.TmdbId)
            .Select(g => g.First())
            .ToList();
        await SaveSettingAsync(NextEpisodesFollowedExternalKey, JsonSerializer.Serialize(clean), cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>Creates <c>LibraryFolders</c> table if missing and migrates legacy JSON <c>LibraryPaths</c> setting once.</summary>
    public async Task EnsureLibraryFoldersTableAsync(CancellationToken cancellationToken = default)
    {
        await _db.Database.ExecuteSqlRawAsync(
                """
                CREATE TABLE IF NOT EXISTS "LibraryFolders" (
                    "Id" INTEGER NOT NULL CONSTRAINT "PK_LibraryFolders" PRIMARY KEY AUTOINCREMENT,
                    "Path" TEXT NOT NULL,
                    "IsActive" INTEGER NOT NULL DEFAULT 1
                );
                CREATE UNIQUE INDEX IF NOT EXISTS "IX_LibraryFolders_Path" ON "LibraryFolders" ("Path");
                """,
                cancellationToken)
            .ConfigureAwait(false);

        if (await _db.LibraryFolders.AnyAsync(cancellationToken).ConfigureAwait(false))
            return;

        var json = await GetSettingAsync("LibraryPaths", cancellationToken).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(json))
            return;

        try
        {
            var list = JsonSerializer.Deserialize<List<string>>(json);
            if (list == null)
                return;
            foreach (var p in list)
            {
                var t = p?.Trim();
                if (string.IsNullOrEmpty(t))
                    continue;
                if (await _db.LibraryFolders.AnyAsync(
                        x => x.Path.ToLower() == t.ToLower(), cancellationToken)
                    .ConfigureAwait(false))
                    continue;
                _db.LibraryFolders.Add(new LibraryFolder { Path = t, IsActive = true });
            }

            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            // ignore corrupt legacy JSON
        }
    }

    public async Task<List<string>> GetAllLibraryPathsAsync(CancellationToken cancellationToken = default)
    {
        return await _db.LibraryFolders.AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.Id)
            .Select(x => x.Path)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task SaveLibraryPathAsync(string path, CancellationToken cancellationToken = default)
    {
        var t = MediaPathNormalizer.PreferredPhysicalPath(path ?? "");
        if (string.IsNullOrEmpty(t))
            return;

        var existing = await _db.LibraryFolders
            .FirstOrDefaultAsync(x => x.Path.ToLower() == t.ToLower(), cancellationToken)
            .ConfigureAwait(false);
        if (existing != null)
        {
            if (!existing.IsActive)
            {
                existing.IsActive = true;
                await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            }

            return;
        }

        _db.LibraryFolders.Add(new LibraryFolder { Path = t, IsActive = true });
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Counts removed by <see cref="ClearIndexedMediaUnderLibraryRootAsync"/> (optional maintenance only).</summary>
    public sealed record LibraryFolderRemovalCounts(int ShowsRemoved, int MoviesRemoved, int ScanLogsRemoved,
        int WatchHistoryRemoved);

    /// <summary>Removes a folder from the configured scan list only. Movies, series, and watch history are unchanged.</summary>
    public async Task RemoveLibraryPathAsync(string path, CancellationToken cancellationToken = default)
    {
        var t = MediaPathNormalizer.PreferredPhysicalPath(path ?? "");
        if (string.IsNullOrEmpty(t))
            return;

        var row = await _db.LibraryFolders
            .FirstOrDefaultAsync(x => x.Path.ToLower() == t.ToLower(), cancellationToken)
            .ConfigureAwait(false);
        if (row == null)
            return;

        _db.LibraryFolders.Remove(row);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Optional maintenance: deletes indexed shows, movies, scan logs, and watch-history rows whose paths fall under
    /// <paramref name="path"/>. Does not change library folder settings. Call only after explicit user confirmation.
    /// </summary>
    public async Task<LibraryFolderRemovalCounts> ClearIndexedMediaUnderLibraryRootAsync(string path,
        CancellationToken cancellationToken = default)
    {
        var normalizedRoot = MediaPathNormalizer.PreferredPhysicalPath(path ?? "");
        if (string.IsNullOrEmpty(normalizedRoot))
            return new LibraryFolderRemovalCounts(0, 0, 0, 0);

        return await ClearIndexedMediaUnderLibraryRootCoreAsync(normalizedRoot, cancellationToken).ConfigureAwait(false);
    }

    private async Task<LibraryFolderRemovalCounts> ClearIndexedMediaUnderLibraryRootCoreAsync(string normalizedRoot,
        CancellationToken cancellationToken = default)
    {
        var showsRemoved = 0;
        var moviesRemoved = 0;

        var showRows = await _db.Shows.AsNoTracking()
            .Where(s => s.FolderPath != "")
            .Select(s => new { s.Id, s.FolderPath })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        foreach (var s in showRows.Where(x =>
                     LibraryPathHelper.MediaPathIsUnderLibraryRoot(normalizedRoot, x.FolderPath)))
        {
            if (await DeleteShowByIdAsync(s.Id, cancellationToken).ConfigureAwait(false))
                showsRemoved++;
        }

        var movieRows = await _db.Movies.AsNoTracking()
            .Where(m => m.FilePath != "")
            .Select(m => new { m.Id, m.FilePath })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        foreach (var m in movieRows.Where(x =>
                     LibraryPathHelper.MediaPathIsUnderLibraryRoot(normalizedRoot, x.FilePath)))
        {
            if (await DeleteMovieByIdAsync(m.Id, cancellationToken).ConfigureAwait(false))
                moviesRemoved++;
        }

        var scanRows = await _db.ScanLogs.AsNoTracking()
            .Select(l => new { l.Id, l.FilePath })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var scanIds = scanRows
            .Where(x => LibraryPathHelper.MediaPathIsUnderLibraryRoot(normalizedRoot, x.FilePath))
            .Select(x => x.Id)
            .ToList();

        var scanRemoved = 0;
        if (scanIds.Count > 0)
        {
            scanRemoved = await _db.ScanLogs.Where(l => scanIds.Contains(l.Id))
                .ExecuteDeleteAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        var whRows = await _db.WatchHistories.AsNoTracking()
            .Select(w => new { w.Id, w.FilePath })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var whIds = whRows
            .Where(x => LibraryPathHelper.MediaPathIsUnderLibraryRoot(normalizedRoot, x.FilePath))
            .Select(x => x.Id)
            .ToList();

        var whRemoved = 0;
        if (whIds.Count > 0)
        {
            whRemoved = await _db.WatchHistories.Where(w => whIds.Contains(w.Id))
                .ExecuteDeleteAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        return new LibraryFolderRemovalCounts(showsRemoved, moviesRemoved, scanRemoved, whRemoved);
    }

    public async Task<IReadOnlyList<string>> GetPinnedScanPathsAsync(CancellationToken cancellationToken = default)
    {
        var raw = await GetSettingAsync("PinnedScanPaths", cancellationToken).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(raw))
            return Array.Empty<string>();
        try
        {
            var list = JsonSerializer.Deserialize<List<string>>(raw);
            if (list == null)
                return Array.Empty<string>();
            return list
                .Select(p => p?.Trim() ?? "")
                .Where(p => p.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    public async Task AddPinnedScanPathAsync(string path, CancellationToken cancellationToken = default)
    {
        var t = MediaPathNormalizer.PreferredPhysicalPath(path ?? "");
        if (string.IsNullOrEmpty(t))
            return;

        var cur = (await GetPinnedScanPathsAsync(cancellationToken).ConfigureAwait(false)).ToList();
        if (cur.Contains(t, StringComparer.OrdinalIgnoreCase))
            return;

        cur.Add(t);
        await SaveSettingAsync("PinnedScanPaths", JsonSerializer.Serialize(cur), cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task RemovePinnedScanPathAsync(string path, CancellationToken cancellationToken = default)
    {
        var t = MediaPathNormalizer.PreferredPhysicalPath(path ?? "");
        if (string.IsNullOrEmpty(t))
            return;

        var cur = (await GetPinnedScanPathsAsync(cancellationToken).ConfigureAwait(false))
            .Where(p => !string.Equals(p, t, StringComparison.OrdinalIgnoreCase))
            .ToList();

        await SaveSettingAsync("PinnedScanPaths", JsonSerializer.Serialize(cur), cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<string>> GetExcludedScanPathsAsync(CancellationToken cancellationToken = default)
    {
        var raw = await GetSettingAsync("ExcludedScanPaths", cancellationToken).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(raw))
            return Array.Empty<string>();
        try
        {
            var list = JsonSerializer.Deserialize<List<string>>(raw);
            if (list == null)
                return Array.Empty<string>();
            return list
                .Select(p => p?.Trim() ?? "")
                .Where(p => p.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    public async Task AddExcludedScanPathAsync(string path, CancellationToken cancellationToken = default)
    {
        var t = MediaPathNormalizer.PreferredPhysicalPath(path ?? "");
        if (string.IsNullOrEmpty(t))
            return;

        var cur = (await GetExcludedScanPathsAsync(cancellationToken).ConfigureAwait(false)).ToList();
        if (cur.Contains(t, StringComparer.OrdinalIgnoreCase))
            return;

        cur.Add(t);
        await SaveSettingAsync("ExcludedScanPaths", JsonSerializer.Serialize(cur), cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task RemoveExcludedScanPathAsync(string path, CancellationToken cancellationToken = default)
    {
        var t = MediaPathNormalizer.PreferredPhysicalPath(path ?? "");
        if (string.IsNullOrEmpty(t))
            return;

        var cur = (await GetExcludedScanPathsAsync(cancellationToken).ConfigureAwait(false))
            .Where(p => !string.Equals(p, t, StringComparison.OrdinalIgnoreCase))
            .ToList();

        await SaveSettingAsync("ExcludedScanPaths", JsonSerializer.Serialize(cur), cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<(int ArabicShows, int NonArabicShows, int ArabicMovies, int NonArabicMovies)>
        GetLanguageClassificationCountsAsync(CancellationToken cancellationToken = default)
    {
        var arS = await _db.Shows.CountAsync(s => s.IsArabic, cancellationToken).ConfigureAwait(false);
        var otherS = await _db.Shows.CountAsync(s => !s.IsArabic, cancellationToken).ConfigureAwait(false);
        var arM = await _db.Movies.CountAsync(m => m.IsArabic, cancellationToken).ConfigureAwait(false);
        var otherM = await _db.Movies.CountAsync(m => !m.IsArabic, cancellationToken).ConfigureAwait(false);
        return (arS, otherS, arM, otherM);
    }

    /// <summary>Recompute <see cref="Show.IsArabic"/> / <see cref="Movie.IsArabic"/> from TMDB details for all rows with <c>TmdbId</c>.</summary>
    public async Task<(int ShowsChanged, int MoviesChanged)> MigrateIsArabicFromTmdbOriginalLanguageAsync(
        TmdbClient tmdb, CancellationToken cancellationToken = default)
    {
        var showsChanged = 0;
        var moviesChanged = 0;

        var shows = await _db.Shows.Where(s => s.TmdbId > 0).ToListAsync(cancellationToken).ConfigureAwait(false);
        foreach (var s in shows)
        {
            try
            {
                var details = await tmdb.GetDetailsAsync(s.TmdbId, "Series", cancellationToken).ConfigureAwait(false);
                var computed = MediaLanguageHelper.ComputeIsArabic(details.OriginalLanguage, s.FolderPath ?? "");
                if (computed != s.IsArabic)
                {
                    s.IsArabic = computed;
                    showsChanged++;
                }
            }
            catch
            {
                // skip titles that fail TMDB (offline, deleted id, etc.)
            }
        }

        var movies = await _db.Movies.Where(m => m.TmdbId > 0).ToListAsync(cancellationToken).ConfigureAwait(false);
        foreach (var m in movies)
        {
            try
            {
                var details = await tmdb.GetDetailsAsync(m.TmdbId, "Movie", cancellationToken).ConfigureAwait(false);
                var computed = MediaLanguageHelper.ComputeIsArabic(details.OriginalLanguage, m.FilePath ?? "");
                if (computed != m.IsArabic)
                {
                    m.IsArabic = computed;
                    moviesChanged++;
                }
            }
            catch
            {
            }
        }

        if (showsChanged > 0 || moviesChanged > 0)
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        return (showsChanged, moviesChanged);
    }

    public async Task<IReadOnlyList<CastMember>> GetCastMembersAsync(int mediaTmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        return await _db.CastMembers.AsNoTracking()
            .Where(c => c.MediaId == mediaTmdbId && c.MediaType == mediaType)
            .OrderBy(c => c.BillingOrder)
            .ThenBy(c => c.Name)
            .Take(10)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Replaces cast rows from TMDB <c>/credits</c> only (top-billed + portrait cache).</summary>
    public async Task<(bool Ok, string? Error)> RefreshMovieCastFromTmdbAsync(int movieLibraryId, TmdbClient tmdb,
        CancellationToken cancellationToken = default)
    {
        var m = await _db.Movies.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == movieLibraryId, cancellationToken).ConfigureAwait(false);
        if (m == null)
            return (false, "Movie not found.");
        if (m.TmdbId <= 0)
            return (false, "No TMDB id for this title.");
        var (ok, err, _, _) =
            await ReplaceCastMembersFromTmdbCreditsCoreAsync(m.TmdbId, "Movie", tmdb, cancellationToken)
                .ConfigureAwait(false);
        return (ok, err);
    }

    /// <summary>Replaces cast rows from TMDB <c>/credits</c> only (top-billed + portrait cache).</summary>
    public async Task<(bool Ok, string? Error)> RefreshShowCastFromTmdbAsync(int showLibraryId, TmdbClient tmdb,
        CancellationToken cancellationToken = default)
    {
        var s = await _db.Shows.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == showLibraryId, cancellationToken).ConfigureAwait(false);
        if (s == null)
            return (false, "Series not found.");
        if (s.TmdbId <= 0)
            return (false, "No TMDB id for this title.");
        var (ok, err, _, _) =
            await ReplaceCastMembersFromTmdbCreditsCoreAsync(s.TmdbId, "Series", tmdb, cancellationToken)
                .ConfigureAwait(false);
        return (ok, err);
    }

    /// <summary>
    /// Batch backfill: walks matched movies then series by library id (exclusive cursors), up to <paramref name="limit"/> titles.
    /// </summary>
    public async Task<CastMetadataBackfillBatchResult> BackfillCastMetadataBatchAsync(TmdbClient tmdb, int limit,
        int afterMovieLibraryIdExclusive, int afterShowLibraryIdExclusive,
        CancellationToken cancellationToken = default)
    {
        limit = Math.Clamp(limit, 1, 100);
        var moviesProcessed = 0;
        var showsProcessed = 0;
        var rowsWritten = 0;
        var missingProfile = 0;
        var failed = 0;
        var lastMovie = afterMovieLibraryIdExclusive;
        var lastShow = afterShowLibraryIdExclusive;

        var movieBatch = await _db.Movies.AsNoTracking()
            .Where(m => m.TmdbId > 0 && m.Id > afterMovieLibraryIdExclusive)
            .OrderBy(m => m.Id)
            .Take(limit)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        foreach (var m in movieBatch)
        {
            var (ok, err, rows, miss) =
                await ReplaceCastMembersFromTmdbCreditsCoreAsync(m.TmdbId, "Movie", tmdb, cancellationToken)
                    .ConfigureAwait(false);
            lastMovie = m.Id;
            if (!ok)
            {
                failed++;
                continue;
            }

            moviesProcessed++;
            rowsWritten += rows;
            missingProfile += miss;
        }

        var remaining = limit - movieBatch.Count;
        if (remaining > 0)
        {
            var showBatch = await _db.Shows.AsNoTracking()
                .Where(s => s.TmdbId > 0 && s.Id > afterShowLibraryIdExclusive)
                .OrderBy(s => s.Id)
                .Take(remaining)
                .ToListAsync(cancellationToken).ConfigureAwait(false);
            foreach (var s in showBatch)
            {
                var (ok, err, rows, miss) =
                    await ReplaceCastMembersFromTmdbCreditsCoreAsync(s.TmdbId, "Series", tmdb, cancellationToken)
                        .ConfigureAwait(false);
                lastShow = s.Id;
                if (!ok)
                {
                    failed++;
                    continue;
                }

                showsProcessed++;
                rowsWritten += rows;
                missingProfile += miss;
            }
        }

        var moreMovies = await _db.Movies.AsNoTracking()
            .AnyAsync(m => m.TmdbId > 0 && m.Id > lastMovie, cancellationToken).ConfigureAwait(false);
        var moreShows = await _db.Shows.AsNoTracking()
            .AnyAsync(s => s.TmdbId > 0 && s.Id > lastShow, cancellationToken).ConfigureAwait(false);
        var hasMore = moreMovies || moreShows;

        return new CastMetadataBackfillBatchResult(moviesProcessed, showsProcessed, rowsWritten, missingProfile,
            failed, lastMovie, lastShow, hasMore);
    }

    private async Task<(bool Ok, string? Error, int Rows, int MissingProfile)> ReplaceCastMembersFromTmdbCreditsCoreAsync(
        int mediaTmdbId, string mediaType, TmdbClient tmdb, CancellationToken cancellationToken)
    {
        var cast = await tmdb.TryFetchTopCastWithPortraitCachesAsync(mediaTmdbId, mediaType, cancellationToken)
            .ConfigureAwait(false);
        if (cast == null)
            return (false, "TMDB credits could not be loaded.", 0, 0);

        var missing = cast.Count(static c => string.IsNullOrWhiteSpace(c.ProfilePath));
        var rows = cast.Select(c => new CastMember
        {
            PersonTmdbId = c.Id,
            MediaId = mediaTmdbId,
            MediaType = mediaType,
            Name = c.Name,
            Character = c.Character,
            ProfilePath = string.IsNullOrWhiteSpace(c.ProfilePath) ? null : c.ProfilePath.Trim(),
            BillingOrder = c.BillingOrder,
            ProfileLocalPath = c.ProfileLocalPath
        }).ToList();

        await ReplaceCastMembersAsync(mediaTmdbId, mediaType, rows, cancellationToken).ConfigureAwait(false);
        return (true, null, rows.Count, missing);
    }

    public async Task EnsureCastMemberPersonTmdbIdColumnAsync(CancellationToken cancellationToken = default)
    {
        if (await SqliteColumnExistsAsync("CastMembers", "PersonTmdbId", cancellationToken).ConfigureAwait(false))
            return;
        await _db.Database
            .ExecuteSqlRawAsync(
                "ALTER TABLE CastMembers ADD COLUMN PersonTmdbId INTEGER NOT NULL DEFAULT 0",
                cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task EnsureCastMemberProfilePathAndBillingOrderColumnsAsync(
        CancellationToken cancellationToken = default)
    {
        if (!await SqliteColumnExistsAsync("CastMembers", "ProfilePath", cancellationToken).ConfigureAwait(false))
        {
            await _db.Database
                .ExecuteSqlRawAsync("ALTER TABLE CastMembers ADD COLUMN ProfilePath TEXT NULL", cancellationToken)
                .ConfigureAwait(false);
        }

        if (!await SqliteColumnExistsAsync("CastMembers", "BillingOrder", cancellationToken).ConfigureAwait(false))
        {
            await _db.Database
                .ExecuteSqlRawAsync(
                    "ALTER TABLE CastMembers ADD COLUMN BillingOrder INTEGER NOT NULL DEFAULT 0",
                    cancellationToken)
                .ConfigureAwait(false);
        }
    }

    /// <summary>SQLite: skip <c>ALTER TABLE … ADD COLUMN</c> when the column already exists (avoids EF error logs).</summary>
    private async Task<bool> SqliteColumnExistsAsync(string table, string column,
        CancellationToken cancellationToken = default)
    {
        var conn = _db.Database.GetDbConnection();
        var shouldClose = conn.State != ConnectionState.Open;
        if (shouldClose)
            await conn.OpenAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"PRAGMA table_info(\"{table}\")";
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var name = reader.GetString(1);
                if (string.Equals(name, column, StringComparison.OrdinalIgnoreCase))
                    return true;
            }

            return false;
        }
        finally
        {
            if (shouldClose)
                await conn.CloseAsync().ConfigureAwait(false);
        }
    }

    /// <summary>Library movies/shows this person appears in (from cast table; requires rescan after PersonTmdbId migration).</summary>
    public async Task<IReadOnlyList<LocalSimilarRow>> GetLibraryMediaForPersonAsync(int personTmdbId,
        CancellationToken cancellationToken = default)
    {
        if (personTmdbId <= 0)
            return Array.Empty<LocalSimilarRow>();

        var rows = await _db.CastMembers.AsNoTracking()
            .Where(c => c.PersonTmdbId == personTmdbId)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var keys = rows
            .Select(r => (r.MediaId, r.MediaType))
            .Distinct()
            .ToList();

        if (keys.Count == 0)
            return Array.Empty<LocalSimilarRow>();

        var shows = await _db.Shows.AsNoTracking().ToListAsync(cancellationToken).ConfigureAwait(false);
        var movies = await _db.Movies.AsNoTracking().ToListAsync(cancellationToken).ConfigureAwait(false);
        var list = new List<LocalSimilarRow>();

        foreach (var (mediaId, mediaType) in keys)
        {
            if (string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase))
            {
                var s = shows.FirstOrDefault(x => x.TmdbId == mediaId);
                if (s != null)
                {
                    list.Add(new LocalSimilarRow
                    {
                        MediaKind = "Series",
                        DatabaseId = s.Id,
                        TmdbId = s.TmdbId,
                        Title = s.Title,
                        Year = s.Year,
                        PosterLocalPath = s.PosterLocalPath
                    });
                }
            }
            else
            {
                var m = movies.FirstOrDefault(x => x.TmdbId == mediaId);
                if (m != null)
                {
                    list.Add(new LocalSimilarRow
                    {
                        MediaKind = "Movie",
                        DatabaseId = m.Id,
                        TmdbId = m.TmdbId,
                        Title = m.Title,
                        Year = m.Year,
                        PosterLocalPath = m.PosterLocalPath
                    });
                }
            }
        }

        return list.OrderBy(x => x.Title, StringComparer.OrdinalIgnoreCase).ToList();
    }

    public async Task ReplaceCastMembersAsync(int mediaTmdbId, string mediaType, IEnumerable<CastMember> members,
        CancellationToken cancellationToken = default)
    {
        await _db.CastMembers.Where(c => c.MediaId == mediaTmdbId && c.MediaType == mediaType)
            .ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);

        foreach (var m in members)
            _db.CastMembers.Add(m);

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Titles in the same language bucket (<paramref name="isArabic"/>) as the current title; when <paramref name="genresCsv"/> has tokens, require at least one overlapping genre. Used for "Surprise me".
    /// </summary>
    public async Task<IReadOnlyList<LocalSimilarRow>> FindSurpriseCandidatesAsync(string? genresCsv, bool isArabic,
        int? excludeShowDatabaseId = null,
        int? excludeMovieDatabaseId = null,
        int? excludeShowTmdbId = null,
        int? excludeMovieTmdbId = null,
        CancellationToken cancellationToken = default)
    {
        var tokens = SplitGenreTokens(genresCsv);
        var requireGenreOverlap = tokens.Count > 0;

        var shows = await _db.Shows.AsNoTracking()
            .Where(s => s.IsArabic == isArabic)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var movies = await _db.Movies.AsNoTracking()
            .Where(m => m.IsArabic == isArabic)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var list = new List<LocalSimilarRow>();

        foreach (var s in shows)
        {
            if (excludeShowDatabaseId is > 0 && s.Id == excludeShowDatabaseId)
                continue;
            if (excludeShowTmdbId is > 0 && s.TmdbId == excludeShowTmdbId)
                continue;
            if (requireGenreOverlap && GenreOverlapScore(s.Genres, tokens) <= 0)
                continue;
            list.Add(new LocalSimilarRow
            {
                MediaKind = "Series",
                DatabaseId = s.Id,
                TmdbId = s.TmdbId,
                Title = s.Title,
                Year = s.Year,
                PosterLocalPath = s.PosterLocalPath
            });
        }

        foreach (var m in movies)
        {
            if (excludeMovieDatabaseId is > 0 && m.Id == excludeMovieDatabaseId)
                continue;
            if (excludeMovieTmdbId is > 0 && m.TmdbId == excludeMovieTmdbId)
                continue;
            if (requireGenreOverlap && GenreOverlapScore(m.Genres, tokens) <= 0)
                continue;
            list.Add(new LocalSimilarRow
            {
                MediaKind = "Movie",
                DatabaseId = m.Id,
                TmdbId = m.TmdbId,
                Title = m.Title,
                Year = m.Year,
                PosterLocalPath = m.PosterLocalPath
            });
        }

        return list;
    }

    /// <summary>Other library titles sharing at least one genre. Exclude current show/movie by DB id and/or TMDB id.</summary>
    public async Task<IReadOnlyList<LocalSimilarRow>> FindLocalSimilarByGenresAsync(string? genresCsv,
        int maxResults,
        int? excludeShowDatabaseId = null,
        int? excludeMovieDatabaseId = null,
        int? excludeShowTmdbId = null,
        int? excludeMovieTmdbId = null,
        CancellationToken cancellationToken = default)
    {
        var tokens = SplitGenreTokens(genresCsv);
        if (tokens.Count == 0)
            return Array.Empty<LocalSimilarRow>();

        var shows = await _db.Shows.AsNoTracking().ToListAsync(cancellationToken).ConfigureAwait(false);
        var movies = await _db.Movies.AsNoTracking().ToListAsync(cancellationToken).ConfigureAwait(false);

        var scored = new List<(int Score, LocalSimilarRow Row)>();

        foreach (var s in shows)
        {
            if (excludeShowDatabaseId is > 0 && s.Id == excludeShowDatabaseId)
                continue;
            if (excludeShowTmdbId is > 0 && s.TmdbId == excludeShowTmdbId)
                continue;
            var score = GenreOverlapScore(s.Genres, tokens);
            if (score <= 0)
                continue;
            scored.Add((score, new LocalSimilarRow
            {
                MediaKind = "Series",
                DatabaseId = s.Id,
                TmdbId = s.TmdbId,
                Title = s.Title,
                Year = s.Year,
                PosterLocalPath = s.PosterLocalPath
            }));
        }

        foreach (var m in movies)
        {
            if (excludeMovieDatabaseId is > 0 && m.Id == excludeMovieDatabaseId)
                continue;
            if (excludeMovieTmdbId is > 0 && m.TmdbId == excludeMovieTmdbId)
                continue;
            var score = GenreOverlapScore(m.Genres, tokens);
            if (score <= 0)
                continue;
            scored.Add((score, new LocalSimilarRow
            {
                MediaKind = "Movie",
                DatabaseId = m.Id,
                TmdbId = m.TmdbId,
                Title = m.Title,
                Year = m.Year,
                PosterLocalPath = m.PosterLocalPath
            }));
        }

        return scored
            .OrderByDescending(x => x.Score)
            .ThenBy(x => x.Row.Title, StringComparer.OrdinalIgnoreCase)
            .Take(maxResults)
            .Select(x => x.Row)
            .ToList();
    }

    public async Task EnsureUserListTablesAndSeedAsync(CancellationToken cancellationToken = default)
    {
        await _db.Database.ExecuteSqlRawAsync(
                """
                CREATE TABLE IF NOT EXISTS "UserLists" (
                    "Id" INTEGER NOT NULL CONSTRAINT "PK_UserLists" PRIMARY KEY AUTOINCREMENT,
                    "Name" TEXT NOT NULL,
                    "CreatedAt" TEXT NOT NULL,
                    "IsDefault" INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS "ListItems" (
                    "Id" INTEGER NOT NULL CONSTRAINT "PK_ListItems" PRIMARY KEY AUTOINCREMENT,
                    "ListId" INTEGER NOT NULL,
                    "TmdbId" INTEGER NOT NULL,
                    "MediaType" TEXT NOT NULL,
                    "AddedAt" TEXT NOT NULL,
                    CONSTRAINT "FK_ListItems_UserLists_ListId" FOREIGN KEY ("ListId") REFERENCES "UserLists" ("Id") ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS "IX_ListItems_ListId" ON "ListItems" ("ListId");
                CREATE UNIQUE INDEX IF NOT EXISTS "IX_ListItems_ListId_TmdbId_MediaType" ON "ListItems" ("ListId", "TmdbId", "MediaType");
                """,
                cancellationToken)
            .ConfigureAwait(false);

        if (!await _db.UserLists.AnyAsync(cancellationToken).ConfigureAwait(false))
        {
            _db.UserLists.Add(new UserList
            {
                Name = BuiltinLists.FavoritesName,
                CreatedAt = DateTime.UtcNow,
                IsDefault = true
            });
            _db.UserLists.Add(new UserList
            {
                Name = BuiltinLists.WatchLaterName,
                CreatedAt = DateTime.UtcNow,
                IsDefault = true
            });
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    public async Task<IReadOnlyList<UserList>> GetUserListsOrderedAsync(CancellationToken cancellationToken = default)
    {
        var lists = await _db.UserLists.AsNoTracking()
            .OrderByDescending(l => l.IsDefault)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        return lists
            .OrderByDescending(l => l.IsDefault)
            .ThenBy(l => l.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<IReadOnlyList<UserListSummaryRow>> GetUserListSummaryRowsAsync(
        CancellationToken cancellationToken = default)
    {
        var rows = await _db.UserLists.AsNoTracking()
            .OrderByDescending(l => l.IsDefault)
            .ThenBy(l => l.Name)
            .Select(l => new UserListSummaryRow(
                l.Id,
                l.Name,
                l.CreatedAt,
                l.IsDefault,
                _db.ListItems.Count(i => i.ListId == l.Id)))
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        return rows;
    }

    public async Task<UserList?> GetUserListByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        return await _db.UserLists.AsNoTracking().FirstOrDefaultAsync(l => l.Id == id, cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<int?> GetUserListIdByExactNameAsync(string name, CancellationToken cancellationToken = default)
    {
        var l = await _db.UserLists.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Name == name, cancellationToken).ConfigureAwait(false);
        return l?.Id;
    }

    public async Task<bool> IsInListAsync(int listId, int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        return await _db.ListItems.AsNoTracking().AnyAsync(
            x => x.ListId == listId && x.TmdbId == tmdbId && x.MediaType == mediaType, cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// When watch history has no poster (e.g. episode play), resolve the library show/movie poster from the file path.
    /// </summary>
    public async Task<string?> TryResolvePosterPathForPlayedFileAsync(string filePath, string? mediaType,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(filePath))
            return null;

        var fp = filePath.Trim();
        static IEnumerable<string> Variants(string p)
        {
            yield return p;
            var a = p.Replace('\\', '/');
            if (!string.Equals(a, p, StringComparison.Ordinal)) yield return a;
            var b = p.Replace('/', '\\');
            if (!string.Equals(b, p, StringComparison.Ordinal)) yield return b;
        }

        if (string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var v in Variants(fp).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var vLower = v.ToLowerInvariant();
                string? poster = await (
                        from e in _db.Episodes.AsNoTracking()
                        join s in _db.Shows.AsNoTracking() on e.ShowId equals s.Id
                        where e.FilePath == v
                        select s.SelectedPosterPath ?? s.PosterLocalPath
                    ).FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);

                if (!string.IsNullOrEmpty(poster))
                    return poster;

                poster = await (
                        from e in _db.Episodes.AsNoTracking()
                        join s in _db.Shows.AsNoTracking() on e.ShowId equals s.Id
                        where e.FilePath.ToLower() == vLower
                        select s.SelectedPosterPath ?? s.PosterLocalPath
                    ).FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);

                if (!string.IsNullOrEmpty(poster))
                    return poster;
            }
        }
        else if (string.Equals(mediaType, "Movie", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var v in Variants(fp).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var vLower = v.ToLowerInvariant();
                var poster = await _db.Movies.AsNoTracking()
                    .Where(m => m.FilePath == v)
                    .Select(m => m.SelectedPosterPath ?? m.PosterLocalPath)
                    .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
                if (!string.IsNullOrEmpty(poster))
                    return poster;

                poster = await _db.Movies.AsNoTracking()
                    .Where(m => m.FilePath.ToLower() == vLower)
                    .Select(m => m.SelectedPosterPath ?? m.PosterLocalPath)
                    .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
                if (!string.IsNullOrEmpty(poster))
                    return poster;
            }
        }

        // Last resort: history path may differ from DB (drive letter, prefix); match by file name tail.
        var fileName = Path.GetFileName(fp.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        if (!string.IsNullOrEmpty(fileName))
        {
            var fl = fileName.ToLowerInvariant();
            if (!string.Equals(mediaType, "Movie", StringComparison.OrdinalIgnoreCase))
            {
                var poster = await (
                    from e in _db.Episodes.AsNoTracking()
                    join s in _db.Shows.AsNoTracking() on e.ShowId equals s.Id
                    where e.FilePath.ToLower().EndsWith(fl)
                    select s.SelectedPosterPath ?? s.PosterLocalPath
                ).FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
                if (!string.IsNullOrEmpty(poster))
                    return poster;
            }

            if (!string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase))
            {
                var poster = await _db.Movies.AsNoTracking()
                    .Where(m => m.FilePath.ToLower().EndsWith(fl))
                    .Select(m => m.SelectedPosterPath ?? m.PosterLocalPath)
                    .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
                if (!string.IsNullOrEmpty(poster))
                    return poster;
            }
        }

        return null;
    }

    public async Task<int?> TryGetTmdbIdFromPlayedFilePathAsync(string filePath, string? mediaType,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(filePath))
            return null;

        var fp = filePath.Trim();
        static IEnumerable<string> Variants(string p)
        {
            yield return p;
            var a = p.Replace('\\', '/');
            if (!string.Equals(a, p, StringComparison.Ordinal)) yield return a;
            var b = p.Replace('/', '\\');
            if (!string.Equals(b, p, StringComparison.Ordinal)) yield return b;
        }

        if (string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var v in Variants(fp).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var vLower = v.ToLowerInvariant();
                var id = await (
                    from e in _db.Episodes.AsNoTracking()
                    join s in _db.Shows.AsNoTracking() on e.ShowId equals s.Id
                    where e.FilePath == v && s.TmdbId > 0
                    select s.TmdbId
                ).FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
                if (id > 0)
                    return id;

                id = await (
                    from e in _db.Episodes.AsNoTracking()
                    join s in _db.Shows.AsNoTracking() on e.ShowId equals s.Id
                    where e.FilePath.ToLower() == vLower && s.TmdbId > 0
                    select s.TmdbId
                ).FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
                if (id > 0)
                    return id;
            }
        }
        else if (string.Equals(mediaType, "Movie", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var v in Variants(fp).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var vLower = v.ToLowerInvariant();
                var id = await _db.Movies.AsNoTracking()
                    .Where(m => m.FilePath == v && m.TmdbId > 0)
                    .Select(m => m.TmdbId)
                    .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
                if (id > 0)
                    return id;

                id = await _db.Movies.AsNoTracking()
                    .Where(m => m.FilePath.ToLower() == vLower && m.TmdbId > 0)
                    .Select(m => m.TmdbId)
                    .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
                if (id > 0)
                    return id;
            }
        }

        var fileName = Path.GetFileName(fp.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        if (!string.IsNullOrEmpty(fileName))
        {
            var fl = fileName.ToLowerInvariant();
            if (!string.Equals(mediaType, "Movie", StringComparison.OrdinalIgnoreCase))
            {
                var id = await (
                    from e in _db.Episodes.AsNoTracking()
                    join s in _db.Shows.AsNoTracking() on e.ShowId equals s.Id
                    where e.FilePath.ToLower().EndsWith(fl) && s.TmdbId > 0
                    select s.TmdbId
                ).FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
                if (id > 0)
                    return id;
            }

            if (!string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase))
            {
                var id = await _db.Movies.AsNoTracking()
                    .Where(m => m.FilePath.ToLower().EndsWith(fl) && m.TmdbId > 0)
                    .Select(m => m.TmdbId)
                    .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
                if (id > 0)
                    return id;
            }
        }

        return null;
    }

    public async Task<int?> TryGetTmdbIdForHistoryPlaybackAsync(string filePath, string? mediaType, string? title,
        CancellationToken cancellationToken = default)
    {
        var id = await TryGetTmdbIdFromPlayedFilePathAsync(filePath, mediaType, cancellationToken)
            .ConfigureAwait(false);
        if (id.HasValue && id.Value > 0)
            return id;

        var altType = string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase)
            ? "Movie"
            : "Series";
        id = await TryGetTmdbIdFromPlayedFilePathAsync(filePath, altType, cancellationToken)
            .ConfigureAwait(false);
        if (id.HasValue && id.Value > 0)
            return id;

        id = await TryGetTmdbIdFromHistoryTitleAsync(title, mediaType, cancellationToken).ConfigureAwait(false);
        if (id.HasValue && id.Value > 0)
            return id;

        id = await TryGetTmdbIdFromHistoryTitleAsync(title, altType, cancellationToken).ConfigureAwait(false);
        return id.HasValue && id.Value > 0 ? id : null;
    }

    public async Task<int?> TryGetTmdbIdFromHistoryTitleAsync(string? title, string? mediaType,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(title))
            return null;

        var t = title.Trim();
        var mt = mediaType?.Trim() ?? "";

        if (string.Equals(mt, "Movie", StringComparison.OrdinalIgnoreCase))
            return await FindMovieTmdbIdByTitleAsync(t, cancellationToken).ConfigureAwait(false);

        string? showName = null;

        var m = HistoryTitleSeasonEpisode.Match(t);
        if (m.Success)
            showName = m.Groups[1].Value.Trim();

        if (string.IsNullOrWhiteSpace(showName))
        {
            m = HistoryTitleEpisodeWord.Match(t);
            if (m.Success)
                showName = m.Groups[1].Value.Trim();
        }

        if (!string.IsNullOrWhiteSpace(showName))
        {
            var sid = await FindShowTmdbIdByTitleAsync(showName, cancellationToken).ConfigureAwait(false);
            if (sid.HasValue && sid.Value > 0)
                return sid;
        }

        if (string.IsNullOrWhiteSpace(mt))
            return await FindMovieTmdbIdByTitleAsync(t, cancellationToken).ConfigureAwait(false);

        return null;
    }

    private async Task<int?> FindShowTmdbIdByTitleAsync(string showName,
        CancellationToken cancellationToken = default)
    {
        var q = _db.Shows.AsNoTracking().Where(s => s.IsMatched && s.TmdbId > 0);

        var id = await q.Where(s => s.Title == showName)
            .Select(s => s.TmdbId)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (id > 0)
            return id;

        var nl = showName.ToLowerInvariant();
        id = await q.Where(s => s.Title.ToLower() == nl)
            .Select(s => s.TmdbId)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (id > 0)
            return id;

        var prefix = showName + " (";
        id = await q.Where(s => s.Title.StartsWith(prefix))
            .OrderBy(s => s.Title.Length)
            .Select(s => s.TmdbId)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (id > 0)
            return id;

        var pll = prefix.ToLowerInvariant();
        id = await q.Where(s => s.Title.ToLower().StartsWith(pll))
            .OrderBy(s => s.Title.Length)
            .Select(s => s.TmdbId)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        return id > 0 ? id : null;
    }

    private async Task<int?> FindMovieTmdbIdByTitleAsync(string movieTitle,
        CancellationToken cancellationToken = default)
    {
        var id = await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.TmdbId > 0 && m.Title == movieTitle)
            .Select(m => m.TmdbId)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (id > 0)
            return id;

        var nl = movieTitle.ToLowerInvariant();
        id = await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.TmdbId > 0 && m.Title.ToLower() == nl)
            .Select(m => m.TmdbId)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        return id > 0 ? id : null;
    }

    private static readonly Regex HistoryTitleSeasonEpisode = new(
        @"^(.+?)\s*(?:[·•\u00B7\u2022]|\s*\u2014\s*|\s*\u2013\s*|\s*-\s*)\s*(S\s*\d+\s*E\s*\d+)\s*$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex HistoryTitleEpisodeWord = new(
        @"^(.+?)\s*[·•\u00B7\u2022\u2014\u2013\-]\s*Episode\s*\d+\s*$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>
    /// When file paths in history do not match DB paths (different roots, encoding, etc.), derive the show
    /// from the display title used at play time (e.g. <c>After Life · S1E1</c>, <c>Magic Eye — Episode 3</c>).
    /// </summary>
    public async Task<string?> TryResolvePosterFromHistoryTitleAsync(string? title, string? mediaType,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(title))
            return null;

        var t = title.Trim();
        var mt = mediaType?.Trim() ?? "";

        if (string.Equals(mt, "Movie", StringComparison.OrdinalIgnoreCase))
            return await FindMoviePosterByTitleAsync(t, cancellationToken).ConfigureAwait(false);

        string? showName = null;

        var m = HistoryTitleSeasonEpisode.Match(t);
        if (m.Success)
            showName = m.Groups[1].Value.Trim();

        if (string.IsNullOrWhiteSpace(showName))
        {
            m = HistoryTitleEpisodeWord.Match(t);
            if (m.Success)
                showName = m.Groups[1].Value.Trim();
        }

        if (!string.IsNullOrWhiteSpace(showName))
        {
            var poster = await FindShowPosterByTitleAsync(showName, cancellationToken).ConfigureAwait(false);
            if (!string.IsNullOrEmpty(poster))
                return poster;
        }

        // mediaType blank (legacy rows): full line might still be a movie title.
        if (string.IsNullOrWhiteSpace(mt))
            return await FindMoviePosterByTitleAsync(t, cancellationToken).ConfigureAwait(false);

        return null;
    }

    private async Task<string?> FindShowPosterByTitleAsync(string showName,
        CancellationToken cancellationToken = default)
    {
        var q = _db.Shows.AsNoTracking().Where(s => s.IsMatched);

        var poster = await q.Where(s => s.Title == showName)
            .Select(s => s.SelectedPosterPath ?? s.PosterLocalPath)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (!string.IsNullOrEmpty(poster))
            return poster;

        var nl = showName.ToLowerInvariant();
        poster = await q.Where(s => s.Title.ToLower() == nl)
            .Select(s => s.SelectedPosterPath ?? s.PosterLocalPath)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (!string.IsNullOrEmpty(poster))
            return poster;

        // Library title may include year: "Name (2024)" while history uses "Name".
        var prefix = showName + " (";
        poster = await q.Where(s => s.Title.StartsWith(prefix))
            .OrderBy(s => s.Title.Length)
            .Select(s => s.SelectedPosterPath ?? s.PosterLocalPath)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (!string.IsNullOrEmpty(poster))
            return poster;

        var pll = prefix.ToLowerInvariant();
        return await q.Where(s => s.Title.ToLower().StartsWith(pll))
            .OrderBy(s => s.Title.Length)
            .Select(s => s.SelectedPosterPath ?? s.PosterLocalPath)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task<string?> FindMoviePosterByTitleAsync(string movieTitle,
        CancellationToken cancellationToken = default)
    {
        var poster = await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.Title == movieTitle)
            .Select(m => m.SelectedPosterPath ?? m.PosterLocalPath)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        if (!string.IsNullOrEmpty(poster))
            return poster;

        var nl = movieTitle.ToLowerInvariant();
        poster = await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.Title.ToLower() == nl)
            .Select(m => m.SelectedPosterPath ?? m.PosterLocalPath)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);

        return string.IsNullOrEmpty(poster) ? null : poster;
    }

    public async Task<HashSet<int>> GetListTmdbKeySetForMediaTypeAsync(int listId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        var ids = await _db.ListItems.AsNoTracking()
            .Where(x => x.ListId == listId && x.MediaType == mediaType)
            .Select(x => x.TmdbId)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return ids.ToHashSet();
    }

    public async Task AddListItemAsync(int listId, int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        if (await IsInListAsync(listId, tmdbId, mediaType, cancellationToken).ConfigureAwait(false))
            return;

        _db.ListItems.Add(new ListItem
        {
            ListId = listId,
            TmdbId = tmdbId,
            MediaType = mediaType,
            AddedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task RemoveListItemAsync(int listId, int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        await _db.ListItems.Where(x => x.ListId == listId && x.TmdbId == tmdbId && x.MediaType == mediaType)
            .ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<UserList> CreateUserListAsync(string name, CancellationToken cancellationToken = default)
    {
        var cleanName = name.Trim();
        if (string.IsNullOrWhiteSpace(cleanName))
            throw new ArgumentException("List name cannot be empty.", nameof(name));

        var exists = await _db.UserLists.AnyAsync(
            x => x.Name.ToLower() == cleanName.ToLower(), cancellationToken).ConfigureAwait(false);
        if (exists)
            throw new InvalidOperationException("A list with this name already exists.");

        var l = new UserList
        {
            Name = cleanName,
            CreatedAt = DateTime.UtcNow,
            IsDefault = false
        };
        _db.UserLists.Add(l);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return l;
    }

    public async Task<bool> RenameUserListAsync(int listId, string newName, CancellationToken cancellationToken = default)
    {
        var cleanName = newName.Trim();
        if (string.IsNullOrWhiteSpace(cleanName))
            return false;

        var list = await _db.UserLists.FirstOrDefaultAsync(x => x.Id == listId, cancellationToken).ConfigureAwait(false);
        if (list == null || list.IsDefault)
            return false;

        var exists = await _db.UserLists.AnyAsync(
            x => x.Id != listId && x.Name.ToLower() == cleanName.ToLower(), cancellationToken).ConfigureAwait(false);
        if (exists)
            return false;

        list.Name = cleanName;
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    public async Task<bool> DeleteUserListAsync(int listId, CancellationToken cancellationToken = default)
    {
        var list = await _db.UserLists.FirstOrDefaultAsync(x => x.Id == listId, cancellationToken).ConfigureAwait(false);
        if (list == null || list.IsDefault)
            return false;
        _db.UserLists.Remove(list);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    public async Task<int> CountMatchedMoviesAsync(CancellationToken cancellationToken = default)
    {
        return await _db.Movies.AsNoTracking().CountAsync(m => m.IsMatched, cancellationToken).ConfigureAwait(false);
    }

    public async Task<int> CountMatchedShowsAsync(CancellationToken cancellationToken = default)
    {
        return await _db.Shows.AsNoTracking().CountAsync(s => s.IsMatched, cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<ListItemDisplayRow>> GetListItemRowsAsync(int listId,
        CancellationToken cancellationToken = default)
    {
        var items = await _db.ListItems.AsNoTracking()
            .Where(x => x.ListId == listId)
            .OrderByDescending(x => x.AddedAt)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var shows = await _db.Shows.AsNoTracking().ToListAsync(cancellationToken).ConfigureAwait(false);
        var movies = await _db.Movies.AsNoTracking().ToListAsync(cancellationToken).ConfigureAwait(false);

        var rows = new List<ListItemDisplayRow>();
        foreach (var li in items)
        {
            if (string.Equals(li.MediaType, "Series", StringComparison.OrdinalIgnoreCase))
            {
                var s = shows.FirstOrDefault(x => x.TmdbId == li.TmdbId);
                rows.Add(new ListItemDisplayRow(li.TmdbId, "Series", s?.Title ?? $"TV {li.TmdbId}", s?.Year,
                    s?.PosterLocalPath, s?.Id));
            }
            else
            {
                var m = movies.FirstOrDefault(x => x.TmdbId == li.TmdbId);
                rows.Add(new ListItemDisplayRow(li.TmdbId, "Movie", m?.Title ?? $"Movie {li.TmdbId}", m?.Year,
                    m?.PosterLocalPath, m?.Id));
            }
        }

        return rows;
    }

    private static List<string> SplitGenreTokens(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv))
            return new List<string>();
        return csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(t => t.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static int GenreOverlapScore(string? genresCsv, IReadOnlyList<string> tokens)
    {
        if (string.IsNullOrWhiteSpace(genresCsv) || tokens.Count == 0)
            return 0;
        var score = 0;
        foreach (var t in tokens)
        {
            if (genresCsv.IndexOf(t, StringComparison.OrdinalIgnoreCase) >= 0)
                score++;
        }

        return score;
    }

    public async Task<bool> DeleteMovieByIdAsync(int movieId, CancellationToken cancellationToken = default)
    {
        var m = await _db.Movies.FirstOrDefaultAsync(x => x.Id == movieId, cancellationToken).ConfigureAwait(false);
        if (m == null)
            return false;

        await _db.CastMembers.Where(c => c.MediaId == m.TmdbId && c.MediaType == "Movie")
            .ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        _db.Movies.Remove(m);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    public async Task<bool> DeleteShowByIdAsync(int showId, CancellationToken cancellationToken = default)
    {
        var s = await _db.Shows.FirstOrDefaultAsync(x => x.Id == showId, cancellationToken).ConfigureAwait(false);
        if (s == null)
            return false;

        await _db.CastMembers.Where(c => c.MediaId == s.TmdbId && c.MediaType == "Series")
            .ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        _db.Shows.Remove(s);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    public async Task<bool> DeleteEpisodeAsync(int episodeId, CancellationToken cancellationToken = default)
    {
        var ep = await _db.Episodes.FirstOrDefaultAsync(x => x.Id == episodeId, cancellationToken).ConfigureAwait(false);
        if (ep == null)
            return false;

        _db.Episodes.Remove(ep);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    public async Task<string?> GetMovieFilePathByLibraryIdAsync(int movieId,
        CancellationToken cancellationToken = default)
    {
        return await _db.Movies.AsNoTracking()
            .Where(m => m.Id == movieId)
            .Select(m => m.FilePath)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<int?> GetLibraryMovieIdByFilePathAsync(string filePath,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(filePath))
            return null;
        return await _db.Movies.AsNoTracking()
            .Where(m => m.FilePath == filePath)
            .Select(m => (int?)m.Id)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<int?> GetLibraryShowIdByFolderPathAsync(string folderPath,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(folderPath))
            return null;

        static string Norm(string p)
        {
            var t = p.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            try
            {
                return Path.GetFullPath(t);
            }
            catch
            {
                return t;
            }
        }

        var want = Norm(folderPath);
        var rows = await _db.Shows.AsNoTracking()
            .Where(s => s.FolderPath != null && s.FolderPath != "")
            .Select(s => new { s.Id, s.FolderPath })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        foreach (var s in rows)
        {
            if (string.IsNullOrWhiteSpace(s.FolderPath))
                continue;
            if (string.Equals(Norm(s.FolderPath), want, StringComparison.OrdinalIgnoreCase))
                return s.Id;
        }

        return null;
    }

    public async Task<string?> GetEpisodeFilePathByIdAsync(int episodeId,
        CancellationToken cancellationToken = default)
    {
        return await _db.Episodes.AsNoTracking()
            .Where(e => e.Id == episodeId)
            .Select(e => e.FilePath)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    private static int? ParseYearFromTmdbDate(string? releaseDate)
    {
        if (string.IsNullOrEmpty(releaseDate) || releaseDate.Length < 4)
            return null;
        return int.TryParse(releaseDate.AsSpan(0, 4), out var y) ? y : null;
    }

    /// <summary>Re-fetch TMDB details and credits; updates text fields and replaces cached cast rows (keeps user-selected artwork paths).</summary>
    public async Task<(bool Ok, string? Error)> RefreshMovieMetadataFromTmdbAsync(int movieId, TmdbClient tmdb,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var m = await _db.Movies.FirstOrDefaultAsync(x => x.Id == movieId, cancellationToken).ConfigureAwait(false);
            if (m == null)
                return (false, "Movie not found.");
            if (m.TmdbId <= 0)
                return (false, "No TMDB id for this title.");

            var details = await tmdb.GetDetailsAsync(m.TmdbId, "Movie", cancellationToken).ConfigureAwait(false);
            var genres = details.Genres.Count > 0 ? string.Join(", ", details.Genres) : null;
            var year = ParseYearFromTmdbDate(details.ReleaseDate);

            m.Title = details.Title;
            m.TitleAr = string.IsNullOrEmpty(details.OriginalTitle) ? null : details.OriginalTitle;
            m.Year = year;
            m.Overview = string.IsNullOrEmpty(details.Overview) ? null : details.Overview;
            m.Genres = genres;
            m.VoteAverage = details.VoteAverage;
            m.Runtime = details.Runtime;
            m.IsArabic = MediaLanguageHelper.ComputeIsArabic(details.OriginalLanguage, m.FilePath ?? "");

            m.CrewCacheJson = Newtonsoft.Json.JsonConvert.SerializeObject(details.Crew);

            var castRows = details.Cast.Select(c => new CastMember
            {
                PersonTmdbId = c.Id,
                MediaId = details.Id,
                MediaType = "Movie",
                Name = c.Name,
                Character = c.Character,
                ProfilePath = string.IsNullOrWhiteSpace(c.ProfilePath) ? null : c.ProfilePath.Trim(),
                BillingOrder = c.BillingOrder,
                ProfileLocalPath = c.ProfileLocalPath
            });

            await ReplaceCastMembersAsync(m.TmdbId, "Movie", castRows, cancellationToken).ConfigureAwait(false);
            m.MetadataRefreshedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    /// <summary>Re-fetch TMDB details and credits; updates text fields and replaces cached cast rows (keeps user-selected artwork paths).</summary>
    /// <param name="episodeStillDownloadBudget">Cap for new episode still downloads (use a large value for prefetch).</param>
    public async Task<(bool Ok, string? Error)> RefreshShowMetadataFromTmdbAsync(int showId, TmdbClient tmdb,
        CancellationToken cancellationToken = default, int episodeStillDownloadBudget = 60)
    {
        try
        {
            var s = await _db.Shows.FirstOrDefaultAsync(x => x.Id == showId, cancellationToken).ConfigureAwait(false);
            if (s == null)
                return (false, "Series not found.");
            if (s.TmdbId <= 0)
                return (false, "No TMDB id for this title.");

            var details = await tmdb.GetDetailsAsync(s.TmdbId, "Series", cancellationToken).ConfigureAwait(false);
            var genres = details.Genres.Count > 0 ? string.Join(", ", details.Genres) : null;
            var year = ParseYearFromTmdbDate(details.ReleaseDate);

            s.Title = details.Title;
            s.TitleAr = string.IsNullOrEmpty(details.OriginalTitle) ? null : details.OriginalTitle;
            s.Year = year;
            s.Overview = string.IsNullOrEmpty(details.Overview) ? null : details.Overview;
            s.Genres = genres;
            s.VoteAverage = details.VoteAverage;
            s.IsArabic = MediaLanguageHelper.ComputeIsArabic(details.OriginalLanguage, s.FolderPath ?? "");

            s.CrewCacheJson = Newtonsoft.Json.JsonConvert.SerializeObject(details.Crew);

            var castRows = details.Cast.Select(c => new CastMember
            {
                PersonTmdbId = c.Id,
                MediaId = details.Id,
                MediaType = "Series",
                Name = c.Name,
                Character = c.Character,
                ProfilePath = string.IsNullOrWhiteSpace(c.ProfilePath) ? null : c.ProfilePath.Trim(),
                BillingOrder = c.BillingOrder,
                ProfileLocalPath = c.ProfileLocalPath
            });

            await ReplaceCastMembersAsync(s.TmdbId, "Series", castRows, cancellationToken).ConfigureAwait(false);

            await SyncEpisodesArtworkFromTmdbAsync(s.Id, s.TmdbId, tmdb, cancellationToken, episodeStillDownloadBudget)
                .ConfigureAwait(false);
            s.MetadataRefreshedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    /// <summary>Refresh metadata and episode stills for every movie and series (for background prefetch).</summary>
    public async Task<(int MoviesOk, int SeriesOk, List<string> Errors)> PrefetchAllLibraryMetadataAsync(TmdbClient tmdb,
        CancellationToken cancellationToken = default)
    {
        var errors = new List<string>();
        var movieIds = await _db.Movies.AsNoTracking()
            .Where(m => m.TmdbId > 0 && m.MetadataRefreshedAt == null)
            .OrderBy(m => m.Id)
            .Select(m => m.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var moviesOk = 0;
        foreach (var id in movieIds)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var (ok, err) = await RefreshMovieMetadataFromTmdbAsync(id, tmdb, cancellationToken).ConfigureAwait(false);
            if (ok)
                moviesOk++;
            else if (!string.IsNullOrEmpty(err))
                errors.Add($"Movie #{id}: {err}");
        }

        var showIds = await _db.Shows.AsNoTracking()
            .Where(s => s.TmdbId > 0 && s.MetadataRefreshedAt == null)
            .OrderBy(s => s.Id)
            .Select(s => s.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var seriesOk = 0;
        foreach (var id in showIds)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var (ok, err) = await RefreshShowMetadataFromTmdbAsync(id, tmdb, cancellationToken, 2500)
                .ConfigureAwait(false);
            if (ok)
                seriesOk++;
            else if (!string.IsNullOrEmpty(err))
                errors.Add($"Series #{id}: {err}");
        }

        return (moviesOk, seriesOk, errors);
    }

    /// <summary>Same as <see cref="PrefetchAllLibraryMetadataAsync"/> but yields progress after each title (NDJSON stream).</summary>
    public async IAsyncEnumerable<PrefetchMetadataProgress> PrefetchAllLibraryMetadataStreamAsync(TmdbClient tmdb,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var errors = new List<string>();

        var movies = await _db.Movies.AsNoTracking()
            .Where(m => m.TmdbId > 0 && m.MetadataRefreshedAt == null)
            .OrderBy(m => m.Id)
            .Select(m => new { m.Id, m.Title })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var shows = await _db.Shows.AsNoTracking()
            .Where(s => s.TmdbId > 0 && s.MetadataRefreshedAt == null)
            .OrderBy(s => s.Id)
            .Select(s => new { s.Id, s.Title })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var moviesAlreadyCached = await _db.Movies.AsNoTracking()
            .CountAsync(m => m.TmdbId > 0 && m.MetadataRefreshedAt != null, cancellationToken).ConfigureAwait(false);
        var seriesAlreadyCached = await _db.Shows.AsNoTracking()
            .CountAsync(s => s.TmdbId > 0 && s.MetadataRefreshedAt != null, cancellationToken).ConfigureAwait(false);

        yield return new PrefetchMetadataProgress
        {
            Phase = "start",
            MoviesTotal = movies.Count,
            SeriesTotal = shows.Count,
            MoviesAlreadyCached = moviesAlreadyCached,
            SeriesAlreadyCached = seriesAlreadyCached
        };

        var moviesOk = 0;
        var n = movies.Count;
        for (var i = 0; i < n; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var m = movies[i];
            var (ok, err) = await RefreshMovieMetadataFromTmdbAsync(m.Id, tmdb, cancellationToken).ConfigureAwait(false);
            if (ok)
                moviesOk++;
            else if (!string.IsNullOrEmpty(err))
                errors.Add($"Movie #{m.Id}: {err}");

            yield return new PrefetchMetadataProgress
            {
                Phase = "movie",
                Index = i + 1,
                ItemTotal = n,
                LibraryId = m.Id,
                Title = m.Title,
                Ok = ok,
                Error = ok ? null : err
            };
        }

        var seriesOk = 0;
        var ns = shows.Count;
        for (var i = 0; i < ns; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var s = shows[i];
            var (ok, err) = await RefreshShowMetadataFromTmdbAsync(s.Id, tmdb, cancellationToken, 2500)
                .ConfigureAwait(false);
            if (ok)
                seriesOk++;
            else if (!string.IsNullOrEmpty(err))
                errors.Add($"Series #{s.Id}: {err}");

            yield return new PrefetchMetadataProgress
            {
                Phase = "series",
                Index = i + 1,
                ItemTotal = ns,
                LibraryId = s.Id,
                Title = s.Title,
                Ok = ok,
                Error = ok ? null : err
            };
        }

        yield return new PrefetchMetadataProgress
        {
            Phase = "done",
            MoviesOk = moviesOk,
            SeriesOk = seriesOk,
            Errors = errors
        };
    }

    /// <summary>Fills missing episode titles and still images from TMDB (season endpoint; much fewer requests).</summary>
    public async Task SyncEpisodesArtworkFromTmdbAsync(int showId, int showTmdbId, TmdbClient tmdb,
        CancellationToken cancellationToken = default, int maxImageDownloads = 60)
    {
        if (showTmdbId <= 0)
            return;

        var eps = await _db.Episodes.Where(e => e.ShowId == showId).ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        var bySeason = eps.GroupBy(e => e.Season).ToList();
        var remaining = Math.Clamp(maxImageDownloads, 0, 500);

        foreach (var seasonGroup in bySeason)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var seasonNum = seasonGroup.Key;
            IReadOnlyDictionary<int, (string? Name, string? StillPath, double? VoteAverage)>? seasonMap;
            try
            {
                seasonMap = await tmdb.TryGetTvSeasonEpisodesAsync(showTmdbId, seasonNum, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch
            {
                continue;
            }

            if (seasonMap == null || seasonMap.Count == 0)
                continue;

            foreach (var ep in seasonGroup)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (!seasonMap.TryGetValue(ep.EpisodeNumber, out var meta))
                    continue;

                if (string.IsNullOrWhiteSpace(ep.Title) && !string.IsNullOrWhiteSpace(meta.Name))
                    ep.Title = meta.Name.Trim();

                if (remaining <= 0)
                    continue;

                if (string.IsNullOrWhiteSpace(ep.StillLocalPath) && !string.IsNullOrWhiteSpace(meta.StillPath))
                {
                    try
                    {
                        ep.StillLocalPath = await tmdb
                            .DownloadImageAsync(meta.StillPath,
                                $"still_tv{showTmdbId}_S{ep.Season}E{ep.EpisodeNumber}.jpg", cancellationToken,
                                "Stills", "w300")
                            .ConfigureAwait(false);
                        remaining--;
                    }
                    catch
                    {
                        /* skip image */
                    }
                }
            }
        }

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Aggregates for GET /api/stats/watch (UI dashboard).</summary>
    public async Task<WatchStatisticsBundle> GetWatchStatisticsBundleAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var weekStart = now.Date.AddDays(-(int)now.DayOfWeek);
        if (weekStart > now.Date) weekStart = weekStart.AddDays(-7);
        var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);

        var histories = await _db.WatchHistories.AsNoTracking().ToListAsync(cancellationToken).ConfigureAwait(false);
        var totalSeconds = histories.Sum(h => Math.Max(0, h.EstimatedSeconds));
        var weekSeconds = histories.Where(h => h.OpenedAt >= weekStart).Sum(h => Math.Max(0, h.EstimatedSeconds));
        var monthSeconds = histories.Where(h => h.OpenedAt >= monthStart).Sum(h => Math.Max(0, h.EstimatedSeconds));

        var moviesCompleted = await _db.Movies.AsNoTracking()
            .CountAsync(m => m.IsMatched && m.WatchStatus == WatchStatuses.Completed, cancellationToken)
            .ConfigureAwait(false);
        var episodesWatched = await _db.Episodes.AsNoTracking()
            .CountAsync(e => e.WatchStatus == WatchStatuses.Completed, cancellationToken).ConfigureAwait(false);
        var seriesCompleted = await _db.Shows.AsNoTracking()
            .CountAsync(s => s.IsMatched && s.WatchStatus == WatchStatuses.Completed, cancellationToken)
            .ConfigureAwait(false);

        var genreCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var csv in await _db.Movies.AsNoTracking()
                     .Where(m => m.IsMatched && m.WatchStatus == WatchStatuses.Completed && m.Genres != null)
                     .Select(m => m.Genres!).ToListAsync(cancellationToken).ConfigureAwait(false))
        foreach (var g in SplitGenres(csv))
            genreCounts[g] = genreCounts.TryGetValue(g, out var c) ? c + 1 : 1;
        foreach (var csv in await _db.Shows.AsNoTracking()
                     .Where(s => s.IsMatched && s.WatchStatus == WatchStatuses.Completed && s.Genres != null)
                     .Select(s => s.Genres!).ToListAsync(cancellationToken).ConfigureAwait(false))
        foreach (var g in SplitGenres(csv))
            genreCounts[g] = genreCounts.TryGetValue(g, out var c) ? c + 1 : 1;

        var topPairs = genreCounts.OrderByDescending(kv => kv.Value).Take(5)
            .Select(kv => new WatchGenreCount(kv.Key, kv.Value)).ToList();

        var arM = await _db.Movies.AsNoTracking().CountAsync(m => m.IsMatched && m.IsArabic, cancellationToken)
            .ConfigureAwait(false);
        var enM = await _db.Movies.AsNoTracking().CountAsync(m => m.IsMatched && !m.IsArabic, cancellationToken)
            .ConfigureAwait(false);
        var arS = await _db.Shows.AsNoTracking().CountAsync(s => s.IsMatched && s.IsArabic, cancellationToken)
            .ConfigureAwait(false);
        var enS = await _db.Shows.AsNoTracking().CountAsync(s => s.IsMatched && !s.IsArabic, cancellationToken)
            .ConfigureAwait(false);
        var a = arM + arS;
        var e = enM + enS;
        var topLanguage = a > e ? "Arabic" : (e > a ? "English" : "Mixed");

        var recentMovies = await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.WatchStatus == WatchStatuses.Completed && m.CompletedAt != null)
            .OrderByDescending(m => m.CompletedAt)
            .Take(5)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var recentShows = await _db.Shows.AsNoTracking()
            .Where(s => s.IsMatched && s.WatchStatus == WatchStatuses.Completed && s.CompletedAt != null)
            .OrderByDescending(s => s.CompletedAt)
            .Take(5)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var recentCards = recentMovies.Select(m => (CompletedAt: m.CompletedAt!.Value, Kind: "movie", Id: m.Id))
            .Concat(recentShows.Select(s => (CompletedAt: s.CompletedAt!.Value, Kind: "series", Id: s.Id)))
            .OrderByDescending(x => x.CompletedAt)
            .Take(5)
            .ToList();

        var daySet = new HashSet<DateTime>();
        foreach (var h in histories)
        {
            daySet.Add(h.OpenedAt.Date);
            if (h.StoppedAt.HasValue) daySet.Add(h.StoppedAt.Value.Date);
        }

        foreach (var m in recentMovies)
            if (m.CompletedAt.HasValue) daySet.Add(m.CompletedAt.Value.Date);
        foreach (var s in recentShows)
            if (s.CompletedAt.HasValue) daySet.Add(s.CompletedAt.Value.Date);

        var streak = ComputeWatchStreak(daySet, now.Date);

        var mWeight = (double)Math.Max(0, moviesCompleted);
        var sWeight = (double)Math.Max(0, episodesWatched + seriesCompleted);
        var sum = mWeight + sWeight;
        var moviePercent = sum > 0 ? 100.0 * mWeight / sum : 50.0;
        var seriesPercent = sum > 0 ? 100.0 * sWeight / sum : 50.0;

        var mRatings = await _db.Movies.AsNoTracking().Where(m => m.IsMatched && m.VoteAverage > 0)
            .Select(m => m.VoteAverage).ToListAsync(cancellationToken).ConfigureAwait(false);
        var sRatings = await _db.Shows.AsNoTracking().Where(s => s.IsMatched && s.VoteAverage > 0)
            .Select(s => s.VoteAverage).ToListAsync(cancellationToken).ConfigureAwait(false);

        var mostGenre = topPairs.Count > 0 ? topPairs[0].Genre : "";

        var matchedShowsCount = await _db.Shows.AsNoTracking().CountAsync(s => s.IsMatched, cancellationToken)
            .ConfigureAwait(false);
        var seriesCompletionPercent = matchedShowsCount > 0
            ? 100.0 * seriesCompleted / matchedShowsCount
            : 0.0;

        var episodesCompletedThisWeek = await _db.Episodes.AsNoTracking()
            .CountAsync(
                e => e.WatchStatus == WatchStatuses.Completed && e.CompletedAt != null &&
                     e.CompletedAt >= weekStart,
                cancellationToken).ConfigureAwait(false);

        var showsWatchingLibrary = await _db.Shows.AsNoTracking()
            .CountAsync(s => s.IsMatched && s.WatchStatus == WatchStatuses.Watching, cancellationToken)
            .ConfigureAwait(false);

        var currentlyWatchingRows =
            await GetCurrentlyWatchingSeriesAsync(21, 500, cancellationToken).ConfigureAwait(false);
        var currentlyWatchingCount = currentlyWatchingRows.Count;

        var decadeCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var y in await _db.Movies.AsNoTracking()
                     .Where(m => m.IsMatched && m.WatchStatus == WatchStatuses.Completed && m.Year != null)
                     .Select(m => m.Year!.Value).ToListAsync(cancellationToken).ConfigureAwait(false))
            AddDecade(decadeCounts, y);
        foreach (var y in await _db.Shows.AsNoTracking()
                     .Where(s => s.IsMatched && s.WatchStatus == WatchStatuses.Completed && s.Year != null)
                     .Select(s => s.Year!.Value).ToListAsync(cancellationToken).ConfigureAwait(false))
            AddDecade(decadeCounts, y);

        var decadeTop = decadeCounts
            .OrderByDescending(kv => kv.Value)
            .Take(6)
            .Select(kv => new WatchDecadeCount(kv.Key, kv.Value))
            .ToList();

        var rewatchSessionApprox = histories
            .Where(h => !string.IsNullOrWhiteSpace(h.FilePath))
            .GroupBy(h => h.FilePath!, StringComparer.OrdinalIgnoreCase)
            .Count(g => g.Count() >= 2);

        var recentOrdered = new List<object>();
        foreach (var x in recentCards)
        {
            if (x.Kind == "movie")
                recentOrdered.Add(recentMovies.First(m => m.Id == x.Id));
            else
                recentOrdered.Add(recentShows.First(s => s.Id == x.Id));
        }

        return new WatchStatisticsBundle(
            (int)(totalSeconds / 60),
            (int)(weekSeconds / 60),
            (int)(monthSeconds / 60),
            moviesCompleted,
            episodesWatched,
            seriesCompleted,
            topPairs,
            topLanguage,
            recentOrdered,
            streak,
            moviePercent,
            seriesPercent,
            mostGenre,
            mRatings.Count > 0 ? mRatings.Average() : 0,
            sRatings.Count > 0 ? sRatings.Average() : 0,
            currentlyWatchingCount,
            episodesCompletedThisWeek,
            seriesCompletionPercent,
            showsWatchingLibrary,
            decadeTop,
            rewatchSessionApprox);
    }

    private static void AddDecade(Dictionary<string, int> map, int year)
    {
        if (year < 1930 || year > DateTime.UtcNow.Year + 2)
            return;
        var bucket = year / 10 * 10;
        var label = $"{bucket}s";
        map[label] = map.TryGetValue(label, out var c) ? c + 1 : 1;
    }

    public async Task<string?> TryGetBackdropPathForPlayedFileAsync(string filePath, string? mediaType,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(filePath)) return null;

        if (string.Equals(mediaType, "Movie", StringComparison.OrdinalIgnoreCase))
        {
            var m = await _db.Movies.AsNoTracking()
                .FirstOrDefaultAsync(x => x.FilePath == filePath, cancellationToken).ConfigureAwait(false);
            if (m != null)
                return string.IsNullOrWhiteSpace(m.SelectedBackdropPath) ? m.BackdropLocalPath : m.SelectedBackdropPath;
        }

        var ep = await TryGetEpisodeByFilePathAsync(filePath, cancellationToken).ConfigureAwait(false);
        if (ep != null)
        {
            var s = await _db.Shows.AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == ep.ShowId, cancellationToken).ConfigureAwait(false);
            if (s != null)
                return string.IsNullOrWhiteSpace(s.SelectedBackdropPath) ? s.BackdropLocalPath : s.SelectedBackdropPath;
        }

        return null;
    }

    public async Task<List<MediaCardDto>> GetHomeTopRatedAsync(int take, CancellationToken cancellationToken = default)
    {
        var pool = Math.Max(take * 5, 16);
        var movies = await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched)
            .OrderByDescending(m => m.VoteAverage)
            .ThenByDescending(m => m.Year ?? 0)
            .Take(pool)
            .Select(m => new MediaCardDto
            {
                Id = m.Id,
                TmdbId = m.TmdbId,
                Title = m.Title,
                Year = m.Year,
                VoteAverage = m.VoteAverage,
                PosterLocalPath = m.PosterLocalPath,
                SelectedPosterPath = m.SelectedPosterPath,
                IsArabic = m.IsArabic,
                WatchStatus = m.WatchStatus,
                DateAdded = m.DateAdded,
                GenresCsv = m.Genres,
                Overview = m.Overview == null
                    ? null
                    : (m.Overview.Length > 200 ? m.Overview.Substring(0, 200) : m.Overview),
                BackdropLocalPath = m.BackdropLocalPath,
                SelectedBackdropPath = m.SelectedBackdropPath,
                MediaFilePath = m.FilePath,
                TmdbMediaType = "Movie"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var shows = await _db.Shows.AsNoTracking()
            .Where(s => s.IsMatched)
            .OrderByDescending(s => s.VoteAverage)
            .ThenByDescending(s => s.Year ?? 0)
            .Take(pool)
            .Select(s => new MediaCardDto
            {
                Id = s.Id,
                TmdbId = s.TmdbId,
                Title = s.Title,
                Year = s.Year,
                VoteAverage = s.VoteAverage,
                PosterLocalPath = s.PosterLocalPath,
                SelectedPosterPath = s.SelectedPosterPath,
                IsArabic = s.IsArabic,
                WatchStatus = s.WatchStatus,
                DateAdded = s.DateAdded,
                GenresCsv = s.Genres,
                Overview = s.Overview == null
                    ? null
                    : (s.Overview.Length > 200 ? s.Overview.Substring(0, 200) : s.Overview),
                BackdropLocalPath = s.BackdropLocalPath,
                SelectedBackdropPath = s.SelectedBackdropPath,
                TmdbMediaType = "Series"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        return movies.Concat(shows)
            .OrderByDescending(x => x.VoteAverage)
            .ThenByDescending(x => x.Year ?? 0)
            .Take(take)
            .ToList();
    }

    public async Task<List<MediaCardDto>> GetHomeArabicPicksAsync(int take,
        CancellationToken cancellationToken = default)
    {
        var movies = await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.IsArabic)
            .Select(m => new MediaCardDto
            {
                Id = m.Id,
                TmdbId = m.TmdbId,
                Title = m.Title,
                Year = m.Year,
                VoteAverage = m.VoteAverage,
                PosterLocalPath = m.PosterLocalPath,
                SelectedPosterPath = m.SelectedPosterPath,
                IsArabic = m.IsArabic,
                WatchStatus = m.WatchStatus,
                DateAdded = m.DateAdded,
                GenresCsv = m.Genres,
                Overview = m.Overview == null
                    ? null
                    : (m.Overview.Length > 200 ? m.Overview.Substring(0, 200) : m.Overview),
                BackdropLocalPath = m.BackdropLocalPath,
                SelectedBackdropPath = m.SelectedBackdropPath,
                MediaFilePath = m.FilePath,
                TmdbMediaType = "Movie"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var shows = await _db.Shows.AsNoTracking()
            .Where(s => s.IsMatched && s.IsArabic)
            .Select(s => new MediaCardDto
            {
                Id = s.Id,
                TmdbId = s.TmdbId,
                Title = s.Title,
                Year = s.Year,
                VoteAverage = s.VoteAverage,
                PosterLocalPath = s.PosterLocalPath,
                SelectedPosterPath = s.SelectedPosterPath,
                IsArabic = s.IsArabic,
                WatchStatus = s.WatchStatus,
                DateAdded = s.DateAdded,
                GenresCsv = s.Genres,
                Overview = s.Overview == null
                    ? null
                    : (s.Overview.Length > 200 ? s.Overview.Substring(0, 200) : s.Overview),
                BackdropLocalPath = s.BackdropLocalPath,
                SelectedBackdropPath = s.SelectedBackdropPath,
                TmdbMediaType = "Series"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var pool = new List<MediaCardDto>();
        pool.AddRange(movies);
        pool.AddRange(shows);
        Shuffle(pool);
        return pool.Take(take).ToList();
    }

    public async Task<List<MediaCardDto>> GetHomeBingeSeriesAsync(int take,
        CancellationToken cancellationToken = default) =>
        await _db.Shows.AsNoTracking()
            .Where(s => s.IsMatched && !s.IsArabic && s.WatchStatus != WatchStatuses.Completed)
            .OrderByDescending(s => s.DateAdded)
            .Take(take)
            .Select(s => new MediaCardDto
            {
                Id = s.Id,
                TmdbId = s.TmdbId,
                Title = s.Title,
                Year = s.Year,
                VoteAverage = s.VoteAverage,
                PosterLocalPath = s.PosterLocalPath,
                SelectedPosterPath = s.SelectedPosterPath,
                IsArabic = s.IsArabic,
                WatchStatus = s.WatchStatus,
                DateAdded = s.DateAdded,
                GenresCsv = s.Genres,
                Overview = s.Overview == null
                    ? null
                    : (s.Overview.Length > 200 ? s.Overview.Substring(0, 200) : s.Overview),
                BackdropLocalPath = s.BackdropLocalPath,
                SelectedBackdropPath = s.SelectedBackdropPath,
                TmdbMediaType = "Series"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

    public async Task<List<MediaCardDto>> GetHomeMovieNightAsync(int take,
        int? shuffleSeed = null,
        CancellationToken cancellationToken = default)
    {
        var ids = await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched)
            .Select(m => m.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        if (ids.Count == 0)
            return new List<MediaCardDto>();

        if (shuffleSeed.HasValue)
            Shuffle(ids, new Random(shuffleSeed.Value));
        else
            Shuffle(ids);
        var pick = ids.Take(take).ToList();
        var rows = await _db.Movies.AsNoTracking()
            .Where(m => pick.Contains(m.Id))
            .Select(m => new MediaCardDto
            {
                Id = m.Id,
                TmdbId = m.TmdbId,
                Title = m.Title != null && m.Title.Trim().Length > 0
                    ? m.Title.Trim()
                    : (m.TitleAr != null && m.TitleAr.Trim().Length > 0 ? m.TitleAr.Trim() : ""),
                Year = m.Year,
                VoteAverage = m.VoteAverage,
                PosterLocalPath = m.PosterLocalPath,
                SelectedPosterPath = m.SelectedPosterPath,
                IsArabic = m.IsArabic,
                WatchStatus = m.WatchStatus,
                DateAdded = m.DateAdded,
                GenresCsv = m.Genres,
                Overview = m.Overview == null
                    ? null
                    : (m.Overview.Length > 200 ? m.Overview.Substring(0, 200) : m.Overview),
                BackdropLocalPath = m.BackdropLocalPath,
                SelectedBackdropPath = m.SelectedBackdropPath,
                MediaFilePath = m.FilePath,
                TmdbMediaType = "Movie"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var order = pick.Select((id, idx) => (id, idx)).ToDictionary(t => t.id, t => t.idx);
        return rows.OrderBy(r => order[r.Id]).ToList();
    }

    public Task<string?> GetHomeLayoutJsonAsync(CancellationToken cancellationToken = default) =>
        GetSettingAsync("HomeLayoutV1", cancellationToken);

    public Task SaveHomeLayoutJsonAsync(string json, CancellationToken cancellationToken = default) =>
        SaveSettingAsync("HomeLayoutV1", json ?? "[]", cancellationToken);

    public async Task<MediaCardDto?> GetHomeFeaturedFallbackAsync(CancellationToken cancellationToken = default)
    {
        var top = await GetHomeTopRatedAsync(1, cancellationToken).ConfigureAwait(false);
        if (top.Count > 0)
            return top[0];
        var recent = await GetHomeRecentlyAddedAsync(1, cancellationToken).ConfigureAwait(false);
        return recent.Count > 0 ? recent[0] : null;
    }

    public async Task<List<MediaCardDto>> GetHomeRecentlyAddedAsync(int take,
        CancellationToken cancellationToken = default)
    {
        var t = Math.Max(1, take);
        var pool = Math.Max(t * 3, 32);
        var movies = await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched)
            .OrderByDescending(m => m.DateAdded)
            .Take(pool)
            .Select(m => new MediaCardDto
            {
                Id = m.Id,
                TmdbId = m.TmdbId,
                Title = m.Title,
                Year = m.Year,
                VoteAverage = m.VoteAverage,
                PosterLocalPath = m.PosterLocalPath,
                SelectedPosterPath = m.SelectedPosterPath,
                IsArabic = m.IsArabic,
                WatchStatus = m.WatchStatus,
                DateAdded = m.DateAdded,
                GenresCsv = m.Genres,
                Overview = m.Overview == null
                    ? null
                    : (m.Overview.Length > 200 ? m.Overview.Substring(0, 200) : m.Overview),
                BackdropLocalPath = m.BackdropLocalPath,
                SelectedBackdropPath = m.SelectedBackdropPath,
                MediaFilePath = m.FilePath,
                TmdbMediaType = "Movie"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var shows = await _db.Shows.AsNoTracking()
            .Where(s => s.IsMatched)
            .OrderByDescending(s => s.DateAdded)
            .Take(pool)
            .Select(s => new MediaCardDto
            {
                Id = s.Id,
                TmdbId = s.TmdbId,
                Title = s.Title,
                Year = s.Year,
                VoteAverage = s.VoteAverage,
                PosterLocalPath = s.PosterLocalPath,
                SelectedPosterPath = s.SelectedPosterPath,
                IsArabic = s.IsArabic,
                WatchStatus = s.WatchStatus,
                DateAdded = s.DateAdded,
                GenresCsv = s.Genres,
                Overview = s.Overview == null
                    ? null
                    : (s.Overview.Length > 200 ? s.Overview.Substring(0, 200) : s.Overview),
                BackdropLocalPath = s.BackdropLocalPath,
                SelectedBackdropPath = s.SelectedBackdropPath,
                TmdbMediaType = "Series"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        return movies.Concat(shows)
            .OrderByDescending(x => x.DateAdded)
            .Take(t)
            .ToList();
    }

    public async Task<List<MediaCardDto>> GetHomeUnfinishedSeriesAsync(int take,
        CancellationToken cancellationToken = default) =>
        await _db.Shows.AsNoTracking()
            .Where(s => s.IsMatched && s.WatchStatus != WatchStatuses.Completed)
            .OrderByDescending(s => s.DateAdded)
            .Take(Math.Max(1, take))
            .Select(s => new MediaCardDto
            {
                Id = s.Id,
                TmdbId = s.TmdbId,
                Title = s.Title,
                Year = s.Year,
                VoteAverage = s.VoteAverage,
                PosterLocalPath = s.PosterLocalPath,
                SelectedPosterPath = s.SelectedPosterPath,
                IsArabic = s.IsArabic,
                WatchStatus = s.WatchStatus,
                DateAdded = s.DateAdded,
                GenresCsv = s.Genres,
                Overview = s.Overview == null
                    ? null
                    : (s.Overview.Length > 200 ? s.Overview.Substring(0, 200) : s.Overview),
                BackdropLocalPath = s.BackdropLocalPath,
                SelectedBackdropPath = s.SelectedBackdropPath,
                TmdbMediaType = "Series"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

    public async Task<List<MediaCardDto>> GetHomeGenreSpotlightAsync(int take, string? genreHint, int? shuffleSeed,
        CancellationToken cancellationToken = default)
    {
        var t = Math.Max(1, take);
        string? g = string.IsNullOrWhiteSpace(genreHint) ? null : genreHint.Trim();
        if (g == null)
        {
            var sample = await _db.Movies.AsNoTracking()
                .Where(m => m.IsMatched && m.Genres != null && m.Genres.Length > 2)
                .OrderByDescending(m => m.DateAdded)
                .Select(m => m.Genres!)
                .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(sample))
            {
                sample = await _db.Shows.AsNoTracking()
                    .Where(s => s.IsMatched && s.Genres != null && s.Genres.Length > 2)
                    .OrderByDescending(s => s.DateAdded)
                    .Select(s => s.Genres!)
                    .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
            }

            if (string.IsNullOrWhiteSpace(sample))
                return new List<MediaCardDto>();
            var tok = SplitGenreTokens(sample).FirstOrDefault();
            g = string.IsNullOrWhiteSpace(tok) ? null : tok;
        }

        if (string.IsNullOrWhiteSpace(g))
            return new List<MediaCardDto>();

        var pool = new List<MediaCardDto>();
        pool.AddRange(await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.Genres != null && m.Genres.Contains(g))
            .Select(m => new MediaCardDto
            {
                Id = m.Id,
                TmdbId = m.TmdbId,
                Title = m.Title,
                Year = m.Year,
                VoteAverage = m.VoteAverage,
                PosterLocalPath = m.PosterLocalPath,
                SelectedPosterPath = m.SelectedPosterPath,
                IsArabic = m.IsArabic,
                WatchStatus = m.WatchStatus,
                DateAdded = m.DateAdded,
                GenresCsv = m.Genres,
                Overview = m.Overview == null
                    ? null
                    : (m.Overview.Length > 200 ? m.Overview.Substring(0, 200) : m.Overview),
                BackdropLocalPath = m.BackdropLocalPath,
                SelectedBackdropPath = m.SelectedBackdropPath,
                MediaFilePath = m.FilePath,
                TmdbMediaType = "Movie"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false));

        pool.AddRange(await _db.Shows.AsNoTracking()
            .Where(s => s.IsMatched && s.Genres != null && s.Genres.Contains(g))
            .Select(s => new MediaCardDto
            {
                Id = s.Id,
                TmdbId = s.TmdbId,
                Title = s.Title,
                Year = s.Year,
                VoteAverage = s.VoteAverage,
                PosterLocalPath = s.PosterLocalPath,
                SelectedPosterPath = s.SelectedPosterPath,
                IsArabic = s.IsArabic,
                WatchStatus = s.WatchStatus,
                DateAdded = s.DateAdded,
                GenresCsv = s.Genres,
                Overview = s.Overview == null
                    ? null
                    : (s.Overview.Length > 200 ? s.Overview.Substring(0, 200) : s.Overview),
                BackdropLocalPath = s.BackdropLocalPath,
                SelectedBackdropPath = s.SelectedBackdropPath,
                TmdbMediaType = "Series"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false));

        if (shuffleSeed.HasValue)
            Shuffle(pool, new Random(shuffleSeed.Value));
        else
            Shuffle(pool);
        return pool.Take(t).ToList();
    }

    public async Task<List<MediaCardDto>> GetHomeHiddenGemsAsync(int take, double minRating, int? maxYear,
        CancellationToken cancellationToken = default)
    {
        var t = Math.Max(1, take);
        var yearCap = maxYear ?? DateTime.UtcNow.Year - 4;
        var movies = await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched &&
                        m.WatchStatus == WatchStatuses.Unwatched &&
                        m.VoteAverage >= minRating &&
                        m.Year != null &&
                        m.Year <= yearCap)
            .OrderByDescending(m => m.VoteAverage)
            .Take(t * 2)
            .Select(m => new MediaCardDto
            {
                Id = m.Id,
                TmdbId = m.TmdbId,
                Title = m.Title,
                Year = m.Year,
                VoteAverage = m.VoteAverage,
                PosterLocalPath = m.PosterLocalPath,
                SelectedPosterPath = m.SelectedPosterPath,
                IsArabic = m.IsArabic,
                WatchStatus = m.WatchStatus,
                DateAdded = m.DateAdded,
                GenresCsv = m.Genres,
                Overview = m.Overview == null
                    ? null
                    : (m.Overview.Length > 200 ? m.Overview.Substring(0, 200) : m.Overview),
                BackdropLocalPath = m.BackdropLocalPath,
                SelectedBackdropPath = m.SelectedBackdropPath,
                MediaFilePath = m.FilePath,
                TmdbMediaType = "Movie"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var shows = await _db.Shows.AsNoTracking()
            .Where(s => s.IsMatched &&
                        s.WatchStatus == WatchStatuses.Unwatched &&
                        s.VoteAverage >= minRating &&
                        s.Year != null &&
                        s.Year <= yearCap)
            .OrderByDescending(s => s.VoteAverage)
            .Take(t * 2)
            .Select(s => new MediaCardDto
            {
                Id = s.Id,
                TmdbId = s.TmdbId,
                Title = s.Title,
                Year = s.Year,
                VoteAverage = s.VoteAverage,
                PosterLocalPath = s.PosterLocalPath,
                SelectedPosterPath = s.SelectedPosterPath,
                IsArabic = s.IsArabic,
                WatchStatus = s.WatchStatus,
                DateAdded = s.DateAdded,
                GenresCsv = s.Genres,
                Overview = s.Overview == null
                    ? null
                    : (s.Overview.Length > 200 ? s.Overview.Substring(0, 200) : s.Overview),
                BackdropLocalPath = s.BackdropLocalPath,
                SelectedBackdropPath = s.SelectedBackdropPath,
                TmdbMediaType = "Series"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        return movies.Concat(shows)
            .OrderByDescending(x => x.VoteAverage)
            .Take(t)
            .ToList();
    }

    public async Task<List<MediaCardDto>> GetHomeUserListCardsAsync(int listId, int take,
        CancellationToken cancellationToken = default)
    {
        var t = Math.Max(1, take);
        var items = await _db.ListItems.AsNoTracking()
            .Where(x => x.ListId == listId)
            .OrderByDescending(x => x.AddedAt)
            .Take(t * 2)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        if (items.Count == 0)
            return new List<MediaCardDto>();

        var movieTmdb = items
            .Where(i => !string.Equals(i.MediaType, "Series", StringComparison.OrdinalIgnoreCase))
            .Select(i => i.TmdbId)
            .Distinct()
            .ToList();
        var showTmdb = items
            .Where(i => string.Equals(i.MediaType, "Series", StringComparison.OrdinalIgnoreCase))
            .Select(i => i.TmdbId)
            .Distinct()
            .ToList();

        var movies = movieTmdb.Count == 0
            ? new List<Movie>()
            : await _db.Movies.AsNoTracking()
                .Where(m => m.IsMatched && movieTmdb.Contains(m.TmdbId))
                .ToListAsync(cancellationToken).ConfigureAwait(false);
        var shows = showTmdb.Count == 0
            ? new List<Show>()
            : await _db.Shows.AsNoTracking()
                .Where(s => s.IsMatched && showTmdb.Contains(s.TmdbId))
                .ToListAsync(cancellationToken).ConfigureAwait(false);

        var outList = new List<MediaCardDto>();
        foreach (var li in items)
        {
            if (outList.Count >= t)
                break;
            if (string.Equals(li.MediaType, "Series", StringComparison.OrdinalIgnoreCase))
            {
                var s = shows.FirstOrDefault(x => x.TmdbId == li.TmdbId);
                if (s == null)
                    continue;
                outList.Add(ToMediaCardDto(s));
            }
            else
            {
                var m = movies.FirstOrDefault(x => x.TmdbId == li.TmdbId);
                if (m == null)
                    continue;
                outList.Add(ToMediaCardDto(m));
            }
        }

        return outList;
    }

    public async Task<List<MediaCardDto>> GetHomeFilteredCustomAsync(HomeSectionQuery q,
        CancellationToken cancellationToken = default)
    {
        var t = Math.Max(1, q.Limit);
        var lang = (q.LanguageCategory ?? "all").ToLowerInvariant();
        var watch = (q.WatchFilter ?? "all").ToLowerInvariant();
        var sort = (q.SortBy ?? "dateadded").ToLowerInvariant();
        var media = (q.MediaType ?? "all").ToLowerInvariant();
        var genres = q.Genres?.Where(g => !string.IsNullOrWhiteSpace(g)).Select(g => g.Trim()).ToList() ?? new List<string>();
        var tags = q.Tags?.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim().ToLowerInvariant()).ToList() ??
                   new List<string>();

        List<MediaCardDto> movies = new();
        List<MediaCardDto> shows = new();

        if (media is "all" or "movie")
            movies = await QueryFilteredMoviesAsync(lang, watch, genres, tags, q.MinRating, q.MinRuntimeMinutes,
                q.MaxRuntimeMinutes, q.YearFrom, q.YearTo, t * 4, cancellationToken).ConfigureAwait(false);
        if (media is "all" or "series")
            shows = await QueryFilteredShowsAsync(lang, watch, genres, tags, q.MinRating, q.YearFrom, q.YearTo, t * 4,
                cancellationToken).ConfigureAwait(false);

        var merged = movies.Concat(shows).ToList();
        merged = ApplyHomeSort(merged, sort);
        if (sort == "random")
        {
            if (q.ShuffleSeed.HasValue)
                Shuffle(merged, new Random(q.ShuffleSeed.Value));
            else
                Shuffle(merged);
        }

        return merged.Take(t).ToList();
    }

    public async Task<List<MediaCardDto>> ResolveHomeSectionAsync(HomeSectionQuery q,
        CancellationToken cancellationToken = default)
    {
        var src = (q.SourceType ?? "custom").ToLowerInvariant().Trim();
        var limit = Math.Max(1, q.Limit);
        return src switch
        {
            "top_rated" or "top_rated_library" => await GetHomeTopRatedAsync(limit, cancellationToken)
                .ConfigureAwait(false),
            "movie_night" => await GetHomeMovieNightAsync(limit, q.ShuffleSeed, cancellationToken).ConfigureAwait(false),
            "arabic_picks" => await GetHomeArabicPicksAsync(limit, cancellationToken).ConfigureAwait(false),
            "binge_series" => await GetHomeBingeSeriesAsync(limit, cancellationToken).ConfigureAwait(false),
            "recently_added" => await GetHomeRecentlyAddedAsync(limit, cancellationToken).ConfigureAwait(false),
            "unfinished_series" => await GetHomeUnfinishedSeriesAsync(limit, cancellationToken).ConfigureAwait(false),
            "genre_spotlight" => await GetHomeGenreSpotlightAsync(limit, q.SpotlightGenre, q.ShuffleSeed, cancellationToken)
                .ConfigureAwait(false),
            "hidden_gems" => await GetHomeHiddenGemsAsync(limit, q.MinRating ?? 7.0, q.YearTo, cancellationToken)
                .ConfigureAwait(false),
            "list_spotlight" or "favorites" or "favorites_list" => await ResolveListSpotlightAsync(q, limit, cancellationToken)
                .ConfigureAwait(false),
            _ => await GetHomeFilteredCustomAsync(q, cancellationToken).ConfigureAwait(false)
        };
    }

    private async Task<List<MediaCardDto>> ResolveListSpotlightAsync(HomeSectionQuery q, int limit,
        CancellationToken cancellationToken)
    {
        var listId = q.ListId;
        if (listId == null)
        {
            var src = (q.SourceType ?? "").ToLowerInvariant();
            if (src.Contains("favorite"))
            {
                listId = await GetUserListIdByExactNameAsync(BuiltinLists.FavoritesName, cancellationToken)
                    .ConfigureAwait(false);
            }
            else
                return new List<MediaCardDto>();
        }

        if (listId == null)
            return new List<MediaCardDto>();
        return await GetHomeUserListCardsAsync(listId.Value, limit, cancellationToken).ConfigureAwait(false);
    }

    private static MediaCardDto ToMediaCardDto(Movie m) => new()
    {
        Id = m.Id,
        TmdbId = m.TmdbId,
        Title = m.Title != null && m.Title.Trim().Length > 0
            ? m.Title.Trim()
            : (m.TitleAr != null && m.TitleAr.Trim().Length > 0 ? m.TitleAr.Trim() : ""),
        Year = m.Year,
        VoteAverage = m.VoteAverage,
        PosterLocalPath = m.PosterLocalPath,
        SelectedPosterPath = m.SelectedPosterPath,
        IsArabic = m.IsArabic,
        WatchStatus = m.WatchStatus,
        DateAdded = m.DateAdded,
        GenresCsv = m.Genres,
        Overview = m.Overview == null ? null : (m.Overview.Length > 200 ? m.Overview.Substring(0, 200) : m.Overview),
        BackdropLocalPath = m.BackdropLocalPath,
        SelectedBackdropPath = m.SelectedBackdropPath,
        MediaFilePath = m.FilePath,
        TmdbMediaType = "Movie"
    };

    private static MediaCardDto ToMediaCardDto(Show s) => new()
    {
        Id = s.Id,
        TmdbId = s.TmdbId,
        Title = s.Title,
        Year = s.Year,
        VoteAverage = s.VoteAverage,
        PosterLocalPath = s.PosterLocalPath,
        SelectedPosterPath = s.SelectedPosterPath,
        IsArabic = s.IsArabic,
        WatchStatus = s.WatchStatus,
        DateAdded = s.DateAdded,
        GenresCsv = s.Genres,
        Overview = s.Overview == null ? null : (s.Overview.Length > 200 ? s.Overview.Substring(0, 200) : s.Overview),
        BackdropLocalPath = s.BackdropLocalPath,
        SelectedBackdropPath = s.SelectedBackdropPath,
        TmdbMediaType = "Series"
    };

    private static List<MediaCardDto> ApplyHomeSort(List<MediaCardDto> rows, string sort) =>
        sort switch
        {
            "rating" => rows.OrderByDescending(x => x.VoteAverage).ToList(),
            "year" => rows.OrderByDescending(x => x.Year ?? 0).ToList(),
            "title" => rows.OrderBy(x => x.Title).ToList(),
            "random" => rows,
            _ => rows.OrderByDescending(x => x.DateAdded).ToList()
        };

    private async Task<List<MediaCardDto>> QueryFilteredMoviesAsync(string lang, string watch, List<string> genres,
        List<string> tags, double? minRating, int? minRt, int? maxRt, int? yearFrom, int? yearTo, int pool,
        CancellationToken cancellationToken)
    {
        var q = _db.Movies.AsNoTracking().Where(m => m.IsMatched);
        q = ApplyLang(q, lang);
        q = ApplyWatchFilterMovies(q, watch);
        if (genres.Count > 0)
            q = q.Where(m => m.Genres != null && genres.Any(g => m.Genres.Contains(g)));
        if (minRating is > 0)
            q = q.Where(m => m.VoteAverage >= minRating);
        if (minRt is > 0)
            q = q.Where(m => m.Runtime != null && m.Runtime >= minRt);
        if (maxRt is > 0)
            q = q.Where(m => m.Runtime != null && m.Runtime <= maxRt);
        if (yearFrom is > 0)
            q = q.Where(m => m.Year != null && m.Year >= yearFrom);
        if (yearTo is > 0)
            q = q.Where(m => m.Year != null && m.Year <= yearTo);
        foreach (var tag in tags)
        {
            var t = tag;
            q = q.Where(m =>
                (m.Title != null && m.Title.ToLower().Contains(t)) ||
                (m.Overview != null && m.Overview.ToLower().Contains(t)));
        }

        q = q.OrderByDescending(m => m.DateAdded);
        var rows = await q.Take(Math.Max(pool, 8))
            .Select(m => new MediaCardDto
            {
                Id = m.Id,
                TmdbId = m.TmdbId,
                Title = m.Title,
                Year = m.Year,
                VoteAverage = m.VoteAverage,
                PosterLocalPath = m.PosterLocalPath,
                SelectedPosterPath = m.SelectedPosterPath,
                IsArabic = m.IsArabic,
                WatchStatus = m.WatchStatus,
                DateAdded = m.DateAdded,
                GenresCsv = m.Genres,
                Overview = m.Overview == null
                    ? null
                    : (m.Overview.Length > 200 ? m.Overview.Substring(0, 200) : m.Overview),
                BackdropLocalPath = m.BackdropLocalPath,
                SelectedBackdropPath = m.SelectedBackdropPath,
                MediaFilePath = m.FilePath,
                TmdbMediaType = "Movie"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return rows;
    }

    private async Task<List<MediaCardDto>> QueryFilteredShowsAsync(string lang, string watch, List<string> genres,
        List<string> tags, double? minRating, int? yearFrom, int? yearTo, int pool,
        CancellationToken cancellationToken)
    {
        var q = _db.Shows.AsNoTracking().Where(s => s.IsMatched);
        q = ApplyLang(q, lang);
        q = ApplyWatchFilterShows(q, watch);
        if (genres.Count > 0)
            q = q.Where(s => s.Genres != null && genres.Any(g => s.Genres.Contains(g)));
        if (minRating is > 0)
            q = q.Where(s => s.VoteAverage >= minRating);
        if (yearFrom is > 0)
            q = q.Where(s => s.Year != null && s.Year >= yearFrom);
        if (yearTo is > 0)
            q = q.Where(s => s.Year != null && s.Year <= yearTo);
        foreach (var tag in tags)
        {
            var t = tag;
            q = q.Where(s =>
                (s.Title != null && s.Title.ToLower().Contains(t)) ||
                (s.Overview != null && s.Overview.ToLower().Contains(t)));
        }

        q = q.OrderByDescending(s => s.DateAdded);
        var rows = await q.Take(Math.Max(pool, 8))
            .Select(s => new MediaCardDto
            {
                Id = s.Id,
                TmdbId = s.TmdbId,
                Title = s.Title,
                Year = s.Year,
                VoteAverage = s.VoteAverage,
                PosterLocalPath = s.PosterLocalPath,
                SelectedPosterPath = s.SelectedPosterPath,
                IsArabic = s.IsArabic,
                WatchStatus = s.WatchStatus,
                DateAdded = s.DateAdded,
                GenresCsv = s.Genres,
                Overview = s.Overview == null
                    ? null
                    : (s.Overview.Length > 200 ? s.Overview.Substring(0, 200) : s.Overview),
                BackdropLocalPath = s.BackdropLocalPath,
                SelectedBackdropPath = s.SelectedBackdropPath,
                TmdbMediaType = "Series"
            })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return rows;
    }

    private static IQueryable<Movie> ApplyLang(IQueryable<Movie> q, string lang)
    {
        if (lang == "en")
            return q.Where(m => !m.IsArabic);
        if (lang == "ar")
            return q.Where(m => m.IsArabic);
        return q;
    }

    private static IQueryable<Show> ApplyLang(IQueryable<Show> q, string lang)
    {
        if (lang == "en")
            return q.Where(s => !s.IsArabic);
        if (lang == "ar")
            return q.Where(s => s.IsArabic);
        return q;
    }

    private static IQueryable<Movie> ApplyWatchFilterMovies(IQueryable<Movie> q, string watch)
    {
        return watch switch
        {
            "unwatched" => q.Where(m => m.WatchStatus == WatchStatuses.Unwatched),
            "watching" => q.Where(m => m.WatchStatus == WatchStatuses.Watching),
            "completed" => q.Where(m => m.WatchStatus == WatchStatuses.Completed),
            "watched" => q.Where(m => m.WatchStatus != WatchStatuses.Unwatched),
            _ => q
        };
    }

    private static IQueryable<Show> ApplyWatchFilterShows(IQueryable<Show> q, string watch)
    {
        return watch switch
        {
            "unwatched" => q.Where(s => s.WatchStatus == WatchStatuses.Unwatched),
            "watching" => q.Where(s => s.WatchStatus == WatchStatuses.Watching),
            "completed" => q.Where(s => s.WatchStatus == WatchStatuses.Completed),
            "watched" => q.Where(s => s.WatchStatus != WatchStatuses.Unwatched),
            _ => q
        };
    }

    private static void Shuffle<T>(IList<T> list)
    {
        for (var i = list.Count - 1; i > 0; i--)
        {
            var j = Random.Shared.Next(i + 1);
            (list[i], list[j]) = (list[j], list[i]!);
        }
    }

    private static void Shuffle<T>(IList<T> list, Random rng)
    {
        for (var i = list.Count - 1; i > 0; i--)
        {
            var j = rng.Next(i + 1);
            (list[i], list[j]) = (list[j], list[i]!);
        }
    }

    private static IEnumerable<string> SplitGenres(string csv)
    {
        foreach (var t in csv.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
            yield return t;
    }

    private static int ComputeWatchStreak(HashSet<DateTime> days, DateTime todayUtc)
    {
        if (days.Count == 0) return 0;
        var d = todayUtc.Date;
        if (!days.Contains(d)) d = d.AddDays(-1);
        if (!days.Contains(d)) return 0;
        var streak = 0;
        while (days.Contains(d))
        {
            streak++;
            d = d.AddDays(-1);
        }

        return streak;
    }
}

public sealed record WatchGenreCount(string Genre, int Count);

public sealed record WatchDecadeCount(string DecadeLabel, int Count);

public sealed record WatchStatisticsBundle(
    int TotalWatchTimeMinutes,
    int ThisWeekMinutes,
    int ThisMonthMinutes,
    int TotalMoviesWatched,
    int TotalEpisodesWatched,
    int TotalSeriesCompleted,
    IReadOnlyList<WatchGenreCount> TopGenres,
    string TopLanguage,
    IReadOnlyList<object> RecentlyCompleted,
    int WatchStreak,
    double MoviePercent,
    double SeriesPercent,
    string MostWatchedGenre,
    double AverageMovieRating,
    double AverageSeriesRating,
    int CurrentlyWatchingCount,
    int EpisodesCompletedThisWeek,
    double SeriesCompletionPercent,
    int ShowsWatchingLibrary,
    IReadOnlyList<WatchDecadeCount> DecadeTop,
    int RewatchSessionsApprox);

public sealed record ListItemDisplayRow(int TmdbId, string MediaType, string Title, int? Year, string? PosterLocalPath,
    int? LibraryDatabaseId);

public sealed record UserListSummaryRow(int Id, string Name, DateTime CreatedAt, bool IsDefault, int ItemCount);

public sealed record PagedResult<T>(IReadOnlyList<T> Items, int TotalItems);
