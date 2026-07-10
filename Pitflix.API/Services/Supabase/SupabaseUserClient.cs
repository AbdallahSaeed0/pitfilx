using System.Net.Http.Json;
using System.Text.Json;
using Pitflix.Core.Config;

namespace Pitflix.API.Services.Supabase;

/// <summary>PostgREST calls made as a specific authenticated user (RLS-scoped via
/// `Authorization: Bearer {accessToken}`, not the service-role key) — used to write into
/// the mobile app's per-account schema (`user_lists`, `watch_records`, `episode_watch_status`;
/// see 003_pitflix_user_library_schema.sql) as that account, from MobileAccountSyncService.</summary>
public sealed class SupabaseUserClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<SupabaseUserClient> _log;

    public SupabaseUserClient(IHttpClientFactory httpClientFactory, ILogger<SupabaseUserClient> log)
    {
        _httpClientFactory = httpClientFactory;
        _log = log;
    }

    public async Task<List<T>?> GetAsync<T>(string accessToken, string table, string query, CancellationToken ct)
    {
        var url = $"{AppSettings.ResolvedSupabaseUrl}/rest/v1/{table}?{query}";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        ApplyHeaders(req, accessToken);

        try
        {
            var http = _httpClientFactory.CreateClient();
            using var res = await http.SendAsync(req, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
            {
                _log.LogWarning("Mobile sync GET {Table} failed: {Status}", table, res.StatusCode);
                return null;
            }
            return await res.Content.ReadFromJsonAsync<List<T>>(JsonOptions, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "Mobile sync GET {Table} threw", table);
            return null;
        }
    }

    /// <summary>POSTs a row and returns it (via `Prefer: return=representation`) — used for
    /// one-off inserts like creating a new custom list where the new id is needed.</summary>
    public async Task<T?> InsertAsync<T>(string accessToken, string table, object payload, CancellationToken ct)
    {
        var url = $"{AppSettings.ResolvedSupabaseUrl}/rest/v1/{table}";
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        ApplyHeaders(req, accessToken);
        req.Headers.Add("Prefer", "return=representation");
        req.Content = JsonContent.Create(payload, options: JsonOptions);

        try
        {
            var http = _httpClientFactory.CreateClient();
            using var res = await http.SendAsync(req, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                _log.LogWarning("Mobile sync INSERT {Table} failed: {Status} {Body}", table, res.StatusCode, body);
                return default;
            }
            var rows = await res.Content.ReadFromJsonAsync<List<T>>(JsonOptions, ct).ConfigureAwait(false);
            return rows is { Count: > 0 } ? rows[0] : default;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "Mobile sync INSERT {Table} threw", table);
            return default;
        }
    }

    /// <summary>Bulk upsert — mirrors the mobile app's own `.upsert(rows, onConflict: ...)` calls
    /// (see PitflixAndroid's UserLibraryService), same conflict-target columns.</summary>
    public async Task<bool> UpsertAsync(
        string accessToken, string table, string onConflict, IReadOnlyList<object> rows, CancellationToken ct)
    {
        if (rows.Count == 0)
            return true;

        var url = $"{AppSettings.ResolvedSupabaseUrl}/rest/v1/{table}?on_conflict={Uri.EscapeDataString(onConflict)}";
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        ApplyHeaders(req, accessToken);
        req.Headers.Add("Prefer", "resolution=merge-duplicates,return=minimal");
        req.Content = JsonContent.Create(rows, options: JsonOptions);

        try
        {
            var http = _httpClientFactory.CreateClient();
            using var res = await http.SendAsync(req, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                _log.LogWarning("Mobile sync UPSERT {Table} failed: {Status} {Body}", table, res.StatusCode, body);
                return false;
            }
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "Mobile sync UPSERT {Table} threw", table);
            return false;
        }
    }

    private static void ApplyHeaders(HttpRequestMessage req, string accessToken)
    {
        req.Headers.Add("apikey", AppSettings.ResolvedSupabaseAnonKey);
        req.Headers.Add("Authorization", $"Bearer {accessToken}");
        req.Headers.Add("Accept", "application/json");
    }
}
