using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitflix.API.Dtos;
using Pitflix.API.Services;
using Pitflix.Core.Database;

namespace Pitflix.API.Endpoints;

public static class RatingsEndpoints
{
    public static void MapRatingsEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/ratings/queue/status", async (RatingsRefreshQueue queue, RatingsSnapshotRepository repo,
                CancellationToken ct) =>
        {
            var coverage = await repo.GetCoverageStatsAsync(ct).ConfigureAwait(false);
            var depth = queue.QueueDepth;
            var active = queue.IsProcessing || depth > 0;
            return Results.Json(new
            {
                ok = true,
                active,
                queueDepth = depth,
                isProcessing = queue.IsProcessing,
                processedTotal = queue.ProcessedTotal,
                lastProcessedUtc = queue.LastProcessedUtc,
                lastError = queue.LastError,
                coverage = new
                {
                    total = coverage.Total,
                    withImdb = coverage.WithImdb,
                    withRottenTomatoes = coverage.WithRottenTomatoes,
                    tmdbOnly = coverage.TmdbOnly,
                    hasImdbIdButNoImdbScore = coverage.HasImdbIdButNoImdbScore,
                }
            }, jsonSerializerOptions);
        });

        app.MapGet("/api/ratings/{tmdbId:int}", async (
            int tmdbId,
            string? mediaType,
            RatingsPersistedReadService read,
            CancellationToken ct) =>
        {
            if (tmdbId <= 0)
                return Results.BadRequest();
            var mt = string.IsNullOrWhiteSpace(mediaType) ? "movie" : mediaType.Trim();
            var normalized = mt.Equals("tv", StringComparison.OrdinalIgnoreCase) ? "Series" : "Movie";
            var r = await read.GetPersistedReadAsync(tmdbId, normalized, ct).ConfigureAwait(false);
            if (!r.Ok)
            {
                var status = r.FailureReason switch
                {
                    "invalid_input" => StatusCodes.Status400BadRequest,
                    "anchor_not_found" => StatusCodes.Status404NotFound,
                    _ => StatusCodes.Status503ServiceUnavailable
                };
                return Results.Json(new { ok = false, reason = r.FailureReason }, jsonSerializerOptions, statusCode: status);
            }

            var s = r.Row!.Snapshot;
            return Results.Json(new
            {
                ok = true,
                seeded = r.Row.WasSeeded,
                isStale = r.Row.IsStale,
                tmdbId = s.TmdbId,
                mediaType = normalized == "Series" ? "tv" : "movie",
                tmdbRating = s.TmdbRating,
                tmdbVoteCount = s.TmdbVoteCount,
                imdbId = s.ImdbId,
                imdbRating = s.ImdbRating,
                imdbVotes = s.ImdbVotes,
                rtCritics = s.RottenTomatoesCritics,
                rtAudience = s.RottenTomatoesAudience,
                confidence = s.RatingsConfidence,
                sourceMask = s.SourceMask,
                refreshTier = s.RefreshTier,
                updated = s.RatingsLastUpdatedAtUtc,
                nextRefresh = s.NextRefreshAtUtc
            }, jsonSerializerOptions);
        });

        app.MapGet("/api/ratings/aggregate", async (
            RatingsAggregationService svc,
            RatingsPersistedReadService persisted,
            int tmdbId,
            string mediaType,
            CancellationToken ct) =>
        {
            if (tmdbId <= 0)
                return Results.BadRequest();
            var normalized = mediaType.Equals("tv", StringComparison.OrdinalIgnoreCase) ? "Series" : "Movie";
            var pr = await persisted.GetPersistedReadAsync(tmdbId, normalized, ct).ConfigureAwait(false);
            if (pr.Ok && pr.Row != null)
            {
                var dto = RatingsPersistedReadService.ToAggregateDto(pr.Row.Snapshot, pr.Row.WasSeeded, pr.Row.IsStale);
                return Results.Json(dto, jsonSerializerOptions);
            }

            var live = await svc.GetAggregateAsync(tmdbId, normalized, ct).ConfigureAwait(false);
            return Results.Json(live, jsonSerializerOptions);
        });

        app.MapGet("/api/ratings/episode", async (
            RatingsAggregationService svc,
            int tvTmdbId,
            int season,
            int episodeNumber,
            CancellationToken ct) =>
        {
            var r = await svc.TryEpisodeRatingAsync(tvTmdbId, season, episodeNumber, ct).ConfigureAwait(false);
            return Results.Json(r, jsonSerializerOptions);
        });

        app.MapPost("/api/ratings/re-enrich", async (HttpRequest req, RatingsRefreshQueue queue, IConfiguration cfg,
                CancellationToken ct) =>
        {
            var expected = cfg["Pitflix:Ratings:ManualReEnrichKey"]?.Trim();
            var requireAuth = cfg.GetValue<bool>("Pitflix:Ratings:RequireManualReEnrichAuth");

            if (!string.IsNullOrEmpty(expected))
            {
                if (!req.Headers.TryGetValue("X-Pitflix-Ratings-ReEnrich-Key", out var key) ||
                    !string.Equals(key.ToString(), expected, StringComparison.Ordinal))
                {
                    if (requireAuth)
                        return Results.Unauthorized();
                }
            }

            var body = await req.ReadFromJsonAsync<RatingsReEnrichBody>(cancellationToken: ct).ConfigureAwait(false);
            if (body?.TmdbId is int tid and > 0)
            {
                queue.TryEnqueueSingle(tid, body.MediaType);
                return Results.Json(new { ok = true, queued = "single" }, jsonSerializerOptions);
            }

            queue.TryEnqueueStaleSweep();
            return Results.Json(new { ok = true, queued = "stale_sweep" }, jsonSerializerOptions);
        });

        app.MapPost("/api/ratings/queue-library", async (HttpRequest req, LibraryRepository lib, RatingsRefreshQueue queue,
                IConfiguration cfg, int? limit, CancellationToken ct) =>
        {
            var expected = cfg["Pitflix:Ratings:ManualReEnrichKey"]?.Trim();
            var requireAuth = cfg.GetValue<bool>("Pitflix:Ratings:RequireManualReEnrichAuth");

            if (!string.IsNullOrEmpty(expected))
            {
                if (!req.Headers.TryGetValue("X-Pitflix-Ratings-ReEnrich-Key", out var key) ||
                    !string.Equals(key.ToString(), expected, StringComparison.Ordinal))
                {
                    if (requireAuth)
                        return Results.Unauthorized();
                }
            }

            var cap = Math.Clamp(limit ?? 500, 1, 5000);
            var movieCap = cap / 2;
            var showCap = cap - movieCap;
            var (movieIds, showIds) = await lib.GetDistinctMatchedTmdbIdsForRatingsAsync(movieCap, showCap, ct)
                .ConfigureAwait(false);
            var accepted = 0;
            foreach (var id in movieIds)
            {
                if (queue.TryEnqueueSingle(id, "movie"))
                    accepted++;
            }

            foreach (var id in showIds)
            {
                if (queue.TryEnqueueSingle(id, "tv"))
                    accepted++;
            }

            return Results.Json(new
            {
                ok = true,
                accepted,
                movies = movieIds.Count,
                shows = showIds.Count,
                cap
            }, jsonSerializerOptions);
        });

        app.MapGet("/api/ratings/mdblist", async (string? imdbId, int? tmdbId, MdbListService mdbList, CancellationToken ct) =>
        {
            var id = imdbId?.Trim();
            if (string.IsNullOrEmpty(id) && (tmdbId is null or <= 0))
                return Results.BadRequest();

            var ratings = await mdbList.GetRatingsAsync(
                string.IsNullOrWhiteSpace(id) ? null : id,
                tmdbId,
                ct).ConfigureAwait(false);
            if (ratings is null)
                return Results.NotFound();

            return Results.Json(new
            {
                imdbScore             = ratings.ImdbScore,
                imdbVotes             = ratings.ImdbVotes,
                rottenTomatoesScore   = ratings.RottenTomatoesScore,
                rottenTomatoesAudience = ratings.RottenTomatoesAudience,
                metacriticScore       = ratings.MetacriticScore,
                letterboxdScore       = ratings.LetterboxdScore,
                traktScore            = ratings.TraktScore,
                rogerEbertScore       = ratings.RogerEbertScore,
            }, jsonSerializerOptions);
        });

        app.MapGet("/api/ratings/batch-cached", async (string? ids, bool? queueMissing, LibraryContext db,
                RatingsRefreshQueue queue, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(ids))
                return Results.Json(new { results = Array.Empty<object>() }, jsonSerializerOptions);

            var parsed = ids.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Take(200)
                .Select(s =>
                {
                    var sep = s.IndexOf(':');
                    if (sep <= 0 || sep == s.Length - 1) return ((string?)null, 0);
                    var type = s[..sep].Trim().ToLowerInvariant();
                    return int.TryParse(s[(sep + 1)..], out var id) && id > 0 ? (type, id) : ((string?)null, 0);
                })
                .Where(x => x.Item1 != null && x.Item2 > 0)
                .ToList();

            if (parsed.Count == 0)
                return Results.Json(new { results = Array.Empty<object>() }, jsonSerializerOptions);

            var tmdbIds = parsed.Select(x => x.Item2).Distinct().ToList();

            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);

            var snapshots = new Dictionary<string, (double? tmdb, string? imdb, string? rt, string? rtAud)>(StringComparer.OrdinalIgnoreCase);
            using (var cmd = conn.CreateCommand())
            {
                var placeholders = string.Join(",", Enumerable.Range(0, tmdbIds.Count).Select(i => $"@id{i}"));
                cmd.CommandText = $"""
                    SELECT TmdbId, MediaType, TmdbRating, ImdbRating, RottenTomatoesCritics, RottenTomatoesAudience
                    FROM RatingsSnapshots WHERE TmdbId IN ({placeholders})
                    """;
                for (int i = 0; i < tmdbIds.Count; i++)
                {
                    var p = cmd.CreateParameter(); p.ParameterName = $"@id{i}"; p.Value = tmdbIds[i];
                    cmd.Parameters.Add(p);
                }
                using var rdr = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
                while (await rdr.ReadAsync(ct).ConfigureAwait(false))
                {
                    var tid = rdr.GetInt32(0);
                    var mt  = rdr.IsDBNull(1) ? "movie" : rdr.GetString(1).ToLowerInvariant();
                    var key = $"{(mt is "series" or "tv" ? "tv" : "movie")}:{tid}";
                    snapshots[key] = (
                        rdr.IsDBNull(2) ? null : rdr.GetDouble(2),
                        rdr.IsDBNull(3) ? null : rdr.GetString(3),
                        rdr.IsDBNull(4) ? null : rdr.GetString(4),
                        rdr.IsDBNull(5) ? null : rdr.GetString(5));
                }
            }

            var mdbByTmdbId = new Dictionary<int, (float? mc, float? lb, float? trakt, float? imdb, float? rt, float? rtAud)>();
            using (var cmd = conn.CreateCommand())
            {
                var placeholders = string.Join(",", Enumerable.Range(0, tmdbIds.Count).Select(i => $"@id{i}"));
                cmd.CommandText = $"SELECT TmdbId, RatingsJson FROM MdbListRatingsCache WHERE TmdbId IN ({placeholders})";
                for (int i = 0; i < tmdbIds.Count; i++)
                {
                    var p = cmd.CreateParameter(); p.ParameterName = $"@id{i}"; p.Value = tmdbIds[i];
                    cmd.Parameters.Add(p);
                }
                using var rdr = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
                while (await rdr.ReadAsync(ct).ConfigureAwait(false))
                {
                    if (rdr.IsDBNull(0) || rdr.IsDBNull(1)) continue;
                    var tid  = rdr.GetInt32(0);
                    var json = rdr.GetString(1);
                    try
                    {
                        var m = JsonSerializer.Deserialize<MdbListRatings>(json, jsonSerializerOptions);
                        if (m != null)
                            mdbByTmdbId[tid] = (m.MetacriticScore, m.LetterboxdScore, m.TraktScore,
                                                m.ImdbScore, m.RottenTomatoesScore, m.RottenTomatoesAudience);
                    }
                    catch { }
                }
            }

            var results = parsed.Select(x =>
            {
                var key = $"{x.Item1}:{x.Item2}";
                snapshots.TryGetValue(key, out var snap);
                mdbByTmdbId.TryGetValue(x.Item2, out var mdb);
                var imdb = snap.imdb ?? (mdb.imdb.HasValue ? $"{mdb.imdb:F1}" : null);
                if (queueMissing == true && string.IsNullOrWhiteSpace(imdb))
                {
                    var mt = x.Item1 is "tv" or "series" ? "tv" : "movie";
                    queue.TryEnqueueSingle(x.Item2, mt);
                }
                return new
                {
                    key,
                    tmdbRating    = snap.tmdb,
                    imdbRating    = imdb,
                    rtCritics     = snap.rt   ?? (mdb.rt.HasValue   ? $"{(int)mdb.rt.Value}%" : null),
                    rtAudience    = snap.rtAud ?? (mdb.rtAud.HasValue ? $"{(int)mdb.rtAud.Value}%" : null),
                    metacritic    = mdb.mc.HasValue    ? (int?)mdb.mc.Value    : null,
                    letterboxd    = mdb.lb.HasValue    ? (float?)mdb.lb.Value  : null,
                    trakt         = mdb.trakt.HasValue ? (float?)mdb.trakt.Value : null,
                };
            }).ToList();

            return Results.Json(new { results }, jsonSerializerOptions);
        });
    }
}
