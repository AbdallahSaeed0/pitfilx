using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API;

public static class MediaCatalogHelpers
{
    public static async Task<object> MakePageAsync(IReadOnlyList<MediaCardDto> rawItems, int total, int page, int pageSize,
        TmdbClient? tmdb, CancellationToken ct)
    {
        var mapped = rawItems.Select(ImageUrls.MapMediaCard).ToList();
        await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(mapped, tmdb, ct).ConfigureAwait(false);
        return new
        {
            items = mapped,
            total,
            totalPages = TotalPages(total, pageSize),
            currentPage = page
        };
    }

    public static int TotalPages(int total, int pageSize)
    {
        var ps = Math.Max(1, pageSize);
        return total <= 0 ? 1 : (int)Math.Ceiling(total / (double)ps);
    }

    public static string? MapSortOption(string sort) =>
        sort.ToLowerInvariant() switch
        {
            "year" => "Year ↓",
            "rating" => "Rating",
            "dateadded" => "Date added",
            "imdbdesc" => "IMDb ↓",
            "imdbasc" => "IMDb ↑",
            _ => null
        };

    public static async Task<(List<MediaCardDto> items, int total)> QueryMediaCardsAsync(
        LibraryContext db,
        LibraryRepository repo,
        bool isMovie,
        bool isArabic,
        string? search,
        string? genre,
        string watch,
        string sort,
        int page,
        int pageSize,
        CancellationToken ct,
        double? minImdbRating = null)
    {
        var sortOpt = MapSortOption(sort);
        var watchNorm = watch.ToLowerInvariant();
        if (watchNorm == "watched")
            return await QueryWatchedPageAsync(db, repo, isMovie, isArabic, search, genre, sort, page, pageSize, ct, minImdbRating)
                .ConfigureAwait(false);

        string? watchForRepo = watchNorm switch
        {
            "unwatched" => WatchStatuses.Unwatched,
            "watching" => WatchStatuses.Watching,
            "completed" => WatchStatuses.Completed,
            _ => null
        };

        if (isMovie)
        {
            var r = await repo.GetMovieCardPageAsync(isArabic, search, genre, watchForRepo, sortOpt, page, pageSize, ct, minImdbRating)
                .ConfigureAwait(false);
            return (r.Items.ToList(), r.TotalItems);
        }
        else
        {
            var r = await repo.GetShowCardPageAsync(isArabic, search, genre, watchForRepo, sortOpt, page, pageSize, ct, minImdbRating)
                .ConfigureAwait(false);
            return (r.Items.ToList(), r.TotalItems);
        }
    }

    public static async Task<(List<MediaCardDto> items, int total)> QueryWatchedPageAsync(
        LibraryContext db,
        LibraryRepository repo,
        bool isMovie,
        bool isArabic,
        string? search,
        string? genre,
        string sort,
        int page,
        int pageSize,
        CancellationToken ct,
        double? minImdbRating = null)
    {
        if (isMovie)
        {
            var q = db.Movies.AsNoTracking()
                .Where(m => m.IsMatched && m.IsArabic == isArabic &&
                            m.WatchStatus != WatchStatuses.Unwatched);
            q = ApplyMovieFilters(q, search, genre);
            if (minImdbRating is > 0)
            {
                var qualifying = await repo.GetTmdbIdsAtOrAboveImdbRatingAsync("Movie", minImdbRating.Value, ct)
                    .ConfigureAwait(false);
                q = q.Where(m => qualifying.Contains(m.TmdbId));
            }
            var skip = Math.Max(0, (Math.Max(1, page) - 1) * Math.Max(1, pageSize));
            var sortNorm = sort.ToLowerInvariant();
            if (sortNorm is "imdbdesc" or "imdbasc")
            {
                var total0 = await q.CountAsync(ct).ConfigureAwait(false);
                var all = await q.Select(m => new MediaCardDto
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
                }).ToListAsync(ct).ConfigureAwait(false);
                var ratingMap = await repo.GetImdbRatingMapAsync("Movie", ct).ConfigureAwait(false);
                var sortedAll = sortNorm == "imdbdesc"
                    ? all.OrderByDescending(m => ratingMap.GetValueOrDefault(m.TmdbId, -1))
                    : all.OrderBy(m => ratingMap.GetValueOrDefault(m.TmdbId, -1));
                return (sortedAll.Skip(skip).Take(Math.Max(1, pageSize)).ToList(), total0);
            }

            q = ApplyMovieSort(q, sort);
            var total = await q.CountAsync(ct).ConfigureAwait(false);
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
                    Overview = m.Overview == null
                        ? null
                        : (m.Overview.Length > 200 ? m.Overview.Substring(0, 200) : m.Overview),
                    BackdropLocalPath = m.BackdropLocalPath,
                    SelectedBackdropPath = m.SelectedBackdropPath,
                    MediaFilePath = m.FilePath,
                    TmdbMediaType = "Movie"
                })
                .ToListAsync(ct)
                .ConfigureAwait(false);
            return (rows, total);
        }
        else
        {
            var q = db.Shows.AsNoTracking()
                .Where(s => s.IsMatched && s.IsArabic == isArabic &&
                            s.WatchStatus != WatchStatuses.Unwatched);
            q = ApplyShowFilters(q, search, genre);
            if (minImdbRating is > 0)
            {
                var qualifying = await repo.GetTmdbIdsAtOrAboveImdbRatingAsync("Series", minImdbRating.Value, ct)
                    .ConfigureAwait(false);
                q = q.Where(s => qualifying.Contains(s.TmdbId));
            }
            var skip = Math.Max(0, (Math.Max(1, page) - 1) * Math.Max(1, pageSize));
            var sortNormS = sort.ToLowerInvariant();
            if (sortNormS is "imdbdesc" or "imdbasc")
            {
                var total0 = await q.CountAsync(ct).ConfigureAwait(false);
                var all = await q.Select(s => new MediaCardDto
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
                }).ToListAsync(ct).ConfigureAwait(false);
                var ratingMap = await repo.GetImdbRatingMapAsync("Series", ct).ConfigureAwait(false);
                var sortedAll = sortNormS == "imdbdesc"
                    ? all.OrderByDescending(s => ratingMap.GetValueOrDefault(s.TmdbId, -1))
                    : all.OrderBy(s => ratingMap.GetValueOrDefault(s.TmdbId, -1));
                return (sortedAll.Skip(skip).Take(Math.Max(1, pageSize)).ToList(), total0);
            }

            q = ApplyShowSort(q, sort);
            var total = await q.CountAsync(ct).ConfigureAwait(false);
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
                    Overview = s.Overview == null
                        ? null
                        : (s.Overview.Length > 200 ? s.Overview.Substring(0, 200) : s.Overview),
                    BackdropLocalPath = s.BackdropLocalPath,
                    SelectedBackdropPath = s.SelectedBackdropPath,
                    TmdbMediaType = "Series"
                })
                .ToListAsync(ct)
                .ConfigureAwait(false);
            return (rows, total);
        }
    }

    public static IQueryable<Movie> ApplyMovieFilters(IQueryable<Movie> q, string? search, string? genre)
    {
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            var lower = term.ToLower();
            // SQLite collation can end up case-sensitive depending on environment; normalize to lower-case.
            q = q.Where(m => m.Title.ToLower().Contains(lower));
        }

        if (!string.IsNullOrWhiteSpace(genre) && !genre.Equals("All", StringComparison.OrdinalIgnoreCase))
            q = q.Where(m => m.Genres != null && m.Genres.Contains(genre));
        return q;
    }

    public static IQueryable<Show> ApplyShowFilters(IQueryable<Show> q, string? search, string? genre)
    {
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            var lower = term.ToLower();
            // SQLite collation can end up case-sensitive depending on environment; normalize to lower-case.
            q = q.Where(s => s.Title.ToLower().Contains(lower));
        }

        if (!string.IsNullOrWhiteSpace(genre) && !genre.Equals("All", StringComparison.OrdinalIgnoreCase))
            q = q.Where(s => s.Genres != null && s.Genres.Contains(genre));
        return q;
    }

    public static IQueryable<Movie> ApplyMovieSort(IQueryable<Movie> q, string sort) =>
        sort.ToLowerInvariant() switch
        {
            "year" => q.OrderByDescending(m => m.Year ?? 0),
            "rating" => q.OrderByDescending(m => m.VoteAverage),
            "dateadded" => q.OrderByDescending(m => m.DateAdded),
            _ => q.OrderBy(m => m.Title)
        };

    public static IQueryable<Show> ApplyShowSort(IQueryable<Show> q, string sort) =>
        sort.ToLowerInvariant() switch
        {
            "year" => q.OrderByDescending(s => s.Year ?? 0),
            "rating" => q.OrderByDescending(s => s.VoteAverage),
            "dateadded" => q.OrderByDescending(s => s.DateAdded),
            _ => q.OrderBy(s => s.Title)
        };
}
