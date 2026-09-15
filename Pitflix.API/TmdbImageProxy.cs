using System.Net;
using System.Text.RegularExpressions;
using Pitflix.API.Services;
using Pitflix.Core.Services;

namespace Pitflix.API;

/// <summary>
/// Serves <c>image.tmdb.org</c> artwork for titles with no locally-cached file yet (search hits,
/// streaming-only rows, freshly-enriched cards).
///
/// Responses are cached to <c>%LocalAppData%\Pitflix\Images\tmdb\{size}\{file}</c>. Without that, every
/// poster the local library hasn't scanned was a fresh round-trip to TMDB — measured at 90-260 ms each —
/// repeated whenever the WebView's HTTP cache turned over, and each one buffered a full image into a
/// byte[] on the request thread while doing so.
/// </summary>
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

        // Both patterns are anchored and reject separators and "..", so neither segment can escape the root.
        var cacheDir = Path.Combine(ImageCacheService.CacheRoot, "tmdb", size!.ToLowerInvariant());
        var cachePath = Path.Combine(cacheDir, file);
        var thumbWidth = ImageThumbnailService.NormalizeWidth(httpContext.Request.Query["w"]);

        if (File.Exists(cachePath))
            return await ServeFileAsync(cachePath, thumbWidth, httpContext, ct).ConfigureAwait(false);

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

            // Persist for next time, then serve off disk so the downscale path applies here too. A failed
            // write only costs a re-fetch next request — never fail a response we already have in hand.
            if (await TryWriteCacheAsync(cacheDir, cachePath, bytes, ct).ConfigureAwait(false))
                return await ServeFileAsync(cachePath, thumbWidth, httpContext, ct).ConfigureAwait(false);

            httpContext.Response.Headers["Cache-Control"] = "public,max-age=604800,immutable";
            return Results.Bytes(bytes, ctMedia);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "TMDB image proxy failed for {Upstream}", upstream);
            return Results.StatusCode(502);
        }
    }

    private static async Task<bool> TryWriteCacheAsync(string dir, string path, byte[] bytes, CancellationToken ct)
    {
        try
        {
            Directory.CreateDirectory(dir);
            // Temp-then-move so a concurrent reader never observes a half-written file.
            var temp = $"{path}.{Environment.CurrentManagedThreadId}.tmp";
            await File.WriteAllBytesAsync(temp, bytes, ct).ConfigureAwait(false);
            File.Move(temp, path, overwrite: true);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static async Task<IResult> ServeFileAsync(string path, int? thumbWidth, HttpContext httpContext,
        CancellationToken ct)
    {
        var servePath = path;
        if (thumbWidth is { } width)
        {
            servePath = await ImageThumbnailService
                .GetOrCreateAsync(path, width, ImageCacheService.CacheRoot, ct)
                .ConfigureAwait(false);
        }

        httpContext.Response.Headers["Cache-Control"] = "public,max-age=604800,immutable";
        return Results.File(servePath, ImageServeHelpers.ImageContentTypeForExtension(servePath));
    }
}
