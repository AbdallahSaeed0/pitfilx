using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Pitflix.API.Services;
using Pitflix.Core.Database;

namespace Pitflix.API.Endpoints;

public static class StremioAddonEndpoints
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan EmptyCacheTtl = TimeSpan.FromMinutes(2);

    public static void MapStremioAddonEndpoints(
        this WebApplication app,
        JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/stremio-addon/movie/{tmdbId:int}", async (
            int tmdbId,
            string? imdbId,
            string? provider,
            StremioAddonService addons,
            LibraryRepository repo,
            IMemoryCache cache,
            CancellationToken ct) =>
        {
            if (!IsImdbId(imdbId))
                return Results.Json(new { items = Array.Empty<object>() }, jsonSerializerOptions);

            var providerId = NormalizeProvider(provider);
            var manifestUrl = await GetManifestUrlAsync(repo, providerId, ct).ConfigureAwait(false);
            var cacheKey = $"stremio-addon:{providerId}:movie:{manifestUrl}:{tmdbId}:{imdbId}";
            if (!cache.TryGetValue(cacheKey, out IReadOnlyList<StremioAddonStream>? items))
            {
                items = await addons.GetStreamsAsync(manifestUrl, "movie", imdbId!, ct).ConfigureAwait(false);
                cache.Set(cacheKey, items, items.Count > 0 ? CacheTtl : EmptyCacheTtl);
            }

            return Results.Json(new { items = items!.Select(ToJson).ToList() }, jsonSerializerOptions);
        });

        app.MapGet("/api/stremio-addon/episode/{tmdbId:int}/{season:int}/{episode:int}", async (
            int tmdbId,
            int season,
            int episode,
            string? imdbId,
            string? provider,
            StremioAddonService addons,
            LibraryRepository repo,
            IMemoryCache cache,
            CancellationToken ct) =>
        {
            if (!IsImdbId(imdbId) || season < 0 || episode <= 0)
                return Results.Json(new { items = Array.Empty<object>() }, jsonSerializerOptions);

            var providerId = NormalizeProvider(provider);
            var manifestUrl = await GetManifestUrlAsync(repo, providerId, ct).ConfigureAwait(false);
            var videoId = $"{imdbId}:{season}:{episode}";
            var cacheKey = $"stremio-addon:{providerId}:episode:{manifestUrl}:{tmdbId}:{videoId}";
            if (!cache.TryGetValue(cacheKey, out IReadOnlyList<StremioAddonStream>? items))
            {
                items = await addons.GetStreamsAsync(manifestUrl, "series", videoId, ct).ConfigureAwait(false);
                cache.Set(cacheKey, items, items.Count > 0 ? CacheTtl : EmptyCacheTtl);
            }

            return Results.Json(new { items = items!.Select(ToJson).ToList() }, jsonSerializerOptions);
        });

        app.MapGet("/api/stremio-addon/verify", async (
            string? manifestUrl,
            StremioAddonService addons,
            CancellationToken ct) =>
        {
            var url = string.IsNullOrWhiteSpace(manifestUrl)
                ? StremioAddonService.DefaultManifestUrl
                : manifestUrl.Trim();
            var result = await addons.ValidateManifestAsync(url, ct).ConfigureAwait(false);
            return Results.Json(
                new { valid = result.Valid, name = result.Name, error = result.Error },
                jsonSerializerOptions,
                statusCode: result.Valid ? 200 : 400);
        });
    }

    private static string NormalizeProvider(string? provider) =>
        string.Equals(provider, "comet", StringComparison.OrdinalIgnoreCase) ? "comet" : "torrentio";

    private static async Task<string> GetManifestUrlAsync(
        LibraryRepository repo,
        string provider,
        CancellationToken ct)
    {
        var isComet = provider == "comet";
        var settingKey = isComet ? "CometAddonManifestUrl" : "StremioAddonManifestUrl";
        var fallback = isComet
            ? StremioAddonService.DefaultCometManifestUrl
            : StremioAddonService.DefaultManifestUrl;
        var configured = await repo.GetSettingAsync(settingKey, ct).ConfigureAwait(false);
        if (isComet &&
            string.Equals(
                configured?.Trim(),
                StremioAddonService.LegacyCometManifestUrl,
                StringComparison.OrdinalIgnoreCase))
            return fallback;

        return StremioAddonService.TryValidatePublicHttpsUrl(configured, out _, out _)
            ? configured!.Trim()
            : fallback;
    }

    private static bool IsImdbId(string? value) =>
        value is { Length: >= 3 } &&
        value.StartsWith("tt", StringComparison.OrdinalIgnoreCase) &&
        value[2..].All(char.IsDigit);

    private static object ToJson(StremioAddonStream stream) => new
    {
        title = stream.Title,
        size = stream.Size,
        quality = stream.Quality,
        format = stream.Format,
        badges = stream.Badges,
        magnetLink = stream.MagnetLink,
        torrentFileUrl = stream.TorrentFileUrl,
        directUrl = stream.DirectUrl,
        infoHash = stream.InfoHash,
        fileIndex = stream.FileIndex,
    };
}
