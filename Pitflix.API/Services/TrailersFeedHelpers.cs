using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Pitflix.API.Services.Trailers;
using Pitflix.Core.Api;
using Pitflix.Core.Models;

using System.Threading;

namespace Pitflix.API.Services;

public static class TrailersFeedHelpers
{
    public static string NormalizeTrailerTitleKey(string? title)
    {
        if (string.IsNullOrWhiteSpace(title))
            return "";
        var t = title.Trim().ToLowerInvariant();
        var chars = t.Where(char.IsLetterOrDigit).ToArray();
        return new string(chars);
    }

    public const int LatestTrailerMonthsWindow = 8;

    public static bool PassesHomeTrailerQualityBar(TmdbDiscoverItem x, int minVotes = 52, double minAvg = 5.0)
    {
        if (x.VoteCount >= minVotes)
            return true;
        if (x.VoteAverage >= minAvg && x.VoteCount >= 28)
            return true;
        return false;
    }

    public static List<TmdbDiscoverItem> FilterHomeTrailerPool(IEnumerable<TmdbDiscoverItem> pool, bool strict)
    {
        var minVotes = strict ? 80 : 52;
        var minAvg = strict ? 5.4 : 5.0;
        return pool.Where(x => PassesHomeTrailerQualityBar(x, minVotes, minAvg)).ToList();
    }

    /// <summary>
    /// Candidates for Home "latest trailers": strictly-upcoming prefix first (unreleased titles), then trending/popular.
    /// Scan order matters — unreleased titles are checked first so their trailers surface before already-released popular rows.
    /// </summary>
    public static async Task<List<TmdbDiscoverItem>> BuildHomeLatestTrailerCandidatePoolAsync(TmdbClient tmdb,
        CancellationToken ct, bool compactDiscover = true)
    {
        var prefix = await BuildStrictlyUpcomingTrailerCandidatePrefixAsync(tmdb, ct, compactDiscover)
            .ConfigureAwait(false);
        var today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
        var pool = new List<TmdbDiscoverItem>();
        pool.AddRange(prefix);

        var trendingMoviesTask = tmdb.GetTrendingMoviesWeekAsync(ct);
        var trendingTvTask = tmdb.GetTrendingTvWeekAsync(ct);
        await Task.WhenAll(trendingMoviesTask, trendingTvTask).ConfigureAwait(false);
        pool.AddRange(await trendingMoviesTask.ConfigureAwait(false));
        pool.AddRange(await trendingTvTask.ConfigureAwait(false));

        var maxUpcomingPages = compactDiscover ? 2 : 6;
        for (var pg = 1; pg <= maxUpcomingPages; pg++)
        {
            var up = await tmdb.GetUpcomingMoviesAsync(pg, ct).ConfigureAwait(false);
            if (up.Count == 0)
                break;
            pool.AddRange(up.Where(m => IsUpcomingForTrailerPool(m.ReleaseDate)));
        }

        var maxTvGtePages = compactDiscover ? 2 : 5;
        for (var p = 1; p <= maxTvGtePages; p++)
        {
            var page = await tmdb.DiscoverTvFirstAirDateGteAsync(today, p, ct).ConfigureAwait(false);
            if (page.Count == 0)
                break;
            pool.AddRange(page.Where(t => IsUpcomingForTrailerPool(t.ReleaseDate)));
        }

        var nowPlayingTask = tmdb.GetNowPlayingMoviesAsync(1, ct);
        var onAirTask = tmdb.GetOnTheAirTvAsync(1, ct);
        Task<List<TmdbDiscoverItem>>? nowPlaying2Task = null;
        if (!compactDiscover)
            nowPlaying2Task = tmdb.GetNowPlayingMoviesAsync(2, ct);
        if (nowPlaying2Task != null)
            await Task.WhenAll(nowPlayingTask, onAirTask, nowPlaying2Task).ConfigureAwait(false);
        else
            await Task.WhenAll(nowPlayingTask, onAirTask).ConfigureAwait(false);
        pool.AddRange(await nowPlayingTask.ConfigureAwait(false));
        if (nowPlaying2Task != null)
            pool.AddRange(await nowPlaying2Task.ConfigureAwait(false));
        pool.AddRange(await onAirTask.ConfigureAwait(false));

        var maxPopularPages = compactDiscover ? 3 : 8;
        var popP = 1;
        while (popP <= maxPopularPages)
        {
            if (popP + 1 <= maxPopularPages)
            {
                var m1 = tmdb.DiscoverPopularMoviesAsync(popP, ct);
                var m2 = tmdb.DiscoverPopularMoviesAsync(popP + 1, ct);
                await Task.WhenAll(m1, m2).ConfigureAwait(false);
                var pg1 = await m1.ConfigureAwait(false);
                var pg2 = await m2.ConfigureAwait(false);
                if (pg1.Count == 0)
                    break;
                pool.AddRange(pg1);
                if (pg2.Count == 0)
                    break;
                pool.AddRange(pg2);
                popP += 2;
            }
            else
            {
                var pg = await tmdb.DiscoverPopularMoviesAsync(popP, ct).ConfigureAwait(false);
                if (pg.Count == 0)
                    break;
                pool.AddRange(pg);
                popP++;
            }
        }

        var tvP = 1;
        while (tvP <= maxPopularPages)
        {
            if (tvP + 1 <= maxPopularPages)
            {
                var t1 = tmdb.DiscoverPopularTvAsync(tvP, ct);
                var t2 = tmdb.DiscoverPopularTvAsync(tvP + 1, ct);
                await Task.WhenAll(t1, t2).ConfigureAwait(false);
                var pg1 = await t1.ConfigureAwait(false);
                var pg2 = await t2.ConfigureAwait(false);
                if (pg1.Count == 0)
                    break;
                pool.AddRange(pg1);
                if (pg2.Count == 0)
                    break;
                pool.AddRange(pg2);
                tvP += 2;
            }
            else
            {
                var pg = await tmdb.DiscoverPopularTvAsync(tvP, ct).ConfigureAwait(false);
                if (pg.Count == 0)
                    break;
                pool.AddRange(pg);
                tvP++;
            }
        }

        pool = FilterHomeTrailerPool(pool, strict: false);
        return DedupeTrailerCandidatesKeepOrder(pool, true, true);
    }

    /// <summary>
    /// Titles with release / first air strictly in the future — scanned first so "not aired yet" trailers surface before
    /// the same popular rows that dominate TMDB-only pools.
    /// </summary>
    private static async Task<List<TmdbDiscoverItem>> BuildStrictlyUpcomingTrailerCandidatePrefixAsync(TmdbClient tmdb,
        CancellationToken ct, bool compact = true)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
        var pool = new List<TmdbDiscoverItem>();

        var maxUpcoming = compact ? 4 : 12;
        for (var pg = 1; pg <= maxUpcoming; pg++)
        {
            var up = await tmdb.GetUpcomingMoviesAsync(pg, ct).ConfigureAwait(false);
            if (up.Count == 0)
                break;
            pool.AddRange(up.Where(m => IsStrictlyFutureReleaseDate(m.ReleaseDate)));
        }

        var maxDiscMovies = compact ? 5 : 15;
        for (var pg = 1; pg <= maxDiscMovies; pg++)
        {
            var page = await tmdb.DiscoverMoviesPrimaryReleaseFromAsync(today, pg, ct).ConfigureAwait(false);
            if (page.Count == 0)
                break;
            pool.AddRange(page.Where(m => IsStrictlyFutureReleaseDate(m.ReleaseDate)));
        }

        var maxTvGte = compact ? 5 : 15;
        for (var pg = 1; pg <= maxTvGte; pg++)
        {
            var page = await tmdb.DiscoverTvFirstAirDateGteAsync(today, pg, ct).ConfigureAwait(false);
            if (page.Count == 0)
                break;
            pool.AddRange(page.Where(t => IsStrictlyFutureReleaseDate(t.ReleaseDate)));
        }

        var maxTvFrom = compact ? 3 : 10;
        for (var pg = 1; pg <= maxTvFrom; pg++)
        {
            var page = await tmdb.DiscoverTvFirstAirFromAsync(today, pg, ct).ConfigureAwait(false);
            if (page.Count == 0)
                break;
            pool.AddRange(page.Where(t => IsStrictlyFutureReleaseDate(t.ReleaseDate)));
        }

        pool = DedupeTrailerCandidatesKeepOrder(pool, true, true);
        return pool
            .Where(x => PassesHomeTrailerQualityBar(x, minVotes: 28, minAvg: 4.85))
            .ToList();
    }

    public static List<TmdbDiscoverItem> DedupeTrailerCandidatesKeepOrder(
        IEnumerable<TmdbDiscoverItem> pool, bool wantMovie, bool wantTv)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var list = new List<TmdbDiscoverItem>();
        foreach (var x in pool)
        {
            if ((x.MediaType == "movie" && !wantMovie) || (x.MediaType == "tv" && !wantTv))
                continue;
            var k = $"{x.MediaType}:{x.Id}";
            if (!seen.Add(k))
                continue;
            list.Add(x);
        }

        return list;
    }

    public static List<TmdbDiscoverItem> RankTrailerCandidatePoolByPopularityOnly(
        IEnumerable<TmdbDiscoverItem> pool, bool wantMovie, bool wantTv)
    {
        return pool
            .Where(x => (x.MediaType == "movie" && wantMovie) || (x.MediaType == "tv" && wantTv))
            .GroupBy(x => $"{x.MediaType}:{x.Id}")
            .Select(g => g.OrderByDescending(x => x.VoteCount).First())
            .OrderByDescending(x => x.VoteCount)
            .ThenByDescending(x => x.VoteAverage)
            .ToList();
    }

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
        var key = $"{x.MediaType}:{x.Id}";
        var curatedBoost = curatedPriority != null && curatedPriority.Contains(key) ? 2.25 : 0.0;
        var vote = Math.Log10(Math.Max(1, x.VoteCount));

        var dateBoost = 0.0;
        var upcomingBoost = 0.0;
        var ymd = x.ReleaseDate?.Trim() ?? "";
        if (ymd.Length >= 10 && DateOnly.TryParse(ymd.AsSpan(0, 10), out var d))
        {
            var days = (d.ToDateTime(TimeOnly.MinValue) - today.ToDateTime(TimeOnly.MinValue)).TotalDays;
            if (days <= 0)
            {
                var ageDays = Math.Abs(days);
                dateBoost = Math.Max(0.0, 1.4 - (ageDays / 180.0) * 1.4);
            }
            else
            {
                upcomingBoost = days <= 365
                    ? 1.1 - (days / 365.0) * 0.75
                    : Math.Max(0.15, 0.35 - ((days - 365.0) / (365.0 * 2.0)) * 0.2);
            }
        }
        else
        {
            dateBoost = 0.25;
        }

        return (vote * 1.15) + dateBoost + upcomingBoost + curatedBoost;
    }

    public static async Task<List<TmdbDiscoverItem>> BuildUpcomingMoviesPoolAsync(TmdbClient tmdb, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
        var pool = new List<TmdbDiscoverItem>();

        for (var pg = 1; pg <= 10; pg++)
        {
            var up = await tmdb.GetUpcomingMoviesAsync(pg, ct).ConfigureAwait(false);
            if (up.Count == 0)
                break;
            pool.AddRange(up.Where(m => IsUpcomingForTrailerPool(m.ReleaseDate)));
        }

        for (var pg = 1; pg <= 12; pg++)
        {
            var page = await tmdb.DiscoverMoviesPrimaryReleaseFromAsync(today, pg, ct).ConfigureAwait(false);
            if (page.Count == 0)
                break;
            pool.AddRange(page.Where(m => IsUpcomingForTrailerPool(m.ReleaseDate)));
        }

        return pool;
    }

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

        for (var pg = 1; pg <= 12; pg++)
        {
            var tv = await tmdb.DiscoverTvFirstAirDateGteAsync(today, pg, ct).ConfigureAwait(false);
            if (tv.Count == 0)
                break;
            pool.AddRange(tv.Where(t => IsUpcomingForTrailerPool(t.ReleaseDate)));
        }

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

    public static bool IsUpcomingForTrailerPool(string? ymd) => IsTodayOrFutureReleaseDate(ymd);

    public record TrailerCardDto(
        int TmdbId,
        string MediaType,
        string Title,
        string? PosterUrl,
        string? BackdropUrl,
        string YoutubeKey,
        string TrailerTitle,
        string? ReleaseDate,
        DateTime? TrailerPublishedAtUtc = null);

    /// <summary>
    /// Home "latest trailers": **strongly prioritizes unreleased (future air/release) titles** by collecting them first,
    /// then backfills with recently-released titles only if needed. Within each bucket, sorts by trailer <c>published_at</c> (newest first).
    /// Pagination via maxApiPasses reduces overhead. Promo fetches run in parallel batches to stay under HTTP client timeouts.
    /// </summary>
    public static async Task<List<TrailerCardDto>> CollectHomeLatestTrailersByPublishedWindowAsync(
        TmdbClient tmdb,
        IReadOnlyList<TmdbDiscoverItem> candidates,
        int maxTrailers,
        int recentDays,
        CancellationToken ct,
        int upcomingTrailerPublishedDays = 105,
        int maxApiPasses = 120,
        bool fetchBackdrop = false,
        int promoFetchConcurrency = 8)
    {
        var unreleasedCards = new List<(DateTime SortUtc, TrailerCardDto Card, bool HasDate)>();
        var releasedCards = new List<(DateTime SortUtc, TrailerCardDto Card, bool HasDate)>();
        var seenKeys = new HashSet<string>(StringComparer.Ordinal);
        var n = 0;
        promoFetchConcurrency = Math.Clamp(promoFetchConcurrency, 1, 16);

        var list = candidates is IList<TmdbDiscoverItem> il ? il : candidates.ToList();
        var idx = 0;
        while (idx < list.Count && n < maxApiPasses)
        {
            var batch = new List<TmdbDiscoverItem>();
            while (idx < list.Count && batch.Count < promoFetchConcurrency && n < maxApiPasses)
            {
                var x = list[idx++];
                var isUnreleased = IsStrictlyFutureReleaseDate(x.ReleaseDate);
                if (isUnreleased && unreleasedCards.Count >= maxTrailers)
                    continue;
                if (!isUnreleased && releasedCards.Count >= maxTrailers)
                    continue;

                if (isUnreleased)
                {
                    if (!PassesHomeTrailerQualityBar(x, minVotes: 26, minAvg: 4.7))
                        continue;
                }
                else if (!PassesHomeTrailerQualityBar(x, minVotes: 50, minAvg: 5.15))
                {
                    continue;
                }

                n++;
                batch.Add(x);
            }

            if (batch.Count == 0)
                break;

            var promoLists = await Task.WhenAll(batch.Select(async x =>
            {
                var mt = x.MediaType == "tv" ? "Series" : "Movie";
                var promos = await tmdb.GetYoutubePromosDetailedAsync(x.Id, mt, ct).ConfigureAwait(false);
                return (x, mt, promos);
            })).ConfigureAwait(false);

            foreach (var (x, mt, promos) in promoLists)
            {
                var isUnreleased = IsStrictlyFutureReleaseDate(x.ReleaseDate);
                var bucket = isUnreleased ? unreleasedCards : releasedCards;

                var recentClamp = Math.Clamp(recentDays, 7, 45);
                var upcomingClamp = Math.Clamp(upcomingTrailerPublishedDays, 45, 150);
                var cutoff = DateTime.UtcNow.AddDays(-(isUnreleased ? upcomingClamp : recentClamp));

                var trailerTypes = promos
                    .Where(p => !string.IsNullOrWhiteSpace(p.Key))
                    .Where(p => p.Type.Equals("Trailer", StringComparison.OrdinalIgnoreCase) ||
                                p.Type.Equals("Teaser", StringComparison.OrdinalIgnoreCase))
                    .ToList();

                (string Key, string Name, string Type, int Rank, DateTime? PublishedAtUtc)? pick = null;

                var withDate = trailerTypes
                    .Where(p => p.PublishedAtUtc.HasValue && p.PublishedAtUtc.Value >= cutoff)
                    .OrderByDescending(p => p.PublishedAtUtc)
                    .ThenByDescending(p => p.Rank)
                    .ToList();
                if (withDate.Count > 0)
                    pick = withDate[0];
                else
                {
                    var undatedPromos = trailerTypes
                        .Where(p => !p.PublishedAtUtc.HasValue)
                        .OrderByDescending(p => p.Rank)
                        .ToList();
                    if (undatedPromos.Count > 0)
                        pick = undatedPromos[0];
                }

                if (pick == null || string.IsNullOrEmpty(pick.Value.Key))
                    continue;

                var dedupe = $"{x.MediaType}:{x.Id}";
                if (!seenKeys.Add(dedupe))
                    continue;

                string? backdropUrl = null;
                if (fetchBackdrop)
                {
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
                }

                var pub = pick.Value.PublishedAtUtc;
                var sortUtc = pub ?? DateTime.SpecifyKind(DateTime.MinValue, DateTimeKind.Utc);
                var card = new TrailerCardDto(
                    x.Id,
                    x.MediaType,
                    x.Title,
                    string.IsNullOrEmpty(x.PosterPath) ? null : $"https://image.tmdb.org/t/p/w500{x.PosterPath}",
                    backdropUrl,
                    pick.Value.Key,
                    TrailerTitleNormalizer.NormalizeClipTitle(pick.Value.Name),
                    string.IsNullOrEmpty(x.ReleaseDate) ? null : x.ReleaseDate,
                    pub);
                bucket.Add((sortUtc, card, pub.HasValue));
            }
        }

        var unreleasedDated = unreleasedCards.Where(t => t.HasDate).OrderByDescending(t => t.SortUtc).ToList();
        var unreleasedUndated = unreleasedCards.Where(t => !t.HasDate).OrderBy(t => t.Card.Title).ToList();
        var releasedDated = releasedCards.Where(t => t.HasDate).OrderByDescending(t => t.SortUtc).ToList();
        var releasedUndated = releasedCards.Where(t => !t.HasDate).OrderBy(t => t.Card.Title).ToList();

        var final = new List<TrailerCardDto>();
        final.AddRange(unreleasedDated.Select(t => t.Card));
        final.AddRange(unreleasedUndated.Select(t => t.Card));

        var needed = maxTrailers - final.Count;
        if (needed > 0)
        {
            final.AddRange(releasedDated.Take(needed).Select(t => t.Card));
            needed = maxTrailers - final.Count;
            if (needed > 0)
                final.AddRange(releasedUndated.Take(needed).Select(t => t.Card));
        }

        return final.Take(maxTrailers).ToList();
    }

    /// <summary>
    /// Same pipeline as <c>/api/home/trailers/latest</c>: external discovery + curated + upcoming-first TMDB pool,
    /// then one clip per title ordered for “new trailers” (not multi-clip browse).
    /// </summary>
    /// <param name="maxApiPasses">
    /// Caps TMDB video fetches per request (each candidate may call videos + optional images). Lower = faster, safer for UI timeouts.
    /// </param>
    public static async Task<List<TrailerCardDto>> BuildHomeLatestTrailerCardsAsync(
        IHttpClientFactory httpFactory,
        IConfiguration configuration,
        ILogger? logger,
        TrailersCuratedPriorityProvider curated,
        TmdbClient tmdb,
        int maxTrailers,
        int recentDays,
        bool wantMovie,
        bool wantTv,
        CancellationToken ct,
        int maxApiPasses = 40,
        bool fetchBackdropInCollect = false,
        bool compactDiscoverPool = true,
        int? maxRssTitlesToResolveOverride = 16)
    {
        try
        {
            List<TmdbDiscoverItem> rssPool;
            try
            {
                (rssPool, _) = await ScrapedTrailerPoolBuilder.BuildFromYoutubeRssAsync(
                        httpFactory, tmdb, configuration, ct, logger, maxRssTitlesToResolveOverride,
                        externalBudgetSeconds: 38,
                        invidiousMaxQueries: 1,
                        invidiousMaxBaseUrls: 2,
                        httpSearchMaxRetriesOverride: 2,
                        httpSearchPerAttemptTimeoutSecondsOverride: 10)
                    .ConfigureAwait(false);
            }
            catch
            {
                rssPool = new List<TmdbDiscoverItem>();
            }

            var basePool = await BuildHomeLatestTrailerCandidatePoolAsync(tmdb, ct, compactDiscoverPool)
                .ConfigureAwait(false);

            var curatedEntries = await curated.TryLoadAsync(ct).ConfigureAwait(false);
            var curatedLoad = new List<Task<TmdbDiscoverItem?>>();
            foreach (var e in curatedEntries)
            {
                var mt = e.MediaType.Trim().ToLowerInvariant();
                if (mt is not ("movie" or "tv") || e.TmdbId <= 0)
                    continue;
                var id = e.TmdbId;
                var mts = mt;
                curatedLoad.Add(tmdb.TryGetDiscoverItemAsync(id, mts, ct));
            }

            var curatedHeaders = new List<TmdbDiscoverItem>();
            foreach (var h in await Task.WhenAll(curatedLoad).ConfigureAwait(false))
            {
                if (h != null)
                    curatedHeaders.Add(h);
            }

            var merged = new List<TmdbDiscoverItem>();
            merged.AddRange(rssPool);
            merged.AddRange(curatedHeaders);
            merged.AddRange(basePool);
            merged = DedupeTrailerCandidatesKeepOrder(merged, wantMovie, wantTv);
            merged = FilterHomeTrailerPool(merged, strict: false);

            var cards = await CollectHomeLatestTrailersByPublishedWindowAsync(
                    tmdb, merged, maxTrailers, recentDays, ct,
                    upcomingTrailerPublishedDays: 105,
                    maxApiPasses: Math.Clamp(maxApiPasses, 16, 120),
                    fetchBackdrop: fetchBackdropInCollect)
                .ConfigureAwait(false);
            return await EnrichTrailerCardsWithCanonicalTmdbAsync(tmdb, cards, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, "BuildHomeLatestTrailerCardsAsync failed — returning empty list");
            return new List<TrailerCardDto>();
        }
    }

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
                    TrailerTitleNormalizer.NormalizeClipTitle(clip.Name),
                    string.IsNullOrEmpty(x.ReleaseDate) ? null : x.ReleaseDate,
                    null));
            }
        }

        return list;
    }

    public static async Task<List<TrailerCardDto>> EnrichTrailerCardsWithCanonicalTmdbAsync(
        TmdbClient tmdb,
        IReadOnlyList<TrailerCardDto> cards,
        CancellationToken ct)
    {
        if (cards.Count == 0)
            return new List<TrailerCardDto>();

        using var gate = new SemaphoreSlim(8, 8);
        var results = new TrailerCardDto[cards.Count];

        async Task OneAsync(int idx)
        {
            var c = cards[idx];
            await gate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                var mt = c.MediaType.Equals("tv", StringComparison.OrdinalIgnoreCase) ? "Series" : "Movie";
                var d = await tmdb.TryGetDiscoverItemAsync(c.TmdbId, mt, ct).ConfigureAwait(false);
                if (d == null)
                {
                    results[idx] = c with { TrailerTitle = TrailerTitleNormalizer.NormalizeClipTitle(c.TrailerTitle) };
                    return;
                }

                var poster = string.IsNullOrEmpty(d.PosterPath)
                    ? c.PosterUrl
                    : $"https://image.tmdb.org/t/p/w500{d.PosterPath}";
                results[idx] = c with
                {
                    Title = d.Title,
                    PosterUrl = poster,
                    ReleaseDate = string.IsNullOrEmpty(d.ReleaseDate) ? c.ReleaseDate : d.ReleaseDate,
                    TrailerTitle = TrailerTitleNormalizer.NormalizeClipTitle(c.TrailerTitle)
                };
            }
            finally
            {
                gate.Release();
            }
        }

        await Task.WhenAll(Enumerable.Range(0, cards.Count).Select(OneAsync)).ConfigureAwait(false);
        return results.ToList();
    }

    private static (string Key, string Name, string Type, int Rank, DateTime? PublishedAtUtc)? PickBestHomeUpcomingPromo(
        IReadOnlyList<(string Key, string Name, string Type, int Rank, DateTime? PublishedAtUtc)> promos)
    {
        var list = promos.Where(p => !string.IsNullOrWhiteSpace(p.Key)).ToList();
        if (list.Count == 0)
            return null;

        var hasTrailerOrTeaser = list.Any(p =>
            p.Type.Equals("Trailer", StringComparison.OrdinalIgnoreCase) ||
            p.Type.Equals("Teaser", StringComparison.OrdinalIgnoreCase));
        var pool = hasTrailerOrTeaser
            ? list.Where(p => !p.Type.Equals("Clip", StringComparison.OrdinalIgnoreCase)).ToList()
            : list;
        if (pool.Count == 0)
            pool = list;

        return pool
            .OrderByDescending(p => p.Type.Equals("Trailer", StringComparison.OrdinalIgnoreCase) ? 4 : 0)
            .ThenByDescending(p => p.Type.Equals("Teaser", StringComparison.OrdinalIgnoreCase) ? 3 : 0)
            .ThenByDescending(p => p.Rank)
            .First();
    }

    public static async Task<List<TrailerCardDto>> CollectHomeUpcomingTrailersAsync(
        TmdbClient tmdb,
        IReadOnlyList<TmdbDiscoverItem> candidates,
        int maxTrailers,
        CancellationToken ct)
    {
        var list = new List<TrailerCardDto>();
        var seenKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var x in candidates)
        {
            if (list.Count >= maxTrailers)
                break;

            var mt = x.MediaType == "tv" ? "Series" : "Movie";
            var promos = await tmdb.GetYoutubePromosDetailedAsync(x.Id, mt, ct).ConfigureAwait(false);
            var pick = PickBestHomeUpcomingPromo(promos);
            if (pick == null || string.IsNullOrEmpty(pick.Value.Key))
                continue;

            var dedupe = $"{x.MediaType}:{x.Id}";
            if (!seenKeys.Add(dedupe))
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

            list.Add(new TrailerCardDto(
                x.Id,
                x.MediaType,
                x.Title,
                string.IsNullOrEmpty(x.PosterPath) ? null : $"https://image.tmdb.org/t/p/w500{x.PosterPath}",
                backdropUrl,
                pick.Value.Key,
                TrailerTitleNormalizer.NormalizeClipTitle(pick.Value.Name),
                string.IsNullOrEmpty(x.ReleaseDate) ? null : x.ReleaseDate,
                pick.Value.PublishedAtUtc));
        }

        return await EnrichTrailerCardsWithCanonicalTmdbAsync(tmdb, list, ct).ConfigureAwait(false);
    }
}
