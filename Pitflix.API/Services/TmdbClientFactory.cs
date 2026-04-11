using System.Net.Http;
using Pitflix.Core.Api;
using Pitflix.Core.Config;

namespace Pitflix.API.Services;

public static class TmdbClientFactory
{
    private static readonly HttpClient Http = new();

    public static TmdbClient? Create()
    {
        var key = AppSettings.ResolvedTmdbApiKey;
        if (!AppSettings.IsValidTmdbKey(key))
            return null;
        return new TmdbClient(Http, key!);
    }
}
