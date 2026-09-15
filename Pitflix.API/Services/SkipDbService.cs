using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Pitflix.API.Services;

/// <summary>Raw intro/outro window from SkipDB, in seconds, plus its own confidence and a
/// match-quality flag ("agnostic" | "out-of-range", confirmed live). Either pair may be null when
/// the source has no data for that segment.</summary>
public sealed record SkipDbResult(
    double? IntroStartSeconds, double? IntroEndSeconds, double? IntroConfidence, string? IntroMatch,
    double? OutroStartSeconds, double? OutroEndSeconds, double? OutroConfidence, string? OutroMatch);

/// <summary>
/// Evaluation-pass client for SkipDB (https://api.skipdb.tv) — a community-submitted intro/outro
/// timestamp database, queried by IMDb id. No API key for reads. Supports both movies (no
/// season/episode) and TV episodes, unlike IntroDB which is TV-only.
///
/// The documented <c>duration</c> query param (for stream-aware matching against the actual file's
/// runtime) is deliberately NOT sent: live testing found it flips the response's own <c>match</c>
/// field to "out-of-range" and drops confidence even when passed the file's real duration (tried
/// as milliseconds, seconds, and alternate param names — only the literal `duration` name is even
/// read, and every value tried degraded the result rather than improving it). Without clearer
/// documentation of its actual contract, using it risks making results worse, not better, so reads
/// stick to the plain (undated) lookup, which reliably returns "agnostic"-matched data instead.
/// </summary>
public sealed class SkipDbService
{
    private readonly HttpClient _http;
    private readonly ILogger<SkipDbService> _logger;

    public SkipDbService(IHttpClientFactory httpClientFactory, ILogger<SkipDbService> logger)
    {
        _http = httpClientFactory.CreateClient("SkipDb");
        _http.Timeout = TimeSpan.FromSeconds(10);
        _logger = logger;
    }

    /// <summary>Movie lookup — no caller in this codebase yet (there is no movie-skip detection
    /// entry point at all), kept for parity with the other two services and for whenever one
    /// exists.</summary>
    public Task<SkipDbResult?> GetForMovieAsync(string imdbId, CancellationToken ct) =>
        GetAsync($"https://api.skipdb.tv/api/segments?imdb_id={Uri.EscapeDataString(imdbId)}", ct);

    public Task<SkipDbResult?> GetForEpisodeAsync(string imdbId, int season, int episode, CancellationToken ct) =>
        GetAsync($"https://api.skipdb.tv/api/segments?imdb_id={Uri.EscapeDataString(imdbId)}&season={season}&episode={episode}", ct);

    private async Task<SkipDbResult?> GetAsync(string url, CancellationToken ct)
    {
        try
        {
            using var resp = await _http.GetAsync(url, ct).ConfigureAwait(false);
            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
                return null;

            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (!root.TryGetProperty("segments", out var segments) || segments.ValueKind != JsonValueKind.Object)
                return null;

            var (introStart, introEnd, introConf, introMatch) = ReadSegment(segments, "intro");
            var (outroStart, outroEnd, outroConf, outroMatch) = ReadSegment(segments, "outro");

            if (introStart is null && introEnd is null && outroStart is null && outroEnd is null)
                return null;

            return new SkipDbResult(introStart, introEnd, introConf, introMatch, outroStart, outroEnd, outroConf, outroMatch);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "SkipDB: lookup failed for {Url}", url);
            return null;
        }
    }

    private static (double? Start, double? End, double? Confidence, string? Match) ReadSegment(
        JsonElement segments, string propertyName)
    {
        if (!segments.TryGetProperty(propertyName, out var seg) || seg.ValueKind != JsonValueKind.Object)
            return (null, null, null, null);

        double? start = seg.TryGetProperty("start_ms", out var s) && s.ValueKind == JsonValueKind.Number
            ? s.GetDouble() / 1000.0 : null;
        double? end = seg.TryGetProperty("end_ms", out var e) && e.ValueKind == JsonValueKind.Number
            ? e.GetDouble() / 1000.0 : null;
        double? confidence = seg.TryGetProperty("confidence", out var c) && c.ValueKind == JsonValueKind.Number
            ? c.GetDouble() : null;
        string? match = seg.TryGetProperty("match", out var m) && m.ValueKind == JsonValueKind.String
            ? m.GetString() : null;
        return (start, end, confidence, match);
    }
}
