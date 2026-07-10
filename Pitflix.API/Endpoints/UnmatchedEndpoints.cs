using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Pitflix.API.Services;
using Pitflix.Core.Database;
using Pitflix.Core.Models;
using Pitflix.Core.Parser;
using Pitflix.Core.Scanner;

namespace Pitflix.API.Endpoints;

public static class UnmatchedEndpoints
{
    public static void MapUnmatchedEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/unmatched", async (
            LibraryRepository repo,
            int page = 1,
            int pageSize = 30,
            string? search = null,
            string type = "all",
            string? sortBy = "date",
            string? sortDir = "desc",
            CancellationToken ct = default) =>
        {
            var shelf = type.ToLowerInvariant() switch
            {
                "movie" => "Movies",
                "series" => "Series",
                _ => (string?)null
            };
            var result = await repo.GetUnmatchedPageAsync(search, shelf, page, pageSize, sortBy, sortDir, ct).ConfigureAwait(false);
            var dtos = result.Items.Select(ScanLogMapper.ToScanLogDto).ToList();
            return Results.Json(new
            {
                items = dtos,
                total = result.TotalItems,
                totalPages = MediaCatalogHelpers.TotalPages(result.TotalItems, pageSize),
                currentPage = page
            }, jsonSerializerOptions);
        });

        app.MapPost("/api/unmatched/clear-all", async (LibraryRepository repo, CancellationToken ct) =>
        {
            var removed = await repo.DeleteUnmatchedScanLogsAsync(ct).ConfigureAwait(false);
            return Results.Json(new { success = true, removed }, jsonSerializerOptions);
        });

        app.MapPost("/api/unmatched/{id:int}/match", async (
            int id,
            MatchBody body,
            LibraryRepository repo,
            LibraryContext db,
            RatingsRefreshQueue ratingsRefreshQueue,
            ITmdbClientFactory tmdbClientFactory,
            CancellationToken ct) =>
        {
            var logs = await repo.GetAllScanLogsAsync(ct).ConfigureAwait(false);
            var log = logs.FirstOrDefault(l => l.Id == id && l.Status == "Unmatched");
            if (log == null)
                return Results.Json(new { success = false, matchedTitle = (string?)null, siblingsFound = 0, siblingIds = Array.Empty<int>(), parentFolder = (string?)null }, jsonSerializerOptions);

            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(new { success = false, matchedTitle = (string?)null, siblingsFound = 0, siblingIds = Array.Empty<int>(), parentFolder = (string?)null }, jsonSerializerOptions);

            var mediaTypeResolved = string.IsNullOrWhiteSpace(body.MediaType) ? "Movie" : body.MediaType!;
            var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
            var ok = await pipeline.MatchFileWithTmdbAsync(log.FilePath, body.TmdbId, mediaTypeResolved, ct)
                .ConfigureAwait(false);
            if (!ok)
                return Results.Json(new { success = false, matchedTitle = (string?)null, siblingsFound = 0, siblingIds = Array.Empty<int>(), parentFolder = (string?)null }, jsonSerializerOptions);

            var after = await db.ScanLogs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct).ConfigureAwait(false);
            var matchedTitle = after?.MatchedTitle ?? body.TmdbId.ToString();

            var siblingIds = new List<int>();
            string? parentFolder = null;
            var inferredMt = FileScanner.InferMediaType(log.FilePath);
            var treatAsSeries = string.Equals(mediaTypeResolved, "Series", StringComparison.OrdinalIgnoreCase) ||
                                string.Equals(inferredMt, "Series", StringComparison.OrdinalIgnoreCase);
            if (treatAsSeries)
            {
                var showRoot = NameParser.GetSeriesShowRootFullPath(log.FilePath);
                parentFolder = showRoot;
                if (!string.IsNullOrEmpty(showRoot))
                {
                    var candidates = await db.ScanLogs.AsNoTracking()
                        .Where(s => s.Status == "Unmatched" && s.Id != id)
                        .Select(s => new { s.Id, s.FilePath })
                        .ToListAsync(ct)
                        .ConfigureAwait(false);
                    foreach (var s in candidates)
                    {
                        var otherRoot = NameParser.GetSeriesShowRootFullPath(s.FilePath);
                        if (otherRoot != null && string.Equals(otherRoot, showRoot, StringComparison.OrdinalIgnoreCase))
                            siblingIds.Add(s.Id);
                    }
                }
            }

            app.Logger.LogInformation(
                "Match complete (scanLogId={ScanLogId}). Siblings found: {SiblingCount}, parentFolder={ParentFolder}",
                id, siblingIds.Count, parentFolder);

            ratingsRefreshQueue.TryEnqueueSingle(body.TmdbId, mediaTypeResolved);
            return Results.Json(new
            {
                success = true,
                matchedTitle,
                siblingsFound = siblingIds.Count,
                siblingIds = siblingIds.ToList(),
                parentFolder
            }, jsonSerializerOptions);
        });

        app.MapPost("/api/unmatched/bulk-match", async (BulkMatchBody body, LibraryRepository repo, LibraryContext db, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var ids = body.Ids ?? Array.Empty<int>();
            if (ids.Length == 0)
                return Results.Json(new { success = true, matched = 0 }, jsonSerializerOptions);

            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.BadRequest(new { error = "TMDB not configured." });

            var mt = string.IsNullOrWhiteSpace(body.MediaType) ? "Series" : body.MediaType!;
            var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
            var matched = 0;
            foreach (var sibId in ids)
            {
                var slog = await db.ScanLogs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == sibId && x.Status == "Unmatched", ct)
                    .ConfigureAwait(false);
                if (slog == null)
                    continue;

                if (await pipeline.MatchFileWithTmdbAsync(slog.FilePath, body.TmdbId, mt, ct).ConfigureAwait(false))
                    matched++;
            }

            return Results.Json(new { success = true, matched }, jsonSerializerOptions);
        });

        app.MapGet("/api/unmatched/smart-scan/status", (SmartMatchRuntime sm) =>
        {
            var last = sm.LastSummary;
            return Results.Json(new
            {
                isRunning = sm.IsRunning,
                current = sm.Current,
                total = sm.Total,
                currentLabel = sm.CurrentLabel,
                lastResult = last == null
                    ? null
                    : new
                    {
                        processed = last.Processed,
                        autoMatched = last.AutoMatched,
                        stillUnmatched = last.StillUnmatched,
                        timeTakenSeconds = last.TimeTakenSeconds
                    }
            }, jsonSerializerOptions);
        });

        app.MapPost("/api/unmatched/smart-scan/cancel", (SmartMatchRuntime sm) =>
        {
            sm.Cancel();
            return Results.Json(new { success = true }, jsonSerializerOptions);
        });

        app.MapPost("/api/unmatched/smart-scan", (SmartMatchRuntime sm, IServiceScopeFactory scopes, ITmdbClientFactory tmdbClientFactory) =>
        {
            if (sm.IsRunning)
                return Results.Conflict(new { error = "Smart auto-match already running." });

            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.BadRequest(new { error = "TMDB API key not configured." });

            sm.BeginJob();
            var token = sm.Token;
            var logger = app.Logger;

            _ = Task.Run(async () =>
            {
                var sw = Stopwatch.StartNew();
                var processed = 0;
                var autoMatched = 0;
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
                    var db = scope.ServiceProvider.GetRequiredService<LibraryContext>();
                    var snapshot = await repo.GetUnmatchedFilesAsync(token).ConfigureAwait(false);
                    sm.SetTotal(snapshot.Count);

                    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);

                    foreach (var log in snapshot)
                    {
                        token.ThrowIfCancellationRequested();
                        sm.Update(processed + 1, log.CleanName);

                        var fresh = await db.ScanLogs.AsNoTracking()
                            .FirstOrDefaultAsync(x => x.Id == log.Id, token).ConfigureAwait(false);
                        if (fresh == null || !string.Equals(fresh.Status, "Unmatched", StringComparison.Ordinal))
                        {
                            processed++;
                            continue;
                        }

                        var parsed = NameParser.Parse(fresh.FilePath);
                        var mediaType = string.IsNullOrEmpty(parsed.MediaType)
                            ? FileScanner.InferMediaType(fresh.FilePath)
                            : parsed.MediaType;
                        if (mediaType != "Movie" && mediaType != "Series")
                        {
                            processed++;
                            continue;
                        }

                        List<TmdbSearchResult> searchResults;
                        try
                        {
                            searchResults = await tmdb.SearchAsync(parsed.CleanName, mediaType, parsed.IsArabic, token)
                                .ConfigureAwait(false);
                        }
                        catch
                        {
                            processed++;
                            continue;
                        }

                        if (!ScanPipeline.TrySmartBulkAutoMatch(parsed, searchResults, out var pick))
                        {
                            processed++;
                            continue;
                        }

                        if (!await pipeline.MatchFileWithTmdbAsync(fresh.FilePath, pick.Id, mediaType, token)
                                .ConfigureAwait(false))
                        {
                            processed++;
                            continue;
                        }

                        autoMatched++;

                        var treatAsSeries = string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase) ||
                                            string.Equals(FileScanner.InferMediaType(fresh.FilePath), "Series",
                                                StringComparison.OrdinalIgnoreCase);
                        if (treatAsSeries)
                        {
                            var showRoot = NameParser.GetSeriesShowRootFullPath(fresh.FilePath);
                            if (!string.IsNullOrEmpty(showRoot))
                            {
                                var candidates = await db.ScanLogs.AsNoTracking()
                                    .Where(s => s.Status == "Unmatched" && s.Id != fresh.Id)
                                    .Select(s => new { s.Id, s.FilePath })
                                    .ToListAsync(token).ConfigureAwait(false);

                                foreach (var c in candidates)
                                {
                                    token.ThrowIfCancellationRequested();
                                    var otherRoot = NameParser.GetSeriesShowRootFullPath(c.FilePath);
                                    if (otherRoot == null ||
                                        !string.Equals(otherRoot, showRoot, StringComparison.OrdinalIgnoreCase))
                                        continue;

                                    var sLog = await db.ScanLogs.AsNoTracking()
                                        .FirstOrDefaultAsync(x => x.Id == c.Id, token).ConfigureAwait(false);
                                    if (sLog == null || !string.Equals(sLog.Status, "Unmatched", StringComparison.Ordinal))
                                        continue;

                                    if (await pipeline.MatchFileWithTmdbAsync(sLog.FilePath, pick.Id, mediaType, token)
                                            .ConfigureAwait(false))
                                        autoMatched++;
                                }
                            }
                        }

                        processed++;
                    }
                }
                catch (OperationCanceledException)
                {
                    /* cancelled */
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Smart auto-match failed after {Processed} processed, {AutoMatched} matched", processed, autoMatched);
                }
                finally
                {
                    try
                    {
                        await using var scope = scopes.CreateAsyncScope();
                        var db = scope.ServiceProvider.GetRequiredService<LibraryContext>();
                        var still = await db.ScanLogs.CountAsync(x => x.Status == "Unmatched", CancellationToken.None)
                            .ConfigureAwait(false);
                        sm.Complete(new SmartScanSummary(processed, autoMatched, still, sw.Elapsed.TotalSeconds));
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex, "Smart auto-match finalize failed after {Processed} processed, {AutoMatched} matched", processed, autoMatched);
                        sm.Complete(new SmartScanSummary(processed, autoMatched, 0, sw.Elapsed.TotalSeconds));
                    }
                }
            }, token);

            return Results.Json(new { started = true }, jsonSerializerOptions);
        });

        app.MapPost("/api/unmatched/{id:int}/skip", async (int id, LibraryRepository repo, CancellationToken ct) =>
        {
            await repo.UpdateScanLogStatusAsync(id, "Skipped", null, null, ct).ConfigureAwait(false);
            return Results.Json(new { success = true });
        });

        app.MapPost("/api/unmatched/search", async (UnmatchedSearchBody body, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(Array.Empty<object>(), jsonSerializerOptions);
            var q = (body.Query ?? "").Trim();
            if (q.Length < 2)
                return Results.Json(Array.Empty<object>(), jsonSerializerOptions);
            var qFallback = Regex.Replace(q, @"[._\-]+", " ");
            qFallback = Regex.Replace(qFallback, @"\s+", " ").Trim();
            if (qFallback.Length >= 4)
                qFallback = Regex.Replace(qFallback, @"\b(19\d{2}|20\d{2})\b", "").Trim();
            var mtRaw = string.IsNullOrWhiteSpace(body.MediaType) ? "Movie" : body.MediaType!;
            var hasArabic = q.Any(c => c >= '؀' && c <= 'ۿ');
            List<(TmdbSearchResult Result, string Media)> combined;

            if (mtRaw.Equals("Both", StringComparison.OrdinalIgnoreCase))
            {
                var movies = await tmdb.SearchAsync(q, "Movie", hasArabic, ct, 12, body.Year).ConfigureAwait(false);
                var series = await tmdb.SearchAsync(q, "Series", hasArabic, ct, 12, body.Year).ConfigureAwait(false);
                if ((movies.Count + series.Count) < 6 && !string.Equals(qFallback, q, StringComparison.Ordinal))
                {
                    var movies2 = await tmdb.SearchAsync(qFallback, "Movie", hasArabic, ct, 12, body.Year).ConfigureAwait(false);
                    var series2 = await tmdb.SearchAsync(qFallback, "Series", hasArabic, ct, 12, body.Year).ConfigureAwait(false);
                    movies = movies.Concat(movies2).ToList();
                    series = series.Concat(series2).ToList();
                }

                combined = movies.Select(r => (Result: r, Media: "Movie"))
                    .Concat(series.Select(r => (Result: r, Media: "Series")))
                    .OrderByDescending(x => x.Result.Popularity)
                    .Take(20)
                    .ToList();
            }
            else
            {
                var list = await tmdb.SearchAsync(q, mtRaw, hasArabic, ct, 14, body.Year).ConfigureAwait(false);
                if (list.Count < 7 && !string.Equals(qFallback, q, StringComparison.Ordinal))
                {
                    var fallback = await tmdb.SearchAsync(qFallback, mtRaw, hasArabic, ct, 14, body.Year).ConfigureAwait(false);
                    list = list.Concat(fallback).ToList();
                }
                combined = list.Select(r => (Result: r, Media: mtRaw)).ToList();
            }

            var payload = combined.Select(pair =>
            {
                var r = pair.Result;
                var mt = pair.Media;
                var overview = r.Overview ?? "";
                var overviewShort = overview.Length > 150 ? overview[..150] : overview;
                return new
                {
                    id = r.Id,
                    title = r.Title,
                    year = r.ReleaseDate.Length >= 4 ? r.ReleaseDate[..4] : (string?)null,
                    overview = string.IsNullOrEmpty(overviewShort) ? null : overviewShort,
                    posterUrl = string.IsNullOrEmpty(r.PosterPath)
                        ? null
                        : $"https://image.tmdb.org/t/p/w92{r.PosterPath}",
                    mediaType = mt,
                    voteAverage = r.VoteAverage
                };
            }).ToList();
            return Results.Json(payload, jsonSerializerOptions);
        });
    }
}
