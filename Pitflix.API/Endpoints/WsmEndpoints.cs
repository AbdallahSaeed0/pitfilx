using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Pitflix.API.Services;
using Pitflix.Core.Database;
using Pitflix.Core.Services.Torrents;

namespace Pitflix.API.Endpoints;

public static class WsmEndpoints
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(30);
    // Empty results get a much shorter TTL than real hits — a transient scrape failure (site down,
    // markup change, network blip) previously looked identical to "no releases exist" and got frozen
    // as such for a full 30 minutes. This lets it self-heal on the next request instead.
    private static readonly TimeSpan EmptyCacheTtl = TimeSpan.FromMinutes(3);

    public static void MapWsmEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        // WatchSoMuch's internal id is exactly the numeric part of the title's IMDb id — no search step needed.
        app.MapGet("/api/wsm/movie/{tmdbId:int}", async (
            int tmdbId, string? imdbId, string? title, int? year, WatchSoMuchScraperService wsm, IMemoryCache cache, CancellationToken ct) =>
        {
            try
            {
                var t = title?.Trim() ?? "";
                // Include imdbId/title/year in the key, not just tmdbId — otherwise a stale cached result
                // from an earlier (wrong) match could be served back for the same tmdbId indefinitely.
                var cacheKey = $"wsm:movie:{tmdbId}:{imdbId}:{t}:{year}";
                if (cache.TryGetValue(cacheKey, out IReadOnlyList<WsmTorrent>? cached))
                    return Results.Json(new { items = cached!.Select(WsmTorrentJson).ToList() }, jsonSerializerOptions);

                var items = string.IsNullOrEmpty(imdbId) || string.IsNullOrEmpty(t) || year is not > 0
                    ? Array.Empty<WsmTorrent>()
                    : await wsm.ScrapeAsync(imdbId, t, year.Value, ct).ConfigureAwait(false);

                cache.Set(cacheKey, items, items.Count > 0 ? CacheTtl : EmptyCacheTtl);
                return Results.Json(new { items = items.Select(WsmTorrentJson).ToList() }, jsonSerializerOptions);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                // Letting this escape unhandled makes ASP.NET Core clear the response (wiping the CORS
                // headers UseCors already set) before writing its default 500 — the browser then reports
                // a misleading "blocked by CORS policy" instead of the real error.
                return Results.Json(new { items = Array.Empty<object>(), error = ex.Message }, jsonSerializerOptions, statusCode: 500);
            }
        });

        // Episode pages embed only the show's current episode — the full season/episode archive is reached
        // via the site's own AJAX endpoint (mid = WatchSoMuch id = numeric part of the show's IMDb id).
        app.MapGet("/api/wsm/episode/{tmdbId:int}/{season:int}/{episode:int}", async (
            int tmdbId, int season, int episode, string? imdbId, WatchSoMuchScraperService wsm, IMemoryCache cache, CancellationToken ct) =>
        {
            try
            {
                var cacheKey = $"wsm:episode:{tmdbId}-{season}-{episode}:{imdbId}";
                if (cache.TryGetValue(cacheKey, out IReadOnlyList<WsmTorrent>? cached))
                    return Results.Json(new { items = cached!.Select(WsmTorrentJson).ToList() }, jsonSerializerOptions);

                var items = string.IsNullOrEmpty(imdbId)
                    ? Array.Empty<WsmTorrent>()
                    : await wsm.ScrapeEpisodeAsync(imdbId, season, episode, ct).ConfigureAwait(false);

                cache.Set(cacheKey, items, items.Count > 0 ? CacheTtl : EmptyCacheTtl);
                return Results.Json(new { items = items.Select(WsmTorrentJson).ToList() }, jsonSerializerOptions);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                return Results.Json(new { items = Array.Empty<object>(), error = ex.Message }, jsonSerializerOptions, statusCode: 500);
            }
        });

        // Targets a season's "full season pack" releases rather than a single episode.
        app.MapGet("/api/wsm/season/{tmdbId:int}/{season:int}", async (
            int tmdbId, int season, string? imdbId, WatchSoMuchScraperService wsm, IMemoryCache cache, CancellationToken ct) =>
        {
            try
            {
                var cacheKey = $"wsm:season:{tmdbId}-{season}:{imdbId}";
                if (cache.TryGetValue(cacheKey, out IReadOnlyList<WsmTorrent>? cached))
                    return Results.Json(new { items = cached!.Select(WsmTorrentJson).ToList() }, jsonSerializerOptions);

                var items = string.IsNullOrEmpty(imdbId)
                    ? Array.Empty<WsmTorrent>()
                    : await wsm.ScrapeSeasonAsync(imdbId, season, ct).ConfigureAwait(false);

                cache.Set(cacheKey, items, items.Count > 0 ? CacheTtl : EmptyCacheTtl);
                return Results.Json(new { items = items.Select(WsmTorrentJson).ToList() }, jsonSerializerOptions);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                return Results.Json(new { items = Array.Empty<object>(), error = ex.Message }, jsonSerializerOptions, statusCode: 500);
            }
        });

        app.MapPost("/api/wsm/download", async (TorrentDownloadBody body, LibraryRepository repo, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.MagnetLink))
                return Results.BadRequest(new { error = "Missing magnetLink." });

            var baseUrl = await repo.GetSettingAsync("QBittorrentBaseUrl", ct).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(baseUrl))
                return Results.Json(new { action = "open_magnet" }, jsonSerializerOptions);

            if (string.IsNullOrWhiteSpace(body.SavePath))
                return Results.BadRequest(new { error = "Choose a save folder when using qBittorrent." });

            var username = await repo.GetSettingAsync("QBittorrentUsername", ct).ConfigureAwait(false);
            var password = await repo.GetSettingAsync("QBittorrentPassword", ct).ConfigureAwait(false);

            var client = new QBittorrentClient(baseUrl, username ?? "", password ?? "");
            var result = await client.AddTorrentAsync(body.MagnetLink, body.SavePath.Trim(), body.FileIndex, ct)
                .ConfigureAwait(false);
            return result.Success
                ? Results.Json(new { action = "queued" }, jsonSerializerOptions)
                : Results.Json(new { error = result.Error }, jsonSerializerOptions, statusCode: 502);
        });

        app.MapPost("/api/wsm/save-torrent-file", async (TorrentFileSaveBody body, CancellationToken ct) =>
        {
            var url = body.TorrentFileUrl?.Trim();
            var savePath = body.SavePath?.Trim();
            if (string.IsNullOrWhiteSpace(url))
                return Results.BadRequest(new { error = "Missing torrentFileUrl." });
            if (string.IsNullOrWhiteSpace(savePath))
                return Results.BadRequest(new { error = "Missing savePath." });

            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
                http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
                if (url.Contains("watchsomuch", StringComparison.OrdinalIgnoreCase))
                    http.DefaultRequestHeaders.Referrer = new Uri("https://watchsomuch.to/");

                using var res = await http.GetAsync(url, ct).ConfigureAwait(false);
                if (!res.IsSuccessStatusCode)
                {
                    return Results.Json(
                        new { error = $"Could not download torrent file ({(int)res.StatusCode})." },
                        jsonSerializerOptions,
                        statusCode: 502);
                }

                var bytes = await res.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
                if (bytes.Length == 0)
                    return Results.Json(new { error = "Torrent file was empty." }, jsonSerializerOptions, statusCode: 502);

                var dir = Path.GetDirectoryName(savePath);
                if (!string.IsNullOrWhiteSpace(dir))
                    Directory.CreateDirectory(dir);

                await File.WriteAllBytesAsync(savePath, bytes, ct).ConfigureAwait(false);
                return Results.Json(new { success = true, savePath }, jsonSerializerOptions);
            }
            catch (Exception ex)
            {
                return Results.Json(new { error = ex.Message }, jsonSerializerOptions, statusCode: 502);
            }
        });
    }

    private static object WsmTorrentJson(WsmTorrent t) => new
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
