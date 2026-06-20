using Pitflix.Core.Api;
using Pitflix.Core.Config;
using Pitflix.Core.Net;

namespace Pitflix.API.Services;

public static class TmdbClientFactory
{
    private static readonly HttpClient Http = PitflixHttp.CreateClient();

    public static TmdbClient? Create()
    {
        var key = AppSettings.ResolvedTmdbApiKey;
        if (!AppSettings.IsValidTmdbKey(key))
            return null;
        return new TmdbClient(Http, key!);
    }
}
