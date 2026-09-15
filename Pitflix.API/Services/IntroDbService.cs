using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Pitflix.API.Services;

/// <summary>Raw intro/outro window from IntroDB, in seconds, plus its own confidence and
/// submission-count fields (unlike TheIntroDB, this source actually reports both — confirmed
/// live). Either pair may be null when the source has no data for that segment.</summary>
public sealed record IntroDbResult(
    double? IntroStartSeconds, double? IntroEndSeconds, double? IntroConfidence, int? IntroSubmissionCount,
    double? OutroStartSeconds, double? OutroEndSeconds, double? OutroConfidence, int? OutroSubmissionCount);

/// <summary>
/// Evaluation-pass client for IntroDB (https://introdb.app) — a community-submitted intro/outro
/// timestamp database, queried by IMDb id. No API key for reads. Confirmed live: TV-only — the
/// read endpoint 400s ("Invalid query params.") without both season and episode, so there is no
/// movie query shape to expose here.
/// </summary>
public sealed class IntroDbService
{
    private readonly HttpClient _http;
    private readonly ILogger<IntroDbService> _logger;

    public IntroDbService(IHttpClientFactory httpClientFactory, ILogger<IntroDbService> logger)
    {
        _http = httpClientFactory.CreateClient("IntroDb");
        _http.Timeout = TimeSpan.FromSeconds(10);
        _logger = logger;
    }

    public async Task<IntroDbResult?> GetForEpisodeAsync(string imdbId, int season, int episode, CancellationToken ct)
    {
        try
        {
            var url = $"https://api.introdb.app/segments?imdb_id={Uri.EscapeDataString(imdbId)}&season={season}&episode={episode}";
            using var resp = await _http.GetAsync(url, ct).ConfigureAwait(false);
            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
                return null;

            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.TryGetProperty("error", out _))
                return null;

            var (introStart, introEnd, introConf, introCount) = ReadSegment(root, "intro");
            var (outroStart, outroEnd, outroConf, outroCount) = ReadSegment(root, "outro");

            if (introStart is null && introEnd is null && outroStart is null && outroEnd is null)
                return null;

            return new IntroDbResult(introStart, introEnd, introConf, introCount, outroStart, outroEnd, outroConf, outroCount);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "IntroDB: lookup failed for {ImdbId} S{Season}E{Episode}", imdbId, season, episode);
            return null;
        }
    }

    private static (double? Start, double? End, double? Confidence, int? SubmissionCount) ReadSegment(
        JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var seg) || seg.ValueKind != JsonValueKind.Object)
            return (null, null, null, null);

        double? start = seg.TryGetProperty("start_ms", out var s) && s.ValueKind == JsonValueKind.Number
            ? s.GetDouble() / 1000.0 : null;
        double? end = seg.TryGetProperty("end_ms", out var e) && e.ValueKind == JsonValueKind.Number
            ? e.GetDouble() / 1000.0 : null;
        double? confidence = seg.TryGetProperty("confidence", out var c) && c.ValueKind == JsonValueKind.Number
            ? c.GetDouble() : null;
        int? submissionCount = seg.TryGetProperty("submission_count", out var sc) && sc.ValueKind == JsonValueKind.Number
            ? sc.GetInt32() : null;
        return (start, end, confidence, submissionCount);
    }
}
