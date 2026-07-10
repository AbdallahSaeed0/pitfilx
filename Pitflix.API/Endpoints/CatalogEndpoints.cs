using System.Text.Json;
using Pitflix.API.Services;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Endpoints;

public static class CatalogEndpoints
{
    public static void MapCatalogEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        // —— Movies ——
        app.MapGet("/api/movies", async (
            LibraryRepository repo,
            LibraryContext db,
            ITmdbClientFactory tmdbClientFactory,
            int page = 1,
            int pageSize = 40,
            string lang = "en",
            string? search = null,
            string? genre = null,
            string sort = "title",
            string watch = "all",
            double? minImdbRating = null,
            CancellationToken ct = default) =>
        {
            var isArabic = string.Equals(lang, "ar", StringComparison.OrdinalIgnoreCase);
            var (items, total) = await MediaCatalogHelpers.QueryMediaCardsAsync(db, repo, isMovie: true, isArabic, search, genre, watch, sort, page, pageSize, ct, minImdbRating)
                .ConfigureAwait(false);
            var tmdb = tmdbClientFactory.Create();
            return Results.Json(await MediaCatalogHelpers.MakePageAsync(items, total, page, pageSize, tmdb, ct).ConfigureAwait(false), jsonSerializerOptions);
        });

        // —— Series ——
        app.MapGet("/api/series", async (
            LibraryRepository repo,
            LibraryContext db,
            ITmdbClientFactory tmdbClientFactory,
            int page = 1,
            int pageSize = 40,
            string lang = "en",
            string? search = null,
            string? genre = null,
            string sort = "title",
            string watch = "all",
            double? minImdbRating = null,
            CancellationToken ct = default) =>
        {
            var isArabic = string.Equals(lang, "ar", StringComparison.OrdinalIgnoreCase);
            var (items, total) = await MediaCatalogHelpers.QueryMediaCardsAsync(db, repo, isMovie: false, isArabic, search, genre, watch, sort, page, pageSize, ct, minImdbRating)
                .ConfigureAwait(false);
            var tmdb = tmdbClientFactory.Create();
            return Results.Json(await MediaCatalogHelpers.MakePageAsync(items, total, page, pageSize, tmdb, ct).ConfigureAwait(false), jsonSerializerOptions);
        });

        // —— Video extras (featurettes, behind-the-scenes, clips) ——
        app.MapGet("/api/movies/{id:int}/videos", async (int id, LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var movie = await repo.GetMovieByIdAsync(id, ct).ConfigureAwait(false);
            if (movie == null || movie.TmdbId <= 0) return Results.NotFound();
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null) return Results.Json(new { videos = Array.Empty<object>(), offline = true }, jsonSerializerOptions);
            try
            {
                var videos = await tmdb.GetMediaExtrasAsync(movie.TmdbId, "Movie", ct).ConfigureAwait(false);
                return Results.Json(new
                {
                    videos = videos.Select(v => new { v.Key, v.Name, v.Type, v.Site, v.ThumbnailUrl }).ToList(),
                    offline = false,
                }, jsonSerializerOptions);
            }
            catch
            {
                // TMDB unreachable — return empty list so the UI degrades gracefully.
                return Results.Json(new { videos = Array.Empty<object>(), offline = true }, jsonSerializerOptions);
            }
        });

        app.MapGet("/api/series/{id:int}/videos", async (int id, LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var show = await repo.GetShowByIdAsync(id, ct).ConfigureAwait(false);
            if (show == null || show.TmdbId <= 0) return Results.NotFound();
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null) return Results.Json(new { videos = Array.Empty<object>(), offline = true }, jsonSerializerOptions);
            try
            {
                var videos = await tmdb.GetMediaExtrasAsync(show.TmdbId, "Series", ct).ConfigureAwait(false);
                return Results.Json(new
                {
                    videos = videos.Select(v => new { v.Key, v.Name, v.Type, v.Site, v.ThumbnailUrl }).ToList(),
                    offline = false,
                }, jsonSerializerOptions);
            }
            catch
            {
                // TMDB unreachable — return empty list so the UI degrades gracefully.
                return Results.Json(new { videos = Array.Empty<object>(), offline = true }, jsonSerializerOptions);
            }
        });

        app.MapGet("/api/series/{id:int}/season/{season:int}", async (
            int id,
            int season,
            LibraryRepository repo,
            RatingsAggregationService ratings,
            ITmdbClientFactory tmdbClientFactory,
            CancellationToken ct) =>
        {
            var show = await repo.GetShowByIdAsync(id, ct).ConfigureAwait(false);
            if (show == null)
                return Results.NotFound();

            var eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
            eps = eps.Where(e => !string.IsNullOrWhiteSpace(e.FilePath) && File.Exists(e.FilePath)).ToList();
            var inSeason = eps.Where(e => e.Season == season).OrderBy(e => e.EpisodeNumber).ToList();
            var tmdb = tmdbClientFactory.Create();

            IReadOnlyDictionary<int, (string? Name, string? StillPath, double? VoteAverage, string? Overview, string? AirDate, int? Runtime)>? tmdbMap = null;
            if (tmdb != null)
            {
                try
                {
                    tmdbMap = await tmdb.TryGetTvSeasonEpisodesAsync(show.TmdbId, season, ct).ConfigureAwait(false);
                }
                catch
                {
                    tmdbMap = null;
                }
            }

            string? EpStill(Episode e) => ImageUrls.ToImageUrl(e.StillLocalPath);
            var todayStr = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
            static bool IsEpisodeAired(string? airDate, string today) =>
                !string.IsNullOrWhiteSpace(airDate) &&
                string.Compare(airDate.Trim(), today, StringComparison.Ordinal) <= 0;

            var localByNumber = inSeason.ToDictionary(e => e.EpisodeNumber);
            var durationByPath = await repo.GetMaxFileDurationSecondsByPathsAsync(
                inSeason.Select(e => e.FilePath), ct).ConfigureAwait(false);
            var virtuallyWatched = await repo.GetVirtuallyWatchedEpisodeNumbersAsync(show.TmdbId, season, ct)
                .ConfigureAwait(false);
            var allEpisodeNumbers = new SortedSet<int>(localByNumber.Keys);
            if (tmdbMap != null)
            {
                foreach (var n in tmdbMap.Keys)
                    allEpisodeNumbers.Add(n);
            }

            // IMDb ratings are cache-only here so the page renders immediately — MDBList enforces a
            // hard 1-request/sec rate limit, so live-fetching N episodes would block the response for
            // N+ seconds. Anything not yet cached is backfilled in the background for next visit.
            var episodeRows = allEpisodeNumbers.Count == 0
                ? Array.Empty<object>()
                : await Task.WhenAll(allEpisodeNumbers.Select(async epNum =>
            {
                localByNumber.TryGetValue(epNum, out var localEp);
                var inLibrary = localEp != null;
                string? airDate = null;
                string? overview = null;
                double? tvVote = null;
                string? tmdbTitle = null;
                string? stillUrl = null;
                int? runtimeMinutes = null;
                if (tmdbMap != null && tmdbMap.TryGetValue(epNum, out var meta))
                {
                    airDate = meta.AirDate;
                    overview = meta.Overview;
                    if (meta.VoteAverage is > 0) tvVote = meta.VoteAverage;
                    tmdbTitle = meta.Name;
                    if (!string.IsNullOrWhiteSpace(meta.StillPath))
                        stillUrl = $"https://image.tmdb.org/t/p/w300{meta.StillPath}";
                    if (meta.Runtime is > 0) runtimeMinutes = meta.Runtime;
                }

                if (localEp != null && !string.IsNullOrWhiteSpace(localEp.FilePath)
                    && durationByPath.TryGetValue(localEp.FilePath, out var fileSeconds) && fileSeconds > 0)
                {
                    runtimeMinutes = (int)Math.Round(fileSeconds / 60.0, MidpointRounding.AwayFromZero);
                }

                var isAired = inLibrary || IsEpisodeAired(airDate, todayStr);
                double? imdbVote = await ratings.TryGetCachedEpisodeImdbRatingAsync(show.TmdbId, season, epNum, ct)
                    .ConfigureAwait(false);
                // No library row, but marked watched via unified history (e.g. "Mark watched" without
                // downloading) — surface it the same as a completed library episode.
                var watchStatus = localEp?.WatchStatus ??
                    (virtuallyWatched.Contains(epNum) ? WatchStatuses.Completed : null);
                return (object)new
                {
                    id = localEp?.Id,
                    season,
                    episodeNumber = epNum,
                    title = !string.IsNullOrWhiteSpace(localEp?.Title) ? localEp!.Title : tmdbTitle,
                    overview,
                    filePath = localEp?.FilePath,
                    subtitlePath = localEp?.SubtitlePath,
                    watchStatus,
                    stillLocalPath = localEp != null ? EpStill(localEp) : null,
                    stillUrl,
                    tmdbVoteAverage = tvVote,
                    imdbVoteAverage = imdbVote,
                    airDate,
                    inLibrary,
                    isAired,
                    runtimeMinutes,
                };
            })).ConfigureAwait(false);

            foreach (var epNum in allEpisodeNumbers)
                _ = ratings.WarmEpisodeImdbRatingAsync(show.TmdbId, season, epNum);

            (string Name, string? PosterPath, string? AirDate, int EpisodeCount, double? VoteAverage)? header = null;
            if (tmdb != null)
            {
                try
                {
                    header = await tmdb.TryGetTvSeasonHeaderAsync(show.TmdbId, season, ct).ConfigureAwait(false);
                }
                catch
                {
                    header = null;
                }
            }

            var seasonName = string.IsNullOrWhiteSpace(header?.Name)
                ? (season == 0 ? "Specials" : $"Season {season}")
                : header!.Value.Name;
            var pp = header?.PosterPath;
            var nextEp = LibraryRepository.GetNextEpisodeForShow(eps);
            object? nextEpisode = nextEp == null
                ? null
                : new
                {
                    id = nextEp.Id,
                    season = nextEp.Season,
                    episodeNumber = nextEp.EpisodeNumber,
                    title = nextEp.Title ?? "",
                    filePath = nextEp.FilePath
                };

            return Results.Json(new
            {
                show = ImageUrls.MapShow(show),
                season,
                seasonName,
                posterUrl = string.IsNullOrWhiteSpace(pp) ? null : $"https://image.tmdb.org/t/p/w500{pp}",
                airDate = header?.AirDate,
                episodeCount = inSeason.Count,
                tmdbEpisodeCount = header?.EpisodeCount ?? 0,
                episodes = episodeRows,
                nextEpisode
            }, jsonSerializerOptions);
        });

        // Show-level credits reflect the show's overall crew (often "Executive Producer" for the
        // showrunner even when they directed this particular episode) — this fetches the real
        // per-episode director + guest cast from TMDB's episode credits endpoint.
        app.MapGet("/api/series/{id:int}/season/{season:int}/episode/{episode:int}/credits", async (
            int id,
            int season,
            int episode,
            LibraryRepository repo,
            ITmdbClientFactory tmdbClientFactory,
            CancellationToken ct) =>
        {
            var show = await repo.GetShowByIdAsync(id, ct).ConfigureAwait(false);
            if (show == null)
                return Results.NotFound();

            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(new { cast = Array.Empty<object>(), crew = Array.Empty<object>() }, jsonSerializerOptions);

            var credits = await tmdb.TryGetTvEpisodeCreditsAsync(show.TmdbId, season, episode, ct).ConfigureAwait(false);
            if (credits == null)
                return Results.Json(new { cast = Array.Empty<object>(), crew = Array.Empty<object>() }, jsonSerializerOptions);

            var cast = credits.Value.Cast.Select(c => new CastMember
            {
                Id = 0,
                PersonTmdbId = c.Id,
                MediaId = show.Id,
                MediaType = "Series",
                Name = c.Name,
                Character = c.Character,
                ProfilePath = c.ProfilePath,
                BillingOrder = c.BillingOrder,
            }).Select(ImageUrls.MapCastMember).ToList();
            var crew = credits.Value.Crew.Select(ImageUrls.MapCrewMember).ToList();

            return Results.Json(new { cast, crew }, jsonSerializerOptions);
        });

        app.MapPost("/api/movies/{id:int}/watch", async (int id, MediaWatchStatusBody body, LibraryRepository repo, CancellationToken ct) =>
        {
            var status = body.WatchStatus ?? "";
            if (!WatchStatuses.IsValid(status))
                return Results.BadRequest(new { error = "Invalid watch status." });
            await repo.UpdateMovieWatchStatusAsync(id, status, ct).ConfigureAwait(false);
            return Results.Json(new { success = true }, jsonSerializerOptions);
        });

        app.MapPost("/api/series/{id:int}/watch", async (int id, MediaWatchStatusBody body, LibraryRepository repo, CancellationToken ct) =>
        {
            var status = body.WatchStatus ?? "";
            if (!WatchStatuses.IsValid(status))
                return Results.BadRequest(new { error = "Invalid watch status." });
            await repo.UpdateShowWatchStatusAsync(id, status, ct).ConfigureAwait(false);
            return Results.Json(new { success = true }, jsonSerializerOptions);
        });

        app.MapPost("/api/cast/refresh", async (HttpRequest http, LibraryRepository repo, ILoggerFactory logFactory,
                ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);
            var lim = int.TryParse(http.Query["limit"], out var l) ? Math.Clamp(l, 1, 100) : 25;
            var afterM = int.TryParse(http.Query["afterMovieId"], out var am) ? am : 0;
            var afterS = int.TryParse(http.Query["afterShowId"], out var ash) ? ash : 0;
            var r = await repo.BackfillCastMetadataBatchAsync(tmdb, lim, afterM, afterS, ct).ConfigureAwait(false);
            var log = logFactory.CreateLogger("CastBackfill");
            log.LogInformation(
                "Cast backfill batch: movies={Movies} shows={Shows} castRows={Rows} missingProfile={Missing} failed={Failed} nextMovie={NextM} nextShow={NextS} hasMore={More}",
                r.MoviesProcessed, r.ShowsProcessed, r.CastRowsWritten, r.CastCreditsMissingProfileImage, r.FailedTitles,
                r.NextAfterMovieLibraryIdExclusive, r.NextAfterShowLibraryIdExclusive, r.HasMore);
            return Results.Json(new
            {
                success = true,
                r.MoviesProcessed,
                r.ShowsProcessed,
                r.CastRowsWritten,
                r.CastCreditsMissingProfileImage,
                r.FailedTitles,
                nextAfterMovieId = r.NextAfterMovieLibraryIdExclusive,
                nextAfterShowId = r.NextAfterShowLibraryIdExclusive,
                r.HasMore
            }, jsonSerializerOptions);
        });

        app.MapGet("/api/series/{id:int}/episodes", async (int id, LibraryRepository repo, CancellationToken ct) =>
        {
            var show = await repo.GetShowByIdAsync(id, ct).ConfigureAwait(false);
            if (show == null)
                return Results.NotFound();
            var eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
            var grouped = eps.GroupBy(e => e.Season).OrderBy(g => g.Key)
                .Select(g => new { season = g.Key, episodes = g.OrderBy(e => e.EpisodeNumber).ToList() }).ToList();
            return Results.Json(grouped, jsonSerializerOptions);
        });
    }
}

internal sealed record MediaWatchStatusBody(string? WatchStatus);
