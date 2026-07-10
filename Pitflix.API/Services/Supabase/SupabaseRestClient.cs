using System.Net.Http.Json;
using System.Text.Json;
using Pitflix.Core.Config;

namespace Pitflix.API.Services.Supabase;

/// <summary>Thin wrapper over Supabase's PostgREST API. Credentials are read fresh from
/// <see cref="AppSettings"/> on every call so a Settings save takes effect without a restart.</summary>
public sealed class SupabaseRestClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<SupabaseRestClient> _log;

    public SupabaseRestClient(IHttpClientFactory httpClientFactory, ILogger<SupabaseRestClient> log)
    {
        _httpClientFactory = httpClientFactory;
        _log = log;
    }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(AppSettings.ResolvedSupabaseUrl) &&
        !string.IsNullOrWhiteSpace(AppSettings.ResolvedSupabaseServiceRoleKey);

    /// <summary>GET {table}?{query} — query should already be PostgREST-filter-formatted
    /// (e.g. <c>source=neq.desktop&amp;order=created_at.asc&amp;limit=200</c>).</summary>
    public async Task<List<T>?> GetAsync<T>(string table, string query, CancellationToken ct)
    {
        if (!IsConfigured)
            return null;

        var url = $"{AppSettings.ResolvedSupabaseUrl}/rest/v1/{table}?{query}";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        ApplyHeaders(req);

        try
        {
            var http = _httpClientFactory.CreateClient();
            using var res = await http.SendAsync(req, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
            {
                _log.LogWarning("Supabase GET {Table} failed: {Status}", table, res.StatusCode);
                return null;
            }

            return await res.Content.ReadFromJsonAsync<List<T>>(JsonOptions, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "Supabase GET {Table} threw", table);
            return null;
        }
    }

    /// <summary>POST a single row to {table}, returning the inserted row (via
    /// <c>Prefer: return=representation</c>) or null on failure.</summary>
    public async Task<T?> InsertAsync<T>(string table, object payload, CancellationToken ct)
    {
        if (!IsConfigured)
            return default;

        var url = $"{AppSettings.ResolvedSupabaseUrl}/rest/v1/{table}";
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        ApplyHeaders(req);
        req.Headers.Add("Prefer", "return=representation");
        req.Content = JsonContent.Create(payload, options: JsonOptions);

        try
        {
            var http = _httpClientFactory.CreateClient();
            using var res = await http.SendAsync(req, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                _log.LogWarning("Supabase INSERT {Table} failed: {Status} {Body}", table, res.StatusCode, body);
                return default;
            }

            var rows = await res.Content.ReadFromJsonAsync<List<T>>(JsonOptions, ct).ConfigureAwait(false);
            return rows is { Count: > 0 } ? rows[0] : default;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "Supabase INSERT {Table} threw", table);
            return default;
        }
    }

    private static void ApplyHeaders(HttpRequestMessage req)
    {
        var key = AppSettings.ResolvedSupabaseServiceRoleKey!;
        req.Headers.Add("apikey", key);
        req.Headers.Add("Authorization", $"Bearer {key}");
        req.Headers.Add("Accept", "application/json");
    }

    /// <summary>Formats a UTC timestamp for a PostgREST <c>gt.</c>/<c>gte.</c> filter value.</summary>
    public static string FormatTimestampFilterValue(DateTime utc) =>
        Uri.EscapeDataString(DateTime.SpecifyKind(utc, DateTimeKind.Utc).ToString("O"));
}
