using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitflix.API.Services;
using Pitflix.API.Services.Recommendations;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Endpoints;

public static class LibraryDetailEndpoints
{
    /// <summary>Legacy <c>CrewCacheJson</c> rows were written with Newtonsoft (PascalCase property names).</summary>
    private static readonly JsonSerializerOptions CrewCacheJsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>
    /// Swaps in a person's manually-picked photo (set on their own actor page) for any cast/crew row
    /// here that's the same person — otherwise a cast list is a snapshot taken at scan time and never
    /// reflects a later photo pick, even after a reload.
    /// </summary>
    private static async Task ApplyPersonPhotoOverridesAsync(LibraryRepository repo,
        IReadOnlyList<CastMember> cast, IReadOnlyList<TmdbCrewMember> crew, CancellationToken ct)
    {
        var ids = cast.Select(c => c.PersonTmdbId).Concat(crew.Select(c => c.Id));
        var overrides = await repo.GetPersonProfileOverridesAsync(ids, ct).ConfigureAwait(false);
        if (overrides.Count == 0)
            return;
        foreach (var c in cast)
            if (overrides.TryGetValue(c.PersonTmdbId, out var path))
                c.ProfileLocalPath = path;
        foreach (var c in crew)
            if (overrides.TryGetValue(c.Id, out var path))
                c.ProfileLocalPath = path;
    }

    public static void MapLibraryDetailEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/movies/{id:int}", async (int id, LibraryRepository repo, LibraryContext db,
            ITmdbClientFactory tmdbClientFactory, TvdbService tvdb, CancellationToken ct) =>
            await GetMovieDetailAsync(id, repo, db, tmdbClientFactory, tvdb, jsonSerializerOptions, ct)
                .ConfigureAwait(false));

        app.MapGet("/api/series/{id:int}", async (int id, LibraryRepository repo, LibraryContext db,
            ITmdbClientFactory tmdbClientFactory, TvdbService tvdb, RatingsAggregationService ratings,
            CancellationToken ct) =>
            await GetSeriesDetailAsync(id, repo, db, tmdbClientFactory, tvdb, ratings, jsonSerializerOptions, ct)
                .ConfigureAwait(false));
    }

    private static async Task<IResult> GetMovieDetailAsync(
        int id, LibraryRepository repo, LibraryContext db, ITmdbClientFactory tmdbClientFactory, TvdbService tvdb,
        JsonSerializerOptions jsonSerializerOptions, CancellationToken ct)
    {
        var movie = await repo.GetMovieByIdAsync(id, ct).ConfigureAwait(false);
        if (movie == null)
            return Results.NotFound();
        var tvdbTask = BuildTvdbDetailPayloadAsync(tvdb, movie.TmdbId, "movie", ct);
        var cast = await repo.GetCastMembersAsync(movie.TmdbId, "Movie", ct).ConfigureAwait(false);
        IReadOnlyList<TmdbCrewMember> crew = Array.Empty<TmdbCrewMember>();
        var tmdb = tmdbClientFactory.Create();
        if (!string.IsNullOrWhiteSpace(movie.CrewCacheJson))
        {
            try
            {
                var parsed = JsonSerializer.Deserialize<List<TmdbCrewMember>>(movie.CrewCacheJson,
                    CrewCacheJsonOptions);
                if (parsed is { Count: > 0 })
                    crew = parsed;
            }
            catch
            {
                /* use live fetch */
            }
        }

        // These are all independent TMDB lookups that don't touch the DbContext, so fire them
        // together instead of one `await` after another — on a cold (never-opened) row every one
        // of these caches is empty and used to stack into several seconds of sequential latency.
        var needCrew = crew.Count == 0 && tmdb != null;
        var needPoster = tmdb != null && string.IsNullOrEmpty(movie.PosterLocalPath) &&
            string.IsNullOrEmpty(movie.SelectedPosterPath);
        var needKeywords = movie.TmdbId > 0 && tmdb != null && string.IsNullOrEmpty(movie.KeywordsJson);
        var needCollection = movie.TmdbId > 0 && tmdb != null;
        var needContentRating = movie.ContentRating == null && movie.TmdbId > 0 && tmdb != null;

        async Task<TmdbDetails?> FetchMovieCrewAsync() =>
            needCrew ? await tmdb!.GetDetailsAsync(movie.TmdbId, "Movie", ct).ConfigureAwait(false) : null;
        var crewFetchTask = FetchMovieCrewAsync();
        var posterFetchTask = needPoster
            ? tmdb!.GetArtworkPathsAsync(movie.TmdbId, "Movie", ct)
            : Task.FromResult<(string PosterPath, string BackdropPath)?>(null);
        var keywordsFetchTask = needKeywords
            ? tmdb!.TryGetKeywordsWithNamesAsync(movie.TmdbId, "Movie", ct)
            : Task.FromResult<IReadOnlyList<(int Id, string Name)>>(Array.Empty<(int, string)>());
        var collectionFetchTask = needCollection
            ? tmdb!.TryGetMovieCollectionInfoAsync(movie.TmdbId, ct)
            : Task.FromResult<(int CollectionId, string CollectionName)?>(null);
        var contentRatingFetchTask = needContentRating
            ? tmdb!.TryGetMovieCertificationAsync(movie.TmdbId, "US", ct)
            : Task.FromResult<string?>(null);
        var companiesFetchTask = movie.TmdbId > 0 && tmdb != null
            ? tmdb.TryGetCompaniesAsync(movie.TmdbId, true, ct)
            : Task.FromResult<IReadOnlyList<TmdbCompanyInfo>>(Array.Empty<TmdbCompanyInfo>());

        await Task.WhenAll(crewFetchTask, posterFetchTask, keywordsFetchTask, collectionFetchTask,
            contentRatingFetchTask, companiesFetchTask).ConfigureAwait(false);

        if (needCrew)
            crew = crewFetchTask.Result!.Crew;

        // Everything from here on touches the shared request-scoped DbContext (via `db`/`repo`),
        // which isn't safe to hit concurrently — keep this part sequential.
        await ApplyPersonPhotoOverridesAsync(repo, cast, crew, ct).ConfigureAwait(false);

        var similarRows = await repo.FindLocalSimilarByGenresAsync(movie.Genres, 24,
                excludeMovieDatabaseId: movie.Id, excludeMovieTmdbId: movie.TmdbId, cancellationToken: ct)
            .ConfigureAwait(false);
        var similar = similarRows.Select(r => ImageUrls.MapMediaCard(ToMediaCardFromSimilar(r))).ToList();
        await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(similar, tmdb, ct, repo).ConfigureAwait(false);
        var movieOut = ImageUrls.MapMovie(movie);
        var art = posterFetchTask.Result;
        if (needPoster && art != null && !string.IsNullOrEmpty(art.Value.PosterPath))
            movieOut.PosterRemoteUrl = $"https://image.tmdb.org/t/p/w500{art.Value.PosterPath}";

        var keywords = new List<object>();
        if (needKeywords)
        {
            var kws = keywordsFetchTask.Result;
            if (kws.Count > 0)
            {
                var kwJson = JsonSerializer.Serialize(kws.Select(k => new { id = k.Id, name = k.Name }));
                await db.Database.ExecuteSqlRawAsync(
                    $"UPDATE Movies SET KeywordsJson = {{0}} WHERE Id = {{1}}", kwJson, movie.Id)
                    .ConfigureAwait(false);
                keywords = kws.Select(k => (object)new { id = k.Id, name = k.Name }).ToList();
            }
        }
        else if (!string.IsNullOrEmpty(movie.KeywordsJson))
        {
            try
            {
                var parsed = JsonSerializer.Deserialize<List<JsonElement>>(movie.KeywordsJson);
                if (parsed != null)
                    keywords = parsed.Select(e => (object)new { id = e.GetProperty("id").GetInt32(), name = e.GetProperty("name").GetString() }).ToList();
            }
            catch { /* ignore malformed cache */ }
        }

        var tmdbSimilar = new List<object>();
        if (movie.TmdbId > 0 && tmdb != null)
        {
            tmdbSimilar = await DetailRecommendationCacheService
                .GetOrBuildAsync(db, tmdb, repo, movie.TmdbId, "Movie", movie.Title, ct)
                .ConfigureAwait(false);
        }

        object? collection = null;
        var colInfo = collectionFetchTask.Result;
        if (needCollection && colInfo.HasValue)
            collection = new { id = colInfo.Value.CollectionId, name = colInfo.Value.CollectionName };

        var contentRating = movie.ContentRating;
        if (needContentRating)
        {
            contentRating = contentRatingFetchTask.Result;
            if (contentRating != null)
                await db.Database.ExecuteSqlRawAsync(
                    "UPDATE Movies SET ContentRating = {0} WHERE Id = {1}", contentRating, movie.Id)
                    .ConfigureAwait(false);
        }

        var tvdbPayload = await tvdbTask.ConfigureAwait(false);
        var logoOverride = await repo.GetSettingAsync($"ClearLogoOverride:Movie:{id}", ct).ConfigureAwait(false);
        var clearLogoUrl = !string.IsNullOrWhiteSpace(logoOverride)
            ? ImageUrls.ToImageUrl(logoOverride)
            : tvdbPayload.ClearLogoUrl;

        var companies = companiesFetchTask.Result
            .Select(c => new
            {
                id = c.Id,
                name = c.Name,
                logoUrl = string.IsNullOrEmpty(c.LogoPath) ? null : $"https://image.tmdb.org/t/p/w300{c.LogoPath}",
                kind = c.Kind,
            })
            .ToList();

        return Results.Json(new
        {
            movie = movieOut,
            cast = cast.Select(ImageUrls.MapCastMember).ToList(),
            crew = crew.Select(ImageUrls.MapCrewMember).ToList(),
            episodes = (object?)null,
            similar,
            tmdbSimilar,
            keywords,
            collection,
            companies,
            contentRating,
            tvdbClearLogoUrl = clearLogoUrl,
            tvdbArtworks = tvdbPayload.Artworks,
        }, jsonSerializerOptions);
    }

    private static async Task<IResult> GetSeriesDetailAsync(
        int id, LibraryRepository repo, LibraryContext db, ITmdbClientFactory tmdbClientFactory, TvdbService tvdb,
        RatingsAggregationService ratings, JsonSerializerOptions jsonSerializerOptions, CancellationToken ct)
    {
        var show = await repo.GetShowByIdAsync(id, ct).ConfigureAwait(false);
        if (show == null)
            return Results.NotFound();
        var tvdbTask = BuildTvdbDetailPayloadAsync(tvdb, show.TmdbId, "series", ct);
        var cast = await repo.GetCastMembersAsync(show.TmdbId, "Series", ct).ConfigureAwait(false);
        IReadOnlyList<TmdbCrewMember> crew = Array.Empty<TmdbCrewMember>();
        var tmdb = tmdbClientFactory.Create();
        if (!string.IsNullOrWhiteSpace(show.CrewCacheJson))
        {
            try
            {
                var parsed = JsonSerializer.Deserialize<List<TmdbCrewMember>>(show.CrewCacheJson,
                    CrewCacheJsonOptions);
                if (parsed is { Count: > 0 })
                    crew = parsed;
            }
            catch
            {
                /* use live fetch */
            }
        }

        // Shows scanned/cached before aggregate_credits-based crew was added never got a "Director"
        // row written to CrewCacheJson — that cache is otherwise non-empty (Producers, Creator,
        // etc.), so the `crew.Count == 0` check below alone would never catch it, permanently
        // hiding Directors/Writers for every already-cached show. Treat "cached but no director" as
        // stale too, and persist the refetched result so this only has to self-heal once per show.
        var cachedCrewMissingDirector = crew.Count > 0 && !crew.Any(c => c.Job.Equals("Director", StringComparison.OrdinalIgnoreCase));

        var needCrew = (crew.Count == 0 || cachedCrewMissingDirector) && tmdb != null;
        var needPoster = tmdb != null && string.IsNullOrEmpty(show.PosterLocalPath) &&
            string.IsNullOrEmpty(show.SelectedPosterPath);
        var needKeywords = show.TmdbId > 0 && tmdb != null && string.IsNullOrEmpty(show.KeywordsJson);
        var needContentRating = show.ContentRating == null && show.TmdbId > 0 && tmdb != null;

        var eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
        eps = eps.Where(e => !string.IsNullOrWhiteSpace(e.FilePath) && File.Exists(e.FilePath)).ToList();
        var needArtworkSync = tmdb != null && eps.Any(e => string.IsNullOrWhiteSpace(e.StillLocalPath));

        // Independent TMDB lookups (crew/poster/keywords/content-rating) touch only the network,
        // never the DbContext, so fire them together instead of one `await` after another — this
        // was the main source of "first open of something new is slow". The episode-artwork sync
        // does touch the DbContext (via `repo`), but only that one — it doesn't conflict with the
        // network-only lookups above, only with other repo/db calls, so it can still ride along.
        async Task<TmdbDetails?> FetchSeriesCrewAsync() =>
            needCrew ? await tmdb!.GetDetailsAsync(show.TmdbId, "Series", ct).ConfigureAwait(false) : null;
        var crewFetchTask = FetchSeriesCrewAsync();
        var posterFetchTask = needPoster
            ? tmdb!.GetArtworkPathsAsync(show.TmdbId, "Series", ct)
            : Task.FromResult<(string PosterPath, string BackdropPath)?>(null);
        var keywordsFetchTask = needKeywords
            ? tmdb!.TryGetKeywordsWithNamesAsync(show.TmdbId, "Series", ct)
            : Task.FromResult<IReadOnlyList<(int Id, string Name)>>(Array.Empty<(int, string)>());
        var contentRatingFetchTask = needContentRating
            ? tmdb!.TryGetTvCertificationAsync(show.TmdbId, "US", ct)
            : Task.FromResult<string?>(null);
        var artworkSyncTask = needArtworkSync
            ? SafeSyncEpisodesArtworkAsync(repo, show.Id, show.TmdbId, tmdb!, ct)
            : Task.CompletedTask;
        var companiesFetchTask = show.TmdbId > 0 && tmdb != null
            ? tmdb.TryGetCompaniesAsync(show.TmdbId, false, ct)
            : Task.FromResult<IReadOnlyList<TmdbCompanyInfo>>(Array.Empty<TmdbCompanyInfo>());

        await Task.WhenAll(crewFetchTask, posterFetchTask, keywordsFetchTask, contentRatingFetchTask,
            artworkSyncTask, companiesFetchTask).ConfigureAwait(false);

        if (needCrew)
        {
            var details = crewFetchTask.Result!;
            crew = details.Crew;
            if (details.Crew.Count > 0)
            {
                var refreshedJson = Newtonsoft.Json.JsonConvert.SerializeObject(details.Crew);
                await db.Database.ExecuteSqlRawAsync("UPDATE Shows SET CrewCacheJson = {0} WHERE Id = {1}",
                    refreshedJson, show.Id).ConfigureAwait(false);
            }
        }

        await ApplyPersonPhotoOverridesAsync(repo, cast, crew, ct).ConfigureAwait(false);

        if (needArtworkSync)
        {
            eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
            eps = eps.Where(e => !string.IsNullOrWhiteSpace(e.FilePath) && File.Exists(e.FilePath)).ToList();
        }

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
        string? EpStill(Episode e) => ImageUrls.ToImageUrl(e.StillLocalPath);
        var episodesGrouped = eps.GroupBy(e => e.Season).OrderBy(g => g.Key)
            .Select(g => new
            {
                season = g.Key,
                episodes = g.OrderBy(e => e.EpisodeNumber).Select(e => new
                {
                    e.Id,
                    e.Season,
                    episodeNumber = e.EpisodeNumber,
                    e.Title,
                    e.FilePath,
                    e.SubtitlePath,
                    e.WatchStatus,
                    e.RewatchCount,
                    stillLocalPath = EpStill(e),
                }).ToList(),
            }).ToList();

        var localSeasonNums = new HashSet<int>(episodesGrouped.Select(g => g.season));
        var seasonRows = new List<(int SeasonNumber, object Row)>();

        if (tmdb != null && episodesGrouped.Count > 0)
        {
            var localHeaders = await Task.WhenAll(episodesGrouped.Select(async g =>
            {
                var sn = g.season;
                var header = await tmdb.TryGetTvSeasonHeaderAsync(show.TmdbId, sn, ct).ConfigureAwait(false);
                var name = string.IsNullOrWhiteSpace(header?.Name)
                    ? (sn == 0 ? "Specials" : $"Season {sn}")
                    : header!.Value.Name;
                var pp = header?.PosterPath;
                var imdbSeason = await ratings.TryGetCachedSeasonImdbRatingAsync(show.TmdbId, sn, ct)
                    .ConfigureAwait(false);
                return (sn, Row: (object)new
                {
                    seasonNumber = sn,
                    name,
                    posterPath = pp,
                    posterUrl = string.IsNullOrWhiteSpace(pp)
                        ? null
                        : $"https://image.tmdb.org/t/p/w500{pp}",
                    airDate = header?.AirDate,
                    episodeCount = g.episodes.Count,
                    tmdbEpisodeCount = header?.EpisodeCount ?? 0,
                    voteAverage = header?.VoteAverage,
                    imdbVoteAverage = imdbSeason,
                    inLibrary = true,
                });
            })).ConfigureAwait(false);
            seasonRows.AddRange(localHeaders);
        }

        if (tmdb != null && show.TmdbId > 0)
        {
            var tmdbSeasonTotal = await tmdb.TryGetTvNumberOfSeasonsAsync(show.TmdbId, ct).ConfigureAwait(false);
            if (tmdbSeasonTotal is > 0)
            {
                var missingSeasons = Enumerable.Range(1, tmdbSeasonTotal.Value)
                    .Where(sn => !localSeasonNums.Contains(sn))
                    .ToList();
                var missingHeaders = await Task.WhenAll(missingSeasons.Select(async sn =>
                {
                    var header = await tmdb.TryGetTvSeasonHeaderAsync(show.TmdbId, sn, ct).ConfigureAwait(false);
                    var name = string.IsNullOrWhiteSpace(header?.Name)
                        ? $"Season {sn}"
                        : header!.Value.Name;
                    var pp = header?.PosterPath;
                    var imdbSeason = await ratings.TryGetCachedSeasonImdbRatingAsync(show.TmdbId, sn, ct)
                        .ConfigureAwait(false);
                    return (sn, Row: (object)new
                    {
                        seasonNumber = sn,
                        name,
                        posterPath = pp,
                        posterUrl = string.IsNullOrWhiteSpace(pp)
                            ? null
                            : $"https://image.tmdb.org/t/p/w500{pp}",
                        airDate = header?.AirDate,
                        episodeCount = 0,
                        tmdbEpisodeCount = header?.EpisodeCount ?? 0,
                        voteAverage = header?.VoteAverage,
                        imdbVoteAverage = imdbSeason,
                        inLibrary = false,
                    });
                })).ConfigureAwait(false);
                seasonRows.AddRange(missingHeaders);
            }
        }

        seasonRows.Sort((a, b) => a.SeasonNumber.CompareTo(b.SeasonNumber));
        var seasonsSummary = seasonRows.Select(r => r.Row).ToList();

        foreach (var seasonGroup in eps.GroupBy(e => e.Season))
            _ = ratings.WarmShowEpisodeRatingsAsync(show.TmdbId, seasonGroup.Key,
                seasonGroup.Select(e => e.EpisodeNumber).ToList());

        var similarRows = await repo.FindLocalSimilarByGenresAsync(show.Genres, 24,
                excludeShowDatabaseId: show.Id, excludeShowTmdbId: show.TmdbId, cancellationToken: ct)
            .ConfigureAwait(false);
        var similar = similarRows.Select(r => ImageUrls.MapMediaCard(ToMediaCardFromSimilar(r))).ToList();
        await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(similar, tmdb, ct, repo).ConfigureAwait(false);
        var showOut = ImageUrls.MapShow(show);
        var showArt = posterFetchTask.Result;
        if (needPoster && showArt != null && !string.IsNullOrEmpty(showArt.Value.PosterPath))
            showOut.PosterRemoteUrl = $"https://image.tmdb.org/t/p/w500{showArt.Value.PosterPath}";

        var keywords = new List<object>();
        if (needKeywords)
        {
            var kws = keywordsFetchTask.Result;
            if (kws.Count > 0)
            {
                var kwJson = JsonSerializer.Serialize(kws.Select(k => new { id = k.Id, name = k.Name }));
                await db.Database.ExecuteSqlRawAsync(
                    $"UPDATE Shows SET KeywordsJson = {{0}} WHERE Id = {{1}}", kwJson, show.Id)
                    .ConfigureAwait(false);
                keywords = kws.Select(k => (object)new { id = k.Id, name = k.Name }).ToList();
            }
        }
        else if (!string.IsNullOrEmpty(show.KeywordsJson))
        {
            try
            {
                var parsed = JsonSerializer.Deserialize<List<JsonElement>>(show.KeywordsJson);
                if (parsed != null)
                    keywords = parsed.Select(e => (object)new { id = e.GetProperty("id").GetInt32(), name = e.GetProperty("name").GetString() }).ToList();
            }
            catch { /* ignore malformed cache */ }
        }

        var tmdbSimilar = new List<object>();
        if (show.TmdbId > 0 && tmdb != null)
        {
            tmdbSimilar = await DetailRecommendationCacheService
                .GetOrBuildAsync(db, tmdb, repo, show.TmdbId, "Series", show.Title, ct)
                .ConfigureAwait(false);
        }

        var contentRating = show.ContentRating;
        if (needContentRating)
        {
            contentRating = contentRatingFetchTask.Result;
            if (contentRating != null)
                await db.Database.ExecuteSqlRawAsync(
                    "UPDATE Shows SET ContentRating = {0} WHERE Id = {1}", contentRating, show.Id)
                    .ConfigureAwait(false);
        }

        var tvdbPayload = await tvdbTask.ConfigureAwait(false);
        var logoOverride = await repo.GetSettingAsync($"ClearLogoOverride:Series:{id}", ct).ConfigureAwait(false);
        var clearLogoUrl = !string.IsNullOrWhiteSpace(logoOverride)
            ? ImageUrls.ToImageUrl(logoOverride)
            : tvdbPayload.ClearLogoUrl;

        var companies = companiesFetchTask.Result
            .Select(c => new
            {
                id = c.Id,
                name = c.Name,
                logoUrl = string.IsNullOrEmpty(c.LogoPath) ? null : $"https://image.tmdb.org/t/p/w300{c.LogoPath}",
                kind = c.Kind,
            })
            .ToList();

        return Results.Json(new
        {
            show = showOut,
            isDropped = show.IsDropped,
            cast = cast.Select(ImageUrls.MapCastMember).ToList(),
            crew = crew.Select(ImageUrls.MapCrewMember).ToList(),
            episodes = episodesGrouped,
            seasonsSummary,
            nextEpisode,
            similar,
            tmdbSimilar,
            keywords,
            companies,
            contentRating,
            tvdbClearLogoUrl = clearLogoUrl,
            tvdbArtworks = tvdbPayload.Artworks,
        }, jsonSerializerOptions);
    }

    private static async Task SafeSyncEpisodesArtworkAsync(LibraryRepository repo, int showId, int showTmdbId,
        TmdbClient tmdb, CancellationToken ct)
    {
        try
        {
            await repo.SyncEpisodesArtworkFromTmdbAsync(showId, showTmdbId, tmdb, ct, maxImageDownloads: 60)
                .ConfigureAwait(false);
        }
        catch
        {
            /* ignore — episode list still renders without stills */
        }
    }

    private static async Task<(string? ClearLogoUrl, object[]? Artworks)> BuildTvdbDetailPayloadAsync(
        TvdbService tvdb, int tmdbId, string mediaType, CancellationToken ct)
    {
        if (tmdbId <= 0) return (null, null);
        try
        {
            var artworks = await tvdb.GetArtworksAsync(tmdbId, mediaType, ct).ConfigureAwait(false);
            if (artworks is null) return (null, null);
            var mapped = artworks.Select(a => new
            {
                url = a.Url,
                thumbnail = a.Thumbnail,
                type = a.Type,
                score = a.Score,
                width = a.Width,
                height = a.Height,
            }).ToArray();
            return (TvdbService.PickClearLogoUrl(artworks), mapped.Length > 0 ? mapped : null);
        }
        catch
        {
            return (null, null);
        }
    }

    private static MediaCardDto ToMediaCardFromSimilar(LocalSimilarRow r) =>
        new()
        {
            Id = r.DatabaseId,
            TmdbId = r.TmdbId,
            Title = r.Title,
            Year = r.Year,
            VoteAverage = 0,
            PosterLocalPath = r.PosterLocalPath,
            IsArabic = false,
            WatchStatus = r.WatchStatus ?? "",
            DateAdded = default,
            GenresCsv = null,
            Overview = null,
            MediaFilePath = null,
            TmdbMediaType = string.Equals(r.MediaKind, "Series", StringComparison.OrdinalIgnoreCase)
                ? "Series"
                : "Movie"
        };
}
