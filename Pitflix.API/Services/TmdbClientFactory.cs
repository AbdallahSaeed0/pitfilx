using Pitflix.Core.Api;
using Pitflix.Core.Config;
using Pitflix.Core.Database;
using Pitflix.Core.Net;

namespace Pitflix.API.Services;

/// <summary>
/// Builds a <see cref="TmdbClient"/> using the currently-configured TMDB API key, or <c>null</c>
/// when no valid key is configured. Injected via DI (registered as a singleton) rather than a
/// static factory, so callers can be constructor/parameter-injected and unit-tested like every
/// other dependency in this app — the key itself is still re-resolved on every call since it can
/// change at runtime via Settings.
/// </summary>
public interface ITmdbClientFactory
{
    TmdbClient? Create();
}

public sealed class TmdbClientFactory : ITmdbClientFactory
{
    /// <summary>
    /// Every TMDB API answer is saved to <c>tmdb-cache.db</c> (next to pitflix.db): answers under 6 h
    /// old are served from disk, and offline / on network failure the saved answer is used — this is
    /// what lets library pages render without internet. 10 s per network attempt instead of
    /// HttpClient's 100 s default, so a dead connection fails over to saved data quickly.
    /// </summary>
    public static readonly PersistentHttpCacheHandler ResponseCache = new(
        PitflixHttp.CreateHandler(),
        Path.Combine(Path.GetDirectoryName(LibraryPaths.DatabaseFilePath)!, "tmdb-cache.db"),
        "api.themoviedb.org",
        freshFor: TimeSpan.FromHours(6),
        networkTimeout: TimeSpan.FromSeconds(10));

    private static readonly HttpClient Http = new(ResponseCache) { Timeout = TimeSpan.FromSeconds(30) };

    /// <summary>The cached TMDB HttpClient, for the few endpoints that call TMDB without <see cref="TmdbClient"/>.</summary>
    public static HttpClient SharedHttp => Http;
    private readonly IResolvedApiKeysAccessor _apiKeys;

    public TmdbClientFactory(IResolvedApiKeysAccessor apiKeys) => _apiKeys = apiKeys;

    public TmdbClient? Create()
    {
        var key = _apiKeys.ResolvedTmdbApiKey;
        if (!AppSettings.IsValidTmdbKey(key))
            return null;
        return new TmdbClient(Http, key!);
    }
}
