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
/// <summary>How an OMDb episode lookup ended. Only <see cref="Rated"/> and <see cref="NoRating"/> are
/// real answers worth caching; the rest are failures that must be retried later, not remembered as
/// "this episode has no rating" (which used to blank ratings for a week after a bad key or outage).</summary>
public enum OmdbLookupOutcome
{
    Rated,
    /// <summary>OMDb answered: the episode exists but has no rating, or OMDb doesn't know it.</summary>
    NoRating,
    /// <summary>Network error, timeout, 5xx — worth retrying on a later visit.</summary>
    Transient,
    /// <summary>No key, invalid/unactivated key, or daily limit reached — every further call fails too.</summary>
    Blocked,
}

public readonly record struct OmdbEpisodeLookup(OmdbLookupOutcome Outcome, double? Rating, string? Error = null)
{
    public bool IsDefinitive => Outcome is OmdbLookupOutcome.Rated or OmdbLookupOutcome.NoRating;
}

public sealed class OmdbRatingClient
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<OmdbRatingClient> _logger;
    private readonly HttpClient _http;
    // Be a polite citizen of the free 1,000-req/day tier — pace requests at ~2/sec.
    private readonly SemaphoreSlim _rateSemaphore = new(1, 1);
    private DateTime _lastRequestAt = DateTime.MinValue;
    private DateTime _lastBlockedWarningAt = DateTime.MinValue;

    public OmdbRatingClient(IServiceScopeFactory scopeFactory, ILogger<OmdbRatingClient> logger,
        IHttpClientFactory httpClientFactory)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _http = httpClientFactory.CreateClient(nameof(OmdbRatingClient));
        _http.Timeout = TimeSpan.FromSeconds(12);
    }

    /// <summary>Episode-level IMDb rating (0-10) when OMDb has it for the given series IMDb id.</summary>
    public async Task<OmdbEpisodeLookup> TryGetEpisodeRatingAsync(string seriesImdbId, int season,
        int episodeNumber, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(seriesImdbId) || season < 0 || episodeNumber <= 0)
            return new(OmdbLookupOutcome.NoRating, null);

        var key = await GetApiKeyAsync(ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(key))
            return new(OmdbLookupOutcome.Blocked, null, "No OMDb API key set.");

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
            // OMDb reports a bad key / used-up quota as 401 with a JSON { "Error": ... } body.
            JsonDocument? doc = null;
            try { doc = JsonDocument.Parse(body); } catch (JsonException) { /* non-JSON error page */ }
            using var docScope = doc;
            string? apiError = null;
            if (doc != null && doc.RootElement.TryGetProperty("Error", out var errEl))
                apiError = errEl.GetString();

            if (IsBlockingError(resp.StatusCode, apiError))
            {
                WarnBlocked(apiError ?? $"HTTP {(int)resp.StatusCode}");
                return new(OmdbLookupOutcome.Blocked, null, apiError);
            }
            if (!resp.IsSuccessStatusCode || doc == null)
            {
                _logger.LogDebug("OMDb episode lookup returned {Status} for {Series} S{Season}E{Episode}",
                    resp.StatusCode, seriesImdbId, season, episodeNumber);
                return new(OmdbLookupOutcome.Transient, null, apiError ?? $"HTTP {(int)resp.StatusCode}");
            }

            var root = doc.RootElement;
            if (root.TryGetProperty("Response", out var respEl) &&
                respEl.GetString()?.Equals("False", StringComparison.OrdinalIgnoreCase) == true)
            {
                // "Series or episode not found!" is a real answer; any other error is a hiccup.
                return apiError?.Contains("not found", StringComparison.OrdinalIgnoreCase) == true
                    ? new(OmdbLookupOutcome.NoRating, null, apiError)
                    : new(OmdbLookupOutcome.Transient, null, apiError);
            }

            if (!root.TryGetProperty("imdbRating", out var ratingEl))
                return new(OmdbLookupOutcome.NoRating, null);
            var ratingStr = ratingEl.GetString();
            if (string.IsNullOrWhiteSpace(ratingStr) || ratingStr == "N/A")
                return new(OmdbLookupOutcome.NoRating, null);

            return double.TryParse(ratingStr, NumberStyles.Any, CultureInfo.InvariantCulture, out var rating) &&
                   rating > 0
                ? new(OmdbLookupOutcome.Rated, rating)
                : new(OmdbLookupOutcome.NoRating, null);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "OMDb episode lookup failed for {Series} S{Season}E{Episode}", seriesImdbId,
                season, episodeNumber);
            return new(OmdbLookupOutcome.Transient, null, ex.Message);
        }
        finally
        {
            _rateSemaphore.Release();
        }
    }

    private static bool IsBlockingError(System.Net.HttpStatusCode status, string? apiError)
    {
        if (status == System.Net.HttpStatusCode.Unauthorized) return true;
        if (apiError is null) return false;
        return apiError.Contains("API key", StringComparison.OrdinalIgnoreCase) ||
               apiError.Contains("limit", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>A bad key / used-up quota silently blanks every episode rating, so say so in the log —
    /// at most every 10 minutes, since a season warm-up would otherwise repeat it per episode.</summary>
    private void WarnBlocked(string reason)
    {
        if (DateTime.UtcNow - _lastBlockedWarningAt < TimeSpan.FromMinutes(10)) return;
        _lastBlockedWarningAt = DateTime.UtcNow;
        _logger.LogWarning(
            "OMDb rejected the request ({Reason}); episode ratings are paused. New OMDb keys only work after clicking the activation link in the OMDb email.",
            reason);
    }

    private async Task<string?> GetApiKeyAsync(CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        return await repo.GetSettingAsync("OmdbApiKey", ct).ConfigureAwait(false);
    }
}
