using System.Net;
using System.Net.Http.Json;
using Pitflix.Core.Config;
using Pitflix.Core.Database;

namespace Pitflix.API.Services.Trakt;

/// <summary>Trakt OAuth 2.0 Authorization Code flow: authorize URL, code exchange, silent background
/// refresh, and disconnect. Tokens live in the single-row TraktSettings table (see LibraryRepository).
/// Client id/secret are read fresh from <see cref="AppSettings"/> on every call (DB-backed, see
/// <c>ResolveTraktCredentialsFromSources</c>) so a credential saved in Settings works immediately.</summary>
public sealed class TraktAuthService
{
    private readonly TraktApiClient _client;
    private readonly TraktRedirectOptions _redirect;
    private readonly ILogger<TraktAuthService> _logger;

    public TraktAuthService(TraktApiClient client, TraktRedirectOptions redirect, ILogger<TraktAuthService> logger)
    {
        _client = client;
        _redirect = redirect;
        _logger = logger;
    }

    public bool IsAppConfigured =>
        !string.IsNullOrWhiteSpace(AppSettings.ResolvedTraktClientId) &&
        !string.IsNullOrWhiteSpace(AppSettings.ResolvedTraktClientSecret);

    public string? BuildAuthorizeUrl(string state)
    {
        var clientId = AppSettings.ResolvedTraktClientId;
        if (string.IsNullOrWhiteSpace(clientId))
            return null;

        var query = $"response_type=code&client_id={Uri.EscapeDataString(clientId)}" +
                    $"&redirect_uri={Uri.EscapeDataString(_redirect.RedirectUri)}" +
                    $"&state={Uri.EscapeDataString(state)}";
        return $"https://trakt.tv/oauth/authorize?{query}";
    }

    public async Task<bool> ExchangeCodeAsync(string code, LibraryRepository repo, CancellationToken ct)
    {
        if (!IsAppConfigured)
            return false;

        var body = new
        {
            code,
            client_id = AppSettings.ResolvedTraktClientId,
            client_secret = AppSettings.ResolvedTraktClientSecret,
            redirect_uri = _redirect.RedirectUri,
            grant_type = "authorization_code",
        };

        using var res = await _client.SendAsync(HttpMethod.Post, "/oauth/token", null, body, ct).ConfigureAwait(false);
        if (res == null)
        {
            _logger.LogWarning("Trakt token exchange failed: no response (network error, timeout, or rate limited).");
            return false;
        }

        if (!res.IsSuccessStatusCode)
        {
            var errorBody = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            var message =
                $"Trakt token exchange failed: {(int)res.StatusCode} {errorBody}. redirect_uri sent was " +
                $"{_redirect.RedirectUri} — it must exactly match the one registered on the Trakt app.";
            _logger.LogWarning(message);
            TryWriteDebugLog(message);
            return false;
        }

        TraktTokenResponse? token;
        try
        {
            token = await res.Content.ReadFromJsonAsync<TraktTokenResponse>(TraktApiClient.JsonOptions, ct)
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Trakt token exchange succeeded but the response body could not be parsed.");
            return false;
        }

        if (token == null)
            return false;

        var expiresAt = DateTime.UtcNow.AddSeconds(token.ExpiresIn);
        await repo.SaveTraktTokensAsync(token.AccessToken, token.RefreshToken, expiresAt, ct).ConfigureAwait(false);
        return true;
    }

    /// <summary>Returns a usable access token, refreshing it first if it's within 24h of expiry.
    /// Never throws and never blocks a caller on a slow/failed refresh longer than one HTTP round-trip —
    /// on failure it marks the connection expired and returns null so the caller skips the Trakt call.</summary>
    public async Task<string?> GetValidAccessTokenAsync(LibraryRepository repo, CancellationToken ct)
    {
        var settings = await repo.GetOrCreateTraktSettingsAsync(ct).ConfigureAwait(false);
        if (!settings.IsConnected || string.IsNullOrEmpty(settings.AccessToken))
            return null;

        var needsRefresh = settings.TokenExpiresAt == null ||
                            settings.TokenExpiresAt.Value <= DateTime.UtcNow.AddHours(24);
        if (!needsRefresh)
            return settings.AccessToken;

        if (string.IsNullOrEmpty(settings.RefreshToken))
        {
            await repo.MarkTraktConnectionExpiredAsync(ct).ConfigureAwait(false);
            return null;
        }

        var refreshed = await RefreshAsync(settings.RefreshToken, ct).ConfigureAwait(false);
        if (refreshed == null)
        {
            // Only give up once the old token has actually expired; a transient refresh failure
            // well before expiry just means we try again on the next call.
            if (settings.TokenExpiresAt != null && settings.TokenExpiresAt.Value > DateTime.UtcNow)
                return settings.AccessToken;

            await repo.MarkTraktConnectionExpiredAsync(ct).ConfigureAwait(false);
            return null;
        }

        var expiresAt = DateTime.UtcNow.AddSeconds(refreshed.ExpiresIn);
        await repo.SaveTraktTokensAsync(refreshed.AccessToken, refreshed.RefreshToken, expiresAt, ct)
            .ConfigureAwait(false);
        return refreshed.AccessToken;
    }

    private async Task<TraktTokenResponse?> RefreshAsync(string refreshToken, CancellationToken ct)
    {
        if (!IsAppConfigured)
            return null;

        var body = new
        {
            refresh_token = refreshToken,
            client_id = AppSettings.ResolvedTraktClientId,
            client_secret = AppSettings.ResolvedTraktClientSecret,
            redirect_uri = _redirect.RedirectUri,
            grant_type = "refresh_token",
        };

        return await _client.SendAndReadAsync<TraktTokenResponse>(HttpMethod.Post, "/oauth/token", null, body, ct)
            .ConfigureAwait(false);
    }

    public async Task<string?> GetConnectedUsernameAsync(string accessToken, CancellationToken ct)
    {
        var profile = await _client.SendAndReadAsync<TraktUserProfile>(HttpMethod.Get, "/users/me", accessToken, null, ct)
            .ConfigureAwait(false);
        return profile?.Username;
    }

    /// <summary>Sends one authenticated request; if it 401s, tries exactly one refresh and retries once.
    /// On a second failure the connection is marked expired. Returns null on any unrecoverable failure —
    /// callers should treat that the same as "skip silently", matching the scraper empty-result convention.</summary>
    public async Task<HttpResponseMessage?> SendAuthenticatedAsync(LibraryRepository repo, HttpMethod method,
        string path, object? jsonBody, CancellationToken ct)
    {
        var token = await GetValidAccessTokenAsync(repo, ct).ConfigureAwait(false);
        if (token == null)
            return null;

        var res = await _client.SendAsync(method, path, token, jsonBody, ct).ConfigureAwait(false);
        if (res == null)
            return null;
        if (res.StatusCode != HttpStatusCode.Unauthorized)
            return res;

        res.Dispose();
        var settings = await repo.GetOrCreateTraktSettingsAsync(ct).ConfigureAwait(false);
        if (string.IsNullOrEmpty(settings.RefreshToken))
        {
            await repo.MarkTraktConnectionExpiredAsync(ct).ConfigureAwait(false);
            return null;
        }

        var refreshed = await RefreshAsync(settings.RefreshToken, ct).ConfigureAwait(false);
        if (refreshed == null)
        {
            await repo.MarkTraktConnectionExpiredAsync(ct).ConfigureAwait(false);
            return null;
        }

        var expiresAt = DateTime.UtcNow.AddSeconds(refreshed.ExpiresIn);
        await repo.SaveTraktTokensAsync(refreshed.AccessToken, refreshed.RefreshToken, expiresAt, ct)
            .ConfigureAwait(false);
        return await _client.SendAsync(method, path, refreshed.AccessToken, jsonBody, ct).ConfigureAwait(false);
    }

    public async Task<List<T>?> SendAndReadListAsync<T>(LibraryRepository repo, HttpMethod method, string path,
        object? jsonBody, CancellationToken ct) where T : class
    {
        using var res = await SendAuthenticatedAsync(repo, method, path, jsonBody, ct).ConfigureAwait(false);
        if (res == null || !res.IsSuccessStatusCode)
            return null;

        try
        {
            return await res.Content.ReadFromJsonAsync<List<T>>(TraktApiClient.JsonOptions, ct).ConfigureAwait(false);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Temporary diagnostic aid: some launch modes of Pitflix.API show no visible console, so a
    /// plain file next to the exe is the most reliable way to see why an OAuth exchange failed.</summary>
    private static void TryWriteDebugLog(string message)
    {
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "trakt-debug.log");
            File.AppendAllText(path, $"[{DateTime.Now:HH:mm:ss.fff}] {message}{Environment.NewLine}");
        }
        catch
        {
            /* best-effort */
        }
    }
}
