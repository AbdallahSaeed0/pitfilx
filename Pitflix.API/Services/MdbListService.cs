using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.API.Services;

public sealed record MdbListRatings(
    float? ImdbScore,
    float? RottenTomatoesScore,
    float? RottenTomatoesAudience,
    float? MetacriticScore,
    float? LetterboxdScore,
    float? TraktScore,
    float? RogerEbertScore,
    long? ImdbVotes = null);

public sealed class MdbListService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<MdbListService> _logger;
    private readonly HttpClient _http;
    // Rate-limit: max 1 request per second (free tier = 1 000/day)
    private readonly SemaphoreSlim _rateSemaphore = new(1, 1);
    private DateTime _lastRequestAt = DateTime.MinValue;

    private static readonly TimeSpan CacheTtl = TimeSpan.FromDays(7);
    private static readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);

    public MdbListService(IServiceScopeFactory scopeFactory, ILogger<MdbListService> logger,
        IHttpClientFactory httpClientFactory)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _http = httpClientFactory.CreateClient("MdbList");
        _http.Timeout = TimeSpan.FromSeconds(20);
    }

    public async Task<MdbListRatings?> GetRatingsAsync(string? imdbId, int? tmdbId, CancellationToken ct)
    {
        var key = await GetApiKeyAsync(ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(key))
        {
            _logger.LogWarning("MDBList: no API key configured — save the key in Settings → Additional Sources");
            return null;
        }
        if (string.IsNullOrWhiteSpace(imdbId) && tmdbId is null) return null;

        // Cache hit?
        if (!string.IsNullOrWhiteSpace(imdbId))
        {
            var cached = await ReadCacheAsync(imdbId, ct).ConfigureAwait(false);
            if (cached is not null) return cached;
        }

        await _rateSemaphore.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var elapsed = (DateTime.UtcNow - _lastRequestAt).TotalMilliseconds;
            if (elapsed < 1000)
                await Task.Delay((int)(1000 - elapsed), ct).ConfigureAwait(false);
            _lastRequestAt = DateTime.UtcNow;

            var url = !string.IsNullOrWhiteSpace(imdbId)
                ? $"https://mdblist.com/api/?i={Uri.EscapeDataString(imdbId)}&apikey={Uri.EscapeDataString(key)}"
                : $"https://mdblist.com/api/?tm={tmdbId}&apikey={Uri.EscapeDataString(key!)}";

            using var resp = await _http.GetAsync(url, ct).ConfigureAwait(false);
            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("MDBList API returned {Status}: {Body}", resp.StatusCode, body);
                return null;
            }

            var result = ParseResponse(body);
            if (result is null)
                _logger.LogWarning("MDBList: could not parse ratings from response: {Body}", body[..Math.Min(body.Length, 300)]);
            if (result is not null && !string.IsNullOrWhiteSpace(imdbId))
                await WriteCacheAsync(imdbId, tmdbId, result, ct).ConfigureAwait(false);

            return result;
        }
        catch (Exception ex)
        {
            _logger.LogWarning("MDBList fetch failed: {Msg}", ex.Message);
            return null;
        }
        finally
        {
            _rateSemaphore.Release();
        }
    }

    /// <summary>Fetches the IMDb rating for a specific episode via the MDBList episode endpoint.</summary>
    public async Task<double?> GetEpisodeRatingAsync(string showImdbId, int season, int episode, CancellationToken ct)
    {
        var key = await GetApiKeyAsync(ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(showImdbId)) return null;

        await _rateSemaphore.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var elapsed = (DateTime.UtcNow - _lastRequestAt).TotalMilliseconds;
            if (elapsed < 1000)
                await Task.Delay((int)(1000 - elapsed), ct).ConfigureAwait(false);
            _lastRequestAt = DateTime.UtcNow;

            var url = $"https://mdblist.com/api/?apikey={Uri.EscapeDataString(key)}&i={Uri.EscapeDataString(showImdbId)}&s={season}&e={episode}";
            using var resp = await _http.GetAsync(url, ct).ConfigureAwait(false);
            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return null;

            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (!root.TryGetProperty("ratings", out var ratings)) return null;

            foreach (var item in ratings.EnumerateArray())
            {
                if (!item.TryGetProperty("source", out var src) || src.GetString() != "imdb") continue;
                if (!item.TryGetProperty("value", out var val)) continue;
                if (val.ValueKind == JsonValueKind.Number) return (double)val.GetSingle();
                if (val.ValueKind == JsonValueKind.String &&
                    double.TryParse(val.GetString(), System.Globalization.NumberStyles.Any,
                        System.Globalization.CultureInfo.InvariantCulture, out var parsed))
                    return parsed;
            }
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogDebug("MDBList episode rating failed S{S}E{E}: {Msg}", season, episode, ex.Message);
            return null;
        }
        finally
        {
            _rateSemaphore.Release();
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async Task<string?> GetApiKeyAsync(CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        return await repo.GetSettingAsync("MdblistApiKey", ct).ConfigureAwait(false);
    }

    private static MdbListRatings? ParseResponse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("ratings", out var ratings)) return null;

            float? imdb = null, rt = null, rtAudience = null, mc = null, lb = null, trakt = null, roger = null;
            long? imdbVotes = null;

            foreach (var item in ratings.EnumerateArray())
            {
                if (!item.TryGetProperty("source", out var srcEl) ||
                    !item.TryGetProperty("value", out var valEl)) continue;

                var src = srcEl.GetString();
                float? val = valEl.ValueKind == JsonValueKind.Number
                    ? valEl.GetSingle()
                    : valEl.ValueKind == JsonValueKind.String &&
                      float.TryParse(valEl.GetString(), System.Globalization.NumberStyles.Any,
                          System.Globalization.CultureInfo.InvariantCulture, out var parsed)
                        ? parsed
                        : null;
                if (val is null) continue;

                switch (src)
                {
                    case "imdb":
                        imdb = val;
                        // MDBList also returns votes count for IMDb
                        if (item.TryGetProperty("votes", out var votesEl) && votesEl.ValueKind == JsonValueKind.Number)
                            imdbVotes = votesEl.GetInt64();
                        break;
                    case "tomatoes":       rt        = val; break;
                    case "tomatoesaudience": rtAudience = val; break;
                    case "metacritic":     mc        = val; break;
                    case "letterboxd":     lb        = val; break;
                    case "trakt":          trakt     = val; break;
                    case "rogerebert":     roger     = val; break;
                }
            }

            // Return null if MDBList had no recognizable scores for this title
            if (imdb is null && rt is null && lb is null && mc is null && trakt is null && roger is null && rtAudience is null)
                return null;

            return new MdbListRatings(imdb, rt, rtAudience, mc, lb, trakt, roger, imdbVotes);
        }
        catch
        {
            return null;
        }
    }

    private static async Task<MdbListRatings?> ReadCacheAsync(string imdbId, CancellationToken ct)
    {
        try
        {
            using var db = LibraryContext.Create();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT RatingsJson, FetchedAtUtc FROM MdbListRatingsCache WHERE ImdbId = @id LIMIT 1";
            var p = cmd.CreateParameter();
            p.ParameterName = "@id";
            p.Value = imdbId;
            cmd.Parameters.Add(p);
            using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;

            var ratingsJson = reader.IsDBNull(0) ? null : reader.GetString(0);
            var fetchedStr  = reader.IsDBNull(1) ? null : reader.GetString(1);
            if (string.IsNullOrWhiteSpace(ratingsJson)) return null;
            if (fetchedStr is not null &&
                DateTime.TryParse(fetchedStr, out var fetched) &&
                DateTime.UtcNow - fetched > CacheTtl)
                return null;

            return JsonSerializer.Deserialize<MdbListRatings>(ratingsJson, _json);
        }
        catch
        {
            return null;
        }
    }

    private static async Task WriteCacheAsync(string imdbId, int? tmdbId, MdbListRatings ratings,
        CancellationToken ct)
    {
        try
        {
            var json = JsonSerializer.Serialize(ratings, _json);
            using var db = LibraryContext.Create();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO MdbListRatingsCache (ImdbId, TmdbId, RatingsJson, FetchedAtUtc)
                VALUES (@id, @tmdb, @json, @fetched)
                ON CONFLICT(ImdbId) DO UPDATE SET
                    TmdbId = excluded.TmdbId,
                    RatingsJson = excluded.RatingsJson,
                    FetchedAtUtc = excluded.FetchedAtUtc;
                """;
            void AddParam(string name, object? val)
            {
                var pr = cmd.CreateParameter();
                pr.ParameterName = name;
                pr.Value = val ?? DBNull.Value;
                cmd.Parameters.Add(pr);
            }
            AddParam("@id",      imdbId);
            AddParam("@tmdb",    (object?)tmdbId ?? DBNull.Value);
            AddParam("@json",    json);
            AddParam("@fetched", DateTime.UtcNow.ToString("O"));
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
        catch { /* best-effort cache write */ }
    }
}
