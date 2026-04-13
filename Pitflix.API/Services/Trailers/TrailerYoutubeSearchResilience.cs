using System.Text.Json;

namespace Pitflix.API.Services.Trailers;

/// <summary>
/// Retries, backoff, and safe parsing for YouTube Data API + Invidious search calls so one slow instance or 429 does not kill trailer discovery.
/// </summary>
internal static class TrailerYoutubeSearchResilience
{
    public const string DefaultUserAgent = "Pitflix/1.0 (trailer discovery)";

    public static bool IsTransientStatusCode(int statusCode) =>
        statusCode == 429 || statusCode == 408 || (statusCode >= 500 && statusCode <= 599);

    public static async Task<HttpResponseMessage?> TrySendGetWithRetriesAsync(
        HttpClient http,
        string url,
        string userAgent,
        int maxAttempts,
        TimeSpan perAttemptTimeout,
        CancellationToken ct)
    {
        maxAttempts = Math.Clamp(maxAttempts, 1, 8);
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
                linked.CancelAfter(perAttemptTimeout);
                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.TryAddWithoutValidation("User-Agent", userAgent);
                var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, linked.Token)
                    .ConfigureAwait(false);
                var code = (int)resp.StatusCode;
                if (IsTransientStatusCode(code) && attempt < maxAttempts)
                {
                    resp.Dispose();
                    await BackoffDelayAsync(attempt, ct).ConfigureAwait(false);
                    continue;
                }

                return resp;
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                if (attempt >= maxAttempts)
                    return null;
                await BackoffDelayAsync(attempt, ct).ConfigureAwait(false);
            }
            catch (HttpRequestException)
            {
                if (attempt >= maxAttempts)
                    return null;
                await BackoffDelayAsync(attempt, ct).ConfigureAwait(false);
            }
        }

        return null;
    }

    public static bool TryParseJsonDocument(string json, out JsonDocument? doc)
    {
        doc = null;
        if (string.IsNullOrWhiteSpace(json))
            return false;
        try
        {
            doc = JsonDocument.Parse(json);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    /// <summary>Detects YouTube Data API v3 quota / daily limit so we can stop issuing further search calls in the same request.</summary>
    public static bool LooksLikeYoutubeQuotaExceeded(string json)
    {
        if (!TryParseJsonDocument(json, out var doc) || doc is null)
            return false;
        using (doc)
        {
            if (!doc.RootElement.TryGetProperty("error", out var err))
                return false;
            if (err.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Array)
            {
                foreach (var e in errors.EnumerateArray())
                {
                    if (e.TryGetProperty("reason", out var r))
                    {
                        var reason = r.GetString();
                        if (reason is "quotaExceeded" or "dailyLimitExceeded")
                            return true;
                    }
                }
            }

            if (err.TryGetProperty("code", out var code) && code.ValueKind == JsonValueKind.Number &&
                code.TryGetInt32(out var c) && c == 403)
            {
                var msg = err.TryGetProperty("message", out var m) ? m.GetString() ?? "" : "";
                if (msg.Contains("quota", StringComparison.OrdinalIgnoreCase))
                    return true;
            }
        }

        return false;
    }

    private static Task BackoffDelayAsync(int attempt, CancellationToken ct)
    {
        var ms = 180 * attempt + Random.Shared.Next(40, 220);
        return Task.Delay(ms, ct);
    }
}
