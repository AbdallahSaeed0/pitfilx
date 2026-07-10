using System.Text.Json;
using Pitflix.API.Services;
using Pitflix.API.Services.Awards;

namespace Pitflix.API.Endpoints;

public static class AwardsEndpoints
{
    public static void MapAwardsEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/awards/catalog", async (AwardsService awards, CancellationToken ct) =>
        {
            var list = await awards.GetCatalogCardsAsync(ct).ConfigureAwait(false);
            return Results.Json(new { awards = list }, jsonSerializerOptions);
        });

        app.MapGet("/api/awards/{awardId}/years", async (string awardId, AwardsService awards, CancellationToken ct) =>
        {
            var years = await awards.GetYearsAsync(awardId, ct).ConfigureAwait(false);
            return Results.Json(new { years }, jsonSerializerOptions);
        });

        app.MapGet("/api/awards/{awardId}/year-tiles", async (string awardId, AwardsService awards, CancellationToken ct) =>
        {
            var tiles = await awards.GetYearTilesAsync(awardId, ct).ConfigureAwait(false);
            return Results.Json(new { tiles }, jsonSerializerOptions);
        });

        app.MapGet("/api/awards/{awardId}/{year:int}", async (string awardId, int year, AwardsService awards,
            CancellationToken ct) =>
        {
            var edition = await awards.BuildEditionAsync(awardId, year, ct).ConfigureAwait(false);
            return edition == null ? Results.NotFound() : Results.Json(edition, jsonSerializerOptions);
        });

        app.MapGet("/api/awards/cache/status", (AwardsCachePreloadCoordinator coord) =>
            Results.Json(coord.GetStatus(), jsonSerializerOptions));

        app.MapPost("/api/awards/cache/preload", (AwardsCachePreloadCoordinator coord) =>
        {
            var ok = coord.TryStart(clearFirst: false);
            return Results.Json(new { started = ok, busy = !ok }, jsonSerializerOptions);
        });

        app.MapPost("/api/awards/cache/refresh", (AwardsCachePreloadCoordinator coord) =>
        {
            var ok = coord.TryStart(clearFirst: true);
            return Results.Json(new { started = ok, busy = !ok }, jsonSerializerOptions);
        });

        app.MapPost("/api/awards/cache/clear",
            async (AwardNomineeCacheRepository repo, CancellationToken ct) =>
            {
                await repo.DeleteAllAsync(ct).ConfigureAwait(false);
                return Results.Json(new { ok = true }, jsonSerializerOptions);
            });

        app.MapPost("/api/awards/cache/cancel", (AwardsCachePreloadCoordinator coord) =>
        {
            coord.RequestCancel();
            return Results.Json(new { ok = true }, jsonSerializerOptions);
        });

        // Awards nominations for a specific title — live from Wikidata (no preload needed).
        app.MapGet("/api/awards/for-title", async (int tmdbId, string? mediaType, string? imdbId, WikidataAwardsService wikidata, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            if (tmdbId <= 0) return Results.BadRequest();
            var isTv = string.Equals(mediaType, "tv", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase);

            // Try TMDB ID first; fall back to IMDb ID (P345) which has much better Wikidata coverage.
            var raw = await wikidata.GetAwardsAsync(tmdbId, isTv, ct).ConfigureAwait(false);
            if (raw.Count == 0 && !string.IsNullOrWhiteSpace(imdbId))
                raw = await wikidata.GetAwardsByImdbIdAsync(imdbId, ct).ConfigureAwait(false);
            if (raw.Count == 0 && !string.IsNullOrWhiteSpace(imdbId) && tmdbClientFactory.Create() is null)
            {
                // no TMDB configured — already tried imdbId above, nothing more to do
            }
            else if (raw.Count == 0 && string.IsNullOrWhiteSpace(imdbId) && tmdbClientFactory.Create() is { } tmdbFallback)
            {
                // Caller didn't send imdbId — look it up from TMDB
                var mt = isTv ? "Series" : "Movie";
                var fetched = await tmdbFallback.TryGetImdbIdAsync(tmdbId, mt, ct).ConfigureAwait(false);
                if (!string.IsNullOrWhiteSpace(fetched))
                    raw = await wikidata.GetAwardsByImdbIdAsync(fetched, ct).ConfigureAwait(false);
            }

            var nominations = raw
                .Select(a =>
                {
                    var (ceremonyId, ceremonyName, categoryName) = WikidataAwardsService.ParseAwardLabel(a.AwardLabel);
                    return new
                    {
                        awardId      = ceremonyId,
                        awardName    = ceremonyName,
                        year         = a.Year,
                        categoryId   = a.AwardLabel.ToLowerInvariant().Replace(' ', '-'),
                        categoryName,
                        winner       = a.Winner,
                    };
                })
                .OrderByDescending(n => n.year)
                .ThenBy(n => n.awardId)
                .ToList();

            return Results.Json(new { nominations }, jsonSerializerOptions);
        });

        // Awards won/nominated by a person — live from Wikidata (P4985 = TMDB person ID).
        app.MapGet("/api/awards/for-person", async (int tmdbId, WikidataAwardsService wikidata, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            if (tmdbId <= 0) return Results.BadRequest();

            var raw = await wikidata.GetPersonAwardsAsync(tmdbId, ct).ConfigureAwait(false);

            // Parse ceremony info first
            var parsed = raw.Select(a =>
            {
                var (ceremonyId, ceremonyName, categoryName) = WikidataAwardsService.ParseAwardLabel(a.AwardLabel);
                return (ceremonyId, ceremonyName, categoryName, a);
            }).ToList();

            // Enrich with TMDB poster URLs in parallel (capped at 6 concurrent)
            var posterUrls = new string?[parsed.Count];
            var tmdbClient = tmdbClientFactory.Create();
            if (tmdbClient != null)
            {
                var sem = new SemaphoreSlim(6, 6);
                await Task.WhenAll(parsed.Select(async (entry, i) =>
                {
                    var tid = entry.a.WorkTmdbMovieId ?? entry.a.WorkTmdbTvId;
                    if (tid == null) return;
                    var mt = entry.a.WorkTmdbMovieId != null ? "Movie" : "Series";
                    await sem.WaitAsync(ct).ConfigureAwait(false);
                    try
                    {
                        var art = await tmdbClient.GetArtworkPathsAsync(tid.Value, mt, ct).ConfigureAwait(false);
                        if (art.HasValue && !string.IsNullOrWhiteSpace(art.Value.PosterPath))
                        {
                            var p = art.Value.PosterPath.Trim().TrimStart('/');
                            var b = ImageUrls.PublicBase.TrimEnd('/');
                            posterUrls[i] = $"{b}/api/img/tmdb?size=w154&file={Uri.EscapeDataString(p)}";
                        }
                    }
                    catch { /* non-critical */ }
                    finally { sem.Release(); }
                })).ConfigureAwait(false);
            }

            var nominations = parsed.Select((entry, i) => new
            {
                awardId         = entry.ceremonyId,
                awardName       = entry.ceremonyName,
                year            = entry.a.Year,
                categoryName    = entry.categoryName,
                winner          = entry.a.Winner,
                workTitle       = entry.a.WorkTitle,
                workTmdbMovieId = entry.a.WorkTmdbMovieId,
                workTmdbTvId    = entry.a.WorkTmdbTvId,
                posterUrl       = posterUrls[i],
            })
            .OrderByDescending(n => n.year)
            .ThenBy(n => n.awardId)
            .ToList();

            return Results.Json(new { nominations }, jsonSerializerOptions);
        });

        // Fast path: branded poster placeholders (same-origin) so awards never fall back to nominee/movie art.
        app.MapGet("/api/awards/placeholder/poster", (string awardId, int? year, string? title, string? accent) =>
        {
            var safeAward = (awardId ?? "").Trim();
            if (string.IsNullOrEmpty(safeAward) || safeAward.Length > 80)
                return Results.BadRequest();
            var y = year is >= 1800 and <= 2200 ? year.Value : (int?)null;
            var textTitle = (title ?? "").Trim();
            if (textTitle.Length > 80)
                textTitle = textTitle[..80];
            var text = !string.IsNullOrWhiteSpace(textTitle) ? textTitle : safeAward.Replace('-', ' ');

            var color = (accent ?? "").Trim();
            if (color.Length is < 4 or > 12 || !color.StartsWith('#'))
                color = "#c9a227";

            // Simple premium-ish SVG: gradient, subtle grain, award title + year.
            var svg = $"""
                      <svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
                        <defs>
                          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0" stop-color="#0b0f16"/>
                            <stop offset="1" stop-color="#151a23"/>
                          </linearGradient>
                          <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stop-color="{color}" stop-opacity="0.28"/>
                            <stop offset="1" stop-color="{color}" stop-opacity="0"/>
                          </linearGradient>
                          <filter id="noise" x="-20%" y="-20%" width="140%" height="140%">
                            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch"/>
                            <feColorMatrix type="matrix"
                              values="0 0 0 0 0
                                      0 0 0 0 0
                                      0 0 0 0 0
                                      0 0 0 .10 0"/>
                          </filter>
                        </defs>
                        <rect width="600" height="900" rx="34" fill="url(#bg)"/>
                        <rect width="600" height="900" rx="34" fill="url(#shine)"/>
                        <rect width="600" height="900" rx="34" filter="url(#noise)" opacity="0.35"/>
                        <rect x="24" y="24" width="552" height="852" rx="28" fill="none" stroke="{color}" stroke-opacity="0.35" stroke-width="2"/>
                        <g fill="{color}" fill-opacity="0.9">
                          <path d="M300 160c-22 0-40 18-40 40v18c0 16-9 30-22 37l-22 12c-8 4-11 14-7 22l16 30c6 11 19 15 30 9l20-11c15-8 33-8 48 0l20 11c11 6 24 2 30-9l16-30c4-8 1-18-7-22l-22-12c-13-7-22-21-22-37v-18c0-22-18-40-40-40z"/>
                          <path d="M238 388h124v22H238z"/>
                        </g>
                        <text x="50" y="560" fill="#e8edf7" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="44" font-weight="800">
                          {System.Security.SecurityElement.Escape(text)}
                        </text>
                        {(y is int yy ? $"<text x=\"50\" y=\"618\" fill=\"#a7b0c0\" font-family=\"system-ui, -apple-system, Segoe UI, Roboto, Arial\" font-size=\"28\" font-weight=\"700\">{yy}</text>" : "")}
                        <text x="50" y="820" fill="#7f8aa0" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="18" font-weight="600" letter-spacing="1.5">
                          PITFLIX AWARDS
                        </text>
                      </svg>
                      """;

            return Results.Text(svg, "image/svg+xml; charset=utf-8");
        });
    }
}
