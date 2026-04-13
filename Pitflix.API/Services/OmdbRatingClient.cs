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

    /// <summary>Title + year + OMDb type (<c>movie</c> or <c>series</c>) when IMDb id is unknown.</summary>
    public async Task<(OmdbTitleResult? Result, OmdbMatchKind Kind)> TryGetByTitleYearTypeAsync(
        string title,
        int? year,
        string omdbType,
        CancellationToken ct = default)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(title))
            return (null, OmdbMatchKind.NotConfigured);

        var t = title.Trim();
        var typeNorm = omdbType.Equals("movie", StringComparison.OrdinalIgnoreCase) ? "movie" : "series";

        try
        {
            var q =
                $"https://www.omdbapi.com/?t={Uri.EscapeDataString(t)}&apikey={Uri.EscapeDataString(_apiKey!)}" +
                $"&plot=short&tomatoes=true&type={typeNorm}";
            if (year is > 1880 and < 2100)
                q += $"&y={year.Value}";

            await using var stream = await _http.GetStreamAsync(new Uri(q), ct).ConfigureAwait(false);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct).ConfigureAwait(false);
            var root = doc.RootElement;
            var (parsed, err) = ParseOmdbTitleDocument(root);
            if (parsed != null)
                return (parsed, OmdbMatchKind.TitleExact);

            if (IsRateOrQuotaError(err))
            {
                _log.LogWarning("OMDb quota/rate during title match for {Title}: {Error}", t, err);
                return (null, OmdbMatchKind.RateLimited);
            }

            // Fall back to search list when single-title lookup fails or is ambiguous on OMDb side.
            var searchQ =
                $"https://www.omdbapi.com/?s={Uri.EscapeDataString(t)}&apikey={Uri.EscapeDataString(_apiKey!)}" +
                $"&type={typeNorm}&page=1";
            await using var stream2 = await _http.GetStreamAsync(new Uri(searchQ), ct).ConfigureAwait(false);
            using var doc2 = await JsonDocument.ParseAsync(stream2, cancellationToken: ct).ConfigureAwait(false);
            var root2 = doc2.RootElement;
            if (root2.TryGetProperty("Response", out var resp2) &&
                resp2.GetString()?.Equals("False", StringComparison.OrdinalIgnoreCase) == true)
            {
                var err2 = root2.TryGetProperty("Error", out var er2) ? er2.GetString() : err;
                _log.LogDebug("OMDb title search miss for {Title} ({Type}): {Error}", t, typeNorm, err2);
                return (null, OmdbMatchKind.NoMatch);
            }

            if (!root2.TryGetProperty("Search", out var search) || search.ValueKind != JsonValueKind.Array ||
                search.GetArrayLength() == 0)
                return (null, OmdbMatchKind.NoMatch);

            var scored = new List<(double Score, string ImdbId)>();
            foreach (var item in search.EnumerateArray())
            {
                var st = item.TryGetProperty("Title", out var tt) ? tt.GetString()?.Trim() ?? "" : "";
                var sy = item.TryGetProperty("Year", out var yy) ? yy.GetString() : "";
                var imdb = item.TryGetProperty("imdbID", out var ii) ? ii.GetString()?.Trim() : null;
                if (string.IsNullOrEmpty(imdb) || !imdb.StartsWith("tt", StringComparison.OrdinalIgnoreCase))
                    continue;

                var score = TitleSimilarity(t, st);
                if (year is > 1880 && sy != null && sy.Contains(year.Value.ToString(), StringComparison.Ordinal))
                    score += 0.35;
                scored.Add((score, imdb));
            }

            if (scored.Count == 0)
                return (null, OmdbMatchKind.NoMatch);

            scored.Sort((a, b) => b.Score.CompareTo(a.Score));
            var ambiguous = scored.Count >= 2 && scored[0].Score - scored[1].Score < 0.08;
            if (ambiguous)
                _log.LogInformation("OMDb ambiguous search for {Title} ({Type}) — using best-scoring hit", t,
                    typeNorm);

            var best = await TryGetByImdbIdAsync(scored[0].ImdbId, ct).ConfigureAwait(false);
            if (best == null)
                return (null, OmdbMatchKind.NoMatch);
            return (best, ambiguous ? OmdbMatchKind.Ambiguous : OmdbMatchKind.TitleSearch);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "OMDb title lookup failed for {Title}", t);
            return (null, OmdbMatchKind.Error);
        }
    }

    /// <summary>Episode-level IMDb rating when OMDb exposes it for the given series IMDb id.</summary>
    public async Task<OmdbTitleResult?> TryGetEpisodeBySeriesImdbIdAsync(string seriesImdbId, int season,
        int episodeNumber, CancellationToken ct = default)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(seriesImdbId))
            return null;

        var id = seriesImdbId.Trim();
        if (!id.StartsWith("tt", StringComparison.OrdinalIgnoreCase))
            return null;
        if (season < 0 || episodeNumber <= 0)
            return null;

        try
        {
            var url =
                $"https://www.omdbapi.com/?i={Uri.EscapeDataString(id)}&Season={season}&Episode={episodeNumber}" +
                $"&apikey={Uri.EscapeDataString(_apiKey!)}&plot=short&tomatoes=true";
            await using var stream = await _http.GetStreamAsync(new Uri(url), ct).ConfigureAwait(false);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct).ConfigureAwait(false);
            var root = doc.RootElement;
            if (root.TryGetProperty("Response", out var resp) &&
                resp.GetString()?.Equals("False", StringComparison.OrdinalIgnoreCase) == true)
            {
                var err = root.TryGetProperty("Error", out var er) ? er.GetString() : "";
                _log.LogDebug("OMDb episode miss {Series} S{Season}E{Episode}: {Error}", id, season, episodeNumber,
                    err);
                return null;
            }

            var imdbR = root.TryGetProperty("imdbRating", out var ir) ? ir.GetString()?.Trim() : null;
            var imdbV = root.TryGetProperty("imdbVotes", out var iv) ? iv.GetString()?.Trim() : null;
            if (string.IsNullOrEmpty(imdbR) && string.IsNullOrEmpty(imdbV))
                return null;

            return new OmdbTitleResult(
                string.IsNullOrEmpty(imdbR) ? null : imdbR,
                RottenTomatoesCriticsPercent: null,
                AudiencePercent: null,
                string.IsNullOrEmpty(imdbV) ? null : imdbV);
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "OMDb episode lookup failed for {Series} S{Season}E{Episode}", id, season, episodeNumber);
            return null;
        }
    }

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
            var (parsed, err) = ParseOmdbTitleDocument(root);
            if (parsed != null)
                return parsed;

            if (IsRateOrQuotaError(err))
                _log.LogWarning("OMDb quota or rate limit for {ImdbId}: {Error}", id, err);
            else
                _log.LogDebug("OMDb non-success for {ImdbId}: {Error}", id, err);
            return null;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "OMDb request failed for {ImdbId}", id);
            return null;
        }
    }

    private static (OmdbTitleResult? Result, string? Error) ParseOmdbTitleDocument(JsonElement root)
    {
        if (root.TryGetProperty("Response", out var resp) &&
            resp.GetString()?.Equals("False", StringComparison.OrdinalIgnoreCase) == true)
        {
            var err = root.TryGetProperty("Error", out var er) ? er.GetString() : "OMDb returned no data.";
            return (null, err);
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

        return (new OmdbTitleResult(
            string.IsNullOrWhiteSpace(imdbRating) ? null : imdbRating.Trim(),
            rtCritics,
            AudiencePercent: audience,
            string.IsNullOrWhiteSpace(imdbVotes) ? null : imdbVotes.Trim()), null);
    }

    private static bool IsRateOrQuotaError(string? err) =>
        err != null && (err.Contains("limit", StringComparison.OrdinalIgnoreCase) ||
                        err.Contains("Maximum", StringComparison.OrdinalIgnoreCase));

    private static double TitleSimilarity(string requested, string candidate)
    {
        var a = requested.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var b = candidate.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (a.Length == 0 || b.Length == 0)
            return 0;
        var setA = new HashSet<string>(a);
        var inter = 0;
        foreach (var w in b)
        {
            if (setA.Contains(w))
                inter++;
        }

        return (double)inter / Math.Max(setA.Count, b.Length);
    }
}

public sealed record OmdbTitleResult(
    string? ImdbRatingOutOf10,
    string? RottenTomatoesCriticsPercent,
    string? AudiencePercent,
    string? ImdbVoteCount);

public enum OmdbMatchKind
{
    NotConfigured,
    NoMatch,
    TitleExact,
    TitleSearch,
    Ambiguous,
    RateLimited,
    Error
}
