using Microsoft.Extensions.Caching.Memory;
using Pitflix.Core.Api;
using Pitflix.Core.Config;

namespace Pitflix.API.Services;

public sealed class RatingsAggregationService
{
    private readonly IMemoryCache _cache;
    private readonly IHttpClientFactory _httpFactory;
    private readonly OmdbRatingClient _omdb;

    public RatingsAggregationService(
        IMemoryCache cache,
        IHttpClientFactory httpFactory,
        OmdbRatingClient omdb)
    {
        _cache = cache;
        _httpFactory = httpFactory;
        _omdb = omdb;
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
            return RatingsAggregateDto.Empty;

        double? tmdbAvg = null;
        int? tmdbVotes = null;
        try
        {
            var isMovie = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase);
            var path = isMovie ? $"movie/{tmdbId}" : $"tv/{tmdbId}";
            var url =
                $"{TmdbClient.ApiBaseUrl.TrimEnd('/')}/{path}?api_key={Uri.EscapeDataString(apiKey)}&language=en-US";
            using var http = _httpFactory.CreateClient();
            var json = await http.GetStringAsync(new Uri(url), ct).ConfigureAwait(false);
            var root = System.Text.Json.JsonDocument.Parse(json).RootElement;
            if (root.TryGetProperty("vote_average", out var va) && va.TryGetDouble(out var v))
                tmdbAvg = v;
            if (root.TryGetProperty("vote_count", out var vc) && vc.TryGetInt32(out var c))
                tmdbVotes = c;
        }
        catch
        {
            /* TMDB optional for block */
        }

        string? imdbId = null;
        try
        {
            imdbId = await tmdb.TryGetImdbIdAsync(tmdbId, mediaType, ct).ConfigureAwait(false);
        }
        catch
        {
            /* ignore */
        }

        string? imdbScore = null;
        string? imdbVotesStr = null;
        string? rtCritics = null;
        string? rtAudience = null;

        if (imdbId != null && _omdb.IsConfigured)
        {
            try
            {
                var o = await _omdb.TryGetByImdbIdAsync(imdbId, ct).ConfigureAwait(false);
                if (o != null)
                {
                    imdbScore = o.ImdbRatingOutOf10;
                    imdbVotesStr = o.ImdbVoteCount;
                    rtCritics = o.RottenTomatoesCriticsPercent;
                    rtAudience = o.AudiencePercent;
                }
            }
            catch
            {
                /* optional */
            }
        }

        var dto = new RatingsAggregateDto(
            FetchedAtUtc: DateTime.UtcNow,
            TmdbVoteAverage: tmdbAvg,
            TmdbVoteCount: tmdbVotes,
            ImdbId: imdbId,
            ImdbRatingDisplay: imdbScore,
            ImdbVoteCountDisplay: imdbVotesStr,
            RottenTomatoesCritics: rtCritics,
            RottenTomatoesAudience: rtAudience);

        _cache.Set(key, dto, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(8) });
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
            if (map == null || !map.TryGetValue(episodeNumber, out var row) || row.VoteAverage is null or <= 0)
                return null;

            var dto = new EpisodeRatingDto(row.VoteAverage.Value, "TMDB");
            _cache.Set(key, dto, TimeSpan.FromHours(12));
            return dto;
        }
        catch
        {
            return null;
        }
    }
}

public sealed record RatingsAggregateDto(
    DateTime FetchedAtUtc,
    double? TmdbVoteAverage,
    int? TmdbVoteCount,
    string? ImdbId,
    string? ImdbRatingDisplay,
    string? ImdbVoteCountDisplay,
    string? RottenTomatoesCritics,
    string? RottenTomatoesAudience)
{
    public static RatingsAggregateDto Empty { get; } = new(
        DateTime.UtcNow, null, null, null, null, null, null, null);
}

public sealed record EpisodeRatingDto(double VoteAverage, string Source);
