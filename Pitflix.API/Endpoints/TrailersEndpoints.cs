using System.Text.Json;
using System.Text.RegularExpressions;
using Pitflix.API.Services;
using Pitflix.API.Services.Trailers;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Endpoints;

public static class TrailersEndpoints
{
    public static void MapTrailersEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        // ── Trailer embed URL for local library items ────────────────────────────────
        app.MapGet("/api/trailers/embed", async (int? tmdbId, string? mediaType, TrailersRepository trailersRepo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            if (tmdbId is null or <= 0)
                return Results.Json(new { embedUrl = (string?)null, trailers = Array.Empty<object>(), error = "tmdbId required." }, jsonSerializerOptions, statusCode: 400);

            static int TrailerTypePriority(string? t) => t switch
            {
                "Trailer" => 0,
                "Teaser"  => 1,
                "Clip"    => 2,
                _         => 3
            };

            // 1) Try persisted trailers DB — grab up to 5 so we can offer a choice
            var rows = await trailersRepo.GetTrailersByTmdbIdAsync(tmdbId.Value, mediaType, true, null, 5, ct).ConfigureAwait(false);
            static string InferTrailerType(string title)
            {
                var t = title ?? "";
                if (t.Contains("Teaser", StringComparison.OrdinalIgnoreCase))  return "Teaser";
                if (t.Contains("Clip",   StringComparison.OrdinalIgnoreCase))   return "Clip";
                return "Trailer";
            }

            var dbTrailers = rows
                .Select(r => new
                {
                    url  = YoutubeEmbedUrl(r.YoutubeUrl ?? r.VideoId),
                    name = r.Title,
                    type = InferTrailerType(r.Title),
                    key  = TrailerYoutubeKey(r.YoutubeUrl ?? r.VideoId)
                })
                .Where(x => x.url != null)
                .OrderBy(x => TrailerTypePriority(x.type))
                .ToList();

            if (dbTrailers.Count > 0)
            {
                var best = dbTrailers[0];
                var allTrailers = dbTrailers.Select(t => new { embedUrl = t.url, title = t.name, type = t.type, youtubeKey = t.key }).ToList();
                return Results.Json(new { embedUrl = best.url, title = best.name, trailers = allTrailers }, jsonSerializerOptions);
            }

            // 2) Fallback: live TMDB fetch — returns trailer + teaser pair when both exist
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(new { embedUrl = (string?)null, trailers = Array.Empty<object>(), error = "TMDB not configured." }, jsonSerializerOptions);

            var isMovie = !string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase);
            var clips = await tmdb.TryGetTrailerAndTeaserClipsAsync(tmdbId.Value, isMovie ? "Movie" : "Series", ct).ConfigureAwait(false);
            if (clips.Count > 0)
            {
                var tmdbTrailers = clips
                    .Select(c => new { embedUrl = $"https://www.youtube.com/embed/{c.Key}?autoplay=1&rel=0", title = c.Name, type = "Trailer", youtubeKey = c.Key })
                    .ToList();
                return Results.Json(new { embedUrl = tmdbTrailers[0].embedUrl, title = tmdbTrailers[0].title, trailers = tmdbTrailers }, jsonSerializerOptions);
            }

            return Results.Json(new { embedUrl = (string?)null, trailers = Array.Empty<object>(), error = "No trailer found." }, jsonSerializerOptions);
        });

        /// <summary>Backward compatible — same as <c>/api/home/trailers/latest</c>.</summary>
        app.MapGet("/api/home/trailers", async (TrailersRepository trailersRepo, ILogger<Program> logger, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(Array.Empty<object>(), jsonSerializerOptions);
            return await HomeTrailersLatestCore(trailersRepo, tmdb, logger, jsonSerializerOptions, ct).ConfigureAwait(false);
        });

        app.MapGet("/api/home/trailers/latest", async (TrailersRepository trailersRepo, ILogger<Program> logger, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(Array.Empty<object>(), jsonSerializerOptions);
            return await HomeTrailersLatestCore(trailersRepo, tmdb, logger, jsonSerializerOptions, ct).ConfigureAwait(false);
        });

        /// <summary>One-shot RSS fetch + TMDB resolve stats (does not return full Home latest cards).</summary>
        app.MapGet("/api/home/trailers/rss-status", async (IHttpClientFactory httpFactory, IConfiguration configuration,
                ITmdbClientFactory tmdbClientFactory, ILogger<Program> logger, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(new { ok = false, error = "tmdb_not_configured" }, jsonSerializerOptions);

            try
            {
                var (_, diag) = await ScrapedTrailerPoolBuilder.BuildFromYoutubeRssAsync(
                    httpFactory, tmdb, configuration, ct, logger).ConfigureAwait(false);
                return Results.Json(new
                {
                    ok = true,
                    enabled = diag.Enabled,
                    channelsConfigured = diag.ChannelsConfigured,
                    rawEntriesFetched = diag.RawEntriesFetched,
                    resolvedToTmdb = diag.ResolvedToTmdb,
                    channelErrors = diag.ChannelErrors,
                    buildError = diag.BuildError,
                    youtubeSearchRawEntries = diag.YoutubeSearchRawEntries,
                    youtubeSearchError = diag.YoutubeSearchError,
                    invidiousRawEntries = diag.InvidiousRawEntries,
                    invidiousError = diag.InvidiousError
                }, jsonSerializerOptions);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Trailer RSS status endpoint failed");
                return Results.Json(new { ok = false, error = ex.Message }, jsonSerializerOptions);
            }
        });

        app.MapGet("/api/home/trailers/upcoming", async (TrailersCuratedPriorityProvider curated, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(Array.Empty<object>(), jsonSerializerOptions);
            return await HomeTrailersUpcomingCore(curated, tmdb, jsonSerializerOptions, ct).ConfigureAwait(false);
        });

        app.MapGet("/api/trailers/latest", async (TrailersRepository repo, int? limit, string? mediaType, bool? activeOnly,
                DateTime? publishedAfter, bool? distinctCatalog, CancellationToken ct) =>
        {
            var rows = await repo
                .GetLatestTrailersAsync(limit ?? 20, mediaType, activeOnly ?? true, publishedAfter, distinctCatalog ?? true, ct)
                .ConfigureAwait(false);
            return Results.Json(rows.Select(TrailerApiModel).ToList(), jsonSerializerOptions);
        });

        app.MapGet("/api/trailers/{tmdbId:int}", async (int tmdbId, TrailersRepository repo, string? mediaType, bool? activeOnly,
                DateTime? publishedAfter, int? limit, CancellationToken ct) =>
        {
            var rows = await repo
                .GetTrailersByTmdbIdAsync(tmdbId, mediaType, activeOnly, publishedAfter, limit, ct)
                .ConfigureAwait(false);
            var primary = rows.FirstOrDefault(r => r.IsActive) ?? rows.FirstOrDefault();
            var alternates = primary == null ? rows : rows.Where(r => r.VideoId != primary.VideoId).ToList();
            return Results.Json(new
            {
                primary = primary == null ? null : TrailerApiModel(primary),
                alternates = alternates.Select(TrailerApiModel).ToList()
            }, jsonSerializerOptions);
        });

        app.MapPost("/api/trailers/ingest", async (HttpRequest req, TrailerIngestionService ingest, IConfiguration cfg,
                CancellationToken ct) =>
        {
            var expected = cfg["Pitflix:Trailers:ManualIngestKey"]?.Trim();
            if (!string.IsNullOrEmpty(expected))
            {
                if (!req.Headers.TryGetValue("X-Pitflix-Trailers-Ingest-Key", out var key) ||
                    !string.Equals(key.ToString(), expected, StringComparison.Ordinal))
                    return Results.Unauthorized();
            }

            var r = await ingest.IngestAsync(ct).ConfigureAwait(false);
            return Results.Json(new
            {
                ok = string.IsNullOrEmpty(r.Error),
                r.FetchedCount,
                r.FilteredCount,
                r.FilteredOutCount,
                r.MatchedCount,
                r.InsertedOrUpdatedCount,
                r.SkippedDedupCount,
                r.PurgedCount,
                r.QuotaStopped,
                r.UnmatchedCount,
                r.UploadsFetchedCount,
                r.SearchFetchedCount,
                r.ChannelsPolled,
                r.FallbackSearchUsed,
                r.NewUploadsSeenCount,
                error = r.Error
            }, jsonSerializerOptions);
        });

        app.MapPost("/api/trailers/monitor/run", async (HttpRequest req, TrailerIngestionService ingest, IConfiguration cfg,
                TrailerMonitorRuntime monitor, CancellationToken ct) =>
        {
            var expected = cfg["Pitflix:Trailers:ManualIngestKey"]?.Trim();
            if (!string.IsNullOrEmpty(expected))
            {
                if (!req.Headers.TryGetValue("X-Pitflix-Trailers-Ingest-Key", out var key) ||
                    !string.Equals(key.ToString(), expected, StringComparison.Ordinal))
                    return Results.Unauthorized();
            }

            var r = await ingest.IngestAsync(ct).ConfigureAwait(false);
            return Results.Json(new
            {
                ok = string.IsNullOrEmpty(r.Error),
                result = r,
                status = monitor.Snapshot()
            }, jsonSerializerOptions);
        });

        app.MapGet("/api/trailers/monitor/status", (HttpRequest req, IConfiguration cfg, TrailerMonitorRuntime monitor) =>
        {
            var expected = cfg["Pitflix:Trailers:ManualIngestKey"]?.Trim();
            if (!string.IsNullOrEmpty(expected))
            {
                if (!req.Headers.TryGetValue("X-Pitflix-Trailers-Ingest-Key", out var key) ||
                    !string.Equals(key.ToString(), expected, StringComparison.Ordinal))
                    return Results.Unauthorized();
            }

            return Results.Json(monitor.Snapshot(), jsonSerializerOptions);
        });

        app.MapGet("/api/trailers/test-youtube-quota", async (IHttpClientFactory httpFactory, IConfiguration cfg, CancellationToken ct) =>
        {
            var apiKey = cfg["Pitflix:YouTubeApiKey"]?.Trim();
            if (string.IsNullOrEmpty(apiKey))
            {
                return Results.Json(new { ok = false, error = "No YouTube API key configured" }, jsonSerializerOptions);
            }

            try
            {
                var http = httpFactory.CreateClient();
                var url = $"https://www.googleapis.com/youtube/v3/channels?part=id&forUsername=test&key={Uri.EscapeDataString(apiKey)}";
                using var resp = await http.GetAsync(url, ct).ConfigureAwait(false);
                var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);

                if (resp.StatusCode == System.Net.HttpStatusCode.Forbidden || body.Contains("quotaExceeded"))
                {
                    return Results.Json(new { ok = false, error = "YouTube API quota exceeded or forbidden", statusCode = (int)resp.StatusCode }, jsonSerializerOptions);
                }

                if (resp.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                {
                    return Results.Json(new { ok = false, error = "YouTube API key is invalid", statusCode = (int)resp.StatusCode }, jsonSerializerOptions);
                }

                if (resp.IsSuccessStatusCode)
                {
                    return Results.Json(new { ok = true, message = "YouTube API is working", statusCode = (int)resp.StatusCode }, jsonSerializerOptions);
                }

                return Results.Json(new { ok = false, error = $"Unexpected status: {resp.StatusCode}", body = body }, jsonSerializerOptions);
            }
            catch (Exception ex)
            {
                app.Logger.LogWarning(ex, "YouTube API quota test failed");
                return Results.Json(new { ok = false, error = ex.Message }, jsonSerializerOptions);
            }
        });

        /// <param name="mode">latest | trending | upcoming | upcoming-movies | upcoming-tv | all-upcoming</param>
        /// <param name="filter">movie | tv | all</param>
        /// <param name="search">When at least 2 characters, TMDB search replaces the usual discover pool (still respects filter).</param>
        app.MapGet("/api/trailers/browse", async (TrailersRepository trailersRepo, TrailersCuratedPriorityProvider curated,
                IHttpClientFactory httpFactory, ITmdbClientFactory tmdbClientFactory,
                IConfiguration configuration, ILogger<Program> logger, string? mode, string? filter, string? search,
                CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(Array.Empty<object>(), jsonSerializerOptions);

            var modeRaw = (mode ?? "upcoming").Trim();
            var modeNorm = (string.IsNullOrEmpty(modeRaw) ? "upcoming" : modeRaw).ToLowerInvariant();
            if (modeNorm == "all-upcoming")
                modeNorm = "upcoming";

            var filterNorm = (filter ?? "all").Trim().ToLowerInvariant();
            // Legacy browse modes: media was implied by tab name.
            if (modeNorm == "upcoming-movies")
                filterNorm = "movie";
            else if (modeNorm == "upcoming-tv")
                filterNorm = "tv";

            var wantMovie = filterNorm is not "tv";
            var wantTv = filterNorm is not "movie";

            var seen = new HashSet<string>(StringComparer.Ordinal);
            var pool = new List<TmdbDiscoverItem>();
            var searchTrim = search?.Trim() ?? "";

            if (modeNorm == "latest")
            {
                var repoMt = PersistedTrailerUiFeed.BrowseRepoMediaType(wantMovie, wantTv);
                var fetchLimit = searchTrim.Length >= 2 ? 200 : 64;
                var persisted = await PersistedTrailerUiFeed.BuildAsync(trailersRepo, tmdb, fetchLimit, repoMt, ct)
                    .ConfigureAwait(false);
                var latestRows = PersistedTrailerUiFeed.TakeForBrowse(persisted, searchTrim.Length >= 2 ? searchTrim : null, 48);
                return Results.Json(latestRows.Select(c => new
                {
                    tmdbId = c.TmdbId,
                    mediaType = c.MediaType,
                    title = c.Title,
                    posterUrl = c.PosterUrl,
                    backdropUrl = c.BackdropUrl,
                    youtubeKey = c.YoutubeKey,
                    trailerTitle = c.TrailerTitle,
                    releaseDate = c.ReleaseDate,
                    trailerPublishedAtUtc = c.TrailerPublishedAtUtc
                }).ToList(), jsonSerializerOptions);
            }

            if (searchTrim.Length >= 2)
            {
                pool.AddRange(await tmdb.SearchDiscoverForTrailersAsync(searchTrim, wantMovie, wantTv, 15, ct)
                    .ConfigureAwait(false));
                pool = TrailersFeedHelpers.RankTrailerCandidatePool(pool, wantMovie, wantTv);
            }
            else
            {
                // Optional curated priority injection (applies only to browse pools, not user search).
                var curatedEntries = await curated.TryLoadAsync(ct).ConfigureAwait(false);
                var curatedKeys = new HashSet<string>(StringComparer.Ordinal);
                foreach (var e in curatedEntries)
                {
                    var mt = e.MediaType.Trim().ToLowerInvariant();
                    if (mt is not ("movie" or "tv") || e.TmdbId <= 0)
                        continue;
                    curatedKeys.Add($"{mt}:{e.TmdbId}");
                    var header = await tmdb.TryGetDiscoverItemAsync(e.TmdbId, mt, ct).ConfigureAwait(false);
                    if (header != null)
                        pool.Add(header);
                }

                if (modeNorm == "trending")
                {
                    pool.AddRange(await tmdb.GetTrendingMoviesWeekAsync(ct).ConfigureAwait(false));
                    pool.AddRange(await tmdb.GetTrendingTvWeekAsync(ct).ConfigureAwait(false));
                    pool = TrailersFeedHelpers.FilterHomeTrailerPool(pool, strict: false);
                    pool = TrailersFeedHelpers.RankTrailerCandidatePool(pool, wantMovie, wantTv, curatedKeys);
                }

                var addUpcomingMovies = modeNorm == "upcoming-movies" || (modeNorm == "upcoming" && wantMovie);
                var addUpcomingTv = modeNorm == "upcoming-tv" || (modeNorm == "upcoming" && wantTv);

                if (addUpcomingMovies)
                {
                    pool.AddRange(await TrailersFeedHelpers.BuildUpcomingMoviesPoolAsync(tmdb, ct).ConfigureAwait(false));
                }

                if (addUpcomingTv)
                {
                    pool.AddRange(await TrailersFeedHelpers.BuildUpcomingTvPoolAsync(tmdb, ct).ConfigureAwait(false));
                }

                pool = TrailersFeedHelpers.RankTrailerCandidatePool(pool, wantMovie, wantTv, curatedKeys);
            }

            // Trending / upcoming / search (non-latest): multi-clip grid (trailer + teaser per title when needed).
            var maxTrailers = modeNorm == "trending" ? 140 : 72;
            var cards = await TrailersFeedHelpers
                .CollectTrailersForItemsAsync(tmdb, pool, maxTrailers, seen, ct)
                .ConfigureAwait(false);

            return Results.Json(cards.Select(c => new
            {
                tmdbId = c.TmdbId,
                mediaType = c.MediaType,
                title = c.Title,
                posterUrl = c.PosterUrl,
                backdropUrl = c.BackdropUrl,
                youtubeKey = c.YoutubeKey,
                trailerTitle = c.TrailerTitle,
                releaseDate = c.ReleaseDate
            }).ToList(), jsonSerializerOptions);
        });
    }

    private static async Task<IResult> HomeTrailersLatestCore(
        TrailersRepository trailersRepo, TmdbClient tmdb, ILogger logger,
        JsonSerializerOptions jsonSerializerOptions, CancellationToken ct)
    {
        var rows = await PersistedTrailerUiFeed.BuildAsync(trailersRepo, tmdb, limit: 120, mediaType: null, ct)
            .ConfigureAwait(false);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        const int RecentlyReleasedWindowDays = 60;
        var freshOngoingCutoffUtc = DateTime.UtcNow.AddDays(-21);
        var freshNoDateCutoffUtc = DateTime.UtcNow.AddDays(-90);

        bool TryParseDateOnly(string? ymd, out DateOnly d)
        {
            d = default;
            if (string.IsNullOrWhiteSpace(ymd) || ymd.Length < 10)
                return false;
            return DateOnly.TryParse(ymd.AsSpan(0, 10), out d);
        }

        bool IsUpcomingOrRecent(TrailerCardUiRow r)
        {
            var hasPub = r.TrailerPublishedAtUtc != default;

            if (TryParseDateOnly(r.ReleaseDate, out var release))
            {
                if (release > today) return true;
                if (release >= today.AddDays(-RecentlyReleasedWindowDays)) return true;
                return hasPub && r.TrailerPublishedAtUtc >= freshOngoingCutoffUtc;
            }

            return hasPub && r.TrailerPublishedAtUtc >= freshNoDateCutoffUtc;
        }

        rows = rows
            .Where(r => IsUpcomingOrRecent(r))
            .OrderByDescending(r => r.TrailerPublishedAtUtc)
            .ThenBy(r => r.ReleaseDate, StringComparer.OrdinalIgnoreCase)
            .ThenBy(r => r.Title, StringComparer.OrdinalIgnoreCase)
            .Take(100)
            .ToList();

        if (rows.Count == 0)
            logger.LogInformation(
                "Home trailers latest: 0 rows passed the window gate " +
                "(upcoming OR released ≤{Days}d ago OR no-release-date trailer ≤90d old). " +
                "Run ingestion or check channel config.", RecentlyReleasedWindowDays);
        return Results.Json(rows.Select(c => new
        {
            tmdbId = c.TmdbId,
            mediaType = c.MediaType,
            title = c.Title,
            posterUrl = c.PosterUrl,
            backdropUrl = c.BackdropUrl,
            youtubeKey = c.YoutubeKey,
            trailerTitle = c.TrailerTitle,
            releaseDate = c.ReleaseDate,
            trailerPublishedAtUtc = c.TrailerPublishedAtUtc
        }).ToList(), jsonSerializerOptions);
    }

    private static async Task<IResult> HomeTrailersUpcomingCore(
        TrailersCuratedPriorityProvider curated, TmdbClient tmdb,
        JsonSerializerOptions jsonSerializerOptions, CancellationToken ct)
    {
        var rawPool = await TrailersFeedHelpers.BuildHomeUpcomingTrendingTrailersPoolAsync(tmdb, ct).ConfigureAwait(false);
        rawPool = TrailersFeedHelpers.FilterHomeTrailerPool(rawPool, strict: true);

        var curatedEntries = await curated.TryLoadAsync(ct).ConfigureAwait(false);
        var curatedKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var e in curatedEntries)
        {
            var mt = e.MediaType.Trim().ToLowerInvariant();
            if (mt is not ("movie" or "tv") || e.TmdbId <= 0)
                continue;
            var header = await tmdb.TryGetDiscoverItemAsync(e.TmdbId, mt, ct).ConfigureAwait(false);
            if (header == null || !TrailersFeedHelpers.IsStrictlyFutureReleaseDate(header.ReleaseDate))
                continue;
            curatedKeys.Add($"{mt}:{e.TmdbId}");
            rawPool.Add(header);
        }

        var merged = TrailersFeedHelpers.RankTrailerCandidatePool(rawPool, true, true, curatedKeys);
        var cards = await TrailersFeedHelpers.CollectHomeUpcomingTrailersAsync(tmdb, merged, 12, ct)
            .ConfigureAwait(false);
        return Results.Json(cards.Select(c => new
        {
            tmdbId = c.TmdbId,
            mediaType = c.MediaType,
            title = c.Title,
            posterUrl = c.PosterUrl,
            backdropUrl = c.BackdropUrl,
            youtubeKey = c.YoutubeKey,
            trailerTitle = c.TrailerTitle,
            releaseDate = c.ReleaseDate,
            trailerPublishedAtUtc = c.TrailerPublishedAtUtc
        }).ToList(), jsonSerializerOptions);
    }

    private static object TrailerApiModel(TrailerItem x) => new
    {
        videoId = x.VideoId,
        title = x.Title,
        channelName = x.ChannelName,
        channelId = x.ChannelId,
        ingestionSource = x.IngestionSource,
        matchConfidence = x.MatchConfidence,
        trustTier = x.TrustTier,
        tmdbId = x.TmdbId,
        mediaType = x.MediaType,
        publishedAt = x.PublishedAtUtc,
        qualityScore = x.QualityScore,
        isActive = x.IsActive,
        youtubeUrl = x.YoutubeUrl
    };

    private static string? TrailerYoutubeKey(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var m = Regex.Match(raw, @"(?:v=|youtu\.be/|embed/)([A-Za-z0-9_-]{11})");
        if (m.Success) return m.Groups[1].Value;
        if (Regex.IsMatch(raw, @"^[A-Za-z0-9_-]{11}$")) return raw;
        return null;
    }

    private static string? YoutubeEmbedUrl(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        if (raw.Contains("/embed/", StringComparison.Ordinal)) return raw;
        var vidMatch = Regex.Match(raw, @"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})");
        if (vidMatch.Success)
            return $"https://www.youtube.com/embed/{vidMatch.Groups[1].Value}?autoplay=1";
        if (Regex.IsMatch(raw, @"^[A-Za-z0-9_-]{11}$"))
            return $"https://www.youtube.com/embed/{raw}?autoplay=1";
        return null;
    }
}
