using System.Text.Json;
using Pitflix.Core.Api;
using Pitflix.Core.Config;
using Pitflix.Core.Database;

namespace Pitflix.API.Services;

/// <summary>
/// Builds the "Top 100 Movies on IMDb" and "Top 100 TV Shows on IMDb" lists by real IMDb score
/// rather than TMDB's own vote_average: pulls a ~150-title candidate pool from TMDB (top_rated +
/// popular) for each media type, looks up each one's actual IMDb rating through
/// <see cref="MdbListService"/>, and keeps the top 100 by that score. MDBList is rate-limited to 1
/// request/sec, so ranking both pools takes several minutes — done here as a periodic background
/// rebuild instead of inline per HTTP request, with the results held in <see cref="ImdbTop100Store"/>
/// / <see cref="ImdbTop100TvStore"/> for the discover endpoint to read instantly.
///
/// TV titles need an extra step movies don't: MDBList's tmdbId-only lookup (<c>?tm=</c>) defaults to
/// movies, so a TV candidate's IMDb id has to be resolved first (via TMDB's external_ids) and passed
/// explicitly — the same two-step pattern <c>RatingsAggregationService</c>/<c>RatingsEnrichmentService</c>
/// already use for TV ratings elsewhere in this codebase.
///
/// Both results are also persisted to disk (see <see cref="MovieCacheFilePath"/> /
/// <see cref="TvCacheFilePath"/>) and reloaded on startup: this API restarts often during
/// development (and can any time in production), and without a disk cache every single restart
/// would reset the stores to empty and force a multi-minute rebuild before the rows show real data
/// again — the disk cache means only the first-ever run pays that cost, and every later restart
/// picks the previous result back up immediately.
/// </summary>
public sealed class ImdbTop100RefreshHostedService : BackgroundService
{
    private static readonly string MovieCacheFilePath = Path.Combine(
        Path.GetDirectoryName(LibraryPaths.DatabaseFilePath) ?? ".", "imdb-top100-cache.json");
    private static readonly string TvCacheFilePath = Path.Combine(
        Path.GetDirectoryName(LibraryPaths.DatabaseFilePath) ?? ".", "imdb-top100-tv-cache.json");

    /// <summary>A cache this old is treated as absent rather than loaded — better to briefly show
    /// the TMDB-vote_average fallback than serve a ranking that predates several rebuild cycles.</summary>
    private static readonly TimeSpan MaxCacheAge = TimeSpan.FromHours(36);

    /// <summary>Same floor IMDb's own Top 250 effectively applies — keeps a brand-new release's
    /// opening-week hype votes from outranking titles with real, sustained consensus.</summary>
    private const long MinImdbVotes = 25_000;

    private readonly ImdbTop100Store _movieStore;
    private readonly ImdbTop100TvStore _tvStore;
    private readonly MdbListService _mdbList;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IResolvedApiKeysAccessor _apiKeys;
    private readonly ITmdbClientFactory _tmdbClientFactory;
    private readonly ILogger<ImdbTop100RefreshHostedService> _log;

    public ImdbTop100RefreshHostedService(
        ImdbTop100Store movieStore,
        ImdbTop100TvStore tvStore,
        MdbListService mdbList,
        IHttpClientFactory httpFactory,
        IResolvedApiKeysAccessor apiKeys,
        ITmdbClientFactory tmdbClientFactory,
        ILogger<ImdbTop100RefreshHostedService> log)
    {
        _movieStore = movieStore;
        _tvStore = tvStore;
        _mdbList = mdbList;
        _httpFactory = httpFactory;
        _apiKeys = apiKeys;
        _tmdbClientFactory = tmdbClientFactory;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        TryLoadFromDisk(isMovie: true);
        TryLoadFromDisk(isMovie: false);

        try
        {
            await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromHours(12));
        while (true)
        {
            foreach (var isMovie in new[] { true, false })
            {
                try
                {
                    await RebuildAsync(isMovie, stoppingToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "IMDb Top 100 ({Kind}): rebuild failed", isMovie ? "Movies" : "TV");
                }
            }

            try
            {
                if (!await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
                    return;
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private async Task RebuildAsync(bool isMovie, CancellationToken ct)
    {
        var kindLabel = isMovie ? "Movies" : "TV Shows";
        var tmdbKey = _apiKeys.ResolvedTmdbApiKey;
        if (!AppSettings.IsValidTmdbKey(tmdbKey))
        {
            _log.LogDebug("IMDb Top 100 ({Kind}): TMDB key not configured, skipping rebuild", kindLabel);
            return;
        }

        var http = _httpFactory.CreateClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0");

        var candidates = await FetchCandidatesAsync(tmdbKey!, http, isMovie, ct).ConfigureAwait(false);
        if (candidates.Count == 0)
        {
            _log.LogWarning("IMDb Top 100 ({Kind}): no candidates fetched from TMDB, skipping rebuild", kindLabel);
            return;
        }

        // TV needs its IMDb id resolved before MDBList will return the right title — a bare tmdbId
        // lookup defaults to movies (see class doc). Reuses the same TmdbClient/factory the rest of
        // the app already uses for this, so results share its cache.
        var tmdb = isMovie ? null : _tmdbClientFactory.Create();
        if (!isMovie && tmdb == null)
        {
            _log.LogDebug("IMDb Top 100 (TV): TMDB client unavailable, skipping rebuild");
            return;
        }

        var ranked = new List<(ImdbTop100Item Item, long Votes)>();
        foreach (var c in candidates)
        {
            ct.ThrowIfCancellationRequested();

            string? imdbId = null;
            if (!isMovie)
            {
                try
                {
                    imdbId = await tmdb!.TryGetImdbIdAsync(c.Id, "Series", ct).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _log.LogDebug(ex, "IMDb Top 100 (TV): imdbId lookup failed for TMDB {TmdbId}", c.Id);
                    continue;
                }
                if (string.IsNullOrWhiteSpace(imdbId))
                    continue;
            }

            MdbListRatings? ratings;
            try
            {
                ratings = isMovie
                    ? await _mdbList.GetRatingsAsync(imdbId: null, tmdbId: c.Id, ct).ConfigureAwait(false)
                    : await _mdbList.GetRatingsAsync(imdbId: imdbId, tmdbId: c.Id, ct).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _log.LogDebug(ex, "IMDb Top 100 ({Kind}): rating lookup failed for TMDB {TmdbId}", kindLabel, c.Id);
                continue;
            }

            if (ratings?.ImdbScore is not { } score || score <= 0)
                continue;

            // A brand-new release can rack up a sky-high average from a small burst of opening-day
            // hype votes before the real distribution settles — IMDb's own Top 250 guards against
            // exactly this with a minimum-votes floor, so this mirrors that instead of trusting a
            // score on its own.
            if ((ratings.ImdbVotes ?? 0) < MinImdbVotes)
                continue;

            var item = new ImdbTop100Item(
                c.Id,
                c.Title,
                null,
                string.IsNullOrEmpty(c.PosterPath) ? null : $"https://image.tmdb.org/t/p/w342{c.PosterPath}",
                string.IsNullOrEmpty(c.BackdropPath) ? null : $"https://image.tmdb.org/t/p/w1280{c.BackdropPath}",
                score,
                c.ReleaseDate?.Length >= 4 ? c.ReleaseDate[..4] : null,
                isMovie ? "Movie" : "Series");
            ranked.Add((item, ratings.ImdbVotes ?? 0));
        }

        if (ranked.Count == 0)
        {
            _log.LogWarning("IMDb Top 100 ({Kind}): no candidate had an MDBList IMDb score — is the MDBList API key configured in Settings > Additional Sources?", kindLabel);
            return;
        }

        var top = ranked
            .OrderByDescending(r => r.Item.ImdbRating)
            .ThenByDescending(r => r.Votes)
            .Take(100)
            .Select(r => r.Item)
            .ToList();

        if (isMovie)
            _movieStore.Set(top);
        else
            _tvStore.Set(top);

        _log.LogInformation("IMDb Top 100 ({Kind}): rebuilt with {Count} titles from {Candidates} candidates", kindLabel, top.Count, candidates.Count);
        SaveToDisk(isMovie, top);
    }

    private void TryLoadFromDisk(bool isMovie)
    {
        var path = isMovie ? MovieCacheFilePath : TvCacheFilePath;
        try
        {
            if (!File.Exists(path))
                return;
            if (DateTime.UtcNow - File.GetLastWriteTimeUtc(path) > MaxCacheAge)
                return;

            var json = File.ReadAllText(path);
            var items = JsonSerializer.Deserialize<List<ImdbTop100Item>>(json);
            if (items is not { Count: > 0 })
                return;

            if (isMovie)
                _movieStore.Set(items);
            else
                _tvStore.Set(items);
            _log.LogInformation("IMDb Top 100 ({Kind}): loaded {Count} titles from disk cache", isMovie ? "Movies" : "TV Shows", items.Count);
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "IMDb Top 100 ({Kind}): disk cache load failed, will rebuild live", isMovie ? "Movies" : "TV Shows");
        }
    }

    private void SaveToDisk(bool isMovie, IReadOnlyList<ImdbTop100Item> items)
    {
        var path = isMovie ? MovieCacheFilePath : TvCacheFilePath;
        try
        {
            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir))
                Directory.CreateDirectory(dir);
            File.WriteAllText(path, JsonSerializer.Serialize(items));
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "IMDb Top 100 ({Kind}): failed to persist disk cache", isMovie ? "Movies" : "TV Shows");
        }
    }

    private sealed record Candidate(int Id, string Title, string? PosterPath, string? BackdropPath, string? ReleaseDate);

    /// <summary>Pulls a de-duplicated candidate pool from TMDB's own top_rated + popular lists (movie
    /// or TV) — these are just the starting pool to be re-ranked by real IMDb score above, not the
    /// final answer, so their own ordering/quality bar doesn't matter much.</summary>
    private static async Task<List<Candidate>> FetchCandidatesAsync(string apiKey, HttpClient http, bool isMovie, CancellationToken ct)
    {
        var seen = new HashSet<int>();
        var result = new List<Candidate>();

        async Task FetchListAsync(string endpoint, int pages)
        {
            for (var page = 1; page <= pages; page++)
            {
                ct.ThrowIfCancellationRequested();
                var url = $"https://api.themoviedb.org/3/{endpoint}?api_key={Uri.EscapeDataString(apiKey)}&language=en-US&page={page}";
                string json;
                try
                {
                    json = await http.GetStringAsync(new Uri(url), ct).ConfigureAwait(false);
                }
                catch
                {
                    continue; // best-effort — skip a failed page rather than aborting the whole rebuild
                }

                using var doc = JsonDocument.Parse(json);
                if (!doc.RootElement.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array)
                    continue;

                foreach (var item in results.EnumerateArray())
                {
                    var id = item.TryGetProperty("id", out var idEl) && idEl.TryGetInt32(out var idv) ? idv : 0;
                    if (id <= 0 || !seen.Add(id)) continue;
                    // Movies use "title"/"release_date"; TV uses "name"/"first_air_date".
                    var title = item.TryGetProperty("title", out var t) ? t.GetString()
                        : item.TryGetProperty("name", out var n) ? n.GetString() : null;
                    if (string.IsNullOrWhiteSpace(title)) continue;
                    var poster = item.TryGetProperty("poster_path", out var pp) ? pp.GetString() : null;
                    var backdrop = item.TryGetProperty("backdrop_path", out var bp) ? bp.GetString() : null;
                    var relDate = item.TryGetProperty("release_date", out var rd) ? rd.GetString()
                        : item.TryGetProperty("first_air_date", out var fa) ? fa.GetString() : null;
                    result.Add(new Candidate(id, title!, poster, backdrop, relDate));
                }
            }
        }

        if (isMovie)
        {
            await FetchListAsync("movie/top_rated", 5).ConfigureAwait(false);
            await FetchListAsync("movie/popular", 3).ConfigureAwait(false);
        }
        else
        {
            await FetchListAsync("tv/top_rated", 5).ConfigureAwait(false);
            await FetchListAsync("tv/popular", 3).ConfigureAwait(false);
        }

        return result;
    }
}
