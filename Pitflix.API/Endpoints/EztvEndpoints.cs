using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Pitflix.API.Services;

namespace Pitflix.API.Endpoints;

/// <summary>TV-only source (EZTV has no movie catalog) — see EztvScraperService.</summary>
public static class EztvEndpoints
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan EmptyCacheTtl = TimeSpan.FromMinutes(3);

    public static void MapEztvEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/eztv/episode/{tmdbId:int}/{season:int}/{episode:int}", async (
            int tmdbId, int season, int episode, string? imdbId, EztvScraperService eztv, IMemoryCache cache, CancellationToken ct) =>
        {
            var cacheKey = $"eztv:episode:{tmdbId}-{season}-{episode}:{imdbId}";
            if (cache.TryGetValue(cacheKey, out IReadOnlyList<EztvTorrent>? cached))
                return Results.Json(new { items = cached!.Select(EztvTorrentJson).ToList() }, jsonSerializerOptions);

            var items = string.IsNullOrEmpty(imdbId) || season <= 0 || episode <= 0
                ? Array.Empty<EztvTorrent>()
                : await eztv.ScrapeEpisodeAsync(imdbId, season, episode, ct).ConfigureAwait(false);

            cache.Set(cacheKey, items, items.Count > 0 ? CacheTtl : EmptyCacheTtl);
            return Results.Json(new { items = items.Select(EztvTorrentJson).ToList() }, jsonSerializerOptions);
        });

        app.MapGet("/api/eztv/season/{tmdbId:int}/{season:int}", async (
            int tmdbId, int season, string? imdbId, EztvScraperService eztv, IMemoryCache cache, CancellationToken ct) =>
        {
            var cacheKey = $"eztv:season:{tmdbId}-{season}:{imdbId}";
            if (cache.TryGetValue(cacheKey, out IReadOnlyList<EztvTorrent>? cached))
                return Results.Json(new { items = cached!.Select(EztvTorrentJson).ToList() }, jsonSerializerOptions);

            var items = string.IsNullOrEmpty(imdbId) || season <= 0
                ? Array.Empty<EztvTorrent>()
                : await eztv.ScrapeSeasonAsync(imdbId, season, ct).ConfigureAwait(false);

            cache.Set(cacheKey, items, items.Count > 0 ? CacheTtl : EmptyCacheTtl);
            return Results.Json(new { items = items.Select(EztvTorrentJson).ToList() }, jsonSerializerOptions);
        });
    }

    private static object EztvTorrentJson(EztvTorrent t) => new
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
