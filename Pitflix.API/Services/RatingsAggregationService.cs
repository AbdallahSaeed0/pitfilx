using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Pitflix.Core.Api;
using Pitflix.Core.Config;

namespace Pitflix.API.Services;

/// <summary>
/// Tiered ratings: (1) PHP IMDb grabber when PHP is available, (2) OMDb for RT + IMDb gaps, (3) TMDB vote average as baseline.
/// </summary>
public sealed class RatingsAggregationService
{
    private readonly IMemoryCache _cache;
    private readonly OmdbRatingClient _omdb;
    private readonly PhpImdbGrabberClient _phpImdb;
    private readonly ILogger<RatingsAggregationService> _log;

    public RatingsAggregationService(
        IMemoryCache cache,
        OmdbRatingClient omdb,
        PhpImdbGrabberClient phpImdb,
        ILogger<RatingsAggregationService> log)
    {
        _cache = cache;
        _omdb = omdb;
        _phpImdb = phpImdb;
        _log = log;
    }

    public async Task<RatingsAggregateDto> GetAggregateAsync(int tmdbId, string mediaType, CancellationToken ct)
    {
        if (tmdbId <= 0)
            return RatingsAggregateDto.Empty;

        var key = $"ratings:{mediaType}:{tmdbId}";
        if (_cache.TryGetValue(key, out RatingsAggregateDto? cached) && cached != null)
            return cached;

        var tmdb = TmdbClientFactory.Create();
        var apiKey = AppSettings.ResolvedTmdbApiKey;
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
        var omdbVia = "none";
        OmdbMatchKind matchKind = OmdbMatchKind.NoMatch;

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

        OmdbTitleResult? omdbResult = null;
        if (_omdb.IsConfigured)
        {
            if (!string.IsNullOrEmpty(imdbId))
            {
                try
                {
                    omdbResult = await _omdb.TryGetByImdbIdAsync(imdbId, ct).ConfigureAwait(false);
                    if (omdbResult != null)
                    {
                        omdbVia = "imdb_id";
                        matchKind = OmdbMatchKind.TitleExact;
                    }
                    else
                        _log.LogDebug("Ratings: OMDb returned no payload for IMDb id {Imdb}", imdbId);
                }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "Ratings: OMDb by IMDb id failed for {Imdb}", imdbId);
                }
            }

            if (omdbResult == null && anchor != null && !string.IsNullOrWhiteSpace(anchor.Title))
            {
                var omdbType = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase) ? "movie" : "series";
                try
                {
                    var (byTitle, kind) = await _omdb
                        .TryGetByTitleYearTypeAsync(anchor.Title, anchor.Year, omdbType, ct)
                        .ConfigureAwait(false);
                    omdbResult = byTitle;
                    matchKind = kind;
                    if (byTitle != null)
                        omdbVia = "title_year";
                    if (kind == OmdbMatchKind.RateLimited)
                        _log.LogWarning("Ratings: OMDb rate limited during title match for {Title}", anchor.Title);
                    else if (kind == OmdbMatchKind.NoMatch)
                        _log.LogDebug("Ratings: OMDb no title match for {Title} ({Type})", anchor.Title, omdbType);
                    else if (kind == OmdbMatchKind.Ambiguous)
                        _log.LogInformation("Ratings: OMDb ambiguous title match for {Title}", anchor.Title);
                }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "Ratings: OMDb title match failed for {Title}", anchor.Title);
                }
            }

            if (omdbResult != null)
            {
                if (string.IsNullOrEmpty(imdbScore) && !string.IsNullOrEmpty(omdbResult.ImdbRatingOutOf10))
                {
                    imdbScore = omdbResult.ImdbRatingOutOf10;
                    imdbVotesStr = omdbResult.ImdbVoteCount;
                    imdbRatingSource = "omdb";
                }

                rtCritics = omdbResult.RottenTomatoesCriticsPercent;
                rtAudience = omdbResult.AudiencePercent;
            }
        }
        else
            _log.LogDebug("Ratings: OMDb API key not configured — TMDB + PHP only");

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
            OmdbResolvedVia: omdbVia,
            OmdbMatchKind: matchKind.ToString());

        var cacheMins = omdbVia == "none" && _omdb.IsConfigured ? 45 : 8 * 60;
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

        var tmdb = TmdbClientFactory.Create();
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

        if (_omdb.IsConfigured)
        {
            try
            {
                var seriesImdb = await tmdb.TryGetImdbIdAsync(tvTmdbId, "Series", ct).ConfigureAwait(false);
                if (!string.IsNullOrEmpty(seriesImdb))
                {
                    var o = await _omdb.TryGetEpisodeBySeriesImdbIdAsync(seriesImdb, season, episodeNumber, ct)
                        .ConfigureAwait(false);
                    if (o != null &&
                        double.TryParse(o.ImdbRatingOutOf10, System.Globalization.NumberStyles.Float,
                            System.Globalization.CultureInfo.InvariantCulture, out var imdbEp))
                    {
                        var dto = new EpisodeRatingDto(imdbEp, "OMDb");
                        _cache.Set(key, dto, TimeSpan.FromHours(12));
                        return dto;
                    }
                }
            }
            catch (Exception ex)
            {
                _log.LogDebug(ex, "Ratings: OMDb episode enrichment failed for TV {Id} S{Season}E{Ep}", tvTmdbId,
                    season, episodeNumber);
            }
        }

        return null;
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
    string? OmdbResolvedVia,
    string? OmdbMatchKind)
{
    public static RatingsAggregateDto Empty { get; } = new(
        DateTime.UtcNow, null, null, null, null, null, null, null, null, null, null);
}

public sealed record EpisodeRatingDto(double VoteAverage, string Source);
