using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Pitflix.API.Services;
using Pitflix.Core.Database;
using Pitflix.Core.Models;
using Pitflix.Core.Services;

namespace Pitflix.API.Endpoints;

public static class MiscEndpoints
{
    public static void MapMiscEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions, string imagesPath)
    {
        app.MapGet("/api/images/{tmdbId:int}/posters", async (int tmdbId, string mediaType, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(Array.Empty<TmdbImage>());
            var mt = string.IsNullOrWhiteSpace(mediaType) ? "Movie" : mediaType;
            var images = await tmdb.GetImagesAsync(tmdbId, mt, ct).ConfigureAwait(false);
            return Results.Json(images.Posters);
        });

        app.MapGet("/api/images/{tmdbId:int}/backdrops", async (int tmdbId, string mediaType, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(Array.Empty<TmdbImage>());
            var mt = string.IsNullOrWhiteSpace(mediaType) ? "Movie" : mediaType;
            var images = await tmdb.GetImagesAsync(tmdbId, mt, ct).ConfigureAwait(false);
            return Results.Json(images.Backdrops);
        });

        app.MapPost("/api/images/{id:int}/select", async (int id, ImageSelectBody body, LibraryRepository repo,
            ITmdbClientFactory tmdbClientFactory, IHttpClientFactory httpFactory, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.BadRequest(new { success = false });

            var mt = body.MediaType ?? "Movie";
            if (!string.IsNullOrWhiteSpace(body.PosterUrl))
            {
                var local = await ImageServeHelpers
                    .DownloadRemoteImageAsync(httpFactory.CreateClient(), body.PosterUrl.Trim(),
                        $"poster_tvdb_{body.TmdbId}{ImageServeHelpers.ExtensionForUrl(body.PosterUrl)}", ct)
                    .ConfigureAwait(false);
                if (local is null)
                    return Results.BadRequest(new { success = false, error = "Failed to download poster." });
                await repo.UpdatePosterAsync(id, mt, local, ct).ConfigureAwait(false);
            }
            else if (!string.IsNullOrWhiteSpace(body.PosterPath))
            {
                var local = await tmdb.DownloadImageAsync(body.PosterPath, $"poster_pick_{body.TmdbId}.jpg", ct)
                    .ConfigureAwait(false);
                await repo.UpdatePosterAsync(id, mt, local, ct).ConfigureAwait(false);
            }

            if (!string.IsNullOrWhiteSpace(body.BackdropUrl))
            {
                var local = await ImageServeHelpers
                    .DownloadRemoteImageAsync(httpFactory.CreateClient(), body.BackdropUrl.Trim(),
                        $"backdrop_tvdb_{body.TmdbId}{ImageServeHelpers.ExtensionForUrl(body.BackdropUrl)}", ct)
                    .ConfigureAwait(false);
                if (local is null)
                    return Results.BadRequest(new { success = false, error = "Failed to download backdrop." });
                await repo.UpdateBackdropAsync(id, mt, local, ct).ConfigureAwait(false);
            }
            else if (!string.IsNullOrWhiteSpace(body.BackdropPath))
            {
                var local = await tmdb
                    .DownloadImageAsync(body.BackdropPath, $"backdrop_pick_{body.TmdbId}.jpg", ct, null, "w1280")
                    .ConfigureAwait(false);
                await repo.UpdateBackdropAsync(id, mt, local, ct).ConfigureAwait(false);
            }

            return Results.Json(new { success = true });
        });

        app.MapPost("/api/maintenance/clear-image-cache", () =>
        {
            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Pitflix",
                "Images");
            var deleted = 0;
            try
            {
                if (Directory.Exists(root))
                {
                    foreach (var f in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
                    {
                        try
                        {
                            File.Delete(f);
                            deleted++;
                        }
                        catch
                        {
                            // skip locked files
                        }
                    }
                }
            }
            catch
            {
                return Results.Json(new { success = false, deleted, message = "Could not clear cache." },
                    jsonSerializerOptions);
            }

            return Results.Json(new { success = true, deleted, message = $"Deleted {deleted} cached image files." },
                jsonSerializerOptions);
        });

        app.MapGet("/images/{**relativePath}", (string relativePath, HttpContext ctx) =>
        {
            var decoded = Uri.UnescapeDataString(relativePath ?? "").Replace('/', Path.DirectorySeparatorChar);
            if (string.IsNullOrEmpty(decoded) || decoded.Contains("..", StringComparison.Ordinal))
                return Results.BadRequest();

            var root = Path.GetFullPath(imagesPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            var fullPath = Path.GetFullPath(Path.Combine(root, decoded));
            var rootWithSep = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
            if (!fullPath.Equals(root, StringComparison.OrdinalIgnoreCase) &&
                !fullPath.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest();

            if (!File.Exists(fullPath))
                return Results.NotFound();

            ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
            ctx.Response.Headers["Cache-Control"] = "public,max-age=86400";
            return Results.File(fullPath, contentType: ImageServeHelpers.ImageContentTypeForExtension(fullPath));
        });

        app.MapGet("/api/tvdb/artworks", async (int? tmdbId, string? mediaType, TvdbService tvdb, CancellationToken ct) =>
        {
            if (tmdbId is null or <= 0 || string.IsNullOrWhiteSpace(mediaType))
                return Results.BadRequest();

            var artworks = await tvdb.GetArtworksAsync(tmdbId.Value, mediaType, ct).ConfigureAwait(false);
            if (artworks is null)
                return Results.NotFound(new { error = "TVDB artworks unavailable (check API keys or mapping)." });

            if (artworks.Count == 0)
                return Results.Json(Array.Empty<object>(), jsonSerializerOptions);

            return Results.Json(artworks.Select(a => new
            {
                url       = a.Url,
                thumbnail = a.Thumbnail,
                type      = a.Type,
                score     = a.Score,
                width     = a.Width,
                height    = a.Height,
            }), jsonSerializerOptions);
        });

        app.MapGet("/api/tvdb/people", async (int? tmdbId, string? mediaType, TvdbService tvdb, CancellationToken ct) =>
        {
            if (tmdbId is null or <= 0 || string.IsNullOrWhiteSpace(mediaType))
                return Results.BadRequest();

            var people = await tvdb.GetPeopleAsync(tmdbId.Value, mediaType, ct).ConfigureAwait(false);
            if (people is null)
                return Results.NotFound();

            return Results.Json(people.Select(p => new
            {
                personName    = p.PersonName,
                characterName = p.CharacterName,
                imageUrl      = p.ImageUrl,
                role          = p.Role,
            }), jsonSerializerOptions);
        });

        app.MapPost("/api/recommendations/from", async (RecommendationFromBody? body, HttpContext httpContext, IMemoryCache memoryCache, ITmdbClientFactory tmdbClientFactory, ILogger<Program> logger, CancellationToken ct) =>
        {
            if (body == null || body.TmdbId <= 0)
            {
                return Results.Json(
                    new { error = "Invalid body: tmdbId (TMDB id) and mediaType (movie or tv) are required.", items = Array.Empty<object>() },
                    jsonSerializerOptions,
                    statusCode: 400);
            }

            var filter = string.IsNullOrWhiteSpace(body.Filter) ? "both" : body.Filter!;
            var mt = string.IsNullOrWhiteSpace(body.MediaType) ? "movie" : body.MediaType!;
            var isMovie = mt.Equals("movie", StringComparison.OrdinalIgnoreCase);

            var cacheKey = $"recommendations:from:{body.TmdbId}:{(isMovie ? "movie" : "tv")}:{filter.ToLowerInvariant()}";
            if (memoryCache.TryGetValue(cacheKey, out string? cachedJson))
            {
                httpContext.Response.Headers["Cache-Control"] = "public,max-age=21600";
                return Results.Text(cachedJson!, "application/json");
            }

            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(new { error = "TMDB API key not configured.", items = Array.Empty<object>() }, jsonSerializerOptions, statusCode: 400);

            try
            {
                var list = await ContentRecommendationBuilder
                    .BuildAsync(tmdb, body.TmdbId, isMovie ? "Movie" : "Series", filter, ct)
                    .ConfigureAwait(false);
                var payload = JsonSerializer.Serialize(new { items = list, error = (string?)null }, jsonSerializerOptions);
                memoryCache.Set(cacheKey, payload, TimeSpan.FromHours(6));
                httpContext.Response.Headers["Cache-Control"] = "public,max-age=21600";
                return Results.Text(payload, "application/json");
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "TMDB recommendations build failed for TMDB {TmdbId} ({MediaType}, filter={Filter})", body.TmdbId, mt, filter);
                return Results.Json(
                    new { error = "Could not build recommendations from TMDB.", detail = ex.Message, items = Array.Empty<object>() },
                    jsonSerializerOptions,
                    statusCode: 502);
            }
        });

        app.MapGet("/api/img/tmdb", async (string? size, string? file, HttpContext httpContext, IHttpClientFactory httpFactory, ILogger<Program> logger, CancellationToken ct) =>
            await TmdbImageProxy.ProxyAsync(size, file, httpContext, httpFactory, logger, ct).ConfigureAwait(false));

        app.MapGet("/api/img/tmdb/{size}/{*filename}", async (string size, string? filename, HttpContext httpContext, IHttpClientFactory httpFactory, ILogger<Program> logger, CancellationToken ct) =>
            await TmdbImageProxy.ProxyAsync(size, filename, httpContext, httpFactory, logger, ct).ConfigureAwait(false));

        app.MapGet("/api/ping", () => Results.Text("pitflix-api", "text/plain"));
        app.MapGet("/api/debug/images", () => ImageServeHelpers.BuildImageFolderDiagnostics(imagesPath));
        app.MapGet("/api/diagnostics/image-cache", () => ImageServeHelpers.BuildImageFolderDiagnostics(imagesPath));
    }
}
