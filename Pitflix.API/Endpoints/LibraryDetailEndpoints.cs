using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitflix.API.Services;
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

        if (crew.Count == 0 && tmdb != null)
        {
            var details = await tmdb.GetDetailsAsync(movie.TmdbId, "Movie", ct).ConfigureAwait(false);
            crew = details.Crew;
        }

        var similarRows = await repo.FindLocalSimilarByGenresAsync(movie.Genres, 24,
                excludeMovieDatabaseId: movie.Id, excludeMovieTmdbId: movie.TmdbId, cancellationToken: ct)
            .ConfigureAwait(false);
        var similar = similarRows.Select(r => ImageUrls.MapMediaCard(ToMediaCardFromSimilar(r))).ToList();
        await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(similar, tmdb, ct).ConfigureAwait(false);
        var movieOut = ImageUrls.MapMovie(movie);
        if (string.IsNullOrEmpty(movieOut.PosterLocalPath) && string.IsNullOrEmpty(movieOut.SelectedPosterPath) &&
            tmdb != null)
        {
            var art = await tmdb.GetArtworkPathsAsync(movie.TmdbId, "Movie", ct).ConfigureAwait(false);
            if (art != null && !string.IsNullOrEmpty(art.Value.PosterPath))
                movieOut.PosterRemoteUrl = $"https://image.tmdb.org/t/p/w500{art.Value.PosterPath}";
        }

        var keywords = new List<object>();
        if (movie.TmdbId > 0 && tmdb != null)
        {
            if (string.IsNullOrEmpty(movie.KeywordsJson))
            {
                var kws = await tmdb.TryGetKeywordsWithNamesAsync(movie.TmdbId, "Movie", ct).ConfigureAwait(false);
                if (kws.Count > 0)
                {
                    var kwJson = JsonSerializer.Serialize(kws.Select(k => new { id = k.Id, name = k.Name }));
                    await db.Database.ExecuteSqlRawAsync(
                        $"UPDATE Movies SET KeywordsJson = {{0}} WHERE Id = {{1}}", kwJson, movie.Id)
                        .ConfigureAwait(false);
                    keywords = kws.Select(k => (object)new { id = k.Id, name = k.Name }).ToList();
                }
            }
            else
            {
                try
                {
                    var parsed = JsonSerializer.Deserialize<List<JsonElement>>(movie.KeywordsJson);
                    if (parsed != null)
                        keywords = parsed.Select(e => (object)new { id = e.GetProperty("id").GetInt32(), name = e.GetProperty("name").GetString() }).ToList();
                }
                catch { /* ignore malformed cache */ }
            }
        }

        var tmdbSimilar = new List<object>();
        if (movie.TmdbId > 0 && tmdb != null)
        {
            var tmdbSimilarRaw = await tmdb.GetMovieSimilarAsync(movie.TmdbId, 1, ct).ConfigureAwait(false);
            var localMovies = await db.Movies.AsNoTracking()
                .Where(m => m.IsMatched)
                .Select(m => new { m.Id, m.TmdbId, m.WatchStatus })
                .ToListAsync(ct).ConfigureAwait(false);
            var localMovieLookup = localMovies.ToDictionary(m => m.TmdbId);
            foreach (var s in tmdbSimilarRaw.Take(20))
            {
                localMovieLookup.TryGetValue(s.Id, out var libMovie);
                var inLibrary = libMovie != null;
                tmdbSimilar.Add(new
                {
                    tmdbId = s.Id,
                    title = s.Title,
                    posterUrl = string.IsNullOrEmpty(s.PosterPath) ? null : $"https://image.tmdb.org/t/p/w342{s.PosterPath}",
                    year = s.ReleaseDate?.Length >= 4 ? s.ReleaseDate[..4] : null,
                    voteAverage = s.VoteAverage,
                    mediaType = "Movie",
                    isInLibrary = inLibrary,
                    libraryId = libMovie?.Id,
                    watchStatus = libMovie?.WatchStatus,
                });
            }
        }

        object? collection = null;
        if (movie.TmdbId > 0 && tmdb != null)
        {
            var colInfo = await tmdb.TryGetMovieCollectionInfoAsync(movie.TmdbId, ct).ConfigureAwait(false);
            if (colInfo.HasValue)
                collection = new { id = colInfo.Value.CollectionId, name = colInfo.Value.CollectionName };
        }

        var contentRating = movie.ContentRating;
        if (contentRating == null && movie.TmdbId > 0 && tmdb != null)
        {
            contentRating = await tmdb.TryGetMovieCertificationAsync(movie.TmdbId, "US", ct).ConfigureAwait(false);
            if (contentRating != null)
                await db.Database.ExecuteSqlRawAsync(
                    "UPDATE Movies SET ContentRating = {0} WHERE Id = {1}", contentRating, movie.Id)
                    .ConfigureAwait(false);
        }

        var tvdbPayload = await tvdbTask.ConfigureAwait(false);

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
            contentRating,
            tvdbClearLogoUrl = tvdbPayload.ClearLogoUrl,
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

        if (crew.Count == 0 && tmdb != null)
        {
            var details = await tmdb.GetDetailsAsync(show.TmdbId, "Series", ct).ConfigureAwait(false);
            crew = details.Crew;
        }

        var eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
        eps = eps.Where(e => !string.IsNullOrWhiteSpace(e.FilePath) && File.Exists(e.FilePath)).ToList();

        if (tmdb != null && eps.Any(e => string.IsNullOrWhiteSpace(e.StillLocalPath)))
        {
            try
            {
                await repo.SyncEpisodesArtworkFromTmdbAsync(show.Id, show.TmdbId, tmdb, ct, maxImageDownloads: 60)
                    .ConfigureAwait(false);
                eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
                eps = eps.Where(e => !string.IsNullOrWhiteSpace(e.FilePath) && File.Exists(e.FilePath)).ToList();
            }
            catch
            {
                /* ignore */
            }
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

        foreach (var ep in eps)
            _ = ratings.WarmEpisodeImdbRatingAsync(show.TmdbId, ep.Season, ep.EpisodeNumber);

        var similarRows = await repo.FindLocalSimilarByGenresAsync(show.Genres, 24,
                excludeShowDatabaseId: show.Id, excludeShowTmdbId: show.TmdbId, cancellationToken: ct)
            .ConfigureAwait(false);
        var similar = similarRows.Select(r => ImageUrls.MapMediaCard(ToMediaCardFromSimilar(r))).ToList();
        await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(similar, tmdb, ct).ConfigureAwait(false);
        var showOut = ImageUrls.MapShow(show);
        if (string.IsNullOrEmpty(showOut.PosterLocalPath) && string.IsNullOrEmpty(showOut.SelectedPosterPath) &&
            tmdb != null)
        {
            var art = await tmdb.GetArtworkPathsAsync(show.TmdbId, "Series", ct).ConfigureAwait(false);
            if (art != null && !string.IsNullOrEmpty(art.Value.PosterPath))
                showOut.PosterRemoteUrl = $"https://image.tmdb.org/t/p/w500{art.Value.PosterPath}";
        }

        var keywords = new List<object>();
        if (show.TmdbId > 0 && tmdb != null)
        {
            if (string.IsNullOrEmpty(show.KeywordsJson))
            {
                var kws = await tmdb.TryGetKeywordsWithNamesAsync(show.TmdbId, "Series", ct).ConfigureAwait(false);
                if (kws.Count > 0)
                {
                    var kwJson = JsonSerializer.Serialize(kws.Select(k => new { id = k.Id, name = k.Name }));
                    await db.Database.ExecuteSqlRawAsync(
                        $"UPDATE Shows SET KeywordsJson = {{0}} WHERE Id = {{1}}", kwJson, show.Id)
                        .ConfigureAwait(false);
                    keywords = kws.Select(k => (object)new { id = k.Id, name = k.Name }).ToList();
                }
            }
            else
            {
                try
                {
                    var parsed = JsonSerializer.Deserialize<List<JsonElement>>(show.KeywordsJson);
                    if (parsed != null)
                        keywords = parsed.Select(e => (object)new { id = e.GetProperty("id").GetInt32(), name = e.GetProperty("name").GetString() }).ToList();
                }
                catch { /* ignore malformed cache */ }
            }
        }

        var tmdbSimilar = new List<object>();
        if (show.TmdbId > 0 && tmdb != null)
        {
            var tmdbSimilarRaw = await tmdb.GetTvSimilarAsync(show.TmdbId, 1, ct).ConfigureAwait(false);
            var localShows = await db.Shows.AsNoTracking()
                .Where(s => s.IsMatched)
                .Select(s => new { s.Id, s.TmdbId, s.WatchStatus })
                .ToListAsync(ct).ConfigureAwait(false);
            var localShowLookup = localShows.ToDictionary(s => s.TmdbId);
            foreach (var s in tmdbSimilarRaw.Take(20))
            {
                localShowLookup.TryGetValue(s.Id, out var libShow);
                var inLibrary = libShow != null;
                tmdbSimilar.Add(new
                {
                    tmdbId = s.Id,
                    title = s.Title,
                    posterUrl = string.IsNullOrEmpty(s.PosterPath) ? null : $"https://image.tmdb.org/t/p/w342{s.PosterPath}",
                    year = s.ReleaseDate?.Length >= 4 ? s.ReleaseDate[..4] : null,
                    voteAverage = s.VoteAverage,
                    mediaType = "Series",
                    isInLibrary = inLibrary,
                    libraryId = libShow?.Id,
                    watchStatus = libShow?.WatchStatus,
                });
            }
        }

        var contentRating = show.ContentRating;
        if (contentRating == null && show.TmdbId > 0 && tmdb != null)
        {
            contentRating = await tmdb.TryGetTvCertificationAsync(show.TmdbId, "US", ct).ConfigureAwait(false);
            if (contentRating != null)
                await db.Database.ExecuteSqlRawAsync(
                    "UPDATE Shows SET ContentRating = {0} WHERE Id = {1}", contentRating, show.Id)
                    .ConfigureAwait(false);
        }

        var tvdbPayload = await tvdbTask.ConfigureAwait(false);

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
            contentRating,
            tvdbClearLogoUrl = tvdbPayload.ClearLogoUrl,
            tvdbArtworks = tvdbPayload.Artworks,
        }, jsonSerializerOptions);
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
