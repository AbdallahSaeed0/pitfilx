using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Pitflix.API.Services;

/// <summary>Optional OMDb enrichment for IMDb / Rotten Tomatoes style scores.</summary>
public sealed class OmdbRatingClient
{
    private readonly HttpClient _http;
    private readonly string? _apiKey;
    private readonly ILogger<OmdbRatingClient> _log;

    public OmdbRatingClient(
        IHttpClientFactory httpFactory,
        IConfiguration configuration,
        ILogger<OmdbRatingClient> log)
    {
        _http = httpFactory.CreateClient(nameof(OmdbRatingClient));
        _http.Timeout = TimeSpan.FromSeconds(12);
        _log = log;
        _apiKey = configuration["Pitflix:OmdbApiKey"]?.Trim();
        if (string.IsNullOrEmpty(_apiKey))
            _apiKey = configuration["OmdbApiKey"]?.Trim();
        if (string.IsNullOrEmpty(_apiKey))
            _apiKey = Environment.GetEnvironmentVariable("PITFLIX_OMDB_API_KEY")?.Trim();
    }

    public bool IsConfigured => !string.IsNullOrEmpty(_apiKey);

    public async Task<OmdbTitleResult?> TryGetByImdbIdAsync(string imdbId, CancellationToken ct = default)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(imdbId))
            return null;

        var id = imdbId.Trim();
        if (!id.StartsWith("tt", StringComparison.OrdinalIgnoreCase))
            return null;

        try
        {
            // tomatoes=true adds Rotten Tomatoes-style fields where available on the API plan.
            var url =
                $"https://www.omdbapi.com/?i={Uri.EscapeDataString(id)}&apikey={Uri.EscapeDataString(_apiKey!)}" +
                "&plot=short&tomatoes=true";
            await using var stream = await _http.GetStreamAsync(new Uri(url), ct).ConfigureAwait(false);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct).ConfigureAwait(false);
            var root = doc.RootElement;
            if (root.TryGetProperty("Response", out var resp) &&
                resp.GetString()?.Equals("False", StringComparison.OrdinalIgnoreCase) == true)
            {
                var err = root.TryGetProperty("Error", out var er) ? er.GetString() : "OMDb returned no data.";
                if (err?.Contains("limit", StringComparison.OrdinalIgnoreCase) == true ||
                    err?.Contains("Maximum", StringComparison.OrdinalIgnoreCase) == true)
                    _log.LogWarning("OMDb quota or rate limit: {Error}", err);
                else
                    _log.LogDebug("OMDb non-success for {ImdbId}: {Error}", id, err);
                return null;
            }

            string? imdbRating = root.TryGetProperty("imdbRating", out var ir) ? ir.GetString() : null;
            string? imdbVotes = root.TryGetProperty("imdbVotes", out var iv) ? iv.GetString() : null;
            string? rtCritics = null;

            if (root.TryGetProperty("Ratings", out var ratings) && ratings.ValueKind == JsonValueKind.Array)
            {
                foreach (var r in ratings.EnumerateArray())
                {
                    var src = r.TryGetProperty("Source", out var s) ? s.GetString() ?? "" : "";
                    var val = r.TryGetProperty("Value", out var v) ? v.GetString() ?? "" : "";
                    if (!src.Contains("Rotten Tomatoes", StringComparison.OrdinalIgnoreCase) ||
                        !val.Contains('%'))
                        continue;
                    rtCritics = val;
                    break;
                }
            }

            if (string.IsNullOrEmpty(rtCritics) && root.TryGetProperty("tomatoMeter", out var tomatoMeter))
            {
                var tms = tomatoMeter.GetString()?.Trim();
                if (!string.IsNullOrEmpty(tms))
                    rtCritics = tms.Contains('%', StringComparison.Ordinal) ? tms : tms + "%";
            }

            string? audience = null;
            if (root.TryGetProperty("tomatoUserMeter", out var tum))
            {
                var aus = tum.GetString()?.Trim();
                if (!string.IsNullOrEmpty(aus))
                    audience = aus.Contains('%', StringComparison.Ordinal) ? aus : aus + "%";
            }

            return new OmdbTitleResult(
                string.IsNullOrWhiteSpace(imdbRating) ? null : imdbRating.Trim(),
                rtCritics,
                AudiencePercent: audience,
                string.IsNullOrWhiteSpace(imdbVotes) ? null : imdbVotes.Trim());
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "OMDb request failed for {ImdbId}", id);
            return null;
        }
    }
}

public sealed record OmdbTitleResult(
    string? ImdbRatingOutOf10,
    string? RottenTomatoesCriticsPercent,
    string? AudiencePercent,
    string? ImdbVoteCount);
