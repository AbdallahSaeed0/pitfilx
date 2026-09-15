using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace Pitflix.API.Services;

public sealed record FanartImage(string Url, string Type, string? Language);

public sealed record FanartResult(
    IReadOnlyList<FanartImage> ClearLogos,
    IReadOnlyList<FanartImage> Posters,
    IReadOnlyList<FanartImage> Backgrounds,
    IReadOnlyList<FanartImage> CharacterArt);

/// <summary>
/// Fanart.tv artwork client. Movies are looked up directly by TMDB id; series must be looked up by
/// TheTVDB id (resolved via <see cref="TvdbService.ResolveTvdbIdAsync"/>), matching how Fanart.tv's
/// own API is keyed. Modeled on <see cref="MdbListService"/>'s scoped-key-lookup + in-memory cache.
/// </summary>
public sealed class FanartClient
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<FanartClient> _logger;
    private readonly HttpClient _http;
    private readonly IMemoryCache _cache;

    private static readonly TimeSpan CacheTtl = TimeSpan.FromDays(3);

    public FanartClient(IServiceScopeFactory scopeFactory, ILogger<FanartClient> logger,
        IHttpClientFactory httpClientFactory, IMemoryCache cache)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _http = httpClientFactory.CreateClient("Fanart");
        _http.Timeout = TimeSpan.FromSeconds(20);
        _cache = cache;
    }

    public async Task<FanartResult?> GetArtworkAsync(int tmdbId, string mediaType, CancellationToken ct)
    {
        var key = await GetApiKeyAsync(ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(key))
        {
            _logger.LogWarning("Fanart: no API key configured — save the key in Settings → Additional Sources");
            return null;
        }

        var isMovie = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase) ||
                      mediaType.Equals("movie", StringComparison.OrdinalIgnoreCase);

        var cacheKey = $"fanart:{(isMovie ? "movie" : "tv")}:{tmdbId}";
        if (_cache.TryGetValue(cacheKey, out FanartResult? cached))
            return cached;

        try
        {
            string url;
            if (isMovie)
            {
                url = $"https://webservice.fanart.tv/v3/movies/{tmdbId}?api_key={Uri.EscapeDataString(key)}";
            }
            else
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var tvdb = scope.ServiceProvider.GetRequiredService<TvdbService>();
                var tvdbId = await tvdb.ResolveTvdbIdAsync(tmdbId, "series", ct).ConfigureAwait(false);
                if (tvdbId is null)
                    return null;
                url = $"https://webservice.fanart.tv/v3/tv/{tvdbId}?api_key={Uri.EscapeDataString(key)}";
            }

            using var resp = await _http.GetAsync(url, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
                return null;

            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            var result = ParseResponse(body, isMovie);
            if (result != null)
                _cache.Set(cacheKey, result, CacheTtl);
            return result;
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Fanart fetch failed for {MediaType} {TmdbId}: {Msg}", mediaType, tmdbId, ex.Message);
            return null;
        }
    }

    private static FanartResult? ParseResponse(string json, bool isMovie)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var logoKey = isMovie ? "hdmovielogo" : "hdtvlogo";
            var logoFallbackKey = isMovie ? "movielogo" : "clearlogo";
            var posterKey = isMovie ? "movieposter" : "tvposter";
            var backgroundKey = isMovie ? "moviebackground" : "showbackground";
            var characterArtKey = "characterart"; // movies only

            List<FanartImage> Read(string key)
            {
                var list = new List<FanartImage>();
                if (!root.TryGetProperty(key, out var arr) || arr.ValueKind != JsonValueKind.Array)
                    return list;
                foreach (var item in arr.EnumerateArray())
                {
                    var url = item.TryGetProperty("url", out var u) ? u.GetString() : null;
                    if (string.IsNullOrWhiteSpace(url)) continue;
                    var lang = item.TryGetProperty("lang", out var l) ? l.GetString() : null;
                    list.Add(new FanartImage(url, key, lang));
                }
                return list;
            }

            var logos = Read(logoKey);
            if (logos.Count == 0) logos = Read(logoFallbackKey);
            var posters = Read(posterKey);
            var backgrounds = Read(backgroundKey);
            var characterArt = isMovie ? Read(characterArtKey) : [];

            if (logos.Count == 0 && posters.Count == 0 && backgrounds.Count == 0 && characterArt.Count == 0)
                return null;

            return new FanartResult(logos, posters, backgrounds, characterArt);
        }
        catch
        {
            return null;
        }
    }

    private async Task<string?> GetApiKeyAsync(CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<Pitflix.Core.Database.LibraryRepository>();
        return await repo.GetSettingAsync("FanartApiKey", ct).ConfigureAwait(false);
    }
}
