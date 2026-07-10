using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Pitflix.Core.Api;

namespace Pitflix.API.Services;

/// <summary>
/// Tiered ratings: (1) PHP IMDb grabber when PHP is available, (2) MDBList for RT + IMDb gaps, (3) TMDB vote average as baseline.
/// </summary>
public sealed class RatingsAggregationService
{
    private readonly IMemoryCache _cache;
    private readonly PhpImdbGrabberClient _phpImdb;
    private readonly MdbListService _mdbList;
    private readonly ITmdbClientFactory _tmdbClientFactory;
    private readonly IResolvedApiKeysAccessor _apiKeys;
    private readonly ILogger<RatingsAggregationService> _log;

    public RatingsAggregationService(
        IMemoryCache cache,
        PhpImdbGrabberClient phpImdb,
        MdbListService mdbList,
        ITmdbClientFactory tmdbClientFactory,
        IResolvedApiKeysAccessor apiKeys,
        ILogger<RatingsAggregationService> log)
    {
        _cache = cache;
        _phpImdb = phpImdb;
        _mdbList = mdbList;
        _tmdbClientFactory = tmdbClientFactory;
        _apiKeys = apiKeys;
        _log = log;
    }

    public async Task<RatingsAggregateDto> GetAggregateAsync(int tmdbId, string mediaType, CancellationToken ct)
    {
        if (tmdbId <= 0)
            return RatingsAggregateDto.Empty;

        var key = $"ratings:{mediaType}:{tmdbId}";
        if (_cache.TryGetValue(key, out RatingsAggregateDto? cached) && cached != null)
            return cached;

        var tmdb = _tmdbClientFactory.Create();
        var apiKey = _apiKeys.ResolvedTmdbApiKey;
        if (tmdb == null || string.IsNullOrEmpty(apiKey))
        {
            _log.LogDebug("Ratings: TMDB client or API key unavailable for {Media} {Id}", mediaType, tmdbId);
            return RatingsAggregateDto.Empty;
        }

        var anchor = await tmdb.TryGetRatingsAnchorAsync(tmdbId, mediaType, ct).ConfigureAwait(false);
        double? tmdbAvg = anchor?.VoteAverage;
        int? tmdbVotes = anchor?.VoteCount;

        string? imdbId = anchor?.ImdbId;
        if (string.IsNullOrEmpty(imdbId))
        {
            try
            {
                imdbId = await tmdb.TryGetImdbIdAsync(tmdbId, mediaType, ct).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _log.LogDebug(ex, "Ratings: external_ids fallback failed for {Media} {Id}", mediaType, tmdbId);
            }
        }

        string? imdbScore = null;
        string? imdbVotesStr = null;
        string? imdbRatingSource = null;
        string? rtCritics = null;
        string? rtAudience = null;
        var mdblistVia = "none";
        var matchKind = "NoMatch";

        if (!string.IsNullOrEmpty(imdbId))
        {
            try
            {
                var php = await _phpImdb.TryFetchAsync(imdbId, ct).ConfigureAwait(false);
                if (php != null)
                {
                    imdbScore = php.RatingDisplay;
                    imdbVotesStr = php.VoteCountDisplay;
                    imdbRatingSource = php.Source;
                }
            }
            catch (Exception ex)
            {
                _log.LogDebug(ex, "Ratings: PHP IMDb tier failed for {Imdb}", imdbId);
            }
        }

        MdbListRatings? mdbResult = null;
        try
        {
            mdbResult = await _mdbList.GetRatingsAsync(imdbId, tmdbId, ct).ConfigureAwait(false);
            if (mdbResult != null)
            {
                mdblistVia = !string.IsNullOrEmpty(imdbId) ? "imdb_id" : "tmdb_id";
                matchKind = "Matched";
            }
            else
                _log.LogDebug("Ratings: MDBList returned no payload for {Media} {Id}", mediaType, tmdbId);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Ratings: MDBList lookup failed for {Media} {Id}", mediaType, tmdbId);
            matchKind = "Error";
        }

        if (mdbResult != null)
        {
            if (string.IsNullOrEmpty(imdbScore) && mdbResult.ImdbScore is { } imdbVal)
            {
                imdbScore = imdbVal.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture);
                imdbVotesStr = mdbResult.ImdbVotes?.ToString(System.Globalization.CultureInfo.InvariantCulture);
                imdbRatingSource = "mdblist";
            }

            if (mdbResult.RottenTomatoesScore is { } rt)
                rtCritics = rt.ToString("0", System.Globalization.CultureInfo.InvariantCulture) + "%";
            if (mdbResult.RottenTomatoesAudience is { } rta)
                rtAudience = rta.ToString("0", System.Globalization.CultureInfo.InvariantCulture) + "%";
        }

        var dto = new RatingsAggregateDto(
            FetchedAtUtc: DateTime.UtcNow,
            TmdbVoteAverage: tmdbAvg,
            TmdbVoteCount: tmdbVotes,
            ImdbId: imdbId,
            ImdbRatingDisplay: imdbScore,
            ImdbVoteCountDisplay: imdbVotesStr,
            ImdbRatingSource: imdbRatingSource,
            RottenTomatoesCritics: rtCritics,
            RottenTomatoesAudience: rtAudience,
            SecondarySourceVia: mdblistVia,
            SecondarySourceMatchKind: matchKind,
            FromSnapshot: false,
            IsStale: false);

        var cacheMins = mdblistVia == "none" ? 45 : 8 * 60;
        _cache.Set(key, dto,
            new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(cacheMins) });
        return dto;
    }

    public async Task<EpisodeRatingDto?> TryEpisodeRatingAsync(int tvTmdbId, int season, int episodeNumber,
        CancellationToken ct)
    {
        if (tvTmdbId <= 0 || season < 0 || episodeNumber <= 0)
            return null;

        var key = $"ratings:ep:{tvTmdbId}:{season}:{episodeNumber}";
        if (_cache.TryGetValue(key, out object? cachedEp) && cachedEp is EpisodeRatingDto epHit)
            return epHit;

        var tmdb = _tmdbClientFactory.Create();
        if (tmdb == null)
            return null;

        try
        {
            var map = await tmdb.TryGetTvSeasonEpisodesAsync(tvTmdbId, season, ct).ConfigureAwait(false);
            if (map != null && map.TryGetValue(episodeNumber, out var row) && row.VoteAverage is > 0)
            {
                var dto = new EpisodeRatingDto(row.VoteAverage.Value, "TMDB");
                _cache.Set(key, dto, TimeSpan.FromHours(12));
                return dto;
            }
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Ratings: TMDB episode vote failed for TV {Id} S{Season}E{Ep}", tvTmdbId, season,
                episodeNumber);
        }

        try
        {
            var seriesImdb = await tmdb.TryGetImdbIdAsync(tvTmdbId, "Series", ct).ConfigureAwait(false);
            if (!string.IsNullOrEmpty(seriesImdb))
            {
                var mdbRating = await _mdbList.GetEpisodeRatingAsync(seriesImdb, season, episodeNumber, ct)
                    .ConfigureAwait(false);
                if (mdbRating is > 0)
                {
                    var dto = new EpisodeRatingDto(mdbRating.Value, "MDBList");
                    _cache.Set(key, dto, TimeSpan.FromHours(12));
                    return dto;
                }
            }
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Ratings: MDBList episode enrichment failed for TV {Id} S{Season}E{Ep}", tvTmdbId,
                season, episodeNumber);
        }

        return null;
    }

    /// <summary>Per-episode IMDb score from MDBList.</summary>
    public async Task<double?> TryGetEpisodeImdbRatingAsync(int tvTmdbId, int season, int episodeNumber,
        CancellationToken ct)
    {
        if (tvTmdbId <= 0 || season < 0 || episodeNumber <= 0) return null;

        var key = $"ratings:imdbep:{tvTmdbId}:{season}:{episodeNumber}";
        if (_cache.TryGetValue(key, out double cachedHit))
            return cachedHit;

        var tmdb = _tmdbClientFactory.Create();
        if (tmdb == null) return null;

        string? seriesImdb = null;
        try { seriesImdb = await tmdb.TryGetImdbIdAsync(tvTmdbId, "Series", ct).ConfigureAwait(false); }
        catch { /* non-fatal */ }

        if (string.IsNullOrEmpty(seriesImdb)) return null;

        try
        {
            var mdbRating = await _mdbList.GetEpisodeRatingAsync(seriesImdb, season, episodeNumber, ct).ConfigureAwait(false);
            if (mdbRating is > 0)
            {
                _cache.Set(key, mdbRating.Value, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(12) });
                return mdbRating.Value;
            }
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Ratings: MDBList episode IMDb rating failed for TV {Id} S{Season}E{Ep}", tvTmdbId, season, episodeNumber);
        }

        return null;
    }

    /// <summary>
    /// Cache-only per-episode IMDb score — never waits on MDBList's 1-req/sec rate limit. Use this on
    /// the synchronous request path so season pages render immediately; call
    /// <see cref="WarmEpisodeImdbRatingAsync"/> in the background to backfill anything missing.
    /// </summary>
    public async Task<double?> TryGetCachedEpisodeImdbRatingAsync(int tvTmdbId, int season, int episodeNumber,
        CancellationToken ct)
    {
        if (tvTmdbId <= 0 || season < 0 || episodeNumber <= 0) return null;

        var key = $"ratings:imdbep:{tvTmdbId}:{season}:{episodeNumber}";
        if (_cache.TryGetValue(key, out double cachedHit))
            return cachedHit;

        var tmdb = _tmdbClientFactory.Create();
        if (tmdb == null) return null;

        string? seriesImdb;
        try { seriesImdb = await tmdb.TryGetImdbIdAsync(tvTmdbId, "Series", ct).ConfigureAwait(false); }
        catch { return null; }
        if (string.IsNullOrEmpty(seriesImdb)) return null;

        var (hit, value) = await _mdbList.TryGetCachedEpisodeRatingAsync(seriesImdb, season, episodeNumber, ct)
            .ConfigureAwait(false);
        if (hit && value is > 0)
            _cache.Set(key, value.Value, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(12) });
        return hit ? value : null;
    }

    /// <summary>Cache-only average IMDb score for a TV season (from cached episode rows).</summary>
    public async Task<double?> TryGetCachedSeasonImdbRatingAsync(int tvTmdbId, int season, CancellationToken ct)
    {
        if (tvTmdbId <= 0 || season < 0) return null;

        var key = $"ratings:imdbseason:{tvTmdbId}:{season}";
        if (_cache.TryGetValue(key, out double cachedHit))
            return cachedHit;

        var tmdb = _tmdbClientFactory.Create();
        if (tmdb == null) return null;

        string? seriesImdb;
        try { seriesImdb = await tmdb.TryGetImdbIdAsync(tvTmdbId, "Series", ct).ConfigureAwait(false); }
        catch { return null; }
        if (string.IsNullOrEmpty(seriesImdb)) return null;

        var avg = await _mdbList.TryGetCachedSeasonAverageRatingAsync(seriesImdb, season, ct).ConfigureAwait(false);
        if (avg is > 0)
            _cache.Set(key, avg.Value, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(12) });
        return avg;
    }

    /// <summary>
    /// Best-effort background backfill for an episode's IMDb rating — respects MDBList's rate limit,
    /// so callers should fire this without awaiting it on the request path.
    /// </summary>
    public async Task WarmEpisodeImdbRatingAsync(int tvTmdbId, int season, int episodeNumber)
    {
        try
        {
            await TryGetEpisodeImdbRatingAsync(tvTmdbId, season, episodeNumber, CancellationToken.None)
                .ConfigureAwait(false);
        }
        catch { /* best-effort */ }
    }
}

public sealed record RatingsAggregateDto(
    DateTime FetchedAtUtc,
    double? TmdbVoteAverage,
    int? TmdbVoteCount,
    string? ImdbId,
    string? ImdbRatingDisplay,
    string? ImdbVoteCountDisplay,
    string? ImdbRatingSource,
    string? RottenTomatoesCritics,
    string? RottenTomatoesAudience,
    string? SecondarySourceVia,
    string? SecondarySourceMatchKind,
    bool FromSnapshot = false,
    bool IsStale = false)
{
    public static RatingsAggregateDto Empty { get; } = new(
        DateTime.UtcNow, null, null, null, null, null, null, null, null, null, null,
        FromSnapshot: false,
        IsStale: false);
}

public sealed record EpisodeRatingDto(double VoteAverage, string Source);
