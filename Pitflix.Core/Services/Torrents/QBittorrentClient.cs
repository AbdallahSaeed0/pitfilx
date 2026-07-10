namespace Pitflix.Core.Services.Torrents;

public sealed record QBittorrentAddResult(bool Success, string? Error);

/// <summary>qBittorrent Web API client (login + add torrent via the WebUI API).</summary>
public sealed class QBittorrentClient
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string _username;
    private readonly string _password;

    public QBittorrentClient(string baseUrl, string username, string password)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _username = username;
        _password = password;

        var handler = new HttpClientHandler { UseCookies = true, CookieContainer = new System.Net.CookieContainer() };
        _http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };
    }

    public async Task<QBittorrentAddResult> AddTorrentAsync(string magnetLink, string savePath, CancellationToken ct)
    {
        try
        {
            using var loginContent = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["username"] = _username,
                ["password"] = _password,
            });
            using var loginRes = await _http.PostAsync($"{_baseUrl}/api/v2/auth/login", loginContent, ct)
                .ConfigureAwait(false);
            if (!loginRes.IsSuccessStatusCode)
                return new QBittorrentAddResult(false, $"qBittorrent login failed ({(int)loginRes.StatusCode}).");

            var loginBody = await loginRes.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!string.Equals(loginBody.Trim(), "Ok.", StringComparison.OrdinalIgnoreCase))
                return new QBittorrentAddResult(false, "qBittorrent rejected the username/password.");

            using var addContent = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["urls"] = magnetLink,
                ["savepath"] = savePath,
            });
            using var addRes = await _http.PostAsync($"{_baseUrl}/api/v2/torrents/add", addContent, ct)
                .ConfigureAwait(false);
            if (!addRes.IsSuccessStatusCode)
                return new QBittorrentAddResult(false, $"qBittorrent rejected the torrent ({(int)addRes.StatusCode}).");

            return new QBittorrentAddResult(true, null);
        }
        catch (Exception ex)
        {
            return new QBittorrentAddResult(false, $"Could not reach qBittorrent: {ex.Message}");
        }
    }
}
