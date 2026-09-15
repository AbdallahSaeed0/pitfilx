using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Pitflix.API.Services;

public sealed record StremioAddonStream(
    string Title,
    string Size,
    string Quality,
    string Format,
    IReadOnlyList<string> Badges,
    string MagnetLink,
    string TorrentFileUrl,
    string? DirectUrl,
    string? InfoHash,
    int? FileIndex);

/// <summary>
/// Minimal client for the open Stremio addon protocol's manifest and stream resources.
/// It intentionally supports stream addons generically; Torrentio is one compatible addon.
/// </summary>
public sealed class StremioAddonService
{
    public const string DefaultManifestUrl = "https://torrentio.strem.fun/manifest.json";
    public const string DefaultCometManifestUrl = "https://comet.stremio.ru/manifest.json";
    public const string LegacyCometManifestUrl = "https://comet.elfhosted.com/manifest.json";

    private static readonly Regex SizeRegex = new(
        @"(?<value>\d+(?:\.\d+)?)\s*(?<unit>GB|MB|TB)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex HashRegex = new(
        @"^[a-fA-F0-9]{40}$",
        RegexOptions.Compiled);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly Func<string, CancellationToken, Task<IPAddress[]>> _resolveHost;

    public StremioAddonService(IHttpClientFactory httpClientFactory)
        : this(httpClientFactory, Dns.GetHostAddressesAsync)
    {
    }

    public StremioAddonService(
        IHttpClientFactory httpClientFactory,
        Func<string, CancellationToken, Task<IPAddress[]>> resolveHost)
    {
        _httpClientFactory = httpClientFactory;
        _resolveHost = resolveHost;
    }

    public async Task<(bool Valid, string? Name, string? Error)> ValidateManifestAsync(
        string manifestUrl,
        CancellationToken ct)
    {
        if (!TryValidatePublicHttpsUrl(manifestUrl, out var uri, out var error))
            return (false, null, error);

        try
        {
            using var res = await SendAsync(uri!, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                return (false, null, $"Manifest returned HTTP {(int)res.StatusCode}.");

            await using var body = await res.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            using var json = await JsonDocument.ParseAsync(body, cancellationToken: ct).ConfigureAwait(false);
            var root = json.RootElement;
            var name = root.TryGetProperty("name", out var n) ? n.GetString() : null;
            if (!SupportsStreams(root))
                return (false, name, "The addon manifest does not advertise a stream resource.");

            return (true, name, null);
        }
        catch (JsonException)
        {
            return (false, null, "The manifest response was not valid JSON.");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return (false, null, $"Could not reach the addon: {ex.Message}");
        }
    }

    public async Task<IReadOnlyList<StremioAddonStream>> GetStreamsAsync(
        string manifestUrl,
        string type,
        string videoId,
        CancellationToken ct)
    {
        if (!TryValidatePublicHttpsUrl(manifestUrl, out var manifestUri, out _))
            return Array.Empty<StremioAddonStream>();
        if (type is not ("movie" or "series") || string.IsNullOrWhiteSpace(videoId))
            return Array.Empty<StremioAddonStream>();

        var manifestPath = manifestUri!.AbsolutePath;
        if (!manifestPath.EndsWith("/manifest.json", StringComparison.OrdinalIgnoreCase))
            return Array.Empty<StremioAddonStream>();

        var basePath = manifestPath[..^"/manifest.json".Length].TrimEnd('/');
        var streamPath = $"{basePath}/stream/{type}/{Uri.EscapeDataString(videoId)}.json";
        var streamUri = new UriBuilder(manifestUri)
        {
            Path = streamPath,
            Query = "",
            Fragment = "",
        }.Uri;

        try
        {
            using var res = await SendAsync(streamUri, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                return Array.Empty<StremioAddonStream>();

            await using var body = await res.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            using var json = await JsonDocument.ParseAsync(body, cancellationToken: ct).ConfigureAwait(false);
            if (!json.RootElement.TryGetProperty("streams", out var streams) ||
                streams.ValueKind != JsonValueKind.Array)
                return Array.Empty<StremioAddonStream>();

            return streams.EnumerateArray()
                .Select(MapStream)
                .Where(x => x is not null)
                .Cast<StremioAddonStream>()
                .GroupBy(x => $"{x.InfoHash}:{x.FileIndex}:{x.DirectUrl}", StringComparer.OrdinalIgnoreCase)
                .Select(x => x.First())
                .ToList();
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            return Array.Empty<StremioAddonStream>();
        }
    }

    private async Task<HttpResponseMessage> SendAsync(Uri uri, CancellationToken ct)
    {
        var addresses = await _resolveHost(uri.DnsSafeHost, ct).ConfigureAwait(false);
        if (addresses.Length == 0 || addresses.Any(IsPrivateAddress))
            throw new HttpRequestException("The addon host resolved to a local or private-network address.");

        var client = _httpClientFactory.CreateClient("StremioAddon");
        using var req = new HttpRequestMessage(HttpMethod.Get, uri);
        req.Headers.Accept.ParseAdd("application/json");
        req.Headers.UserAgent.ParseAdd("Pitflix/0.5 StremioAddonClient");
        return await client.SendAsync(req, HttpCompletionOption.ResponseContentRead, ct).ConfigureAwait(false);
    }

    private static StremioAddonStream? MapStream(JsonElement stream)
    {
        var title = FirstString(stream, "title", "description", "name")?.Trim() ?? "";
        var name = FirstString(stream, "name")?.Trim() ?? "";
        var directUrl = FirstString(stream, "url")?.Trim();
        var infoHash = FirstString(stream, "infoHash")?.Trim();
        if (!string.IsNullOrEmpty(infoHash) && !HashRegex.IsMatch(infoHash))
            infoHash = null;
        infoHash = infoHash?.ToLowerInvariant();

        int? fileIndex = null;
        if (stream.TryGetProperty("fileIdx", out var idx) && idx.TryGetInt32(out var parsedIdx) && parsedIdx >= 0)
            fileIndex = parsedIdx;

        if (string.IsNullOrEmpty(infoHash) && string.IsNullOrEmpty(directUrl))
            return null;

        var displayTitle = !string.IsNullOrEmpty(title) ? title : !string.IsNullOrEmpty(name) ? name : "Stremio stream";
        var combined = $"{name}\n{title}";
        if (combined.Contains("Non-debrid searches disabled", StringComparison.OrdinalIgnoreCase) ||
            combined.Contains("Direct torrent playback is disabled", StringComparison.OrdinalIgnoreCase))
            return null;

        var size = ExtractSize(stream, combined);
        var quality = DetectQuality(combined);
        var format = DetectFormat(combined);
        var badges = DetectBadges(combined);
        var magnet = infoHash is null ? "" : BuildMagnet(infoHash, displayTitle, stream);

        return new StremioAddonStream(
            displayTitle, size, quality, format, badges, magnet, "", directUrl, infoHash, fileIndex);
    }

    private static string ExtractSize(JsonElement stream, string text)
    {
        if (stream.TryGetProperty("behaviorHints", out var hints) &&
            hints.ValueKind == JsonValueKind.Object &&
            hints.TryGetProperty("videoSize", out var videoSize) &&
            videoSize.TryGetInt64(out var bytes) &&
            bytes > 0)
        {
            var gb = bytes / 1024d / 1024d / 1024d;
            return gb >= 1 ? $"{gb:0.##} GB" : $"{bytes / 1024d / 1024d:0.#} MB";
        }

        var match = SizeRegex.Match(text);
        return match.Success ? $"{match.Groups["value"].Value} {match.Groups["unit"].Value.ToUpperInvariant()}" : "";
    }

    private static string DetectQuality(string text)
    {
        if (Regex.IsMatch(text, @"\b(2160p|4k)\b", RegexOptions.IgnoreCase)) return "4K";
        if (Regex.IsMatch(text, @"\b1080p\b", RegexOptions.IgnoreCase)) return "1080p";
        if (Regex.IsMatch(text, @"\b720p\b", RegexOptions.IgnoreCase)) return "720p";
        if (Regex.IsMatch(text, @"\b(480p|576p)\b", RegexOptions.IgnoreCase)) return "480p";
        return "Unknown";
    }

    private static string DetectFormat(string text)
    {
        if (Regex.IsMatch(text, @"\bMP4\b", RegexOptions.IgnoreCase)) return "MP4";
        if (Regex.IsMatch(text, @"\bAVI\b", RegexOptions.IgnoreCase)) return "AVI";
        return "MKV";
    }

    private static IReadOnlyList<string> DetectBadges(string text)
    {
        var badges = new List<string>();
        AddBadge(@"\b(HEVC|x265|h\.?265)\b", "HEVC");
        AddBadge(@"\b(x264|h\.?264)\b", "x264");
        AddBadge(@"\b10[\s-]?bit\b", "10bit");
        AddBadge(@"\bREMUX\b", "Remux");
        AddBadge(@"\bWEB[\s.-]?DL\b", "WEB-DL");
        AddBadge(@"\bWEBRIP\b", "WEBRip");
        AddBadge(@"\bBLU[\s.-]?RAY\b", "Bluray");
        AddBadge(@"\bHDR10\+", "HDR10+");
        AddBadge(@"\bHDR\b", "HDR");
        AddBadge(@"\b(DV|DOLBY[\s.-]?VISION)\b", "Dolby Vision");
        AddBadge(@"\bATMOS\b", "Atmos");

        return badges;

        void AddBadge(string pattern, string badge)
        {
            if (Regex.IsMatch(text, pattern, RegexOptions.IgnoreCase) &&
                !badges.Contains(badge, StringComparer.OrdinalIgnoreCase))
                badges.Add(badge);
        }
    }

    private static string BuildMagnet(string hash, string title, JsonElement stream)
    {
        var parts = new List<string>
        {
            $"magnet:?xt=urn:btih:{hash}",
            $"dn={Uri.EscapeDataString(title)}",
        };
        if (stream.TryGetProperty("sources", out var sources) && sources.ValueKind == JsonValueKind.Array)
        {
            foreach (var source in sources.EnumerateArray())
            {
                var value = source.GetString();
                if (string.IsNullOrWhiteSpace(value)) continue;
                if (value.StartsWith("tracker:", StringComparison.OrdinalIgnoreCase))
                    value = value["tracker:".Length..];
                if (Uri.TryCreate(value, UriKind.Absolute, out var tracker) &&
                    tracker.Scheme is "udp" or "http" or "https" or "wss")
                    parts.Add($"tr={Uri.EscapeDataString(value)}");
            }
        }
        return string.Join("&", parts);
    }

    private static string? FirstString(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String)
                return value.GetString();
        }
        return null;
    }

    private static bool SupportsStreams(JsonElement manifest)
    {
        if (!manifest.TryGetProperty("resources", out var resources) || resources.ValueKind != JsonValueKind.Array)
            return false;
        foreach (var resource in resources.EnumerateArray())
        {
            if (resource.ValueKind == JsonValueKind.String &&
                string.Equals(resource.GetString(), "stream", StringComparison.OrdinalIgnoreCase))
                return true;
            if (resource.ValueKind == JsonValueKind.Object &&
                resource.TryGetProperty("name", out var name) &&
                string.Equals(name.GetString(), "stream", StringComparison.OrdinalIgnoreCase))
                return true;
        }
        return false;
    }

    public static bool TryValidatePublicHttpsUrl(string? raw, out Uri? uri, out string? error)
    {
        uri = null;
        error = null;
        if (!Uri.TryCreate(raw?.Trim(), UriKind.Absolute, out var parsed) ||
            parsed.Scheme != Uri.UriSchemeHttps)
        {
            error = "Use an absolute HTTPS manifest URL.";
            return false;
        }
        if (!string.IsNullOrEmpty(parsed.UserInfo) ||
            !parsed.AbsolutePath.EndsWith("/manifest.json", StringComparison.OrdinalIgnoreCase))
        {
            error = "The URL must end in /manifest.json and must not contain embedded credentials.";
            return false;
        }

        var host = parsed.DnsSafeHost;
        if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
            host.EndsWith(".local", StringComparison.OrdinalIgnoreCase) ||
            (IPAddress.TryParse(host, out var ip) && IsPrivateAddress(ip)))
        {
            error = "Local and private-network addon URLs are not allowed.";
            return false;
        }

        uri = parsed;
        return true;
    }

    private static bool IsPrivateAddress(IPAddress address)
    {
        if (IPAddress.IsLoopback(address)) return true;
        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
        {
            var b = address.GetAddressBytes();
            return b[0] == 10 ||
                   b[0] == 127 ||
                   b[0] == 169 && b[1] == 254 ||
                   b[0] == 172 && b[1] is >= 16 and <= 31 ||
                   b[0] == 192 && b[1] == 168;
        }
        return address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.Equals(IPAddress.IPv6Loopback);
    }
}
