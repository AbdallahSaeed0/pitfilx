using Pitflix.Core.Api;
using Pitflix.Core.Models;

namespace Pitflix.API.Services;

public static class TrailersFeedHelpers
{
    // Wider than a strict “news” window: big titles can drop out of trending/discover pages when release is far out.
    // We still rank intelligently so the grid feels current.
    public const int LatestTrailerMonthsWindow = 8;

    /// <summary>
    /// “Latest” pool: trending + now playing / on the air, plus discover pages for titles whose release / first air
    /// falls in the rolling window starting <see cref="LatestTrailerMonthsWindow"/> months ago (UTC). Then drops
    /// items with a known release/air date before that cutoff (trending-only exceptions: undated rows stay).
    /// </summary>
    public static async Task<List<TmdbDiscoverItem>> BuildLatestTrailerPoolAsync(
        TmdbClient tmdb, bool wantMovie, bool wantTv, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var from = today.AddMonths(-LatestTrailerMonthsWindow);
        var fromYmd = from.ToString("yyyy-MM-dd");

        var pool = new List<TmdbDiscoverItem>();
        if (wantMovie)
        {
            pool.AddRange(await tmdb.GetTrendingMoviesWeekAsync(ct).ConfigureAwait(false));
            pool.AddRange(await tmdb.GetNowPlayingMoviesAsync(1, ct).ConfigureAwait(false));
            pool.AddRange(await tmdb.GetNowPlayingMoviesAsync(2, ct).ConfigureAwait(false));
            for (var p = 1; p <= 12; p++)
            {
                var page = await tmdb.DiscoverMoviesPrimaryReleaseFromAsync(fromYmd, p, ct).ConfigureAwait(false);
                if (page.Count == 0)
                    break;
                pool.AddRange(page);
            }
        }

        if (wantTv)
        {
            pool.AddRange(await tmdb.GetTrendingTvWeekAsync(ct).ConfigureAwait(false));
            pool.AddRange(await tmdb.GetOnTheAirTvAsync(1, ct).ConfigureAwait(false));
            for (var p = 1; p <= 10; p++)
            {
                var page = await tmdb.DiscoverTvFirstAirDateGteAsync(fromYmd, p, ct).ConfigureAwait(false);
                if (page.Count == 0)
                    break;
                pool.AddRange(page);
            }
        }

        return FilterLatestTrailerReleaseWindow(pool, from);
    }

    /// <summary>Keeps rows with no usable date, or with release / first air on or after <paramref name="fromDateUtc"/>.</summary>
    public static List<TmdbDiscoverItem> FilterLatestTrailerReleaseWindow(
        IEnumerable<TmdbDiscoverItem> pool, DateOnly fromDateUtc)
    {
        return pool.Where(x =>
        {
            var ymd = x.ReleaseDate?.Trim() ?? "";
            if (ymd.Length < 10 || !DateOnly.TryParse(ymd.AsSpan(0, 10), out var d))
                return true;
            return d >= fromDateUtc;
        }).ToList();
    }

    /// <summary>
    /// Dedupe by TMDB id + media type, keep the row with the highest <see cref="TmdbDiscoverItem.VoteCount"/> proxy
    /// (or vote_count from discover), then rank so high-interest titles get trailer slots first.
    /// </summary>
    public static List<TmdbDiscoverItem> RankTrailerCandidatePool(
        IEnumerable<TmdbDiscoverItem> pool, bool wantMovie, bool wantTv, IReadOnlySet<string>? curatedPriority = null)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        return pool
            .Where(x => (x.MediaType == "movie" && wantMovie) || (x.MediaType == "tv" && wantTv))
            .GroupBy(x => $"{x.MediaType}:{x.Id}")
            .Select(g => g.OrderByDescending(x => x.VoteCount).First())
            .OrderByDescending(x => TrailerCandidateScore(x, today, curatedPriority))
            .ToList();
    }

    private static double TrailerCandidateScore(TmdbDiscoverItem x, DateOnly today, IReadOnlySet<string>? curatedPriority)
    {
        // Balance:
        // - popularity/vote_count proxy
        // - recency (for “latest” feel)
        // - upcoming (do not penalize far-future blockbusters into oblivion)
        // - curated priority boost (small, optional injection layer)

        var key = $"{x.MediaType}:{x.Id}";
        var curatedBoost = curatedPriority != null && curatedPriority.Contains(key) ? 2.25 : 0.0;

        // vote_count is the only stable field across discover + our search shaping; compress with log.
        var vote = Math.Log10(Math.Max(1, x.VoteCount));

        var dateBoost = 0.0;
        var upcomingBoost = 0.0;
        var ymd = x.ReleaseDate?.Trim() ?? "";
        if (ymd.Length >= 10 && DateOnly.TryParse(ymd.AsSpan(0, 10), out var d))
        {
            var days = (d.ToDateTime(TimeOnly.MinValue) - today.ToDateTime(TimeOnly.MinValue)).TotalDays;
            // Recent past gets a bump; too old fades.
            if (days <= 0)
            {
                var ageDays = Math.Abs(days);
                // 0..180 days ago => 1.4..0.0
                dateBoost = Math.Max(0.0, 1.4 - (ageDays / 180.0) * 1.4);
            }
            else
            {
                // Upcoming: near-term gets more, but far-future still remains eligible.
                // 0..365 days ahead => 1.1..0.35, then gently decays to 0.15 by 3 years.
                upcomingBoost = days <= 365
                    ? 1.1 - (days / 365.0) * 0.75
                    : Math.Max(0.15, 0.35 - ((days - 365.0) / (365.0 * 2.0)) * 0.2);
            }
        }
        else
        {
            // Undated rows (common in trending/search) shouldn't be auto-dropped; keep them competitive.
            dateBoost = 0.25;
        }

        return (vote * 1.15) + dateBoost + upcomingBoost + curatedBoost;
    }

    public static async Task<List<TmdbDiscoverItem>> BuildUpcomingMoviesPoolAsync(TmdbClient tmdb, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
        var pool = new List<TmdbDiscoverItem>();

        // TMDB “upcoming” is good, but can miss far-future high-interest titles due to list behavior.
        for (var pg = 1; pg <= 10; pg++)
        {
            var up = await tmdb.GetUpcomingMoviesAsync(pg, ct).ConfigureAwait(false);
            if (up.Count == 0)
                break;
            pool.AddRange(up.Where(m => IsUpcomingForTrailerPool(m.ReleaseDate)));
        }

        // Add a popularity-sorted discover sweep for *all* future releases (captures far-future blockbusters).
        for (var pg = 1; pg <= 12; pg++)
        {
            var page = await tmdb.DiscoverMoviesPrimaryReleaseFromAsync(today, pg, ct).ConfigureAwait(false);
            if (page.Count == 0)
                break;
            pool.AddRange(page.Where(m => IsUpcomingForTrailerPool(m.ReleaseDate)));
        }

        return pool;
    }

    /// <summary>
    /// Home row: trending + popular upcoming titles only when release/air date is strictly after today (UTC),
    /// mixed movies and TV, de-duplicated and vote_count-ordered for trailer collection.
    /// </summary>
    public static async Task<List<TmdbDiscoverItem>> BuildHomeUpcomingTrendingTrailersPoolAsync(TmdbClient tmdb,
        CancellationToken ct)
    {
        var pool = new List<TmdbDiscoverItem>();

        foreach (var m in await tmdb.GetTrendingMoviesWeekAsync(ct).ConfigureAwait(false))
        {
            if (IsStrictlyFutureReleaseDate(m.ReleaseDate))
                pool.Add(m);
        }

        foreach (var t in await tmdb.GetTrendingTvWeekAsync(ct).ConfigureAwait(false))
        {
            if (IsStrictlyFutureReleaseDate(t.ReleaseDate))
                pool.Add(t);
        }

        pool.AddRange(await BuildUpcomingMoviesPoolAsync(tmdb, ct).ConfigureAwait(false));
        pool.AddRange(await BuildUpcomingTvPoolAsync(tmdb, ct).ConfigureAwait(false));

        pool = pool.Where(x => IsStrictlyFutureReleaseDate(x.ReleaseDate)).ToList();

        return pool
            .GroupBy(x => $"{x.MediaType}:{x.Id}")
            .Select(g => g.OrderByDescending(x => x.VoteCount).First())
            .OrderByDescending(x => x.VoteCount)
            .ToList();
    }

    public static async Task<List<TmdbDiscoverItem>> BuildUpcomingTvPoolAsync(TmdbClient tmdb, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
        var pool = new List<TmdbDiscoverItem>();

        // Popularity-sorted sweep is better for “important future series” than purely date-ascending pages.
        for (var pg = 1; pg <= 12; pg++)
        {
            var tv = await tmdb.DiscoverTvFirstAirDateGteAsync(today, pg, ct).ConfigureAwait(false);
            if (tv.Count == 0)
                break;
            pool.AddRange(tv.Where(t => IsUpcomingForTrailerPool(t.ReleaseDate)));
        }

        // Keep a small date-ascending slice for “this week/soon” browsing feel.
        for (var pg = 1; pg <= 4; pg++)
        {
            var tv = await tmdb.DiscoverTvFirstAirFromAsync(today, pg, ct).ConfigureAwait(false);
            if (tv.Count == 0)
                break;
            pool.AddRange(tv.Where(t => IsUpcomingForTrailerPool(t.ReleaseDate)));
        }

        return pool;
    }

    public static bool IsStrictlyFutureReleaseDate(string? ymd)
    {
        if (string.IsNullOrWhiteSpace(ymd) || ymd.Length < 10)
            return false;
        if (!DateOnly.TryParse(ymd.AsSpan(0, 10), out var d))
            return false;
        return d > DateOnly.FromDateTime(DateTime.UtcNow);
    }

    public static bool IsTodayOrFutureReleaseDate(string? ymd)
    {
        if (string.IsNullOrWhiteSpace(ymd) || ymd.Length < 10)
            return false;
        if (!DateOnly.TryParse(ymd.AsSpan(0, 10), out var d))
            return false;
        return d >= DateOnly.FromDateTime(DateTime.UtcNow);
    }

    /// <summary>
    /// Trailer browse “upcoming” pool: include today and future (strict <c>&gt;</c> today often drops the whole list when TMDB uses “this week” dates or teasers-only titles).
    /// </summary>
    public static bool IsUpcomingForTrailerPool(string? ymd) => IsTodayOrFutureReleaseDate(ymd);

    public record TrailerCardDto(
        int TmdbId,
        string MediaType,
        string Title,
        string? PosterUrl,
        string? BackdropUrl,
        string YoutubeKey,
        string TrailerTitle,
        string? ReleaseDate);

    public static async Task<List<TrailerCardDto>> CollectTrailersForItemsAsync(
        TmdbClient tmdb,
        IEnumerable<TmdbDiscoverItem> candidates,
        int maxTrailers,
        HashSet<string> seenKeys,
        CancellationToken ct)
    {
        var list = new List<TrailerCardDto>();
        foreach (var x in candidates)
        {
            if (list.Count >= maxTrailers)
                break;
            var mt = x.MediaType == "tv" ? "Series" : "Movie";
            var clips = await tmdb.TryGetTrailerAndTeaserClipsAsync(x.Id, mt, ct).ConfigureAwait(false);
            if (clips.Count == 0)
                continue;

            string? backdropUrl = null;
            try
            {
                var art = await tmdb.GetArtworkPathsAsync(x.Id, mt, ct).ConfigureAwait(false);
                if (art.HasValue && !string.IsNullOrEmpty(art.Value.BackdropPath))
                    backdropUrl = $"https://image.tmdb.org/t/p/w780{art.Value.BackdropPath}";
            }
            catch
            {
                /* optional */
            }

            foreach (var clip in clips)
            {
                if (list.Count >= maxTrailers)
                    break;
                var dedupe = $"{x.MediaType}:{x.Id}:{clip.Key}";
                if (!seenKeys.Add(dedupe))
                    continue;

                list.Add(new TrailerCardDto(
                    x.Id,
                    x.MediaType,
                    x.Title,
                    string.IsNullOrEmpty(x.PosterPath) ? null : $"https://image.tmdb.org/t/p/w500{x.PosterPath}",
                    backdropUrl,
                    clip.Key,
                    clip.Name,
                    string.IsNullOrEmpty(x.ReleaseDate) ? null : x.ReleaseDate));
            }
        }

        return list;
    }
}
