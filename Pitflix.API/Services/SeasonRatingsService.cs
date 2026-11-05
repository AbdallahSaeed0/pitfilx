using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.RegularExpressions;
using Pitflix.Core.Database;
using Pitflix.Core.Net;

namespace Pitflix.API.Services;

/// <summary>
/// Per-season critic/audience scores for the season page — Rotten Tomatoes (Tomatometer + Popcornmeter)
/// and Metacritic (Metascore). MDBList, where the show-level numbers come from, only has whole-show
/// scores, but both sites publish a page per season:
/// <list type="number">
/// <item>the show's ids on both sites come from Wikidata (P1258 Rotten Tomatoes, P1712 Metacritic),
/// looked up by its TMDB id (P4983) through the disk-cached "Wikidata" client;</item>
/// <item>the season page is read once: RT embeds criticsScore/audienceScore JSON, Metacritic a
/// schema.org aggregateRating.</item>
/// </list>
/// Results are saved in Settings for <see cref="FreshFor"/>; older ones are still returned at once and
/// refreshed in the background, so only a never-seen season waits on the network (~1-1.5 s).
/// </summary>
public sealed class SeasonRatingsService
{
    public sealed record SeasonScores(int? RottenTomatoes, int? RottenTomatoesAudience, int? Metacritic,
        string? RottenTomatoesUrl, string? MetacriticUrl, DateTime FetchedUtc);

    private static readonly TimeSpan FreshFor = TimeSpan.FromDays(7);
    private static readonly Regex RtCritics = new("\"criticsScore\":\\{[^{}]*?\"score\":\"(\\d{1,3})\"", RegexOptions.Compiled);
    private static readonly Regex RtAudience = new("\"audienceScore\":\\{[^{}]*?\"score\":\"(\\d{1,3})\"", RegexOptions.Compiled);
    private static readonly Regex McAggregate = new("\"aggregateRating\":\\{[^{}]*?\"ratingValue\":\\s*\"?(\\d{1,3})", RegexOptions.Compiled);

    private readonly IHttpClientFactory _httpFactory;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<SeasonRatingsService> _log;
    private readonly ConcurrentDictionary<string, byte> _refreshing = new();

    public SeasonRatingsService(IHttpClientFactory httpFactory, IServiceScopeFactory scopeFactory,
        ILogger<SeasonRatingsService> log)
    {
        _httpFactory = httpFactory;
        _scopeFactory = scopeFactory;
        _log = log;
    }

    public async Task<SeasonScores?> GetAsync(int showTmdbId, int season, CancellationToken ct)
    {
        if (showTmdbId <= 0 || season <= 0) return null; // specials have no per-season pages
        var key = $"SeasonScores:{showTmdbId}:{season}";
        var saved = await ReadAsync(key, ct).ConfigureAwait(false);
        if (saved is not null)
        {
            if (DateTime.UtcNow - saved.FetchedUtc > FreshFor && !NetworkStatus.IsOffline &&
                _refreshing.TryAdd(key, 0))
            {
                _ = Task.Run(async () =>
                {
                    try { await FetchAndSaveAsync(key, showTmdbId, season, CancellationToken.None).ConfigureAwait(false); }
                    catch { /* keep the saved scores */ }
                    finally { _refreshing.TryRemove(key, out _); }
                });
            }
            return saved;
        }
        if (NetworkStatus.IsOffline) return null;
        return await FetchAndSaveAsync(key, showTmdbId, season, ct).ConfigureAwait(false);
    }

    private async Task<SeasonScores> FetchAndSaveAsync(string key, int showTmdbId, int season, CancellationToken ct)
    {
        var (rtId, mcId) = await ResolveSiteIdsAsync(showTmdbId, ct).ConfigureAwait(false);
        var web = _httpFactory.CreateClient(nameof(SeasonRatingsService));

        int? rt = null, rtAudience = null, mc = null;
        string? rtUrl = null, mcUrl = null;
        var rtTask = rtId is null
            ? Task.FromResult<string?>(null)
            : GetPageAsync(web, $"https://www.rottentomatoes.com/{rtId}/s{season:00}", $"/s{season:00}", ct);
        var mcTask = mcId is null
            ? Task.FromResult<string?>(null)
            : GetPageAsync(web, $"https://www.metacritic.com/{mcId}/season-{season}/", $"/season-{season}", ct);
        await Task.WhenAll(rtTask, mcTask).ConfigureAwait(false);

        if (rtTask.Result is { } rtHtml)
        {
            rtUrl = $"https://www.rottentomatoes.com/{rtId}/s{season:00}";
            rt = MatchInt(RtCritics, rtHtml);
            rtAudience = MatchInt(RtAudience, rtHtml);
        }
        if (mcTask.Result is { } mcHtml)
        {
            mcUrl = $"https://www.metacritic.com/{mcId}/season-{season}/";
            mc = MatchInt(McAggregate, mcHtml);
        }

        var scores = new SeasonScores(rt, rtAudience, mc, rtUrl, mcUrl, DateTime.UtcNow);
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        await repo.SaveSettingAsync(key, JsonSerializer.Serialize(scores), ct).ConfigureAwait(false);
        return scores;
    }

    /// <summary>The page body, or null when it's missing — or when the site redirected away from the
    /// season (a season it doesn't have lands on the show page, whose scores would be the wrong ones).</summary>
    private async Task<string?> GetPageAsync(HttpClient web, string url, string mustStayOn, CancellationToken ct)
    {
        try
        {
            using var resp = await web.GetAsync(url, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return null;
            var finalPath = resp.RequestMessage?.RequestUri?.AbsolutePath ?? "";
            if (!finalPath.Contains(mustStayOn, StringComparison.OrdinalIgnoreCase)) return null;
            return await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _log.LogDebug("Season score page failed {Url}: {Msg}", url, ex.Message);
            return null;
        }
    }

    private async Task<(string? Rt, string? Mc)> ResolveSiteIdsAsync(int showTmdbId, CancellationToken ct)
    {
        var sparql = $$"""
            SELECT ?rt ?mc WHERE {
              ?item wdt:P4983 "{{showTmdbId}}" .
              OPTIONAL { ?item wdt:P1258 ?rt }
              OPTIONAL { ?item wdt:P1712 ?mc }
            } LIMIT 1
            """;
        try
        {
            var client = _httpFactory.CreateClient("Wikidata");
            var url = "https://query.wikidata.org/sparql?query=" + Uri.EscapeDataString(sparql) + "&format=json";
            using var resp = await client.GetAsync(url, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return (null, null);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false));
            foreach (var b in doc.RootElement.GetProperty("results").GetProperty("bindings").EnumerateArray())
            {
                static string? Val(JsonElement b, string name) =>
                    b.TryGetProperty(name, out var v) && v.TryGetProperty("value", out var s) ? s.GetString() : null;
                // Only shapes we know how to turn into season URLs.
                var rt = Val(b, "rt");
                var mc = Val(b, "mc");
                return (rt is not null && rt.StartsWith("tv/") ? rt : null,
                        mc is not null && mc.StartsWith("tv/") ? mc : null);
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or KeyNotFoundException)
        {
            _log.LogDebug("Wikidata site-id lookup failed for tmdb {Id}: {Msg}", showTmdbId, ex.Message);
        }
        return (null, null);
    }

    private static int? MatchInt(Regex re, string html)
    {
        var m = re.Match(html);
        return m.Success && int.TryParse(m.Groups[1].Value, out var v) && v is >= 0 and <= 100 ? v : null;
    }

    private async Task<SeasonScores?> ReadAsync(string key, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        var json = await repo.GetSettingAsync(key, ct).ConfigureAwait(false);
        if (string.IsNullOrEmpty(json)) return null;
        try { return JsonSerializer.Deserialize<SeasonScores>(json); }
        catch (JsonException) { return null; }
    }
}
