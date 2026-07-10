using System.Net;
using System.Text.RegularExpressions;

namespace Pitflix.API;

internal static class TmdbImageProxy
{
    public static async Task<IResult> ProxyAsync(
        string? size,
        string? file,
        HttpContext httpContext,
        IHttpClientFactory httpFactory,
        ILogger logger,
        CancellationToken ct)
    {
        size = size?.Trim();
        file = file?.Trim().TrimStart('/') ?? "";
        if (!Regex.IsMatch(size ?? "", @"^(?i)(original|[wh]\d+)$") ||
            string.IsNullOrEmpty(file) ||
            !Regex.IsMatch(file, @"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,240}$"))
            return Results.BadRequest();

        var upstream = $"https://image.tmdb.org/t/p/{size}/{file}";
        var client = httpFactory.CreateClient();
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, upstream);
            req.Headers.TryAddWithoutValidation("User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
            req.Headers.TryAddWithoutValidation("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
            using var resp = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
            if (resp.StatusCode == HttpStatusCode.NotFound)
                return Results.NotFound();
            if (!resp.IsSuccessStatusCode)
                return Results.StatusCode((int)resp.StatusCode);
            var bytes = await resp.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
            var ctMedia = resp.Content.Headers.ContentType?.MediaType ?? "image/jpeg";
            httpContext.Response.Headers["Cache-Control"] = "public,max-age=604800,immutable";
            return Results.Bytes(bytes, ctMedia);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "TMDB image proxy failed for {Upstream}", upstream);
            return Results.StatusCode(502);
        }
    }
}
