using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pitflix.Core.Models;
using Pitflix.Core.Services;

namespace Pitflix.Core.Api;

public sealed class TmdbClient
{
    public const string ApiBaseUrl = "https://api.themoviedb.org/3/";
    public const string ImageBaseUrl = "https://image.tmdb.org/t/p/w500";

    private readonly HttpClient _http;
    private readonly string _apiKey;

    public TmdbClient(HttpClient http, string apiKey)
    {
        _http = http;
        _apiKey = apiKey;
    }

    private string AbsoluteApiUrl(string pathAndQuery)
    {
        var path = pathAndQuery.TrimStart('/');
        return $"{ApiBaseUrl.TrimEnd('/')}/{path}";
    }

    /// <summary>TV episode metadata for artwork and titles (TMDB <c>tv/{{id}}/season/{{s}}/episode/{{e}}</c>).</summary>
    public async Task<(string? Name, string? StillPath)?> TryGetTvEpisodeAsync(int tvTmdbId, int seasonNumber,
        int episodeNumber, CancellationToken cancellationToken = default)
    {
        if (tvTmdbId <= 0 || seasonNumber < 0 || episodeNumber <= 0)
            return null;

        var url = AbsoluteApiUrl(
            $"tv/{tvTmdbId}/season/{seasonNumber}/episode/{episodeNumber}?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var root = JObject.Parse(json);
            var name = (string?)root["name"];
            var still = (string?)root["still_path"];
            return (string.IsNullOrWhiteSpace(name) ? null : name.Trim(),
                string.IsNullOrWhiteSpace(still) ? null : still);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>TV season episode list (fast path to get stills for a whole season).</summary>
    public async Task<IReadOnlyDictionary<int, (string? Name, string? StillPath, double? VoteAverage)>?> TryGetTvSeasonEpisodesAsync(
        int tvTmdbId, int seasonNumber, CancellationToken cancellationToken = default)
    {
        if (tvTmdbId <= 0 || seasonNumber < 0)
            return null;

        var url = AbsoluteApiUrl(
            $"tv/{tvTmdbId}/season/{seasonNumber}?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var root = JObject.Parse(json);
            var eps = root["episodes"] as JArray;
            if (eps == null || eps.Count == 0)
                return new Dictionary<int, (string?, string?, double?)>();

            var map = new Dictionary<int, (string? Name, string? StillPath, double? VoteAverage)>();
            foreach (var t in eps)
            {
                var num = (int?)t?["episode_number"] ?? 0;
                if (num <= 0)
                    continue;
                var name = (string?)t?["name"];
                var still = (string?)t?["still_path"];
                var vote = (double?)t?["vote_average"];
                map[num] = (string.IsNullOrWhiteSpace(name) ? null : name.Trim(),
                    string.IsNullOrWhiteSpace(still) ? null : still,
                    vote is > 0 ? vote : null);
            }

            return map;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>TMDB <c>number_of_seasons</c> from <c>tv/{{id}}</c>.</summary>
    public async Task<int?> TryGetTvNumberOfSeasonsAsync(int tvTmdbId, CancellationToken cancellationToken = default)
    {
        if (tvTmdbId <= 0)
            return null;

        var url = AbsoluteApiUrl($"tv/{tvTmdbId}?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var root = JObject.Parse(json);
            var n = (int?)root["number_of_seasons"];
            return n is > 0 ? n : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Season poster, title, air date, and counts from <c>tv/{{id}}/season/{{n}}</c>.</summary>
    public async Task<(string Name, string? PosterPath, string? AirDate, int EpisodeCount)?> TryGetTvSeasonHeaderAsync(
        int tvTmdbId, int seasonNumber, CancellationToken cancellationToken = default)
    {
        if (tvTmdbId <= 0 || seasonNumber < 0)
            return null;

        var url = AbsoluteApiUrl(
            $"tv/{tvTmdbId}/season/{seasonNumber}?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var root = JObject.Parse(json);
            var name = (string?)root["name"] ?? $"Season {seasonNumber}";
            var poster = (string?)root["poster_path"];
            var air = (string?)root["air_date"];
            var epCount = (int?)root["episode_count"] ?? (root["episodes"] is JArray ja ? ja.Count : 0);
            return (name.Trim(),
                string.IsNullOrWhiteSpace(poster) ? null : poster,
                string.IsNullOrWhiteSpace(air) ? null : air,
                epCount);
        }
        catch
        {
            return null;
        }
    }

    public async Task<IReadOnlyList<int>> GetKeywordIdsAsync(int tmdbId, string mediaType,
        CancellationToken cancellationToken = default, int maxIds = 8)
    {
        if (tmdbId <= 0 || maxIds <= 0)
            return Array.Empty<int>();

        var isMovie = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase);
        var path = isMovie ? $"movie/{tmdbId}/keywords" : $"tv/{tmdbId}/keywords";
        var url = AbsoluteApiUrl($"{path}?api_key={Uri.EscapeDataString(_apiKey)}");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var root = JObject.Parse(json);
            var keywords = root["keywords"] as JArray ?? root["results"] as JArray;
            if (keywords == null || keywords.Count == 0)
                return Array.Empty<int>();

            var ids = new List<int>(maxIds);
            foreach (var t in keywords)
            {
                var id = (int?)t?["id"] ?? 0;
                if (id <= 0)
                    continue;
                ids.Add(id);
                if (ids.Count >= maxIds)
                    break;
            }

            return ids;
        }
        catch
        {
            return Array.Empty<int>();
        }
    }

    public async Task<string?> TryGetImdbIdAsync(int tmdbId, string mediaType, CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
            return null;

        var isMovie = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase);
        var path = isMovie ? $"movie/{tmdbId}/external_ids" : $"tv/{tmdbId}/external_ids";
        var url = AbsoluteApiUrl($"{path}?api_key={Uri.EscapeDataString(_apiKey)}");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var root = JObject.Parse(json);
            var imdb = (string?)root["imdb_id"];
            return string.IsNullOrWhiteSpace(imdb) ? null : imdb.Trim();
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Single TMDB round-trip for ratings enrichment: votes + external ids + title/year.</summary>
    public async Task<TmdbRatingsAnchor?> TryGetRatingsAnchorAsync(int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
            return null;

        var isMovie = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase);
        var path = isMovie ? $"movie/{tmdbId}" : $"tv/{tmdbId}";
        var url = AbsoluteApiUrl(
            $"{path}?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US&append_to_response=external_ids");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var root = JObject.Parse(json);
            double? va = null;
            int? vc = null;
            if (root["vote_average"] != null && double.TryParse(root["vote_average"]!.ToString(),
                    System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out var v))
                va = v;
            if (root["vote_count"] != null && int.TryParse(root["vote_count"]!.ToString(), out var c))
                vc = c;

            var title = isMovie ? (string?)root["title"] : (string?)root["name"];
            var date = isMovie ? (string?)root["release_date"] : (string?)root["first_air_date"];
            int? year = null;
            if (!string.IsNullOrEmpty(date) && date!.Length >= 4 &&
                int.TryParse(date.AsSpan(0, 4), out var y))
                year = y;

            string? imdb = null;
            var ext = root["external_ids"] as JObject;
            if (ext != null && ext["imdb_id"] != null)
                imdb = ((string?)ext["imdb_id"])?.Trim();

            return new TmdbRatingsAnchor(
                string.IsNullOrWhiteSpace(imdb) ? null : imdb,
                string.IsNullOrWhiteSpace(title) ? "" : title.Trim(),
                year,
                va,
                vc);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Primary title from <c>movie/{{id}}</c> or <c>tv/{{id}}</c> (for cards when library title is missing/garbled).</summary>
    public async Task<string?> TryGetDisplayTitleAsync(int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
            return null;

        var isMovie = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase);
        var path = isMovie ? $"movie/{tmdbId}" : $"tv/{tmdbId}";
        var url = AbsoluteApiUrl($"{path}?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var root = JObject.Parse(json);
            var t = isMovie ? (string?)root["title"] : (string?)root["name"];
            return string.IsNullOrWhiteSpace(t) ? null : t.Trim();
        }
        catch
        {
            return null;
        }
    }

    public async Task<List<TmdbDiscoverItem>> DiscoverMoviesBySignalsAsync(IReadOnlyList<int> genreIds,
        IReadOnlyList<int> keywordIds, int? excludeTmdbId, double minVoteAverage, int minVoteCount, int page,
        CancellationToken cancellationToken = default)
    {
        var q = new List<string>
        {
            $"api_key={Uri.EscapeDataString(_apiKey)}",
            "language=en-US",
            "sort_by=popularity.desc",
            $"vote_average.gte={minVoteAverage.ToString(System.Globalization.CultureInfo.InvariantCulture)}",
            $"vote_count.gte={minVoteCount}",
            $"page={Math.Clamp(page, 1, 500)}"
        };
        // Pipe = OR: match any seed genre/keyword (comma = AND and is usually too strict for “similar”).
        if (genreIds.Count > 0)
            q.Add($"with_genres={string.Join("|", genreIds.Distinct())}");
        if (keywordIds.Count > 0)
            q.Add($"with_keywords={string.Join("|", keywordIds.Distinct())}");

        var url = AbsoluteApiUrl($"discover/movie?{string.Join("&", q)}");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            return ParseDiscoverMovies(json, excludeTmdbId);
        }
        catch
        {
            return new List<TmdbDiscoverItem>();
        }
    }

    public async Task<List<TmdbDiscoverItem>> DiscoverTvBySignalsAsync(IReadOnlyList<int> genreIds,
        IReadOnlyList<int> keywordIds, int? excludeTmdbId, double minVoteAverage, int minVoteCount, int page,
        CancellationToken cancellationToken = default)
    {
        var q = new List<string>
        {
            $"api_key={Uri.EscapeDataString(_apiKey)}",
            "language=en-US",
            "sort_by=popularity.desc",
            $"vote_average.gte={minVoteAverage.ToString(System.Globalization.CultureInfo.InvariantCulture)}",
            $"vote_count.gte={minVoteCount}",
            $"page={Math.Clamp(page, 1, 500)}"
        };
        if (genreIds.Count > 0)
            q.Add($"with_genres={string.Join("|", genreIds.Distinct())}");
        if (keywordIds.Count > 0)
            q.Add($"with_keywords={string.Join("|", keywordIds.Distinct())}");

        var url = AbsoluteApiUrl($"discover/tv?{string.Join("&", q)}");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            return ParseDiscoverTv(json, excludeTmdbId);
        }
        catch
        {
            return new List<TmdbDiscoverItem>();
        }
    }

    private static List<TmdbDiscoverItem> ParseDiscoverMovies(string json, int? excludeTmdbId)
    {
        var root = JObject.Parse(json);
        var results = root["results"] as JArray;
        var list = new List<TmdbDiscoverItem>();
        if (results == null)
            return list;

        foreach (var t in results)
        {
            var id = (int?)t?["id"] ?? 0;
            if (id <= 0 || (excludeTmdbId.HasValue && id == excludeTmdbId.Value))
                continue;
            list.Add(new TmdbDiscoverItem
            {
                Id = id,
                MediaType = "movie",
                Title = (string?)t?["title"] ?? "",
                PosterPath = (string?)t?["poster_path"] ?? "",
                Overview = (string?)t?["overview"] ?? "",
                ReleaseDate = (string?)t?["release_date"] ?? "",
                VoteAverage = (double?)t?["vote_average"] ?? 0,
                VoteCount = (int?)t?["vote_count"] ?? 0,
                GenreIds = ParseGenreIdsArray(t?["genre_ids"] as JArray)
            });
        }

        return list;
    }

    private static List<TmdbDiscoverItem> ParseDiscoverTv(string json, int? excludeTmdbId)
    {
        var root = JObject.Parse(json);
        var results = root["results"] as JArray;
        var list = new List<TmdbDiscoverItem>();
        if (results == null)
            return list;

        foreach (var t in results)
        {
            var id = (int?)t?["id"] ?? 0;
            if (id <= 0 || (excludeTmdbId.HasValue && id == excludeTmdbId.Value))
                continue;
            list.Add(new TmdbDiscoverItem
            {
                Id = id,
                MediaType = "tv",
                Title = (string?)t?["name"] ?? "",
                PosterPath = (string?)t?["poster_path"] ?? "",
                Overview = (string?)t?["overview"] ?? "",
                ReleaseDate = (string?)t?["first_air_date"] ?? "",
                VoteAverage = (double?)t?["vote_average"] ?? 0,
                VoteCount = (int?)t?["vote_count"] ?? 0,
                GenreIds = ParseGenreIdsArray(t?["genre_ids"] as JArray)
            });
        }

        return list;
    }

    private static List<int> ParseGenreIdsArray(JArray? arr)
    {
        if (arr == null || arr.Count == 0)
            return new List<int>();
        var ids = new List<int>();
        foreach (var x in arr)
        {
            var id = x?.Value<int?>() ?? 0;
            if (id > 0)
                ids.Add(id);
        }

        return ids;
    }

    public async Task<List<TmdbDiscoverItem>> GetUpcomingMoviesAsync(int page, CancellationToken cancellationToken = default)
    {
        // region widens the upcoming slate (theatrical window); without it some locales get thin pages.
        var url = AbsoluteApiUrl(
            $"movie/upcoming?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US&page={Math.Clamp(page, 1, 50)}&region=US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            return ParseDiscoverMovies(json, excludeTmdbId: null);
        }
        catch
        {
            return new List<TmdbDiscoverItem>();
        }
    }

    public async Task<List<TmdbDiscoverItem>> GetOnTheAirTvAsync(int page, CancellationToken cancellationToken = default)
    {
        var url = AbsoluteApiUrl(
            $"tv/on_the_air?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US&page={Math.Clamp(page, 1, 50)}");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            return ParseDiscoverTv(json, excludeTmdbId: null);
        }
        catch
        {
            return new List<TmdbDiscoverItem>();
        }
    }

    public async Task<List<TmdbDiscoverItem>> GetTrendingMoviesWeekAsync(CancellationToken cancellationToken = default)
    {
        var url = AbsoluteApiUrl(
            $"trending/movie/week?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            return ParseDiscoverMovies(json, excludeTmdbId: null);
        }
        catch
        {
            return new List<TmdbDiscoverItem>();
        }
    }

    public async Task<List<TmdbDiscoverItem>> GetTrendingTvWeekAsync(CancellationToken cancellationToken = default)
    {
        var url = AbsoluteApiUrl(
            $"trending/tv/week?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            return ParseDiscoverTv(json, excludeTmdbId: null);
        }
        catch
        {
            return new List<TmdbDiscoverItem>();
        }
    }

    /// <summary>TMDB <c>movie/{{id}}/recommendations</c> — good fallback when discover is too narrow.</summary>
    public async Task<List<TmdbDiscoverItem>> GetMovieApiRecommendationsAsync(int movieTmdbId, int page,
        CancellationToken cancellationToken = default)
    {
        if (movieTmdbId <= 0)
            return new List<TmdbDiscoverItem>();

        var url = AbsoluteApiUrl(
            $"movie/{movieTmdbId}/recommendations?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US&page={Math.Clamp(page, 1, 500)}");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            return ParseDiscoverMovies(json, excludeTmdbId: movieTmdbId);
        }
        catch
        {
            return new List<TmdbDiscoverItem>();
        }
    }

    /// <summary>TMDB <c>tv/{{id}}/recommendations</c>.</summary>
    public async Task<List<TmdbDiscoverItem>> GetTvApiRecommendationsAsync(int tvTmdbId, int page,
        CancellationToken cancellationToken = default)
    {
        if (tvTmdbId <= 0)
            return new List<TmdbDiscoverItem>();

        var url = AbsoluteApiUrl(
            $"tv/{tvTmdbId}/recommendations?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US&page={Math.Clamp(page, 1, 500)}");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            return ParseDiscoverTv(json, excludeTmdbId: tvTmdbId);
        }
        catch
        {
            return new List<TmdbDiscoverItem>();
        }
    }

    public async Task<List<TmdbDiscoverItem>> GetNowPlayingMoviesAsync(int page,
        CancellationToken cancellationToken = default)
    {
        var url = AbsoluteApiUrl(
            $"movie/now_playing?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US&page={Math.Clamp(page, 1, 50)}");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            return ParseDiscoverMovies(json, excludeTmdbId: null);
        }
        catch
        {
            return new List<TmdbDiscoverItem>();
        }
    }

    /// <summary>Popular movies (no release-date filter) — broad pool for “latest trailer” discovery by video <c>published_at</c>.</summary>
    public async Task<List<TmdbDiscoverItem>> DiscoverPopularMoviesAsync(int page,
        CancellationToken cancellationToken = default)
    {
        var url = AbsoluteApiUrl(
            $"discover/movie?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US" +
            $"&sort_by=popularity.desc&page={Math.Clamp(page, 1, 500)}&region=US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            return ParseDiscoverMovies(json, excludeTmdbId: null);
        }
        catch
        {
            return new List<TmdbDiscoverItem>();
        }
    }

    /// <summary>Popular TV (no first-air filter) — broad pool for latest-trailer discovery.</summary>
    public async Task<List<TmdbDiscoverItem>> DiscoverPopularTvAsync(int page,
        CancellationToken cancellationToken = default)
    {
        var url = AbsoluteApiUrl(
            $"discover/tv?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US" +
            $"&sort_by=popularity.desc&page={Math.Clamp(page, 1, 500)}");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            return ParseDiscoverTv(json, excludeTmdbId: null);
        }
        catch
        {
            return new List<TmdbDiscoverItem>();
        }
    }

    /// <summary>Movies whose primary release date is on or after <paramref name="fromYyyyMmDd"/> — for “recent” trailer grids.</summary>
    public async Task<List<TmdbDiscoverItem>> DiscoverMoviesPrimaryReleaseFromAsync(string fromYyyyMmDd, int page,
        CancellationToken cancellationToken = default)
    {
        var url = AbsoluteApiUrl(
            $"discover/movie?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US" +
            $"&sort_by=popularity.desc&primary_release_date.gte={Uri.EscapeDataString(fromYyyyMmDd)}" +
            $"&page={Math.Clamp(page, 1, 500)}&region=US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            return ParseDiscoverMovies(json, excludeTmdbId: null);
        }
        catch
        {
            return new List<TmdbDiscoverItem>();
        }
    }

    /// <summary>TV with <c>first_air_date</c> on or after <paramref name="fromYyyyMmDd"/> (popularity order).</summary>
    public async Task<List<TmdbDiscoverItem>> DiscoverTvFirstAirDateGteAsync(string fromYyyyMmDd, int page,
        CancellationToken cancellationToken = default)
    {
        var url = AbsoluteApiUrl(
            $"discover/tv?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US" +
            $"&sort_by=popularity.desc&first_air_date.gte={Uri.EscapeDataString(fromYyyyMmDd)}" +
            $"&page={Math.Clamp(page, 1, 500)}");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            return ParseDiscoverTv(json, excludeTmdbId: null);
        }
        catch
        {
            return new List<TmdbDiscoverItem>();
        }
    }

    /// <summary>TV shows with first air date on or after <paramref name="fromYyyyMmDd"/> (UTC calendar).</summary>
    public async Task<List<TmdbDiscoverItem>> DiscoverTvFirstAirFromAsync(string fromYyyyMmDd, int page,
        CancellationToken cancellationToken = default)
    {
        var url = AbsoluteApiUrl(
            $"discover/tv?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US" +
            $"&sort_by=first_air_date.asc&first_air_date.gte={Uri.EscapeDataString(fromYyyyMmDd)}" +
            $"&page={Math.Clamp(page, 1, 500)}");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            return ParseDiscoverTv(json, excludeTmdbId: null);
        }
        catch
        {
            return new List<TmdbDiscoverItem>();
        }
    }

    private static int YoutubePromoRank(string typeRaw, string nameRaw)
    {
        var type = typeRaw.Trim();
        var name = nameRaw.Trim();
        if (type.Equals("Trailer", StringComparison.OrdinalIgnoreCase))
            return 100 - (name.Contains("teaser", StringComparison.OrdinalIgnoreCase) ? 5 : 0);
        if (type.Equals("Teaser", StringComparison.OrdinalIgnoreCase))
            return 85;
        if (type.Equals("Clip", StringComparison.OrdinalIgnoreCase))
            return 50;
        if (type.Equals("Featurette", StringComparison.OrdinalIgnoreCase))
            return 40;
        if (type.Contains("trailer", StringComparison.OrdinalIgnoreCase) ||
            name.Contains("trailer", StringComparison.OrdinalIgnoreCase))
            return 60;
        if (name.Contains("teaser", StringComparison.OrdinalIgnoreCase))
            return 55;
        return 10;
    }

    private static List<(string Key, string Name, string Type, int Rank)> ParseYoutubePromoRows(JArray? results)
    {
        var rows = new List<(string Key, string Name, string Type, int Rank)>();
        if (results == null)
            return rows;

        foreach (var t in results)
        {
            var site = ((string?)t?["site"] ?? "").Trim();
            if (!site.Equals("YouTube", StringComparison.OrdinalIgnoreCase))
                continue;
            var type = ((string?)t?["type"] ?? "").Trim();
            var name = (string?)t?["name"] ?? "Video";
            var key = (string?)t?["key"];
            if (string.IsNullOrWhiteSpace(key))
                continue;
            rows.Add((key.Trim(), name, type, YoutubePromoRank(type, name)));
        }

        return rows;
    }

    /// <summary>All YouTube promos with TMDB <c>published_at</c> for trailer-age sorting on Home.</summary>
    public async Task<IReadOnlyList<(string Key, string Name, string Type, int Rank, DateTime? PublishedAtUtc)>>
        GetYoutubePromosDetailedAsync(int tmdbId, string mediaType, CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
            return Array.Empty<(string, string, string, int, DateTime?)>();

        var isMovie = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase);
        var path = isMovie ? $"movie/{tmdbId}/videos" : $"tv/{tmdbId}/videos";
        var url = AbsoluteApiUrl($"{path}?api_key={Uri.EscapeDataString(_apiKey)}");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var root = JObject.Parse(json);
            return ParseYoutubePromoRowsDetailed(root["results"] as JArray);
        }
        catch
        {
            return Array.Empty<(string, string, string, int, DateTime?)>();
        }
    }

    private static IReadOnlyList<(string Key, string Name, string Type, int Rank, DateTime? PublishedAtUtc)>
        ParseYoutubePromoRowsDetailed(JArray? results)
    {
        var rows = new List<(string Key, string Name, string Type, int Rank, DateTime? PublishedAtUtc)>();
        if (results == null)
            return rows;

        foreach (var t in results)
        {
            var site = ((string?)t?["site"] ?? "").Trim();
            if (!site.Equals("YouTube", StringComparison.OrdinalIgnoreCase))
                continue;
            var type = ((string?)t?["type"] ?? "").Trim();
            var name = (string?)t?["name"] ?? "Video";
            var key = (string?)t?["key"];
            if (string.IsNullOrWhiteSpace(key))
                continue;
            DateTime? pub = null;
            var pubRaw = (string?)t?["published_at"];
            if (!string.IsNullOrWhiteSpace(pubRaw) &&
                DateTime.TryParse(pubRaw, System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                    out var dto))
                pub = dto;
            rows.Add((key.Trim(), name, type, YoutubePromoRank(type, name), pub));
        }

        return rows;
    }

    /// <summary>
    /// Best YouTube trailer and best teaser when they differ (TMDB <c>type</c>), so browse grids can show both.
    /// Falls back to a single highest-ranked promo when there is no <c>Trailer</c>/<c>Teaser</c> pair.
    /// </summary>
    public async Task<List<(string Key, string Name)>> TryGetTrailerAndTeaserClipsAsync(int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
            return new List<(string Key, string Name)>();

        var isMovie = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase);
        var path = isMovie ? $"movie/{tmdbId}/videos" : $"tv/{tmdbId}/videos";
        var url = AbsoluteApiUrl($"{path}?api_key={Uri.EscapeDataString(_apiKey)}");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var root = JObject.Parse(json);
            var rows = ParseYoutubePromoRows(root["results"] as JArray);
            if (rows.Count == 0)
                return new List<(string Key, string Name)>();

            var trailerBest = rows
                .Where(r => r.Type.Equals("Trailer", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(r => r.Rank)
                .FirstOrDefault();

            var teaserBest = rows
                .Where(r => r.Type.Equals("Teaser", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(r => r.Rank)
                .FirstOrDefault();

            var list = new List<(string Key, string Name)>();
            if (!string.IsNullOrEmpty(trailerBest.Key))
                list.Add((trailerBest.Key, trailerBest.Name));
            if (!string.IsNullOrEmpty(teaserBest.Key) &&
                !string.Equals(teaserBest.Key, trailerBest.Key, StringComparison.Ordinal))
                list.Add((teaserBest.Key, teaserBest.Name));

            if (list.Count == 0)
            {
                var best = rows.OrderByDescending(r => r.Rank).First();
                list.Add((best.Key, best.Name));
            }

            return list;
        }
        catch
        {
            return new List<(string Key, string Name)>();
        }
    }

    /// <summary>First YouTube promo (trailer preferred when present, else best-ranked).</summary>
    public async Task<(string Key, string Name)?> TryGetFeaturedTrailerAsync(int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        var clips = await TryGetTrailerAndTeaserClipsAsync(tmdbId, mediaType, cancellationToken).ConfigureAwait(false);
        return clips.Count > 0 ? clips[0] : null;
    }

    public async Task<(JObject? NextEpisode, string? ShowName)?> TryGetTvNextAiringAsync(int tvTmdbId,
        CancellationToken cancellationToken = default)
    {
        if (tvTmdbId <= 0)
            return null;

        var url = AbsoluteApiUrl($"tv/{tvTmdbId}?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var root = JObject.Parse(json);
            var showName = (string?)root["name"] ?? "";
            var next = root["next_episode_to_air"] as JObject;
            return (next, string.IsNullOrWhiteSpace(showName) ? null : showName.Trim());
        }
        catch
        {
            return null;
        }
    }

    public async Task<IReadOnlyList<int>> GetGenreIdsAsync(int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
            return Array.Empty<int>();

        var isMovie = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase);
        var path = isMovie ? $"movie/{tmdbId}" : $"tv/{tmdbId}";
        var url = AbsoluteApiUrl($"{path}?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var root = JObject.Parse(json);
            var genres = root["genres"] as JArray;
            if (genres == null || genres.Count == 0)
                return Array.Empty<int>();

            var ids = new List<int>();
            foreach (var g in genres)
            {
                var id = (int?)g?["id"] ?? 0;
                if (id > 0)
                    ids.Add(id);
            }

            return ids;
        }
        catch
        {
            return Array.Empty<int>();
        }
    }

    public async Task<List<TmdbSearchResult>> SearchAsync(string cleanName, string mediaType, bool isArabic,
        CancellationToken cancellationToken = default, int maxResults = 5)
    {
        if (string.IsNullOrWhiteSpace(cleanName))
            return new List<TmdbSearchResult>();

        var cap = Math.Clamp(maxResults, 1, 20);
        var merged = new List<TmdbSearchResult>();
        var seen = new HashSet<int>();

        void TryAdd(IEnumerable<TmdbSearchResult> items)
        {
            foreach (var x in items)
            {
                if (seen.Add(x.Id))
                    merged.Add(x);
                if (merged.Count >= cap)
                    return;
            }
        }

        var en = await SearchOnceAsync(cleanName, mediaType, "en-US", cancellationToken).ConfigureAwait(false);
        TryAdd(en);

        if (isArabic && merged.Count < cap)
        {
            var ar = await SearchOnceAsync(cleanName, mediaType, "ar", cancellationToken).ConfigureAwait(false);
            TryAdd(ar);
        }

        return merged;
    }

    /// <summary>Search hits shaped like discover rows so trailer collection can reuse the same pipeline.</summary>
    public async Task<List<TmdbDiscoverItem>> SearchDiscoverForTrailersAsync(string query, bool includeMovies,
        bool includeTv, int maxPerType, CancellationToken cancellationToken = default)
    {
        var q = query?.Trim() ?? "";
        var list = new List<TmdbDiscoverItem>();
        if (q.Length < 2)
            return list;

        var cap = Math.Clamp(maxPerType, 1, 25);
        if (includeMovies)
        {
            foreach (var r in await SearchAsync(q, "Movie", false, cancellationToken, cap).ConfigureAwait(false))
            {
                list.Add(new TmdbDiscoverItem
                {
                    Id = r.Id,
                    MediaType = "movie",
                    Title = r.Title,
                    PosterPath = r.PosterPath ?? "",
                    Overview = r.Overview ?? "",
                    ReleaseDate = r.ReleaseDate,
                    VoteAverage = 0,
                    VoteCount = (int)Math.Clamp(r.Popularity * 20.0, 0, int.MaxValue),
                });
            }
        }

        if (includeTv)
        {
            foreach (var r in await SearchAsync(q, "Series", false, cancellationToken, cap).ConfigureAwait(false))
            {
                list.Add(new TmdbDiscoverItem
                {
                    Id = r.Id,
                    MediaType = "tv",
                    Title = r.Title,
                    PosterPath = r.PosterPath ?? "",
                    Overview = r.Overview ?? "",
                    ReleaseDate = r.ReleaseDate,
                    VoteAverage = 0,
                    VoteCount = (int)Math.Clamp(r.Popularity * 20.0, 0, int.MaxValue),
                });
            }
        }

        return list;
    }

    private async Task<List<TmdbSearchResult>> SearchOnceAsync(string cleanName, string mediaType, string language,
        CancellationToken cancellationToken)
    {
        var endpoint = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase)
            ? "search/movie"
            : "search/tv";

        var url = AbsoluteApiUrl(
            $"{endpoint}?api_key={Uri.EscapeDataString(_apiKey)}&query={Uri.EscapeDataString(cleanName)}&language={Uri.EscapeDataString(language)}");

        var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
        var jo = JObject.Parse(json);
        var results = jo["results"] as JArray;
        if (results == null || results.Count == 0)
            return new List<TmdbSearchResult>();

        var list = new List<TmdbSearchResult>();
        foreach (var token in results)
        {
            var item = token?.ToObject<TmdbSearchResult>();
            if (item != null)
                list.Add(item);
        }

        return list;
    }

    private const int MaxTopBilledCast = 10;

    public async Task<TmdbDetails> GetDetailsAsync(int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        var isMovie = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase);
        var path = isMovie ? $"movie/{tmdbId}" : $"tv/{tmdbId}";
        var detailsUrl = AbsoluteApiUrl($"{path}?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US");
        var json = await _http.GetStringAsync(detailsUrl, cancellationToken).ConfigureAwait(false);
        var details = ParseDetails(json);
        details.Similar.Clear();

        var creditsJson = await TryFetchCreditsJsonAsync(tmdbId, mediaType, cancellationToken).ConfigureAwait(false);
        if (creditsJson != null)
        {
            var (cast, crew) = ParseFullCreditsResponse(creditsJson);
            details.Cast = cast;
            details.Crew = crew;
            await DownloadCastAndCrewPortraitCachesAsync(details.Cast, details.Crew, cancellationToken)
                .ConfigureAwait(false);
        }
        else
        {
            details.Cast = new List<TmdbCastMember>();
            details.Crew = new List<TmdbCrewMember>();
        }

        return details;
    }

    /// <summary>TMDB <c>/credits</c> only: top-billed cast + portrait cache downloads (no movie/tv details request).</summary>
    public async Task<List<TmdbCastMember>?> TryFetchTopCastWithPortraitCachesAsync(int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
            return null;
        var json = await TryFetchCreditsJsonAsync(tmdbId, mediaType, cancellationToken).ConfigureAwait(false);
        if (json == null)
            return null;
        var (cast, _) = ParseFullCreditsResponse(json);
        await DownloadCastPortraitCachesAsync(cast, cancellationToken).ConfigureAwait(false);
        return cast;
    }

    private async Task<string?> TryFetchCreditsJsonAsync(int tmdbId, string mediaType,
        CancellationToken cancellationToken)
    {
        var isMovie = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase);
        var path = isMovie ? $"movie/{tmdbId}" : $"tv/{tmdbId}";
        var creditsUrl = AbsoluteApiUrl($"{path}/credits?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US");
        try
        {
            return await _http.GetStringAsync(creditsUrl, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            return null;
        }
    }

    private async Task DownloadCastPortraitCachesAsync(IList<TmdbCastMember> cast,
        CancellationToken cancellationToken)
    {
        for (var i = 0; i < cast.Count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (i >= MaxTopBilledCast)
                break;
            var c = cast[i];
            if (string.IsNullOrWhiteSpace(c.ProfilePath))
                continue;
            c.ProfileLocalPath = await ImageCacheService
                .GetOrDownloadAsync(_http, c.ProfilePath, "Cast", TmdbImageUrls.PersonProfileAvatarSize,
                    cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task DownloadCastAndCrewPortraitCachesAsync(IList<TmdbCastMember> cast, IList<TmdbCrewMember> crew,
        CancellationToken cancellationToken)
    {
        await DownloadCastPortraitCachesAsync(cast, cancellationToken).ConfigureAwait(false);
        foreach (var c in crew)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(c.ProfilePath))
                continue;
            c.ProfileLocalPath = await ImageCacheService
                .GetOrDownloadAsync(_http, c.ProfilePath, "Crew", TmdbImageUrls.PersonProfileAvatarSize,
                    cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>Poster and backdrop paths only — no credits (avoids N× cast image downloads for bulk refresh).</summary>
    public async Task<(string PosterPath, string BackdropPath)?> GetArtworkPathsAsync(int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
            return null;

        var isMovie = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase);
        var path = isMovie ? $"movie/{tmdbId}" : $"tv/{tmdbId}";
        var url = AbsoluteApiUrl($"{path}?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var root = JObject.Parse(json);
            var poster = (string?)root["poster_path"] ?? "";
            var backdrop = (string?)root["backdrop_path"] ?? "";
            return (poster, backdrop);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Minimal title + dates + vote/popularity fields shaped like a discover row.
    /// Used for curated trailer priority injection so we can merge “must-consider” titles into the same pipeline.
    /// </summary>
    public async Task<TmdbDiscoverItem?> TryGetDiscoverItemAsync(int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
            return null;

        var isMovie = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase) ||
                      mediaType.Equals("movie", StringComparison.OrdinalIgnoreCase);
        var isTv = mediaType.Equals("Series", StringComparison.OrdinalIgnoreCase) ||
                   mediaType.Equals("tv", StringComparison.OrdinalIgnoreCase);
        if (!isMovie && !isTv)
            return null;

        var path = isMovie ? $"movie/{tmdbId}" : $"tv/{tmdbId}";
        var url = AbsoluteApiUrl($"{path}?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var root = JObject.Parse(json);
            var title = isMovie ? (string?)root["title"] : (string?)root["name"];
            var poster = (string?)root["poster_path"];
            var overview = (string?)root["overview"];
            var release = isMovie ? (string?)root["release_date"] : (string?)root["first_air_date"];
            var voteAvg = (double?)root["vote_average"] ?? 0;
            var voteCount = (int?)root["vote_count"] ?? 0;
            var genres = root["genres"] as JArray;
            var genreIds = new List<int>();
            if (genres != null)
            {
                foreach (var g in genres)
                {
                    var id = (int?)g?["id"] ?? 0;
                    if (id > 0)
                        genreIds.Add(id);
                }
            }

            return new TmdbDiscoverItem
            {
                Id = tmdbId,
                MediaType = isMovie ? "movie" : "tv",
                Title = string.IsNullOrWhiteSpace(title) ? "" : title.Trim(),
                PosterPath = string.IsNullOrWhiteSpace(poster) ? "" : poster,
                Overview = string.IsNullOrWhiteSpace(overview) ? "" : overview.Trim(),
                ReleaseDate = string.IsNullOrWhiteSpace(release) ? "" : release.Trim(),
                VoteAverage = voteAvg,
                VoteCount = voteCount,
                GenreIds = genreIds
            };
        }
        catch
        {
            return null;
        }
    }

    /// <summary>First TMDB movie search hit. <paramref name="primaryReleaseYear"/> maps to API <c>year</c>.</summary>
    public async Task<int?> TryFindMovieIdBySearchAsync(string query, int? primaryReleaseYear,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query))
            return null;
        var q = Uri.EscapeDataString(query.Trim());
        var y = primaryReleaseYear is >= 1900 && primaryReleaseYear <= 2100
            ? $"&year={primaryReleaseYear.Value}"
            : "";
        var url = AbsoluteApiUrl(
            $"search/movie?api_key={Uri.EscapeDataString(_apiKey)}&query={q}&page=1{y}&language=en-US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var jo = JObject.Parse(json);
            var results = jo["results"] as JArray;
            if (results == null || results.Count == 0)
                return null;
            return (int?)results[0]?["id"];
        }
        catch
        {
            return null;
        }
    }

    /// <summary>First TMDB TV search hit.</summary>
    public async Task<int?> TryFindTvIdBySearchAsync(string query, int? firstAirYear,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query))
            return null;
        var q = Uri.EscapeDataString(query.Trim());
        var y = firstAirYear is >= 1900 && firstAirYear <= 2100
            ? $"&first_air_date_year={firstAirYear.Value}"
            : "";
        var url = AbsoluteApiUrl(
            $"search/tv?api_key={Uri.EscapeDataString(_apiKey)}&query={q}&page=1{y}&language=en-US");
        try
        {
            var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
            var jo = JObject.Parse(json);
            var results = jo["results"] as JArray;
            if (results == null || results.Count == 0)
                return null;
            return (int?)results[0]?["id"];
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Awards-only: evaluates multiple search results with title + release-year gates. Never returns the first TMDB row blindly.
    /// </summary>
    public async Task<int?> TryFindAwardsMovieMatchAsync(string query, IReadOnlyList<int> searchYears,
        string nomineeTitleForScoring, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query) || searchYears.Count == 0)
            return null;
        var qEnc = Uri.EscapeDataString(query.Trim());
        var distinctYears = searchYears.Where(static y => y is >= 1870 and <= 2100).Distinct().ToList();
        if (distinctYears.Count == 0)
            return null;

        var bestScore = 0;
        int? bestId = null;
        foreach (var year in distinctYears)
        {
            var url = AbsoluteApiUrl(
                $"search/movie?api_key={Uri.EscapeDataString(_apiKey)}&query={qEnc}&page=1&year={year}&language=en-US");
            try
            {
                var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
                var jo = JObject.Parse(json);
                var results = jo["results"] as JArray;
                if (results == null || results.Count == 0)
                    continue;
                foreach (var token in results.Take(15))
                {
                    var id = (int?)token?["id"] ?? 0;
                    if (id <= 0)
                        continue;
                    var title = (string?)token?["title"];
                    var ot = (string?)token?["original_title"];
                    var rd = (string?)token?["release_date"];
                    var score = AwardsTmdbMatch.TitleScore(nomineeTitleForScoring, title, ot);
                    if (!AwardsTmdbMatch.YearConstraintOk(rd, searchYears, score))
                        continue;
                    if (score < AwardsTmdbMatch.MinTitleScore)
                        continue;
                    if (score > bestScore)
                    {
                        bestScore = score;
                        bestId = id;
                    }
                }
            }
            catch
            {
                /* next year */
            }
        }

        return bestScore >= AwardsTmdbMatch.MinTitleScore ? bestId : null;
    }

    /// <summary>Awards-only TV search with <c>first_air_date_year</c> + strict title scoring.</summary>
    public async Task<int?> TryFindAwardsTvMatchAsync(string query, IReadOnlyList<int> firstAirYears,
        string nomineeTitleForScoring, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query) || firstAirYears.Count == 0)
            return null;
        var qEnc = Uri.EscapeDataString(query.Trim());
        var distinctYears = firstAirYears.Where(static y => y is >= 1870 and <= 2100).Distinct().ToList();
        if (distinctYears.Count == 0)
            return null;

        var bestScore = 0;
        int? bestId = null;
        foreach (var year in distinctYears)
        {
            var url = AbsoluteApiUrl(
                $"search/tv?api_key={Uri.EscapeDataString(_apiKey)}&query={qEnc}&page=1&first_air_date_year={year}&language=en-US");
            try
            {
                var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
                var jo = JObject.Parse(json);
                var results = jo["results"] as JArray;
                if (results == null || results.Count == 0)
                    continue;
                foreach (var token in results.Take(15))
                {
                    var id = (int?)token?["id"] ?? 0;
                    if (id <= 0)
                        continue;
                    var title = (string?)token?["name"];
                    var ot = (string?)token?["original_name"];
                    var rd = (string?)token?["first_air_date"];
                    var score = AwardsTmdbMatch.TitleScore(nomineeTitleForScoring, title, ot);
                    if (!AwardsTmdbMatch.YearConstraintOk(rd, firstAirYears, score))
                        continue;
                    if (score < AwardsTmdbMatch.MinTitleScore)
                        continue;
                    if (score > bestScore)
                    {
                        bestScore = score;
                        bestId = id;
                    }
                }
            }
            catch
            {
                /* next year */
            }
        }

        return bestScore >= AwardsTmdbMatch.MinTitleScore ? bestId : null;
    }

    private static TmdbDetails ParseDetails(string json)
    {
        var root = JObject.Parse(json);

        var details = new TmdbDetails
        {
            Id = (int)root["id"]!,
            OriginalLanguage = (string?)root["original_language"] ?? "",
            Title = (string?)root["title"] ?? (string?)root["name"] ?? "",
            OriginalTitle = (string?)root["original_title"] ?? (string?)root["original_name"] ?? "",
            Overview = (string?)root["overview"] ?? "",
            PosterPath = (string?)root["poster_path"] ?? "",
            BackdropPath = (string?)root["backdrop_path"] ?? "",
            ReleaseDate = (string?)root["release_date"] ?? (string?)root["first_air_date"] ?? "",
            VoteAverage = (double?)root["vote_average"] ?? 0,
            Runtime = (int?)root["runtime"]
        };

        details.Genres = new List<string>();
        if (root["genres"] is JArray genres)
        {
            foreach (var g in genres)
                details.Genres.Add((string?)g?["name"] ?? "");
        }

        details.Cast = new List<TmdbCastMember>();
        details.Crew = new List<TmdbCrewMember>();

        details.Similar = new List<TmdbSearchResult>();
        return details;
    }

    /// <summary>Parses TMDB <c>/movie/{{id}}/credits</c> or <c>/tv/{{id}}/credits</c> JSON (full cast list + crew).</summary>
    private static (List<TmdbCastMember> Cast, List<TmdbCrewMember> Crew) ParseFullCreditsResponse(string creditsJson)
    {
        var root = JObject.Parse(creditsJson);
        var castOut = new List<TmdbCastMember>();
        var castArr = root["cast"] as JArray;
        if (castArr != null)
        {
            foreach (var c in castArr)
            {
                var id = (int?)c?["id"] ?? 0;
                if (id <= 0)
                    continue;
                var order = (int?)c?["order"];
                var sortKey = order is >= 0 and < 10_000 ? order.Value : 9999;
                var profilePath = (string?)c?["profile_path"] ?? "";
                castOut.Add(new TmdbCastMember
                {
                    Id = id,
                    Name = NormalizeCastPersonName((string?)c?["name"]),
                    Character = NormalizeCastCharacter((string?)c?["character"]),
                    ProfilePath = profilePath,
                    BillingOrder = sortKey
                });
            }
        }

        castOut = castOut
            .OrderBy(x => x.BillingOrder)
            .ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
            .GroupBy(x => x.Id)
            .Select(g => g.First())
            .Take(MaxTopBilledCast)
            .ToList();

        for (var i = 0; i < castOut.Count; i++)
            castOut[i].BillingOrder = i;

        var crew = new List<TmdbCrewMember>();
        var crewJobs = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Director", "Producer", "Executive Producer", "Co-Producer", "Writer", "Screenplay", "Creator"
        };
        var crewArr = root["crew"] as JArray;
        if (crewArr != null)
        {
            var seenPerson = new HashSet<int>();
            foreach (var t in crewArr)
            {
                var job = (string?)t?["job"] ?? "";
                if (!crewJobs.Contains(job))
                    continue;
                var pid = (int?)t?["id"] ?? 0;
                if (pid <= 0 || !seenPerson.Add(pid))
                    continue;
                var nm = NormalizeCastPersonName((string?)t?["name"]);
                crew.Add(new TmdbCrewMember
                {
                    Id = pid,
                    Name = nm,
                    Job = string.IsNullOrWhiteSpace(job) ? "—" : job.Trim(),
                    ProfilePath = (string?)t?["profile_path"] ?? ""
                });
                if (crew.Count >= 18)
                    break;
            }
        }

        return (castOut, crew);
    }

    private static string NormalizeCastPersonName(string? raw)
    {
        var s = (raw ?? "").Trim();
        s = Regex.Replace(s, @"\s+", " ");
        return string.IsNullOrEmpty(s) ? "Unknown" : s;
    }

    private static string NormalizeCastCharacter(string? raw)
    {
        var s = (raw ?? "").Trim();
        s = Regex.Replace(s, @"\s+", " ");
        return string.IsNullOrEmpty(s) ? "—" : s;
    }

    public async Task<TmdbPersonDetails?> GetPersonDetailsAsync(int personId,
        CancellationToken cancellationToken = default)
    {
        if (personId <= 0)
            return null;

        var url = AbsoluteApiUrl(
            $"person/{personId}?api_key={Uri.EscapeDataString(_apiKey)}&language=en-US&append_to_response=combined_credits");
        string json;
        try
        {
            json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            return null;
        }

        var root = JObject.Parse(json);
        var p = new TmdbPersonDetails
        {
            Id = (int?)root["id"] ?? personId,
            Name = (string?)root["name"] ?? "",
            Biography = (string?)root["biography"] ?? "",
            ProfilePath = (string?)root["profile_path"] ?? "",
            Birthday = string.IsNullOrWhiteSpace((string?)root["birthday"]) ? null : (string?)root["birthday"],
            PlaceOfBirth = string.IsNullOrWhiteSpace((string?)root["place_of_birth"])
                ? null
                : (string?)root["place_of_birth"]
        };

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var scored = new List<(double Popularity, TmdbPersonKnownCredit Row)>();

        var castArr = root["combined_credits"]?["cast"] as JArray;
        if (castArr != null)
        {
            foreach (var t in castArr)
            {
                var mt = (string?)t?["media_type"] ?? "";
                if (!string.Equals(mt, "movie", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(mt, "tv", StringComparison.OrdinalIgnoreCase))
                    continue;
                var mid = (int?)t?["id"] ?? 0;
                if (mid <= 0)
                    continue;
                var key = $"{mt}:{mid}";
                if (!seen.Add(key))
                    continue;
                var title = (string?)t?["title"] ?? (string?)t?["name"] ?? "";
                var poster = (string?)t?["poster_path"] ?? "";
                var pop = (double?)t?["popularity"] ?? 0;
                scored.Add((pop, new TmdbPersonKnownCredit
                {
                    MediaTmdbId = mid,
                    MediaType = string.Equals(mt, "tv", StringComparison.OrdinalIgnoreCase) ? "tv" : "movie",
                    Title = title,
                    PosterPath = string.IsNullOrEmpty(poster) ? null : poster,
                    Popularity = pop
                }));
            }
        }

        p.KnownFor = scored
            .OrderByDescending(x => x.Popularity)
            .Take(24)
            .Select(x => x.Row)
            .ToList();

        if (!string.IsNullOrWhiteSpace(p.ProfilePath))
        {
            p.ProfileLocalPath = await ImageCacheService
                .GetOrDownloadAsync(_http, p.ProfilePath, "Person", "w185", cancellationToken).ConfigureAwait(false);
        }

        return p;
    }

    public async Task<string> DownloadImageAsync(string imagePath, string localFileName,
        CancellationToken cancellationToken = default, string? subfolder = null, string tmdbImageSize = "w500")
    {
        if (string.IsNullOrWhiteSpace(localFileName))
            throw new ArgumentException("Local file name is required.", nameof(localFileName));

        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Pitflix",
            "Images");
        var dir = string.IsNullOrEmpty(subfolder) ? root : Path.Combine(root, subfolder);
        Directory.CreateDirectory(dir);

        var safeName = Path.GetFileName(localFileName);
        var fullPath = Path.Combine(dir, safeName);

        if (File.Exists(fullPath))
            return fullPath;

        if (string.IsNullOrWhiteSpace(imagePath))
            return fullPath;

        var path = imagePath.StartsWith('/') ? imagePath : "/" + imagePath;
        var size = string.IsNullOrWhiteSpace(tmdbImageSize) ? "w500" : tmdbImageSize.Trim();
        var url = $"https://image.tmdb.org/t/p/{size}{path}";

        using var response = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
            .ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        await using var fs = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None);
        await response.Content.CopyToAsync(fs, cancellationToken).ConfigureAwait(false);

        return fullPath;
    }

    public async Task<TmdbImageCollection> GetImagesAsync(int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        var isMovie = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase);
        var path = isMovie ? $"movie/{tmdbId}/images" : $"tv/{tmdbId}/images";
        var url = AbsoluteApiUrl(
            $"{path}?api_key={Uri.EscapeDataString(_apiKey)}&include_image_language=en,ar,null");

        var json = await _http.GetStringAsync(url, cancellationToken).ConfigureAwait(false);
        var jo = JObject.Parse(json);

        var posters = ParseImageArray(jo["posters"] as JArray)
            .OrderBy(x => x.Language != null) // null language first
            .ThenByDescending(x => x.VoteAverage)
            .Take(20)
            .ToList();
        var backdrops = ParseImageArray(jo["backdrops"] as JArray)
            .OrderBy(x => x.Language != null) // null language first
            .ThenByDescending(x => x.VoteAverage)
            .Take(10)
            .ToList();

        return new TmdbImageCollection
        {
            Posters = posters,
            Backdrops = backdrops
        };
    }

    /// <summary>
    /// Latest TMDB trailers from recently-released movies and TV shows.
    /// Returns items with YouTube trailer URLs and published dates for recency filtering.
    /// Movies: released in last 6 months. TV: first aired in last 3 months.
    /// Filters to only items with a valid YouTube trailer (published_at timestamp required).
    /// </summary>
    public async Task<List<(int TmdbId, string MediaType, string Title, string ReleaseDate, string VideoKey, 
        string VideoName, string VideoType, DateTime? PublishedAtUtc, double VoteAverage, int VoteCount)>>
        GetLatestTmdbTrailersAsync(CancellationToken cancellationToken = default)
    {
        var results = new List<(int, string, string, string, string, string, string, DateTime?, double, int)>();
        
        var now = DateTime.UtcNow;
        var sixMonthsAgo = now.AddMonths(-6).ToString("yyyy-MM-dd");
        var threeMonthsAgo = now.AddMonths(-3).ToString("yyyy-MM-dd");
        
        // Fetch recent movies (last 6 months, by popularity)
        var recentMoviesPages = new List<Task<List<TmdbDiscoverItem>>>();
        for (var p = 1; p <= 3; p++)
        {
            recentMoviesPages.Add(DiscoverMoviesPrimaryReleaseFromAsync(sixMonthsAgo, p, cancellationToken));
        }
        
        // Also fetch trending movies (catches popular rereleases, specials, etc.)
        recentMoviesPages.Add(GetTrendingMoviesWeekAsync(cancellationToken));
        
        // Fetch recent TV (last 3 months, by popularity)  
        var recentTvPages = new List<Task<List<TmdbDiscoverItem>>>();
        for (var p = 1; p <= 3; p++)
        {
            recentTvPages.Add(DiscoverTvFirstAirDateGteAsync(threeMonthsAgo, p, cancellationToken));
        }
        
        // Also fetch trending TV (catches new seasons, popular shows, etc.)
        recentTvPages.Add(GetTrendingTvWeekAsync(cancellationToken));
        
        // Also fetch "on the air" which includes new seasons being broadcast/streaming
        recentTvPages.Add(GetOnTheAirTvAsync(1, cancellationToken));
        recentTvPages.Add(GetOnTheAirTvAsync(2, cancellationToken));
        
        // Also fetch popular TV - catches shows with new seasons that just got trailers
        recentTvPages.Add(DiscoverPopularTvAsync(1, cancellationToken));
        recentTvPages.Add(DiscoverPopularTvAsync(2, cancellationToken));

        await Task.WhenAll(recentMoviesPages.Concat(recentTvPages)).ConfigureAwait(false);

        var recentMovies = new List<TmdbDiscoverItem>();
        var recentTv = new List<TmdbDiscoverItem>();
        
        foreach (var task in recentMoviesPages)
            recentMovies.AddRange(await task.ConfigureAwait(false));
        foreach (var task in recentTvPages)
            recentTv.AddRange(await task.ConfigureAwait(false));

        // Deduplicate by TMDB ID before creating dictionaries (multiple sources can yield same IDs)
        recentMovies = recentMovies.DistinctBy(x => x.Id).ToList();
        recentTv = recentTv.DistinctBy(x => x.Id).ToList();

        // Fetch videos for each title and extract YouTube trailers with published dates
        var videoTasks = new Dictionary<(int Id, string Type), Task<IReadOnlyList<(string, string, string, int, DateTime?)>>>();
        
        foreach (var item in recentMovies)
        {
            if (item.Id <= 0) continue;
            videoTasks[(item.Id, "Movie")] = GetYoutubePromosDetailedAsync(item.Id, "Movie", cancellationToken);
        }

        foreach (var item in recentTv)
        {
            if (item.Id <= 0) continue;
            videoTasks[(item.Id, "Series")] = GetYoutubePromosDetailedAsync(item.Id, "Series", cancellationToken);
        }

        // Build a map for quick title/date lookup
        var movieMap = recentMovies.ToDictionary(x => x.Id);
        var tvMap = recentTv.ToDictionary(x => x.Id);

        // Await all video fetch tasks and process results
        await Task.WhenAll(videoTasks.Values).ConfigureAwait(false);

        foreach (var ((tmdbId, mediaType), videoTask) in videoTasks)
        {
            var videos = await videoTask.ConfigureAwait(false);
            if (videos.Count == 0)
                continue;

            var sourceItem = mediaType == "Movie" 
                ? (movieMap.TryGetValue(tmdbId, out var m) ? m : null)
                : (tvMap.TryGetValue(tmdbId, out var t) ? t : null);

            if (sourceItem == null)
                continue;

            // Include trailers, teasers, and clips from YouTube
            foreach (var (key, name, type, rank, publishedAt) in videos)
            {
                if (string.IsNullOrEmpty(key))
                    continue;

                // Only include trailers, teasers, and clips
                if (!type.Equals("Trailer", StringComparison.OrdinalIgnoreCase) &&
                    !type.Equals("Teaser", StringComparison.OrdinalIgnoreCase) &&
                    !type.Equals("Clip", StringComparison.OrdinalIgnoreCase))
                    continue;

                // Use video's published date if available, otherwise fall back to media release/air date
                var effectivePublishedAt = publishedAt;
                if (effectivePublishedAt == null && !string.IsNullOrEmpty(sourceItem.ReleaseDate))
                {
                    if (DateTime.TryParse(sourceItem.ReleaseDate, out var parsedDate))
                        effectivePublishedAt = DateTime.SpecifyKind(parsedDate, DateTimeKind.Utc);
                }

                // Only include if we have some date information
                if (effectivePublishedAt == null)
                    continue;

                results.Add((
                    tmdbId,
                    mediaType.ToLowerInvariant(),
                    sourceItem.Title,
                    sourceItem.ReleaseDate,
                    key,
                    name,
                    type,
                    effectivePublishedAt,
                    sourceItem.VoteAverage,
                    sourceItem.VoteCount
                ));
            }
        }

        return results
            .OrderByDescending(x => x.Item8)  // Most recent first (Item8 = PublishedAtUtc)
            .DistinctBy(x => x.Item5) // Deduplicate by video key (Item5 = VideoKey)
            .ToList();
    }

    private static IEnumerable<TmdbImage> ParseImageArray(JArray? array)
    {
        if (array == null)
            yield break;

        foreach (var t in array)
        {
            var filePath = (string?)t?["file_path"];
            if (string.IsNullOrWhiteSpace(filePath))
                continue;
            yield return new TmdbImage
            {
                FilePath = filePath,
                VoteAverage = (double?)t?["vote_average"] ?? 0d,
                Width = (int?)t?["width"] ?? 0,
                Height = (int?)t?["height"] ?? 0,
                Language = (string?)t?["iso_639_1"]
            };
        }
    }
}
