using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Pitflix.Core.Config;

namespace Pitflix.API.Services.Trakt;

/// <summary>Thin wrapper around Trakt's REST API. Follows the scraper-service convention elsewhere in this
/// codebase: one shared static HttpClient, never throws — callers get null on any failure (network error,
/// timeout, or 429) and decide what "silently drop" means for their call site. 401s are returned as-is so
/// <see cref="TraktAuthService"/> can attempt a token refresh before giving up.</summary>
public sealed class TraktApiClient
{
    private const string BaseUrl = "https://api.trakt.tv";
    private static readonly HttpClient Http = CreateSharedClient();

    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static HttpClient CreateSharedClient()
    {
        var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        // Trakt's Cloudflare WAF 403s requests with no User-Agent (looks like a bot) — same reason the
        // scraper services in this codebase always set one.
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0 (+https://github.com)");
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return http;
    }

    /// <summary>Sends a request and returns the raw response, or null on transport failure / rate limit
    /// (429 is backed off silently — never surfaced to the user, per the scraper empty-result convention),
    /// or when no Trakt app client id is configured yet. Reads <see cref="AppSettings.ResolvedTraktClientId"/>
    /// fresh on every call so a credential saved in Settings takes effect without a restart.</summary>
    public async Task<HttpResponseMessage?> SendAsync(HttpMethod method, string path, string? accessToken,
        object? jsonBody, CancellationToken ct)
    {
        var clientId = AppSettings.ResolvedTraktClientId;
        if (string.IsNullOrWhiteSpace(clientId))
            return null;

        try
        {
            using var req = new HttpRequestMessage(method, $"{BaseUrl}{path}");
            req.Headers.TryAddWithoutValidation("trakt-api-version", "2");
            req.Headers.TryAddWithoutValidation("trakt-api-key", clientId);
            if (!string.IsNullOrEmpty(accessToken))
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            if (jsonBody != null)
                req.Content = JsonContent.Create(jsonBody, options: JsonOptions);

            var res = await Http.SendAsync(req, ct).ConfigureAwait(false);
            if (res.StatusCode == (HttpStatusCode)429)
                return null;

            return res;
        }
        catch
        {
            return null;
        }
    }

    public async Task<T?> SendAndReadAsync<T>(HttpMethod method, string path, string? accessToken,
        object? jsonBody, CancellationToken ct) where T : class
    {
        using var res = await SendAsync(method, path, accessToken, jsonBody, ct).ConfigureAwait(false);
        if (res == null || !res.IsSuccessStatusCode)
            return null;

        try
        {
            return await res.Content.ReadFromJsonAsync<T>(JsonOptions, ct).ConfigureAwait(false);
        }
        catch
        {
            return null;
        }
    }
}
