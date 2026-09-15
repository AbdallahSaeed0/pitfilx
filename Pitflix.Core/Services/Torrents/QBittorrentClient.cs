namespace Pitflix.Core.Services.Torrents;

using System.Text.Json;
using System.Text.RegularExpressions;

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

    public Task<QBittorrentAddResult> AddTorrentAsync(
        string magnetLink,
        string savePath,
        CancellationToken ct) =>
        AddTorrentAsync(magnetLink, savePath, null, ct);

    public async Task<QBittorrentAddResult> AddTorrentAsync(
        string magnetLink,
        string savePath,
        int? fileIndex,
        CancellationToken ct)
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

            var addFields = new Dictionary<string, string>
            {
                ["urls"] = magnetLink,
                ["savepath"] = savePath,
            };
            if (fileIndex is >= 0)
            {
                // Keep multi-file torrents stopped until the addon-selected file is the only
                // enabled file. qBittorrent 4.x uses "paused"; 5.x uses "stopped".
                addFields["paused"] = "true";
                addFields["stopped"] = "true";
            }

            using var addContent = new FormUrlEncodedContent(addFields);
            using var addRes = await _http.PostAsync($"{_baseUrl}/api/v2/torrents/add", addContent, ct)
                .ConfigureAwait(false);
            if (!addRes.IsSuccessStatusCode)
                return new QBittorrentAddResult(false, $"qBittorrent rejected the torrent ({(int)addRes.StatusCode}).");

            if (fileIndex is >= 0)
            {
                var hash = ExtractInfoHash(magnetLink);
                if (hash is null)
                    return new QBittorrentAddResult(
                        false,
                        "Torrent was added paused, but Pitflix could not determine its hash for file selection.");

                var selection = await SelectOnlyFileAsync(hash, fileIndex.Value, ct).ConfigureAwait(false);
                if (!selection.Success)
                    return selection;
            }

            return new QBittorrentAddResult(true, null);
        }
        catch (Exception ex)
        {
            return new QBittorrentAddResult(false, $"Could not reach qBittorrent: {ex.Message}");
        }
    }

    private async Task<QBittorrentAddResult> SelectOnlyFileAsync(
        string hash,
        int selectedIndex,
        CancellationToken ct)
    {
        List<int>? fileIds = null;
        for (var attempt = 0; attempt < 15 && !ct.IsCancellationRequested; attempt++)
        {
            using var filesRes = await _http.GetAsync(
                $"{_baseUrl}/api/v2/torrents/files?hash={Uri.EscapeDataString(hash)}",
                ct).ConfigureAwait(false);
            if (filesRes.IsSuccessStatusCode)
            {
                var json = await filesRes.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.ValueKind == JsonValueKind.Array && doc.RootElement.GetArrayLength() > 0)
                {
                    fileIds = doc.RootElement.EnumerateArray()
                        .Where(x => x.TryGetProperty("index", out var index) && index.TryGetInt32(out _))
                        .Select(x => x.GetProperty("index").GetInt32())
                        .ToList();
                    break;
                }
            }
            await Task.Delay(TimeSpan.FromSeconds(1), ct).ConfigureAwait(false);
        }

        if (fileIds is null || !fileIds.Contains(selectedIndex))
            return new QBittorrentAddResult(
                false,
                $"Torrent was added paused, but file {selectedIndex} was not available for selection.");

        var unwanted = fileIds.Where(x => x != selectedIndex).ToArray();
        if (unwanted.Length > 0)
        {
            var disabled = await SetFilePriorityAsync(hash, unwanted, 0, ct).ConfigureAwait(false);
            if (!disabled)
                return new QBittorrentAddResult(false, "Torrent was added paused, but other files could not be disabled.");
        }
        if (!await SetFilePriorityAsync(hash, new[] { selectedIndex }, 1, ct).ConfigureAwait(false))
            return new QBittorrentAddResult(false, "Torrent was added paused, but the selected file could not be enabled.");

        // qBittorrent 5.x renamed resume to start. Try the new route, then the legacy route.
        if (!await PostHashesAsync("/api/v2/torrents/start", hash, ct).ConfigureAwait(false) &&
            !await PostHashesAsync("/api/v2/torrents/resume", hash, ct).ConfigureAwait(false))
            return new QBittorrentAddResult(false, "File selection succeeded, but qBittorrent could not start the torrent.");

        return new QBittorrentAddResult(true, null);
    }

    private async Task<bool> SetFilePriorityAsync(
        string hash,
        IEnumerable<int> ids,
        int priority,
        CancellationToken ct)
    {
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["hash"] = hash,
            ["id"] = string.Join("|", ids),
            ["priority"] = priority.ToString(),
        });
        using var res = await _http.PostAsync($"{_baseUrl}/api/v2/torrents/filePrio", content, ct)
            .ConfigureAwait(false);
        return res.IsSuccessStatusCode;
    }

    private async Task<bool> PostHashesAsync(string path, string hash, CancellationToken ct)
    {
        using var content = new FormUrlEncodedContent(new Dictionary<string, string> { ["hashes"] = hash });
        using var res = await _http.PostAsync($"{_baseUrl}{path}", content, ct).ConfigureAwait(false);
        return res.IsSuccessStatusCode;
    }

    private static string? ExtractInfoHash(string magnetLink)
    {
        var match = Regex.Match(magnetLink, @"(?:\?|&)xt=urn:btih:([a-fA-F0-9]{40})(?:&|$)");
        return match.Success ? match.Groups[1].Value.ToLowerInvariant() : null;
    }
}
