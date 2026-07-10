using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Pitflix.API.Services;

namespace Pitflix.API.Endpoints;

public static class PsaEndpoints
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(30);

    public static void MapPsaEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/psa/movie/{tmdbId:int}", async (
            int tmdbId, string? title, int? year, PsaScraperService psa, IMemoryCache cache, CancellationToken ct) =>
        {
            var t = title?.Trim() ?? "";
            if (string.IsNullOrEmpty(t) || year is not > 0)
                return Results.Json(new { items = Array.Empty<object>() }, jsonSerializerOptions);

            var cacheKey = $"psa:movie:{tmdbId}:{t}:{year}";
            if (cache.TryGetValue(cacheKey, out IReadOnlyList<PsaTorrent>? cached))
                return Results.Json(new { items = cached!.Select(PsaTorrentJson).ToList() }, jsonSerializerOptions);

            var items = await psa.ScrapeMovieAsync(t, year.Value, ct).ConfigureAwait(false);
            if (items.Count > 0)
                cache.Set(cacheKey, items, CacheTtl);

            return Results.Json(new { items = items.Select(PsaTorrentJson).ToList() }, jsonSerializerOptions);
        });

        app.MapGet("/api/psa/episode/{tmdbId:int}/{season:int}/{episode:int}", async (
            int tmdbId, int season, int episode, string? title, PsaScraperService psa, IMemoryCache cache, CancellationToken ct) =>
        {
            var t = title?.Trim() ?? "";
            if (string.IsNullOrEmpty(t) || season <= 0 || episode <= 0)
                return Results.Json(new { items = Array.Empty<object>() }, jsonSerializerOptions);

            var cacheKey = $"psa:episode:{tmdbId}:{season}:{episode}:{t}";
            if (cache.TryGetValue(cacheKey, out IReadOnlyList<PsaTorrent>? cached))
                return Results.Json(new { items = cached!.Select(PsaTorrentJson).ToList() }, jsonSerializerOptions);

            var items = await psa.ScrapeEpisodeAsync(t, season, episode, ct).ConfigureAwait(false);
            if (items.Count > 0)
                cache.Set(cacheKey, items, CacheTtl);

            return Results.Json(new { items = items.Select(PsaTorrentJson).ToList() }, jsonSerializerOptions);
        });

        app.MapGet("/api/psa/season/{tmdbId:int}/{season:int}", async (
            int tmdbId, int season, string? title, PsaScraperService psa, IMemoryCache cache, CancellationToken ct) =>
        {
            var t = title?.Trim() ?? "";
            if (string.IsNullOrEmpty(t) || season <= 0)
                return Results.Json(new { items = Array.Empty<object>() }, jsonSerializerOptions);

            var cacheKey = $"psa:season:{tmdbId}:{season}:{t}";
            if (cache.TryGetValue(cacheKey, out IReadOnlyList<PsaTorrent>? cached))
                return Results.Json(new { items = cached!.Select(PsaTorrentJson).ToList() }, jsonSerializerOptions);

            var items = await psa.ScrapeSeasonAsync(t, season, ct).ConfigureAwait(false);
            if (items.Count > 0)
                cache.Set(cacheKey, items, CacheTtl);

            return Results.Json(new { items = items.Select(PsaTorrentJson).ToList() }, jsonSerializerOptions);
        });
    }

    private static object PsaTorrentJson(PsaTorrent t) => new
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
