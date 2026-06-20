using System.Text.Json;

namespace Pitflix.API.Services.Awards;

public sealed record WikidataAward(string AwardLabel, bool Winner, int? Year);

public sealed class WikidataAwardsService
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<WikidataAwardsService> _log;

    public WikidataAwardsService(IHttpClientFactory httpFactory, ILogger<WikidataAwardsService> log)
    {
        _httpFactory = httpFactory;
        _log = log;
    }

    public async Task<IReadOnlyList<WikidataAward>> GetAwardsAsync(int tmdbId, bool isTv, CancellationToken ct)
    {
        // Wikidata properties: P4947 = TMDB movie ID, P8652 = TMDB TV series ID
        // P166 = award received (win), P1411 = nominated for (nomination)
        var tmdbProp = isTv ? "P8652" : "P4947";
        var sparql = $$"""
            SELECT ?type ?awardLabel ?year WHERE {
              ?item wdt:{{tmdbProp}} "{{tmdbId}}" .
              {
                ?item p:P166 ?st .
                ?st ps:P166 ?award .
                OPTIONAL { ?st pq:P585 ?year }
                BIND("won" AS ?type)
              } UNION {
                ?item p:P1411 ?st .
                ?st ps:P1411 ?award .
                OPTIONAL { ?st pq:P585 ?year }
                BIND("nominated" AS ?type)
              }
              SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
            }
            ORDER BY DESC(?year)
            LIMIT 300
            """;

        try
        {
            var url = "https://query.wikidata.org/sparql?query=" + Uri.EscapeDataString(sparql) + "&format=json";
            var client = _httpFactory.CreateClient("Wikidata");
            using var resp = await client.GetAsync(url, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                _log.LogWarning("Wikidata SPARQL returned {Status}", resp.StatusCode);
                return Array.Empty<WikidataAward>();
            }

            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(body);
            var bindings = doc.RootElement.GetProperty("results").GetProperty("bindings");

            var results = new List<WikidataAward>();
            foreach (var b in bindings.EnumerateArray())
            {
                var type = b.TryGetProperty("type", out var te) ? te.GetProperty("value").GetString() : null;
                var label = b.TryGetProperty("awardLabel", out var le) ? le.GetProperty("value").GetString() : null;
                var yearStr = b.TryGetProperty("year", out var ye) ? ye.GetProperty("value").GetString() : null;

                if (string.IsNullOrWhiteSpace(label)) continue;

                int? year = null;
                if (!string.IsNullOrWhiteSpace(yearStr) &&
                    DateTime.TryParse(yearStr, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt))
                    year = dt.Year;

                results.Add(new WikidataAward(label.Trim(), type == "won", year));
            }

            return results;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Wikidata awards fetch failed for TMDB {Id}", tmdbId);
            return Array.Empty<WikidataAward>();
        }
    }

    /// <summary>Same award query but keyed on IMDb ID (P345) — much broader Wikidata coverage than TMDB IDs.</summary>
    public async Task<IReadOnlyList<WikidataAward>> GetAwardsByImdbIdAsync(string imdbId, CancellationToken ct)
    {
        var sparql = $$"""
            SELECT ?type ?awardLabel ?year WHERE {
              ?item wdt:P345 "{{imdbId}}" .
              {
                ?item p:P166 ?st .
                ?st ps:P166 ?award .
                OPTIONAL { ?st pq:P585 ?year }
                BIND("won" AS ?type)
              } UNION {
                ?item p:P1411 ?st .
                ?st ps:P1411 ?award .
                OPTIONAL { ?st pq:P585 ?year }
                BIND("nominated" AS ?type)
              }
              SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
            }
            ORDER BY DESC(?year)
            LIMIT 300
            """;

        try
        {
            var url = "https://query.wikidata.org/sparql?query=" + Uri.EscapeDataString(sparql) + "&format=json";
            var client = _httpFactory.CreateClient("Wikidata");
            using var resp = await client.GetAsync(url, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return Array.Empty<WikidataAward>();

            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(body);
            var bindings = doc.RootElement.GetProperty("results").GetProperty("bindings");

            var results = new List<WikidataAward>();
            foreach (var b in bindings.EnumerateArray())
            {
                var type  = b.TryGetProperty("type",       out var te) ? te.GetProperty("value").GetString() : null;
                var label = b.TryGetProperty("awardLabel", out var le) ? le.GetProperty("value").GetString() : null;
                var yearStr = b.TryGetProperty("year",     out var ye) ? ye.GetProperty("value").GetString() : null;
                if (string.IsNullOrWhiteSpace(label)) continue;
                int? year = null;
                if (!string.IsNullOrWhiteSpace(yearStr) &&
                    DateTime.TryParse(yearStr, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt))
                    year = dt.Year;
                results.Add(new WikidataAward(label.Trim(), type == "won", year));
            }
            return results;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Wikidata awards-by-imdb fetch failed for {ImdbId}", imdbId);
            return Array.Empty<WikidataAward>();
        }
    }

    public sealed record PersonAwardEntry(
        string AwardLabel, bool Winner, int? Year,
        string? WorkTitle, int? WorkTmdbMovieId, int? WorkTmdbTvId);

    /// <summary>
    /// Fetches awards won/nominated for a person by their TMDB person ID.
    /// Uses Wikidata property P4985 (TMDB person ID).
    /// </summary>
    public async Task<IReadOnlyList<PersonAwardEntry>> GetPersonAwardsAsync(int tmdbPersonId, CancellationToken ct)
    {
        var sparql = $$"""
            SELECT ?type ?awardLabel ?year ?workLabel ?workMovieId ?workTvId WHERE {
              ?person wdt:P4985 "{{tmdbPersonId}}" .
              {
                ?person p:P166 ?st .
                ?st ps:P166 ?award .
                OPTIONAL { ?st pq:P585 ?year }
                OPTIONAL { ?st pq:P1686 ?work .
                             OPTIONAL { ?work wdt:P4947 ?workMovieId }
                             OPTIONAL { ?work wdt:P8652 ?workTvId } }
                BIND("won" AS ?type)
              } UNION {
                ?person p:P1411 ?st .
                ?st ps:P1411 ?award .
                OPTIONAL { ?st pq:P585 ?year }
                OPTIONAL { ?st pq:P1686 ?work .
                             OPTIONAL { ?work wdt:P4947 ?workMovieId }
                             OPTIONAL { ?work wdt:P8652 ?workTvId } }
                BIND("nominated" AS ?type)
              }
              SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
            }
            ORDER BY DESC(?year)
            LIMIT 300
            """;

        try
        {
            var url = "https://query.wikidata.org/sparql?query=" + Uri.EscapeDataString(sparql) + "&format=json";
            var client = _httpFactory.CreateClient("Wikidata");
            using var resp = await client.GetAsync(url, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return Array.Empty<PersonAwardEntry>();

            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(body);
            var bindings = doc.RootElement.GetProperty("results").GetProperty("bindings");

            var results = new List<PersonAwardEntry>();
            foreach (var b in bindings.EnumerateArray())
            {
                var type  = b.TryGetProperty("type", out var te) ? te.GetProperty("value").GetString() : null;
                var label = b.TryGetProperty("awardLabel", out var le) ? le.GetProperty("value").GetString() : null;
                var yearStr = b.TryGetProperty("year", out var ye) ? ye.GetProperty("value").GetString() : null;
                var workTitle = b.TryGetProperty("workLabel", out var wl) ? wl.GetProperty("value").GetString() : null;
                var movieIdStr = b.TryGetProperty("workMovieId", out var mi) ? mi.GetProperty("value").GetString() : null;
                var tvIdStr = b.TryGetProperty("workTvId", out var ti) ? ti.GetProperty("value").GetString() : null;

                if (string.IsNullOrWhiteSpace(label)) continue;

                int? year = null;
                if (!string.IsNullOrWhiteSpace(yearStr) &&
                    DateTime.TryParse(yearStr, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt))
                    year = dt.Year;

                int? movieId = int.TryParse(movieIdStr, out var m) ? m : null;
                int? tvId    = int.TryParse(tvIdStr,    out var t) ? t : null;

                results.Add(new PersonAwardEntry(label.Trim(), type == "won", year, workTitle, movieId, tvId));
            }

            return results;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Wikidata person awards fetch failed for TMDB person {Id}", tmdbPersonId);
            return Array.Empty<PersonAwardEntry>();
        }
    }

    // ── Helpers to group raw Wikidata award labels into ceremony + category ──

    private static readonly (string prefix, string ceremonyId, string ceremonyName)[] CeremonyPatterns =
    [
        ("Academy Award",           "academy-awards",   "Academy Awards"),
        ("BAFTA",                   "bafta",            "BAFTA"),
        ("Golden Globe",            "golden-globes",    "Golden Globes"),
        ("Primetime Emmy",          "emmys",            "Primetime Emmy"),
        ("Emmy Award",              "emmys",            "Emmy Awards"),
        ("Screen Actors Guild",     "sag",              "SAG Awards"),
        ("Critics' Choice",         "critics-choice",   "Critics' Choice"),
        ("Directors Guild",         "dga",              "Directors Guild"),
        ("Writers Guild",           "wga",              "Writers Guild"),
        ("Producers Guild",         "pga",              "Producers Guild"),
        ("César Award",             "cesar",            "César Awards"),
        ("Saturn Award",            "saturn",           "Saturn Awards"),
        ("MTV Movie",               "mtv",              "MTV Awards"),
    ];

    public static (string ceremonyId, string ceremonyName, string categoryName) ParseAwardLabel(string label)
    {
        foreach (var (prefix, id, name) in CeremonyPatterns)
        {
            if (!label.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;

            // Strip prefix and common connectors to get the category portion
            var rest = label[prefix.Length..].TrimStart();
            foreach (var connector in new[] { "Award for ", "Award - ", "for ", "- " })
            {
                if (rest.StartsWith(connector, StringComparison.OrdinalIgnoreCase))
                {
                    rest = rest[connector.Length..].TrimStart();
                    break;
                }
            }

            var category = string.IsNullOrWhiteSpace(rest) ? name : rest;
            return (id, name, category);
        }

        // Unknown ceremony — use the full label
        return ("other", "Other Awards", label);
    }
}
