using System.Globalization;
using System.Text.Json;
using Pitflix.Core.Database;

namespace Pitflix.API.Services;

/// <summary>
/// Per-episode IMDb ratings via OMDb (<c>omdbapi.com</c>) — the only ratings source this app uses that
/// actually varies by episode. MDBList's free tier does not: its per-episode-parameter endpoint returns
/// the show's own rating for every episode, and its bulk episode-ratings endpoint gates real per-episode
/// data behind a paid "Supporter" plan (confirmed against the live API).
/// </summary>
public sealed class OmdbRatingClient
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<OmdbRatingClient> _logger;
    private readonly HttpClient _http;
    // Be a polite citizen of the free 1,000-req/day tier — pace requests at ~2/sec.
    private readonly SemaphoreSlim _rateSemaphore = new(1, 1);
    private DateTime _lastRequestAt = DateTime.MinValue;

    public OmdbRatingClient(IServiceScopeFactory scopeFactory, ILogger<OmdbRatingClient> logger,
        IHttpClientFactory httpClientFactory)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _http = httpClientFactory.CreateClient(nameof(OmdbRatingClient));
        _http.Timeout = TimeSpan.FromSeconds(12);
    }

    /// <summary>Episode-level IMDb rating (0-10) when OMDb has it for the given series IMDb id.</summary>
    public async Task<double?> TryGetEpisodeRatingAsync(string seriesImdbId, int season, int episodeNumber,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(seriesImdbId) || season < 0 || episodeNumber <= 0) return null;

        var key = await GetApiKeyAsync(ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(key)) return null;

        await _rateSemaphore.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var elapsed = (DateTime.UtcNow - _lastRequestAt).TotalMilliseconds;
            if (elapsed < 500)
                await Task.Delay((int)(500 - elapsed), ct).ConfigureAwait(false);
            _lastRequestAt = DateTime.UtcNow;

            var url =
                $"https://www.omdbapi.com/?i={Uri.EscapeDataString(seriesImdbId)}&Season={season}&Episode={episodeNumber}" +
                $"&apikey={Uri.EscapeDataString(key)}";
            using var resp = await _http.GetAsync(url, ct).ConfigureAwait(false);
            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogDebug("OMDb episode lookup returned {Status} for {Series} S{Season}E{Episode}",
                    resp.StatusCode, seriesImdbId, season, episodeNumber);
                return null;
            }

            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.TryGetProperty("Response", out var respEl) &&
                respEl.GetString()?.Equals("False", StringComparison.OrdinalIgnoreCase) == true)
                return null;

            if (!root.TryGetProperty("imdbRating", out var ratingEl)) return null;
            var ratingStr = ratingEl.GetString();
            if (string.IsNullOrWhiteSpace(ratingStr) || ratingStr == "N/A") return null;

            return double.TryParse(ratingStr, NumberStyles.Any, CultureInfo.InvariantCulture, out var rating) &&
                   rating > 0
                ? rating
                : null;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "OMDb episode lookup failed for {Series} S{Season}E{Episode}", seriesImdbId,
                season, episodeNumber);
            return null;
        }
        finally
        {
            _rateSemaphore.Release();
        }
    }

    private async Task<string?> GetApiKeyAsync(CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        return await repo.GetSettingAsync("OmdbApiKey", ct).ConfigureAwait(false);
    }
}
