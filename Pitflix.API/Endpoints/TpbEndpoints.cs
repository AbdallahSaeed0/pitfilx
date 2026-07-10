using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Pitflix.API.Services;

namespace Pitflix.API.Endpoints;

public static class TpbEndpoints
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(30);

    public static void MapTpbEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/tpb/movie/{tmdbId:int}", async (
            int tmdbId, string? title, int? year, string? imdbId, TpbScraperService tpb, IMemoryCache cache, CancellationToken ct) =>
        {
            var cacheKey = $"tpb:movie:{tmdbId}";
            if (cache.TryGetValue(cacheKey, out IReadOnlyList<TpbTorrent>? cached))
                return Results.Json(new { items = cached!.Select(TpbTorrentJson).ToList() }, jsonSerializerOptions);

            var t = title?.Trim() ?? "";
            var items = string.IsNullOrEmpty(t) || year is not > 0
                ? Array.Empty<TpbTorrent>()
                : await tpb.ScrapeMovieAsync(t, year.Value, imdbId, ct).ConfigureAwait(false);

            cache.Set(cacheKey, items, CacheTtl);
            return Results.Json(new { items = items.Select(TpbTorrentJson).ToList() }, jsonSerializerOptions);
        });

        app.MapGet("/api/tpb/episode/{tmdbId:int}/{season:int}/{episode:int}", async (
            int tmdbId, int season, int episode, string? title, TpbScraperService tpb, IMemoryCache cache, CancellationToken ct) =>
        {
            var cacheKey = $"tpb:episode:{tmdbId}-{season}-{episode}";
            if (cache.TryGetValue(cacheKey, out IReadOnlyList<TpbTorrent>? cached))
                return Results.Json(new { items = cached!.Select(TpbTorrentJson).ToList() }, jsonSerializerOptions);

            var t = title?.Trim() ?? "";
            var items = string.IsNullOrEmpty(t) || season <= 0 || episode <= 0
                ? Array.Empty<TpbTorrent>()
                : await tpb.ScrapeEpisodeAsync(t, season, episode, ct).ConfigureAwait(false);

            cache.Set(cacheKey, items, CacheTtl);
            return Results.Json(new { items = items.Select(TpbTorrentJson).ToList() }, jsonSerializerOptions);
        });

        app.MapGet("/api/tpb/season/{tmdbId:int}/{season:int}", async (
            int tmdbId, int season, string? title, TpbScraperService tpb, IMemoryCache cache, CancellationToken ct) =>
        {
            var cacheKey = $"tpb:season:{tmdbId}-{season}";
            if (cache.TryGetValue(cacheKey, out IReadOnlyList<TpbTorrent>? cached))
                return Results.Json(new { items = cached!.Select(TpbTorrentJson).ToList() }, jsonSerializerOptions);

            var t = title?.Trim() ?? "";
            var items = string.IsNullOrEmpty(t) || season <= 0
                ? Array.Empty<TpbTorrent>()
                : await tpb.ScrapeSeasonAsync(t, season, ct).ConfigureAwait(false);

            cache.Set(cacheKey, items, CacheTtl);
            return Results.Json(new { items = items.Select(TpbTorrentJson).ToList() }, jsonSerializerOptions);
        });
    }

    private static object TpbTorrentJson(TpbTorrent t) => new
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
