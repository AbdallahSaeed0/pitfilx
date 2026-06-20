using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.API.Services;

public sealed record TvdbArtwork(string Url, string Thumbnail, int Type, double Score, int Width, int Height);

public sealed record TvdbPerson(string PersonName, string CharacterName, string ImageUrl, string Role);

public sealed class TvdbService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<TvdbService> _logger;
    private readonly HttpClient _http;

    // Token cache (valid for ~30 days)
    private string? _cachedToken;
    private DateTime _tokenExpiresAt = DateTime.MinValue;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);

    private static readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);

    public TvdbService(IServiceScopeFactory scopeFactory, ILogger<TvdbService> logger,
        IHttpClientFactory httpClientFactory)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _http = httpClientFactory.CreateClient("Tvdb");
        _http.Timeout = TimeSpan.FromSeconds(20);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<TvdbArtwork>?> GetArtworksAsync(int tmdbId, string mediaType,
        CancellationToken ct)
    {
        var key = await GetApiKeyAsync(ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(key)) return null;

        var tvdbId = await GetTvdbIdAsync(tmdbId, mediaType, key, ct).ConfigureAwait(false);
        if (tvdbId is null) return null;

        var token = await GetOrRefreshTokenAsync(key, ct).ConfigureAwait(false);
        if (token is null) return null;

        try
        {
            var segment = mediaType.Equals("movie", StringComparison.OrdinalIgnoreCase) ? "movies" : "series";
            string url;
            if (segment == "movies")
                url = $"https://api4.thetvdb.com/v4/movies/{tvdbId}/extended";
            else
                url = $"https://api4.thetvdb.com/v4/series/{tvdbId}/artworks";

            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);

            if (resp.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                _cachedToken = null;
                return null;
            }
            if (!resp.IsSuccessStatusCode) return null;

            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            return ParseArtworks(body, segment == "movies");
        }
        catch (Exception ex)
        {
            _logger.LogWarning("TVDB artwork fetch failed for tmdbId={TmdbId}: {Msg}", tmdbId, ex.Message);
            return null;
        }
    }

    public async Task<IReadOnlyList<TvdbPerson>?> GetPeopleAsync(int tmdbId, string mediaType,
        CancellationToken ct)
    {
        var key = await GetApiKeyAsync(ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(key)) return null;

        var tvdbId = await GetTvdbIdAsync(tmdbId, mediaType, key, ct).ConfigureAwait(false);
        if (tvdbId is null) return null;

        var token = await GetOrRefreshTokenAsync(key, ct).ConfigureAwait(false);
        if (token is null) return null;

        try
        {
            var segment = mediaType.Equals("movie", StringComparison.OrdinalIgnoreCase) ? "movies" : "series";
            var url = $"https://api4.thetvdb.com/v4/{segment}/{tvdbId}/extended";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);

            if (resp.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                _cachedToken = null;
                return null;
            }
            if (!resp.IsSuccessStatusCode) return null;

            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            return ParsePeople(body);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("TVDB people fetch failed for tmdbId={TmdbId}: {Msg}", tmdbId, ex.Message);
            return null;
        }
    }

    // ── Token management ──────────────────────────────────────────────────────

    private async Task<string?> GetOrRefreshTokenAsync(string apiKey, CancellationToken ct)
    {
        if (_cachedToken is not null && DateTime.UtcNow < _tokenExpiresAt)
            return _cachedToken;

        await _tokenLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (_cachedToken is not null && DateTime.UtcNow < _tokenExpiresAt)
                return _cachedToken;

            using var req = new HttpRequestMessage(HttpMethod.Post, "https://api4.thetvdb.com/v4/login");
            req.Content = JsonContent.Create(new { apikey = apiKey });
            using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("TVDB login returned {Status}", resp.StatusCode);
                return null;
            }

            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("data", out var data) ||
                !data.TryGetProperty("token", out var tokenEl))
                return null;

            _cachedToken = tokenEl.GetString();
            _tokenExpiresAt = DateTime.UtcNow.AddDays(28); // refresh a few days early
            return _cachedToken;
        }
        catch (Exception ex)
        {
            _logger.LogWarning("TVDB token refresh failed: {Msg}", ex.Message);
            return null;
        }
        finally
        {
            _tokenLock.Release();
        }
    }

    // ── TVDB ID resolution ────────────────────────────────────────────────────

    private async Task<int?> GetTvdbIdAsync(int tmdbId, string mediaType, string apiKey, CancellationToken ct)
    {
        var cached = await ReadTvdbIdCacheAsync(tmdbId, mediaType, ct).ConfigureAwait(false);
        if (cached.HasValue) return cached == -1 ? null : cached;

        try
        {
            var segment = mediaType.Equals("movie", StringComparison.OrdinalIgnoreCase) ? "movie" : "tv";
            var tmdbApiKey = await GetTmdbKeyAsync(ct).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(tmdbApiKey)) return null;

            var url = $"https://api.themoviedb.org/3/{segment}/{tmdbId}/external_ids?api_key={Uri.EscapeDataString(tmdbApiKey)}";
            using var resp = await _http.GetAsync(url, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                await WriteTvdbIdCacheAsync(tmdbId, mediaType, -1, ct).ConfigureAwait(false);
                return null;
            }

            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(body);
            int? tvdbId = null;
            if (doc.RootElement.TryGetProperty("tvdb_id", out var tvdbEl) &&
                tvdbEl.ValueKind == JsonValueKind.Number)
                tvdbId = tvdbEl.GetInt32();

            await WriteTvdbIdCacheAsync(tmdbId, mediaType, tvdbId ?? -1, ct).ConfigureAwait(false);
            return tvdbId;
        }
        catch (Exception ex)
        {
            _logger.LogWarning("TVDB ID lookup failed for tmdbId={TmdbId}: {Msg}", tmdbId, ex.Message);
            return null;
        }
    }

    // ── Parsing helpers ───────────────────────────────────────────────────────

    private static IReadOnlyList<TvdbArtwork>? ParseArtworks(string json, bool fromExtended)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            JsonElement artworksEl;

            if (fromExtended)
            {
                if (!root.TryGetProperty("data", out var data) ||
                    !data.TryGetProperty("artworks", out artworksEl))
                    return null;
            }
            else
            {
                if (!root.TryGetProperty("data", out artworksEl)) return null;
            }

            var useful = new HashSet<int> { 2, 3, 11 }; // poster, background, clearlogo
            var list = new List<TvdbArtwork>();
            foreach (var item in artworksEl.EnumerateArray())
            {
                var type = item.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.Number
                    ? t.GetInt32() : 0;
                if (!useful.Contains(type)) continue;

                var url  = item.TryGetProperty("image",     out var u) ? u.GetString() ?? "" : "";
                var thumb = item.TryGetProperty("thumbnail", out var th) ? th.GetString() ?? url : url;
                var score = item.TryGetProperty("score",    out var s) && s.ValueKind == JsonValueKind.Number
                    ? s.GetDouble() : 0;
                var w = item.TryGetProperty("width",  out var ww) && ww.ValueKind == JsonValueKind.Number
                    ? ww.GetInt32() : 0;
                var h = item.TryGetProperty("height", out var hh) && hh.ValueKind == JsonValueKind.Number
                    ? hh.GetInt32() : 0;

                if (!string.IsNullOrWhiteSpace(url))
                    list.Add(new TvdbArtwork(url, thumb, type, score, w, h));
            }
            return list;
        }
        catch { return null; }
    }

    private static IReadOnlyList<TvdbPerson>? ParsePeople(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("data", out var data) ||
                !data.TryGetProperty("characters", out var chars))
                return null;

            var list = new List<TvdbPerson>();
            foreach (var c in chars.EnumerateArray())
            {
                var imgUrl = c.TryGetProperty("personImgURL", out var img) ? img.GetString() : null;
                if (string.IsNullOrWhiteSpace(imgUrl)) continue; // skip entries with no photo

                var charName   = c.TryGetProperty("name",       out var cn) ? cn.GetString()  ?? "" : "";
                var personName = c.TryGetProperty("personName", out var pn) ? pn.GetString()  ?? "" : "";
                var type       = c.TryGetProperty("type",       out var tp) && tp.ValueKind == JsonValueKind.Number
                    ? tp.GetInt32() : 0;
                var role = type switch { 1 => "Director", 2 => "Writer", _ => "Actor" };

                list.Add(new TvdbPerson(personName, charName, imgUrl, role));
            }
            return list;
        }
        catch { return null; }
    }

    // ── Cache I/O ─────────────────────────────────────────────────────────────

    private static async Task<int?> ReadTvdbIdCacheAsync(int tmdbId, string mediaType, CancellationToken ct)
    {
        try
        {
            using var db = LibraryContext.Create();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT TvdbId, FetchedAtUtc FROM TvdbIdCache WHERE TmdbId = @tmdb AND MediaType = @mt LIMIT 1";
            void Add(string n, object v) { var p = cmd.CreateParameter(); p.ParameterName = n; p.Value = v; cmd.Parameters.Add(p); }
            Add("@tmdb", tmdbId);
            Add("@mt", mediaType);
            using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            if (!await r.ReadAsync(ct).ConfigureAwait(false)) return null;
            var tvdbId = r.IsDBNull(0) ? -1 : r.GetInt32(0);
            var fetchedStr = r.IsDBNull(1) ? null : r.GetString(1);
            // Cache TTL: 30 days for TVDB IDs (they rarely change)
            if (fetchedStr is not null &&
                DateTime.TryParse(fetchedStr, out var fetched) &&
                DateTime.UtcNow - fetched > TimeSpan.FromDays(30))
                return null;
            return tvdbId;
        }
        catch { return null; }
    }

    private static async Task WriteTvdbIdCacheAsync(int tmdbId, string mediaType, int tvdbId, CancellationToken ct)
    {
        try
        {
            using var db = LibraryContext.Create();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO TvdbIdCache (TmdbId, MediaType, TvdbId, FetchedAtUtc)
                VALUES (@tmdb, @mt, @tvdb, @fetched)
                ON CONFLICT(TmdbId, MediaType) DO UPDATE SET
                    TvdbId = excluded.TvdbId,
                    FetchedAtUtc = excluded.FetchedAtUtc;
                """;
            void Add(string n, object? v) { var p = cmd.CreateParameter(); p.ParameterName = n; p.Value = v ?? DBNull.Value; cmd.Parameters.Add(p); }
            Add("@tmdb",    tmdbId);
            Add("@mt",      mediaType);
            Add("@tvdb",    tvdbId == -1 ? DBNull.Value : (object)tvdbId);
            Add("@fetched", DateTime.UtcNow.ToString("O"));
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
        catch { }
    }

    private async Task<string?> GetApiKeyAsync(CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        return await repo.GetSettingAsync("TvdbApiKey", ct).ConfigureAwait(false);
    }

    private async Task<string?> GetTmdbKeyAsync(CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        return await repo.GetSettingAsync("TmdbApiKey", ct).ConfigureAwait(false);
    }
}
