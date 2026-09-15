using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Pitflix.API.Services;

/// <summary>Raw intro/credits window from TheIntroDB, in seconds. Either pair may be null when
/// the API had no data for that segment; <see cref="IntroEndSeconds"/>/<see cref="OutroEndSeconds"/>
/// can also be null on their own when a boundary (start of file, end of file) is implied rather
/// than reported.</summary>
public sealed record TheIntroDbResult(
    double? IntroStartSeconds, double? IntroEndSeconds,
    double? OutroStartSeconds, double? OutroEndSeconds);

/// <summary>
/// Evaluation-pass client for TheIntroDB (https://theintrodb.org) — a community-submitted
/// intro/credits timestamp database, queried by TMDB id. No API key for reads. The public docs
/// don't document a confidence or submission-count field, and live testing confirmed the response
/// has none, so results are accepted as-is and simply tagged with their source at the call site —
/// there is no threshold to gate on.
/// </summary>
public sealed class TheIntroDbService
{
    private readonly HttpClient _http;
    private readonly ILogger<TheIntroDbService> _logger;

    public TheIntroDbService(IHttpClientFactory httpClientFactory, ILogger<TheIntroDbService> logger)
    {
        _http = httpClientFactory.CreateClient("TheIntroDb");
        _http.Timeout = TimeSpan.FromSeconds(10);
        _logger = logger;
    }

    /// <summary>Movie lookup — pass only <paramref name="tmdbId"/>.</summary>
    public Task<TheIntroDbResult?> GetForMovieAsync(int tmdbId, CancellationToken ct) =>
        GetAsync($"https://api.theintrodb.org/v3/media?tmdb_id={tmdbId}", ct);

    /// <summary>TV episode lookup — <paramref name="tmdbId"/> is the show's id.</summary>
    public Task<TheIntroDbResult?> GetForEpisodeAsync(int tmdbId, int season, int episode, CancellationToken ct) =>
        GetAsync($"https://api.theintrodb.org/v3/media?tmdb_id={tmdbId}&season={season}&episode={episode}", ct);

    private async Task<TheIntroDbResult?> GetAsync(string url, CancellationToken ct)
    {
        try
        {
            using var resp = await _http.GetAsync(url, ct).ConfigureAwait(false);
            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
                return null;

            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.TryGetProperty("error", out _))
                return null;

            var (introStart, introEnd) = ReadFirstSegment(root, "intro");
            var (outroStart, outroEnd) = ReadFirstSegment(root, "credits");

            if (introStart is null && introEnd is null && outroStart is null && outroEnd is null)
                return null;

            return new TheIntroDbResult(introStart, introEnd, outroStart, outroEnd);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "TheIntroDB: lookup failed for {Url}", url);
            return null;
        }
    }

    private static (double? Start, double? End) ReadFirstSegment(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var arr) ||
            arr.ValueKind != JsonValueKind.Array || arr.GetArrayLength() == 0)
            return (null, null);

        var first = arr[0];
        double? start = first.TryGetProperty("start_ms", out var s) && s.ValueKind == JsonValueKind.Number
            ? s.GetDouble() / 1000.0 : null;
        double? end = first.TryGetProperty("end_ms", out var e) && e.ValueKind == JsonValueKind.Number
            ? e.GetDouble() / 1000.0 : null;
        return (start, end);
    }
}
