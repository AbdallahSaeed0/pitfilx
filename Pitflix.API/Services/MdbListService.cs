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

    /// <param name="maxAge">How old a saved answer may be before asking MDBList again (default
    /// <see cref="CacheTtl"/>). Callers pass less for new releases, whose scores move daily.</param>
    public async Task<MdbListRatings?> GetRatingsAsync(string? imdbId, int? tmdbId, CancellationToken ct,
        TimeSpan? maxAge = null)
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
            var cached = await ReadCacheAsync(imdbId, maxAge ?? CacheTtl, ct).ConfigureAwait(false);
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

    /// <summary>
    /// Cache-only lookup — never makes a live MDBList request, so it never blocks on the 1-req/sec
    /// rate limit. Returns (false, null) when the episode hasn't been fetched yet.
    /// </summary>
    public Task<(bool Hit, double? Value)> TryGetCachedEpisodeRatingAsync(string showImdbId, int season,
        int episode, CancellationToken ct) =>
        ReadEpisodeCacheAsync(showImdbId, season, episode, ct);

    /// <summary>Persists one episode's IMDb rating (from <see cref="OmdbRatingClient"/>, the only
    /// source that actually varies by episode) into the per-episode cache table so subsequent
    /// cache-only lookups resolve instantly. <paramref name="rating"/> may be null — a cached "no
    /// rating" row still avoids re-querying OMDb for an episode it doesn't have.</summary>
    public Task CacheEpisodeRatingAsync(string showImdbId, int season, int episode, double? rating,
        CancellationToken ct) =>
        WriteEpisodeCacheAsync(showImdbId, season, episode, rating, ct);

    /// <summary>Wipes both persisted ratings cache tables (title-level and per-episode). Returns the
    /// total row count removed. Used by the Settings → Maintenance "Clear ratings cache" action, e.g.
    /// to force a refetch after a fix to how episodes are matched/validated.</summary>
    /// <summary>
    /// Episodes of a show that don't need an OMDb call: anything with a rating (however old — refreshing
    /// a known rating isn't worth daily quota) plus "no rating" answers still inside the cache TTL.
    /// One query per show, so the background refill can skip covered shows without a per-episode read.
    /// </summary>
    public static async Task<HashSet<(int Season, int Episode)>> GetCoveredEpisodesAsync(string showImdbId,
        CancellationToken ct)
    {
        var covered = new HashSet<(int, int)>();
        if (string.IsNullOrWhiteSpace(showImdbId)) return covered;
        try
        {
            using var db = LibraryContext.Create();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT Season, Episode, ImdbRating, FetchedAtUtc FROM MdbListEpisodeRatingsCache
                WHERE ShowImdbId = @id
                """;
            var p = cmd.CreateParameter();
            p.ParameterName = "@id";
            p.Value = showImdbId;
            cmd.Parameters.Add(p);
            using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await reader.ReadAsync(ct).ConfigureAwait(false))
            {
                var hasRating = !reader.IsDBNull(2);
                if (!hasRating)
                {
                    var fetchedStr = reader.IsDBNull(3) ? null : reader.GetString(3);
                    var fresh = fetchedStr != null && DateTime.TryParse(fetchedStr, out var fetched) &&
                                DateTime.UtcNow - fetched.ToUniversalTime() <= CacheTtl;
                    if (!fresh) continue;
                }
                covered.Add((reader.GetInt32(0), reader.GetInt32(1)));
            }
        }
        catch
        {
            // unreadable cache — treat as nothing covered; the refill just does more work
        }
        return covered;
    }

    /// <summary>Drops cached per-episode "no rating" rows (keeps real ratings). Called when the OMDb
    /// key is saved: misses recorded under a missing/invalid key would otherwise hide ratings for the
    /// full cache TTL even after the key is fixed.</summary>
    public static async Task<int> ClearEpisodeMissesAsync(CancellationToken ct)
    {
        try
        {
            using var db = LibraryContext.Create();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM MdbListEpisodeRatingsCache WHERE ImdbRating IS NULL;";
            return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
        catch
        {
            return 0;
        }
    }

    public async Task<int> ClearAllCachesAsync(CancellationToken ct)
    {
        try
        {
            using var db = LibraryContext.Create();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);

            async Task<int> DeleteAllAsync(string table)
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = $"DELETE FROM {table};";
                return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            var deleted = await DeleteAllAsync("MdbListRatingsCache").ConfigureAwait(false);
            deleted += await DeleteAllAsync("MdbListEpisodeRatingsCache").ConfigureAwait(false);
            return deleted;
        }
        catch (Exception ex)
        {
            _logger.LogWarning("MDBList: failed to clear ratings cache: {Msg}", ex.Message);
            return 0;
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

    private static async Task<MdbListRatings?> ReadCacheAsync(string imdbId, TimeSpan maxAge, CancellationToken ct)
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
            // Stored as UTC ("…Z"); plain TryParse turned it into local time, skewing ages by the
            // UTC offset.
            if (fetchedStr is not null &&
                DateTime.TryParse(fetchedStr, System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal,
                    out var fetched) &&
                DateTime.UtcNow - fetched > maxAge)
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

    /// <summary>Average cached IMDb score for all episodes in a season (null when no cached rows).</summary>
    public async Task<double?> TryGetCachedSeasonAverageRatingAsync(string showImdbId, int season, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(showImdbId) || season < 0) return null;
        try
        {
            using var db = LibraryContext.Create();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT AVG(ImdbRating) FROM MdbListEpisodeRatingsCache
                WHERE ShowImdbId = @id AND Season = @s AND ImdbRating IS NOT NULL AND ImdbRating > 0
                """;
            void AddParam(string name, object val)
            {
                var p = cmd.CreateParameter();
                p.ParameterName = name;
                p.Value = val;
                cmd.Parameters.Add(p);
            }
            AddParam("@id", showImdbId);
            AddParam("@s", season);
            var scalar = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
            if (scalar is null or DBNull) return null;
            var avg = Convert.ToDouble(scalar);
            return avg > 0 ? avg : null;
        }
        catch
        {
            return null;
        }
    }

    private static async Task<(bool Hit, double? Value)> ReadEpisodeCacheAsync(string showImdbId, int season,
        int episode, CancellationToken ct)
    {
        try
        {
            using var db = LibraryContext.Create();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT ImdbRating, FetchedAtUtc FROM MdbListEpisodeRatingsCache
                WHERE ShowImdbId = @id AND Season = @s AND Episode = @e LIMIT 1
                """;
            void AddParam(string name, object val)
            {
                var p = cmd.CreateParameter();
                p.ParameterName = name;
                p.Value = val;
                cmd.Parameters.Add(p);
            }
            AddParam("@id", showImdbId);
            AddParam("@s", season);
            AddParam("@e", episode);
            using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return (false, null);

            var fetchedStr = reader.IsDBNull(1) ? null : reader.GetString(1);
            if (fetchedStr is not null &&
                DateTime.TryParse(fetchedStr, out var fetched) &&
                DateTime.UtcNow - fetched > CacheTtl)
                return (false, null);

            return (true, reader.IsDBNull(0) ? null : reader.GetDouble(0));
        }
        catch
        {
            return (false, null);
        }
    }

    private static async Task WriteEpisodeCacheAsync(string showImdbId, int season, int episode, double? rating,
        CancellationToken ct)
    {
        try
        {
            using var db = LibraryContext.Create();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO MdbListEpisodeRatingsCache (ShowImdbId, Season, Episode, ImdbRating, FetchedAtUtc)
                VALUES (@id, @s, @e, @rating, @fetched)
                ON CONFLICT(ShowImdbId, Season, Episode) DO UPDATE SET
                    ImdbRating = excluded.ImdbRating,
                    FetchedAtUtc = excluded.FetchedAtUtc;
                """;
            void AddParam(string name, object? val)
            {
                var p = cmd.CreateParameter();
                p.ParameterName = name;
                p.Value = val ?? DBNull.Value;
                cmd.Parameters.Add(p);
            }
            AddParam("@id", showImdbId);
            AddParam("@s", season);
            AddParam("@e", episode);
            AddParam("@rating", (object?)rating ?? DBNull.Value);
            AddParam("@fetched", DateTime.UtcNow.ToString("O"));
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
        catch { /* best-effort cache write */ }
    }
}
