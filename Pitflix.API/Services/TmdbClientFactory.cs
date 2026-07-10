using Pitflix.Core.Api;
using Pitflix.Core.Config;
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
    private static readonly HttpClient Http = PitflixHttp.CreateClient();
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
