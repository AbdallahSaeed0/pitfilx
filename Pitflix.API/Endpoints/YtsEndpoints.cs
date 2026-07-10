using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Pitflix.API.Services;

namespace Pitflix.API.Endpoints;

public static class YtsEndpoints
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(30);

    public static void MapYtsEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        // YTS is movies-only — lookup by IMDb id, with title+year fallback via list_movies.
        app.MapGet("/api/yts/movie/{tmdbId:int}", async (
            int tmdbId, string? imdbId, string? title, int? year, YtsScraperService yts, IMemoryCache cache, CancellationToken ct) =>
        {
            var cacheKey = $"yts:movie:{tmdbId}";
            if (cache.TryGetValue(cacheKey, out IReadOnlyList<YtsTorrent>? cached))
                return Results.Json(new { items = cached!.Select(YtsTorrentJson).ToList() }, jsonSerializerOptions);

            var t = title?.Trim() ?? "";
            var items = string.IsNullOrEmpty(t) || year is not > 0
                ? Array.Empty<YtsTorrent>()
                : await yts.ScrapeAsync(imdbId, t, year.Value, ct).ConfigureAwait(false);

            cache.Set(cacheKey, items, CacheTtl);
            return Results.Json(new { items = items.Select(YtsTorrentJson).ToList() }, jsonSerializerOptions);
        });
    }

    private static object YtsTorrentJson(YtsTorrent t) => new
    {
        title = t.Title,
        size = t.Size,
        quality = t.Quality,
        format = t.Format,
        badges = t.Badges,
        magnetLink = t.MagnetLink,
        torrentFileUrl = t.TorrentFileUrl,
    };
}
