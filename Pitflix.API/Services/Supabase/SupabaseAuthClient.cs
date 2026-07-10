using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Pitflix.Core.Config;

namespace Pitflix.API.Services.Supabase;

public sealed record SupabaseAuthSession(string AccessToken, string RefreshToken, string UserId, string Email);

/// <summary>Minimal GoTrue (Supabase Auth) client — signs the desktop app in as a specific
/// per-user account so it can write into that account's RLS-scoped tables (`watch_records`,
/// `user_lists`, etc.) directly, without the mobile app ever needing to be reachable over LAN.
/// Separate from <see cref="SupabaseRestClient"/>, which uses the service-role key and has no
/// per-user identity.</summary>
public sealed class SupabaseAuthClient
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<SupabaseAuthClient> _log;

    public SupabaseAuthClient(IHttpClientFactory httpClientFactory, ILogger<SupabaseAuthClient> log)
    {
        _httpClientFactory = httpClientFactory;
        _log = log;
    }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(AppSettings.ResolvedSupabaseUrl) &&
        !string.IsNullOrWhiteSpace(AppSettings.ResolvedSupabaseAnonKey);

    public Task<SupabaseAuthSession?> SignInWithPasswordAsync(string email, string password, CancellationToken ct) =>
        RequestTokenAsync(new { email, password }, "password", ct);

    public Task<SupabaseAuthSession?> RefreshAsync(string refreshToken, CancellationToken ct) =>
        RequestTokenAsync(new { refresh_token = refreshToken }, "refresh_token", ct);

    private async Task<SupabaseAuthSession?> RequestTokenAsync(object body, string grantType, CancellationToken ct)
    {
        if (!IsConfigured)
            return null;

        var url = $"{AppSettings.ResolvedSupabaseUrl}/auth/v1/token?grant_type={grantType}";
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        req.Headers.Add("apikey", AppSettings.ResolvedSupabaseAnonKey);
        req.Content = JsonContent.Create(body);

        try
        {
            var http = _httpClientFactory.CreateClient();
            using var res = await http.SendAsync(req, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
            {
                _log.LogWarning("Mobile account {Grant} failed: {Status}", grantType, res.StatusCode);
                return null;
            }

            var json = await res.Content.ReadFromJsonAsync<GoTrueTokenResponse>(cancellationToken: ct)
                .ConfigureAwait(false);
            if (json?.AccessToken is null || json.RefreshToken is null || json.User?.Id is null)
                return null;

            return new SupabaseAuthSession(json.AccessToken, json.RefreshToken, json.User.Id, json.User.Email ?? "");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "Mobile account {Grant} threw", grantType);
            return null;
        }
    }

    private sealed class GoTrueTokenResponse
    {
        [JsonPropertyName("access_token")] public string? AccessToken { get; set; }
        [JsonPropertyName("refresh_token")] public string? RefreshToken { get; set; }
        [JsonPropertyName("user")] public GoTrueUser? User { get; set; }
    }

    private sealed class GoTrueUser
    {
        [JsonPropertyName("id")] public string? Id { get; set; }
        [JsonPropertyName("email")] public string? Email { get; set; }
    }
}
