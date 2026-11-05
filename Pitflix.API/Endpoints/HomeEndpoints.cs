using System.Collections.Concurrent;
using System.Linq.Expressions;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Pitflix.API;
using Pitflix.API.Dtos;
using Pitflix.API.Services;
using Pitflix.API.Services.Trakt;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Endpoints;

/// <summary>Slim projection of a Show for /api/home/next-episodes, including the persisted
/// next-airing cache fields (see AddNextAiringCacheMigration) so the endpoint can read them
/// straight from the DB instead of needing a live TMDB call for every show.</summary>
internal sealed class ShowNextAiringRow
{
    public int Id { get; init; }
    public string? Title { get; init; }
    public int TmdbId { get; init; }
    public string? PosterLocalPath { get; init; }
    public string? SelectedPosterPath { get; init; }
    public string? NextEpisodeName { get; init; }
    public int? NextEpisodeSeason { get; init; }
    public int? NextEpisodeNumber { get; init; }
    public string? NextEpisodeAirDate { get; init; }
    public DateTime? NextAiringFetchedAtUtc { get; init; }

    public static readonly Expression<Func<Show, ShowNextAiringRow>> Projection = s => new ShowNextAiringRow
    {
        Id = s.Id,
        Title = s.Title,
        TmdbId = s.TmdbId,
        PosterLocalPath = s.PosterLocalPath,
        SelectedPosterPath = s.SelectedPosterPath,
        NextEpisodeName = s.NextEpisodeName,
        NextEpisodeSeason = s.NextEpisodeSeason,
        NextEpisodeNumber = s.NextEpisodeNumber,
        NextEpisodeAirDate = s.NextEpisodeAirDate,
        NextAiringFetchedAtUtc = s.NextAiringFetchedAtUtc,
    };
}

public static class HomeEndpoints
{
    /// <summary>The (view, limit) combos the UI requests from /api/home/next-episodes (NextEpisodesSection.tsx, NextEpisodesPage.tsx).</summary>
    internal static readonly string[] NextEpisodesCacheKeys =
        { "home:next-episodes:priority:56", "home:next-episodes:all:160", "home:next-episodes:all:200" };

    /// <summary>Drops the server-side Home row caches (Continue Watching / Up Next / next episodes) —
    /// for changes that alter what those rows show, like newly picked artwork.</summary>
    public static void InvalidateHomeCaches(IMemoryCache memoryCache)
    {
        memoryCache.Remove("home:watching-currently");
        foreach (var key in NextEpisodesCacheKeys)
            memoryCache.Remove(key);
    }

    private const string HomeWatchingCurrentlySettingKey = "Cache_HomeWatchingCurrently";

    /// <summary>Recomputes Up Next, updates the in-memory cache, and persists a snapshot for the next
    /// cold start. Shared by the synchronous first-run path and the background refresh.</summary>
    private static async Task<List<WatchingCurrentlyApiRow>> RefreshWatchingCurrentlyAsync(LibraryRepository repo,
        ITmdbClientFactory tmdbClientFactory, IMemoryCache memoryCache, JsonSerializerOptions jsonSerializerOptions,
        CancellationToken ct)
    {
        const string cacheKey = "home:watching-currently";

        var tmdb = tmdbClientFactory.Create();
        // Passing tmdb lets a show whose library episodes are all watched still surface here when TMDB has
        // more aired-but-not-downloaded episodes, instead of dropping out of Up Next entirely.
        var rows = await repo.GetCurrentlyWatchingSeriesAsync(21, 200, tmdb, ct).ConfigureAwait(false);
        var list = rows
            .Select(r => WatchingCurrentlyApiRow.From(r, ImageUrls.ToImageUrl(r.SelectedPosterPath ?? r.PosterLocalPath)))
            .ToList();
        if (tmdb != null && list.Count > 0)
        {
            await Parallel.ForEachAsync(list, new ParallelOptions { MaxDegreeOfParallelism = 5, CancellationToken = ct },
                async (row, token) =>
                {
                    if (!string.IsNullOrEmpty(row.PosterUrl) || row.ShowTmdbId <= 0)
                        return;
                    try
                    {
                        var art = await tmdb.GetArtworkPathsAsync(row.ShowTmdbId, "Series", token).ConfigureAwait(false);
                        if (art != null && !string.IsNullOrEmpty(art.Value.PosterPath))
                            row.PosterUrl = $"https://image.tmdb.org/t/p/w500{art.Value.PosterPath}";
                    }
                    catch
                    {
                        /* optional */
                    }
                }).ConfigureAwait(false);
        }

        // The TMDB fallback lookups (episodes not yet in the library) are what make this endpoint slow —
        // cache the assembled result briefly so repeated home loads/navigations don't repeat them.
        memoryCache.Set(cacheKey, list, TimeSpan.FromMinutes(3));
        try
        {
            await repo.SaveSettingAsync(HomeWatchingCurrentlySettingKey, JsonSerializer.Serialize(list, jsonSerializerOptions), ct)
                .ConfigureAwait(false);
        }
        catch { /* best-effort persistence — worst case, next cold start recomputes inline */ }

        return list;
    }

    public static void MapHomeEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/home/top-rated", async (LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
    await HomeMediaRowsJson(repo, c => repo.GetHomeTopRatedAsync(8, c), ct, tmdbClientFactory, jsonSerializerOptions).ConfigureAwait(false));

        app.MapGet("/api/home/arabic-picks", async (LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
    await HomeMediaRowsJson(repo, c => repo.GetHomeArabicPicksAsync(20, c), ct, tmdbClientFactory, jsonSerializerOptions).ConfigureAwait(false));

        app.MapGet("/api/home/binge-series", async (LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
    await HomeMediaRowsJson(repo, c => repo.GetHomeBingeSeriesAsync(20, c), ct, tmdbClientFactory, jsonSerializerOptions).ConfigureAwait(false));

        app.MapGet("/api/home/movie-night", async (LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
    await HomeMediaRowsJson(repo, c => repo.GetHomeMovieNightAsync(10, null, c), ct, tmdbClientFactory, jsonSerializerOptions).ConfigureAwait(false));

        app.MapGet("/api/home/layout", async (LibraryRepository repo, CancellationToken ct) =>
{
    var raw = await repo.GetHomeLayoutJsonAsync(ct).ConfigureAwait(false);
    if (string.IsNullOrWhiteSpace(raw))
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);
    return Results.Text(raw.Trim(), "application/json");
});

        app.MapPost("/api/home/layout", async (HttpRequest req, LibraryRepository repo, CancellationToken ct) =>
{
    using var reader = new StreamReader(req.Body);
    var body = (await reader.ReadToEndAsync(ct).ConfigureAwait(false)).Trim();
    if (string.IsNullOrWhiteSpace(body))
        return Results.BadRequest();
    await repo.SaveHomeLayoutJsonAsync(body, ct).ConfigureAwait(false);
    return Results.Ok();
});

        app.MapPost("/api/home/section/query", async (HomeSectionQuery query, LibraryRepository repo,
                ITmdbClientFactory tmdbClientFactory, TraktRecommendationsService traktRecs, CancellationToken ct) =>
{
    List<MediaCardDto> rows;
    if (string.Equals(query.SourceType, "trakt_recommendations", StringComparison.OrdinalIgnoreCase))
    {
        rows = await traktRecs.GetHomeCardsAsync(repo, query.Limit, query.MediaType ?? "all", ct)
            .ConfigureAwait(false);
    }
    else
    {
        rows = await repo.ResolveHomeSectionAsync(query, ct).ConfigureAwait(false);
    }

    var mapped = rows.Select(ImageUrls.MapMediaCard).ToList();
    var tmdb = tmdbClientFactory.Create();
    if (tmdb != null)
        await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(mapped, tmdb, ct, repo).ConfigureAwait(false);
    return Results.Json(mapped, jsonSerializerOptions);
});

        app.MapGet("/api/home/featured-fallback", async (LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    var dto = await repo.GetHomeFeaturedFallbackAsync(ct).ConfigureAwait(false);
    if (dto == null)
        return Results.Json(new { card = (object?)null }, jsonSerializerOptions);
    var mapped = ImageUrls.MapMediaCard(dto);
    var list = new List<MediaCardDto> { mapped };
    var tmdb = tmdbClientFactory.Create();
    if (tmdb != null)
        await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(list, tmdb, ct, repo).ConfigureAwait(false);
    return Results.Json(new { card = list[0] }, jsonSerializerOptions);
});

        app.MapGet("/api/home/coming-soon", async (LibraryRepository repo, ITmdbClientFactory tmdbClientFactory,
    IMemoryCache memoryCache, CancellationToken ct) =>
{
    const string cacheKey = "home:coming-soon";
    if (memoryCache.TryGetValue(cacheKey, out object? cachedComingSoon))
        return Results.Json(cachedComingSoon, jsonSerializerOptions);

    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
    {
        return Results.Json(
            new { movies = Array.Empty<object>(), tv = Array.Empty<object>() },
            jsonSerializerOptions);
    }

    var today = DateOnly.FromDateTime(DateTime.UtcNow);
    var todayStr = today.ToString("yyyy-MM-dd");
    // Was 30 days — widened so Coming Soon actually has something to show further out, matching
    // the mobile app's TmdbService.comingSoonWindowDays.
    const int comingSoonWindowDays = 90;
    var cutoffStr = today.AddDays(comingSoonWindowDays).ToString("yyyy-MM-dd");

    // Fetch movies, new series, TMDB candidate pools, AND library shows � all in parallel
    // (2 pages each for movies/new series so the wider window has enough candidates to fill it,
    // same reasoning as the existing 2-page on-the-air/popular-tv fetches below).
    var moviesTask1       = tmdb.GetUpcomingMoviesAsync(1, ct);
    var moviesTask2       = tmdb.GetUpcomingMoviesAsync(2, ct);
    var newTvTask1        = tmdb.DiscoverTvFirstAirFromAsync(todayStr, 1, ct);
    var newTvTask2        = tmdb.DiscoverTvFirstAirFromAsync(todayStr, 2, ct);
    var trendingTvTask    = tmdb.GetTrendingTvWeekAsync(ct);
    var onTheAirTask1     = tmdb.GetOnTheAirTvAsync(1, ct);
    var onTheAirTask2     = tmdb.GetOnTheAirTvAsync(2, ct);
    var popularTvTask1    = tmdb.DiscoverPopularTvAsync(1, ct);
    var popularTvTask2    = tmdb.DiscoverPopularTvAsync(2, ct);
    var libraryShowsTask  = repo.GetAllShowsAsync(ct);
    await Task.WhenAll(moviesTask1, moviesTask2, newTvTask1, newTvTask2, trendingTvTask, onTheAirTask1, onTheAirTask2, popularTvTask1, popularTvTask2, libraryShowsTask).ConfigureAwait(false);

    var movies = moviesTask1.Result.Concat(moviesTask2.Result)
        .GroupBy(m => m.Id).Select(g => g.First())
        .Where(m => TrailersFeedHelpers.IsStrictlyFutureReleaseDate(m.ReleaseDate))
        .ToList();

    // New series: first_air_date is strictly in the future
    var newSeries = newTvTask1.Result.Concat(newTvTask2.Result)
        .GroupBy(t => t.Id).Select(g => g.First())
        .Where(t => TrailersFeedHelpers.IsStrictlyFutureReleaseDate(t.ReleaseDate))
        .ToList();

    // Library shows ? TmdbDiscoverItem stubs so they always enter the candidate pool.
    // This guarantees shows the user is already watching appear if a new season is coming.
    static string? ExtractPosterPath(string? url)
    {
        if (string.IsNullOrEmpty(url)) return null;
        var marker = "image.tmdb.org/t/p/";
        var idx = url.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return null;
        var afterSize = url[(idx + marker.Length)..];
        var slash = afterSize.IndexOf('/');
        return slash >= 0 ? afterSize[slash..] : null;
    }

    var libraryStubs = libraryShowsTask.Result
        .Where(s => s.IsMatched && s.TmdbId > 0)
        .Select(s => new TmdbDiscoverItem
        {
            Id         = s.TmdbId,
            MediaType  = "tv",
            Title      = s.Title,
            PosterPath = ExtractPosterPath(s.PosterRemoteUrl) ?? "",
        })
        .ToList();

    // Candidate pool: library shows first (guaranteed), then TMDB public lists � all deduplicated.
    var newSeriesIds = new HashSet<int>(newSeries.Select(s => s.Id));
    var candidates = libraryStubs
        .Concat(trendingTvTask.Result)
        .Concat(onTheAirTask1.Result)
        .Concat(onTheAirTask2.Result)
        .Concat(popularTvTask1.Result)
        .Concat(popularTvTask2.Result)
        .GroupBy(s => s.Id)
        .Select(g => g.First())
        .Where(s => !newSeriesIds.Contains(s.Id))
        .Take(150)
        .ToList();

    // Enrich each candidate with a concurrency cap to avoid TMDB rate-limiting.
    // Keep shows whose next_episode_to_air is season 2+ and airs within the next 30 days.
    var sem = new SemaphoreSlim(6, 6);
    var enrichTasks = candidates.Select(async show =>
    {
        await sem.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var info = await tmdb.TryGetTvNextAiringAsync(show.Id, ct).ConfigureAwait(false);
            var next = info?.NextEpisode;
            if (next == null) return ((TmdbDiscoverItem Show, int SeasonNumber, string AirDate)?)null;
            var seasonNum  = (int?)next["season_number"];
            var episodeNum = (int?)next["episode_number"];
            var airDate    = (string?)next["air_date"];
            // Season 2+ premiere only � episode 1 means the season hasn't started yet
            if (seasonNum == null || seasonNum < 2 || episodeNum != 1) return null;
            if (string.IsNullOrEmpty(airDate)) return null;
            if (string.Compare(airDate, todayStr,  StringComparison.Ordinal) < 0) return null;
            if (string.Compare(airDate, cutoffStr, StringComparison.Ordinal) > 0) return null;
            return ((TmdbDiscoverItem Show, int SeasonNumber, string AirDate)?)(Show: show, SeasonNumber: seasonNum.Value, AirDate: airDate!);
        }
        finally { sem.Release(); }
    });

    var enriched = (await Task.WhenAll(enrichTasks).ConfigureAwait(false))
        .Where(r => r != null)
        .Select(r => r!.Value)
        .OrderBy(e => e.AirDate)
        .ToList();

    // Merge: new series first, then upcoming seasons (already ordered by air date); deduplicate by tmdbId
    var seenIds = new HashSet<int>(newSeries.Select(s => s.Id));
    var mergedTv = newSeries.Select(s => (Show: s, SeasonNumber: (int?)null, AirDate: s.ReleaseDate)).ToList();
    foreach (var e in enriched)
    {
        if (seenIds.Add(e.Show.Id))
            mergedTv.Add((e.Show, (int?)e.SeasonNumber, e.AirDate));
    }

    object MapMovie(Pitflix.Core.Models.TmdbDiscoverItem x)
    {
        var ov = x.Overview ?? "";
        return new
        {
            tmdbId = x.Id,
            mediaType = "movie",
            title = x.Title,
            releaseDate = x.ReleaseDate,
            posterUrl = string.IsNullOrEmpty(x.PosterPath)
                ? null
                : $"https://image.tmdb.org/t/p/w342{x.PosterPath}",
            overview = ov.Length > 160 ? ov[..160] + "�" : ov,
            voteAverage = x.VoteAverage,
            seasonNumber = (int?)null
        };
    }

    var comingSoonResult = new
        {
            movies = movies.Take(30).Select(MapMovie).ToList(),
            tv = mergedTv.Take(40).Select(e =>
            {
                var x = e.Show;
                var ov = x.Overview ?? "";
                return new
                {
                    tmdbId = x.Id,
                    mediaType = "tv",
                    title = x.Title,
                    releaseDate = e.AirDate,
                    posterUrl = string.IsNullOrEmpty(x.PosterPath)
                        ? null
                        : $"https://image.tmdb.org/t/p/w342{x.PosterPath}",
                    overview = ov.Length > 160 ? ov[..160] + "�" : ov,
                    voteAverage = x.VoteAverage,
                    seasonNumber = e.SeasonNumber
                };
            }).ToList()
        };
    memoryCache.Set(cacheKey, comingSoonResult, TimeSpan.FromMinutes(10));
    return Results.Json(comingSoonResult, jsonSerializerOptions);
});

        app.MapGet("/api/home/next-episodes/pins", async (LibraryRepository repo, CancellationToken ct) =>
{
    var ids = await repo.GetNextEpisodesPinnedShowIdsAsync(ct).ConfigureAwait(false);
    return Results.Json(new { showIds = ids }, jsonSerializerOptions);
});

        app.MapPut("/api/home/next-episodes/pins", async (NextEpisodesPinsDto body, LibraryRepository repo,
    IMemoryCache memoryCache, CancellationToken ct) =>
{
    await repo.SaveNextEpisodesPinnedShowIdsAsync(body.ShowIds, ct).ConfigureAwait(false);
    // Invalidate /api/home/next-episodes's cache (see there) — otherwise a pin/unpin wouldn't
    // reorder the list for up to 3 minutes. Keyed on the (view, limit) combos the UI actually
    // requests (NextEpisodesSection.tsx, NextEpisodesPage.tsx).
    foreach (var key in NextEpisodesCacheKeys)
        memoryCache.Remove(key);
    return Results.Ok();
});

        app.MapGet("/api/home/next-episodes/followed", async (LibraryRepository repo, CancellationToken ct) =>
{
    var list = await repo.GetFollowedExternalShowsAsync(ct).ConfigureAwait(false);
    return Results.Json(list, jsonSerializerOptions);
});

        app.MapPut("/api/home/next-episodes/followed", async (List<FollowedExternalShow>? body, LibraryRepository repo,
    CancellationToken ct) =>
{
    if (body == null)
        return Results.BadRequest();
    await repo.SaveFollowedExternalShowsAsync(body, ct).ConfigureAwait(false);
    return Results.Ok();
});

        app.MapGet("/api/home/next-episodes", async (LibraryContext db, LibraryRepository repo, ITmdbClientFactory tmdbClientFactory,
    IMemoryCache memoryCache, string? view, int? limit,
    CancellationToken ct) =>
{
    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);
    var viewKey = string.Equals(view, "all", StringComparison.OrdinalIgnoreCase) ? "all" : "priority";
    var limitCap = viewKey == "all" ? 240 : 96;
    var takeLimit = Math.Clamp(limit ?? (viewKey == "all" ? 160 : 48), 12, limitCap);

    // Most of this list now reads straight from each Show's persisted next-airing cache (see
    // NextAiringRefreshHostedService) — only shows the background service hasn't seen yet get a
    // live TMDB call below. This extra short-TTL cache still helps avoid re-sorting/re-querying
    // hundreds of rows on every rapid repeat request. Cache key includes viewKey/takeLimit since
    // those change which shows get queried/returned.
    var cacheKey = $"home:next-episodes:{viewKey}:{takeLimit}";
    if (memoryCache.TryGetValue(cacheKey, out object? cachedNextEpisodes))
        return Results.Json(cachedNextEpisodes, jsonSerializerOptions);

    var pinnedIds = await repo.GetNextEpisodesPinnedShowIdsAsync(ct).ConfigureAwait(false);
    var pinnedSet = pinnedIds.Count == 0 ? null : pinnedIds.ToHashSet();

    List<ShowNextAiringRow> pinnedShows;
    if (pinnedSet == null || pinnedSet.Count == 0)
        pinnedShows = new List<ShowNextAiringRow>();
    else
    {
        pinnedShows = await db.Shows.AsNoTracking()
            .Where(s => pinnedSet.Contains(s.Id) && s.IsMatched && s.TmdbId > 0)
            .Select(ShowNextAiringRow.Projection)
            .ToListAsync(ct)
            .ConfigureAwait(false);
    }

    var restQuery = db.Shows.AsNoTracking().Where(s => s.IsMatched && s.TmdbId > 0);
    if (pinnedSet is { Count: > 0 })
        restQuery = restQuery.Where(s => !pinnedSet.Contains(s.Id));
    // Priority view (what Home actually shows) only scans shows you've started or finished —
    // an untouched backlog title's upcoming air date isn't "next up" for you, and skipping it
    // avoids a live TMDB call per show. The "all" view (dedicated Next Episodes page) is an
    // explicit opt-in, so it keeps scanning everything including backlog.
    if (viewKey != "all")
        restQuery = restQuery.Where(s => s.WatchStatus != WatchStatuses.Unwatched);

    var restTake = viewKey == "all" ? 1500 : 900;
    var rest = await restQuery
        .OrderByDescending(s => s.DateAdded)
        .Take(restTake)
        .Select(ShowNextAiringRow.Projection)
        .ToListAsync(ct)
        .ConfigureAwait(false);

    var shows = new List<ShowNextAiringRow>(pinnedShows.Count + rest.Count);
    shows.AddRange(pinnedShows);
    shows.AddRange(rest);

    var libTmdbIds = shows.Select(s => s.TmdbId).ToHashSet();
    var followedExternal = (await repo.GetFollowedExternalShowsAsync(ct).ConfigureAwait(false))
        .Where(f => !libTmdbIds.Contains(f.TmdbId))
        .ToList();

    var today = DateOnly.FromDateTime(DateTime.UtcNow);
    var bag = new ConcurrentBag<(int Tier, bool Pinned, DateOnly Air, string SortTitle, object Row)>();

    void AddLibraryRow(ShowNextAiringRow s, string? name, string? ad, int? sn, int? en)
    {
        if (string.IsNullOrEmpty(ad) || ad.Length < 10)
            return;
        if (!DateOnly.TryParse(ad.AsSpan(0, 10), out var airDay))
            return;
        if (airDay < today)
            return;
        var isPinned = pinnedSet != null && pinnedSet.Contains(s.Id);
        var posterUrl = ImageUrls.ToImageUrl(s.SelectedPosterPath ?? s.PosterLocalPath);
        var row = new
        {
            kind = "library",
            libraryShowId = s.Id,
            showTitle = s.Title,
            showTmdbId = s.TmdbId,
            episodeTitle = name ?? "",
            season = sn,
            episodeNumber = en,
            airDate = ad,
            pinned = isPinned,
            posterUrl,
        };
        var tier = viewKey == "all" ? 1 : (isPinned ? 0 : 1);
        bag.Add((tier, isPinned, airDay, s.Title ?? "", row));
    }

    // Already-fetched (see NextAiringRefreshHostedService) — read straight off the row, no TMDB
    // call needed. A null NextEpisodeAirDate here legitimately means "checked, nothing upcoming".
    foreach (var s in shows.Where(s => s.NextAiringFetchedAtUtc != null))
        AddLibraryRow(s, s.NextEpisodeName, s.NextEpisodeAirDate, s.NextEpisodeSeason, s.NextEpisodeNumber);

    // Never checked yet (new to the library since the background service last saw it) — these are
    // normally few, so a live lookup here is cheap; the background service will keep them warm
    // from here on. Persisted immediately so this show doesn't need a live lookup again either.
    var neverFetched = shows.Where(s => s.NextAiringFetchedAtUtc == null).ToList();
    var freshResults = new ConcurrentBag<(int ShowId, string? Name, int? Season, int? Number, string? AirDate)>();
    await Parallel.ForEachAsync(neverFetched, new ParallelOptions { MaxDegreeOfParallelism = 10, CancellationToken = ct },
        async (s, token) =>
        {
            try
            {
                var air = await tmdb.TryGetTvNextAiringAsync(s.TmdbId, token).ConfigureAwait(false);
                var ne = air?.NextEpisode;
                var name = (string?)ne?["name"];
                var ad = (string?)ne?["air_date"];
                var sn = (int?)ne?["season_number"];
                var en = (int?)ne?["episode_number"];
                freshResults.Add((s.Id, name, sn, en, ad));
                AddLibraryRow(s, name, ad, sn, en);
            }
            catch
            {
                freshResults.Add((s.Id, null, null, null, null));
            }
        }).ConfigureAwait(false);
    if (!freshResults.IsEmpty)
        await repo.SaveNextAiringResultsAsync(freshResults.ToList(), ct).ConfigureAwait(false);

    await Parallel.ForEachAsync(followedExternal, new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = ct },
        async (f, token) =>
        {
            try
            {
                var air = await tmdb.TryGetTvNextAiringAsync(f.TmdbId, token).ConfigureAwait(false);
                if (air == null || air.Value.NextEpisode == null)
                    return;
                var ne = air.Value.NextEpisode;
                var name = (string?)ne["name"] ?? "";
                var ad = (string?)ne["air_date"];
                var sn = (int?)ne["season_number"];
                var en = (int?)ne["episode_number"];
                if (string.IsNullOrEmpty(ad) || ad.Length < 10)
                    return;
                if (!DateOnly.TryParse(ad.AsSpan(0, 10), out var airDay))
                    return;
                if (airDay < today)
                    return;
                string? posterUrl = null;
                if (!string.IsNullOrWhiteSpace(f.PosterPath))
                {
                    var p = f.PosterPath.Trim();
                    posterUrl = p.StartsWith("http", StringComparison.OrdinalIgnoreCase)
                        ? p
                        : $"https://image.tmdb.org/t/p/w500{p.TrimStart('/')}";
                }
                var row = new
                {
                    kind = "followed",
                    libraryShowId = (int?)null,
                    showTitle = string.IsNullOrWhiteSpace(f.Title) ? air.Value.ShowName : f.Title,
                    showTmdbId = f.TmdbId,
                    episodeTitle = name,
                    season = sn,
                    episodeNumber = en,
                    airDate = ad,
                    pinned = false,
                    posterUrl,
                    followed = true,
                };
                bag.Add((2, false, airDay, f.Title ?? "", row));
            }
            catch
            {
                /* skip */
            }
        }).ConfigureAwait(false);

    var ordered = (viewKey == "all"
            ? bag.OrderBy(x => x.Air).ThenBy(x => x.SortTitle, StringComparer.OrdinalIgnoreCase)
            : bag.OrderBy(x => x.Tier)
                .ThenByDescending(x => x.Pinned)
                .ThenBy(x => x.Air)
                .ThenBy(x => x.SortTitle, StringComparer.OrdinalIgnoreCase))
        .Select(x => x.Row)
        .Take(takeLimit)
        .ToList();

    memoryCache.Set(cacheKey, ordered, TimeSpan.FromMinutes(3));
    return Results.Json(ordered, jsonSerializerOptions);
});

        app.MapGet("/api/home/watching-currently", async (LibraryRepository repo, ITmdbClientFactory tmdbClientFactory,
            IMemoryCache memoryCache, IServiceProvider services, CancellationToken ct) =>
{
    const string cacheKey = "home:watching-currently";
    if (memoryCache.TryGetValue(cacheKey, out object? cachedList))
        return Results.Json(cachedList, jsonSerializerOptions);

    // No fresh in-memory cache — either the API just (re)started or the 3-minute TTL lapsed. The TMDB
    // fallback lookups inside GetCurrentlyWatchingSeriesAsync (one show whose library episodes are all
    // watched still needs a live "has TMDB aired a new one?" check) are what make a cold compute slow.
    // Serve the last known-good snapshot — persisted across restarts, not just in-memory — immediately,
    // and refresh in the background, instead of blocking Up Next on every home load.
    List<WatchingCurrentlyApiRow>? snapshot = null;
    try
    {
        var json = await repo.GetSettingAsync(HomeWatchingCurrentlySettingKey, ct).ConfigureAwait(false);
        if (!string.IsNullOrEmpty(json))
            snapshot = JsonSerializer.Deserialize<List<WatchingCurrentlyApiRow>>(json, jsonSerializerOptions);
    }
    catch { /* corrupt/missing snapshot — fall through to a live compute below */ }

    if (snapshot != null)
    {
        // Short TTL: a real refresh is already in flight and will overwrite this shortly.
        memoryCache.Set(cacheKey, snapshot, TimeSpan.FromSeconds(20));
        _ = Task.Run(async () =>
        {
            try
            {
                // Own scope/DbContext — the request's `repo` is disposed once this response returns.
                await using var bgScope = services.CreateAsyncScope();
                var bgRepo = bgScope.ServiceProvider.GetRequiredService<LibraryRepository>();
                var bgTmdbFactory = bgScope.ServiceProvider.GetRequiredService<ITmdbClientFactory>();
                await RefreshWatchingCurrentlyAsync(bgRepo, bgTmdbFactory, memoryCache, jsonSerializerOptions,
                    CancellationToken.None).ConfigureAwait(false);
            }
            catch { /* best-effort */ }
        });
        return Results.Json(snapshot, jsonSerializerOptions);
    }

    // First run ever (no snapshot yet) — nothing to serve, so this one request has to wait.
    var list = await RefreshWatchingCurrentlyAsync(repo, tmdbClientFactory, memoryCache, jsonSerializerOptions, ct)
        .ConfigureAwait(false);
    return Results.Json(list, jsonSerializerOptions);
});

        app.MapPost("/api/home/watching-currently/{showId:int}/dismiss", async (int showId, LibraryRepository repo,
            IMemoryCache memoryCache, IServiceProvider services, CancellationToken ct) =>
{
    if (showId <= 0)
        return Results.BadRequest(new { ok = false, message = "Invalid show id." });
    var ok = await repo.DismissCurrentlyWatchingShowAsync(showId, ct).ConfigureAwait(false);
    if (ok)
    {
        // Clearing the memory cache alone isn't enough — the next load would just fall back to the
        // persisted snapshot, which still has the dismissed show. Refresh both right away.
        memoryCache.Remove("home:watching-currently");
        _ = Task.Run(async () =>
        {
            try
            {
                await using var bgScope = services.CreateAsyncScope();
                var bgRepo = bgScope.ServiceProvider.GetRequiredService<LibraryRepository>();
                var bgTmdbFactory = bgScope.ServiceProvider.GetRequiredService<ITmdbClientFactory>();
                await RefreshWatchingCurrentlyAsync(bgRepo, bgTmdbFactory, memoryCache, jsonSerializerOptions,
                    CancellationToken.None).ConfigureAwait(false);
            }
            catch { /* best-effort */ }
        });
    }
    return ok ? Results.Json(new { ok = true }) : Results.NotFound(new { ok = false });
});

/// <summary>TMDB TV search for shows not necessarily in the library (Next Episodes discovery).</summary>
        app.MapGet("/api/discover/tv-search", async (string? q, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null || string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);

    var hits = await tmdb.SearchAsync(q.Trim(), "Series", false, ct, maxResults: 15).ConfigureAwait(false);
    var mapped = hits.Select(h => new
    {
        tmdbId = h.Id,
        title = h.Title,
        year = string.IsNullOrEmpty(h.ReleaseDate) || h.ReleaseDate.Length < 4
            ? (int?)null
            : int.TryParse(h.ReleaseDate.AsSpan(0, 4), out var y) ? y : null,
        posterUrl = string.IsNullOrEmpty(h.PosterPath) ? null : $"https://image.tmdb.org/t/p/w342{h.PosterPath}",
    }).ToList();
    return Results.Json(mapped, jsonSerializerOptions);
});

/// <summary>Next airing block for any TMDB TV id (library not required).</summary>
        app.MapGet("/api/discover/tv-schedule", async (int tmdbId, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
{
    var tmdb = tmdbClientFactory.Create();
    if (tmdb == null || tmdbId <= 0)
        return Results.Json(null, jsonSerializerOptions);

    var air = await tmdb.TryGetTvNextAiringAsync(tmdbId, ct).ConfigureAwait(false);
    if (air == null || air.Value.NextEpisode == null)
    {
        return Results.Json(new
        {
            ok = false,
            showTitle = air?.ShowName,
            message = "TMDB has no next episode to air for this series (ended, paused, or data missing)."
        }, jsonSerializerOptions);
    }

    var ne = air.Value.NextEpisode;
    var name = (string?)ne["name"] ?? "";
    var ad = (string?)ne["air_date"];
    var sn = (int?)ne["season_number"];
    var en = (int?)ne["episode_number"];
    return Results.Json(new
    {
        ok = true,
        showTitle = air.Value.ShowName,
        tmdbId = tmdbId,
        episodeTitle = name,
        season = sn,
        episodeNumber = en,
        airDate = ad
    }, jsonSerializerOptions);
});
    }

    private static async Task<IResult> HomeMediaRowsJson(LibraryRepository repo,
        Func<CancellationToken, Task<List<MediaCardDto>>> load, CancellationToken ct,
        ITmdbClientFactory tmdbClientFactory,
        JsonSerializerOptions jsonSerializerOptions)
    {
        var raw = await load(ct).ConfigureAwait(false);
        var mapped = raw.Select(ImageUrls.MapMediaCard).ToList();
        var tmdb = tmdbClientFactory.Create();
        if (tmdb != null)
            await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(mapped, tmdb, ct, repo).ConfigureAwait(false);
        return Results.Json(mapped, jsonSerializerOptions);
    }
}