using System.Net;
using System.Net.Http;

namespace Pitflix.Core.Net;

/// <summary>Shared HTTP client defaults (TMDB and image CDN often respond with gzip).</summary>
public static class PitflixHttp
{
    public static HttpMessageHandler CreateHandler() =>
        new SocketsHttpHandler
        {
            AutomaticDecompression = DecompressionMethods.All,
            PooledConnectionLifetime = TimeSpan.FromMinutes(10),
        };

    public static HttpClient CreateClient(TimeSpan? timeout = null)
    {
        var client = new HttpClient(CreateHandler(), disposeHandler: true);
        if (timeout is { } t)
            client.Timeout = t;
        return client;
    }
}
