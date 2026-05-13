using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Pitflix.API;
using Pitflix.API.Dtos;
using Pitflix.API.Services;
using Pitflix.API.Services.Awards;
using Pitflix.API.Services.Trailers;
using Pitflix.Core.Api;
using Pitflix.Core.Config;
using Pitflix.Core.Database;
using Pitflix.Core.Migrations;
using Pitflix.Core.Models;
using Pitflix.Core.Parser;
using Pitflix.Core.Scanner;
using Pitflix.Core.Services;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddJsonFile("appsettings.local.json", optional: true, reloadOnChange: true);

// Single loopback URL avoids duplicate binds; override if 5001 is busy:
//   $env:PITFLIX_LISTEN_URLS='http://127.0.0.1:5002'; dotnet run
//   dotnet run --launch-profile http-alt
var listenRaw = Environment.GetEnvironmentVariable("PITFLIX_LISTEN_URLS")?.Trim()
    ?? Environment.GetEnvironmentVariable("ASPNETCORE_URLS")?.Trim()
    ?? builder.Configuration["Pitflix:ListenUrls"]?.Trim()
    ?? "http://127.0.0.1:5001";
var listenAddresses = listenRaw.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
if (listenAddresses.Length == 0)
    listenAddresses = new[] { "http://127.0.0.1:5001" };
builder.WebHost.UseUrls(listenAddresses);

var publicBaseConfigured = builder.Configuration["Pitflix:PublicBaseUrl"]?.Trim();
var publicBase = !string.IsNullOrEmpty(publicBaseConfigured)
    ? publicBaseConfigured.TrimEnd('/')
    : listenAddresses[0].TrimEnd('/');

builder.Services.AddCors(options =>
{
    options.AddPolicy("TauriPolicy", policy =>
        policy
            .WithOrigins(
                "http://localhost:1420",
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:4173",
                "http://127.0.0.1:4173",
                "http://localhost:3000",
                "http://127.0.0.1:3000",
                "tauri://localhost",
                "http://tauri.localhost",
                "https://tauri.localhost")
            .AllowAnyMethod()
            .AllowAnyHeader()
            .WithExposedHeaders("Content-Type"));
});

builder.Services.AddDbContext<LibraryContext>(options =>
{
    var dir = Path.GetDirectoryName(LibraryPaths.DatabaseFilePath);
    if (!string.IsNullOrEmpty(dir))
        Directory.CreateDirectory(dir);
    options.UseSqlite(LibraryPaths.DatabaseConnectionString);
});
builder.Services.AddScoped<LibraryRepository>();
builder.Services.AddScoped<TrailersRepository>();
builder.Services.AddScoped<RatingsSnapshotRepository>();
builder.Services.AddSingleton<ScanRuntime>();
builder.Services.AddSingleton<SmartMatchRuntime>();
builder.Services.AddHostedService<LibraryAutoScanService>();
builder.Services.AddHostedService<PinnedFolderScanService>();
builder.Services.AddHostedService<TrailerIngestionHostedService>();
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient();
builder.Services.AddHttpClient(nameof(OmdbRatingClient));
builder.Services.AddTransient<OmdbRatingClient>();
builder.Services.AddSingleton<PhpImdbGrabberClient>();
builder.Services.AddSingleton<RatingsAggregationService>();
builder.Services.AddScoped<RatingsEnrichmentService>();
builder.Services.AddScoped<RatingsPersistedReadService>();
builder.Services.AddSingleton<RatingsRefreshQueue>();
builder.Services.AddHostedService<RatingsRefreshHostedService>();
builder.Services.AddSingleton<IAwardsDataProvider, FileAwardsDataProvider>();
builder.Services.AddScoped<AwardNomineeCacheRepository>();
builder.Services.AddSingleton<AwardsService>();
builder.Services.AddSingleton<AwardsCachePreloadCoordinator>();
builder.Services.AddSingleton<TrailersCuratedPriorityProvider>();
builder.Services.AddSingleton<OfficialTrailersChannelProvider>();
builder.Services.AddSingleton<TrailerMonitorRuntime>();
builder.Services.AddScoped<TrailerIngestionService>();

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<LibraryContext>();
    db.Database.EnsureCreated();
    var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
    await repo.EnsureLibraryFoldersTableAsync();
    await repo.EnsureSelectedImageColumnsAsync();
    await repo.EnsureEpisodeStillLocalPathColumnAsync();
    await repo.EnsureWatchHistoryResumeColumnsAsync();
    await repo.EnsureWatchStatusColumnsAsync();
    await repo.EnsureUserListTablesAndSeedAsync();
    await repo.EnsureCastMemberPersonTmdbIdColumnAsync();
    await repo.EnsureCastMemberProfilePathAndBillingOrderColumnsAsync();
    await repo.EnsureCrewCacheJsonColumnsAsync();
    await AddMetadataRefreshedAtMigration.RunIfNeededAsync(repo);
    var trailersRepo = scope.ServiceProvider.GetRequiredService<TrailersRepository>();
    await trailersRepo.EnsureTrailersTableAsync();
    await trailersRepo.EnsureTrailerChannelSyncStatesTableAsync();
    var ratingsSnapshotRepo = scope.ServiceProvider.GetRequiredService<RatingsSnapshotRepository>();
    await ratingsSnapshotRepo.EnsureRatingsSnapshotsTableAsync();
    var awardNomineeCacheRepo = scope.ServiceProvider.GetRequiredService<AwardNomineeCacheRepository>();
    await awardNomineeCacheRepo.EnsureTableAsync(CancellationToken.None).ConfigureAwait(false);
    AppSettings.ResolveTmdbApiKeyFromSources(repo);
    AppSettings.ResolveOpenSubtitlesFromSources(repo);

    var setupFlag = await repo.GetSettingAsync("SetupComplete", CancellationToken.None).ConfigureAwait(false);
    if (string.IsNullOrEmpty(setupFlag))
    {
        var tmdbDb = await repo.GetSettingAsync("TmdbApiKey", CancellationToken.None).ConfigureAwait(false);
        var paths = await repo.GetAllLibraryPathsAsync(CancellationToken.None).ConfigureAwait(false);
        var tmdbEffective = AppSettings.IsValidTmdbKey(tmdbDb)
            ? tmdbDb
            : AppSettings.TryLoadTmdbApiKeyFromLocalFile();
        if (AppSettings.IsValidTmdbKey(tmdbEffective) || paths.Count > 0)
            await repo.SaveSettingAsync("SetupComplete", "true", CancellationToken.None).ConfigureAwait(false);
    }
}

ImageUrls.PublicBase = publicBase;

var imagesPath = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
    "Pitflix", "Images");
Directory.CreateDirectory(imagesPath);

// 1) CORS first
app.UseCors("TauriPolicy");

// 2) Manual /images GET — serves files directly (bypasses static-file quirks).
app.Use(async (context, next) =>
{
    if (!HttpMethods.IsGet(context.Request.Method))
    {
        await next().ConfigureAwait(false);
        return;
    }

    var path = context.Request.Path;
    if (!path.HasValue ||
        !path.StartsWithSegments("/images", StringComparison.OrdinalIgnoreCase, out var remainder))
    {
        await next().ConfigureAwait(false);
        return;
    }

    var relative = Uri.UnescapeDataString(remainder.Value!.TrimStart('/')).Replace('/', Path.DirectorySeparatorChar);
    if (string.IsNullOrEmpty(relative) || relative.Contains("..", StringComparison.Ordinal))
    {
        await next().ConfigureAwait(false);
        return;
    }

    var root = Path.GetFullPath(imagesPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
    var fullPath = Path.GetFullPath(Path.Combine(root, relative));
    var rootWithSep = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
    if (!fullPath.Equals(root, StringComparison.OrdinalIgnoreCase) &&
        !fullPath.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase))
    {
        await next().ConfigureAwait(false);
        return;
    }

    if (!File.Exists(fullPath))
    {
        await next().ConfigureAwait(false);
        return;
    }

    context.Response.Headers["Access-Control-Allow-Origin"] = "*";
    context.Response.Headers["Cache-Control"] = "public,max-age=86400";
    context.Response.ContentType = ImageContentTypeForExtension(fullPath);
    await context.Response.SendFileAsync(fullPath).ConfigureAwait(false);
});

// 3) Static files (backup) — same physical root, /images request path
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(imagesPath),
    RequestPath = "/images",
    ServeUnknownFileTypes = true,
    DefaultContentType = "image/jpeg",
    OnPrepareResponse = ctx =>
    {
        ctx.Context.Response.Headers["Access-Control-Allow-Origin"] = "*";
        ctx.Context.Response.Headers["Cache-Control"] = "public,max-age=86400";
    }
});

// Do not call UseRouting() here: WebApplication wires routing + endpoints for MapGet/MapPost
// automatically. An extra UseRouting() breaks endpoint execution and yields 404 for all API routes.

var jsonSerializerOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);

// —— Movies ——
app.MapGet("/api/movies", async (
    LibraryRepository repo,
    LibraryContext db,
    int page = 1,
    int pageSize = 40,
    string lang = "en",
    string? search = null,
    string? genre = null,
    string sort = "title",
    string watch = "all",
    CancellationToken ct = default) =>
{
    var isArabic = string.Equals(lang, "ar", StringComparison.OrdinalIgnoreCase);
    var (items, total) = await QueryMediaCardsAsync(db, repo, isMovie: true, isArabic, search, genre, watch, sort, page, pageSize, ct)
        .ConfigureAwait(false);
    var tmdb = TmdbClientFactory.Create();
    return Results.Json(await MakePageAsync(items, total, page, pageSize, tmdb, ct).ConfigureAwait(false), jsonSerializerOptions);
});

app.MapGet("/api/movies/{id:int}", async (int id, LibraryRepository repo, LibraryContext db, CancellationToken ct) =>
{
    var movie = await repo.GetMovieByIdAsync(id, ct).ConfigureAwait(false);
    if (movie == null)
        return Results.NotFound();
    var cast = await repo.GetCastMembersAsync(movie.TmdbId, "Movie", ct).ConfigureAwait(false);
    IReadOnlyList<TmdbCrewMember> crew = Array.Empty<TmdbCrewMember>();
    var tmdb = TmdbClientFactory.Create();
    if (!string.IsNullOrWhiteSpace(movie.CrewCacheJson))
    {
        try
        {
            var parsed = Newtonsoft.Json.JsonConvert.DeserializeObject<List<TmdbCrewMember>>(movie.CrewCacheJson);
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

    return Results.Json(new
    {
        movie = movieOut,
        cast = cast.Select(ImageUrls.MapCastMember).ToList(),
        crew = crew.Select(ImageUrls.MapCrewMember).ToList(),
        episodes = (object?)null,
        similar
    }, jsonSerializerOptions);
});

// —— Series ——
app.MapGet("/api/series", async (
    LibraryRepository repo,
    LibraryContext db,
    int page = 1,
    int pageSize = 40,
    string lang = "en",
    string? search = null,
    string? genre = null,
    string sort = "title",
    string watch = "all",
    CancellationToken ct = default) =>
{
    var isArabic = string.Equals(lang, "ar", StringComparison.OrdinalIgnoreCase);
    var (items, total) = await QueryMediaCardsAsync(db, repo, isMovie: false, isArabic, search, genre, watch, sort, page, pageSize, ct)
        .ConfigureAwait(false);
    var tmdb = TmdbClientFactory.Create();
    return Results.Json(await MakePageAsync(items, total, page, pageSize, tmdb, ct).ConfigureAwait(false), jsonSerializerOptions);
});

app.MapGet("/api/series/{id:int}", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var show = await repo.GetShowByIdAsync(id, ct).ConfigureAwait(false);
    if (show == null)
        return Results.NotFound();
    var cast = await repo.GetCastMembersAsync(show.TmdbId, "Series", ct).ConfigureAwait(false);
    IReadOnlyList<TmdbCrewMember> crew = Array.Empty<TmdbCrewMember>();
    var tmdb = TmdbClientFactory.Create();
    if (!string.IsNullOrWhiteSpace(show.CrewCacheJson))
    {
        try
        {
            var parsed = Newtonsoft.Json.JsonConvert.DeserializeObject<List<TmdbCrewMember>>(show.CrewCacheJson);
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
    
    // Filter out episodes whose files no longer exist on disk
    eps = eps.Where(e => !string.IsNullOrWhiteSpace(e.FilePath) && File.Exists(e.FilePath)).ToList();
    
    // Opportunistic episode artwork fill so the series page shows per-episode images without requiring manual refresh.
    // Uses the season endpoint (1 request/season) and caps downloads to keep the page responsive.
    if (tmdb != null && eps.Any(e => string.IsNullOrWhiteSpace(e.StillLocalPath)))
    {
        try
        {
            await repo.SyncEpisodesArtworkFromTmdbAsync(show.Id, show.TmdbId, tmdb, ct, maxImageDownloads: 60)
                .ConfigureAwait(false);
            eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
            // Filter again after sync
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

    var localSeasonNums = new HashSet<int>();
    var seasonRows = new List<(int SeasonNumber, object Row)>();
    if (tmdb != null && episodesGrouped.Count > 0)
    {
        foreach (var g in episodesGrouped)
        {
            var sn = g.season;
            localSeasonNums.Add(sn);
            var header = await tmdb.TryGetTvSeasonHeaderAsync(show.TmdbId, sn, ct).ConfigureAwait(false);
            var name = string.IsNullOrWhiteSpace(header?.Name)
                ? (sn == 0 ? "Specials" : $"Season {sn}")
                : header!.Value.Name;
            var pp = header?.PosterPath;
            seasonRows.Add((sn,
                new
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
                    inLibrary = true,
                }));
        }
    }

    if (tmdb != null && show.TmdbId > 0)
    {
        var tmdbSeasonTotal = await tmdb.TryGetTvNumberOfSeasonsAsync(show.TmdbId, ct).ConfigureAwait(false);
        if (tmdbSeasonTotal is > 0)
        {
            for (var sn = 1; sn <= tmdbSeasonTotal.Value; sn++)
            {
                if (localSeasonNums.Contains(sn))
                    continue;
                var header = await tmdb.TryGetTvSeasonHeaderAsync(show.TmdbId, sn, ct).ConfigureAwait(false);
                var name = string.IsNullOrWhiteSpace(header?.Name)
                    ? $"Season {sn}"
                    : header!.Value.Name;
                var pp = header?.PosterPath;
                seasonRows.Add((sn,
                    new
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
                        inLibrary = false,
                    }));
            }
        }
    }

    seasonRows.Sort((a, b) => a.SeasonNumber.CompareTo(b.SeasonNumber));
    var seasonsSummary = seasonRows.Select(r => r.Row).ToList();

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

    return Results.Json(new
    {
        show = showOut,
        cast = cast.Select(ImageUrls.MapCastMember).ToList(),
        crew = crew.Select(ImageUrls.MapCrewMember).ToList(),
        episodes = episodesGrouped,
        seasonsSummary,
        nextEpisode,
        similar
    }, jsonSerializerOptions);
});

app.MapGet("/api/series/{id:int}/season/{season:int}", async (
    int id,
    int season,
    LibraryRepository repo,
    RatingsAggregationService ratings,
    CancellationToken ct) =>
{
    var show = await repo.GetShowByIdAsync(id, ct).ConfigureAwait(false);
    if (show == null)
        return Results.NotFound();

    var eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
    eps = eps.Where(e => !string.IsNullOrWhiteSpace(e.FilePath) && File.Exists(e.FilePath)).ToList();
    var inSeason = eps.Where(e => e.Season == season).OrderBy(e => e.EpisodeNumber).ToList();
    var tmdb = TmdbClientFactory.Create();

    IReadOnlyDictionary<int, (string? Name, string? StillPath, double? VoteAverage)>? tmdbMap = null;
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
    var episodeRows = await Task.WhenAll(inSeason.Select(async e =>
    {
        double? tvVote = null;
        if (tmdbMap != null &&
            tmdbMap.TryGetValue(e.EpisodeNumber, out var meta) &&
            meta.VoteAverage is > 0)
            tvVote = meta.VoteAverage;
        double? imdbVote = await ratings.TryGetEpisodeImdbRatingAsync(show.TmdbId, season, e.EpisodeNumber, ct)
            .ConfigureAwait(false);
        return (object)new
        {
            e.Id,
            e.Season,
            episodeNumber = e.EpisodeNumber,
            e.Title,
            e.FilePath,
            e.SubtitlePath,
            e.WatchStatus,
            stillLocalPath = EpStill(e),
            tmdbVoteAverage = tvVote,
            imdbVoteAverage = imdbVote
        };
    })).ConfigureAwait(false);

    (string Name, string? PosterPath, string? AirDate, int EpisodeCount)? header = null;
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
        episodeCount = episodeRows.Length,
        tmdbEpisodeCount = header?.EpisodeCount ?? 0,
        episodes = episodeRows,
        nextEpisode
    }, jsonSerializerOptions);
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

app.MapPost("/api/library/movies/{id:int}/refresh-metadata", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);
    var (ok, err) = await repo.RefreshMovieMetadataFromTmdbAsync(id, tmdb, ct).ConfigureAwait(false);
    return ok
        ? Results.Json(new { success = true }, jsonSerializerOptions)
        : Results.Json(new { success = false, error = err }, jsonSerializerOptions);
});

app.MapPost("/api/library/series/{id:int}/refresh-metadata", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);
    var (ok, err) = await repo.RefreshShowMetadataFromTmdbAsync(id, tmdb, ct).ConfigureAwait(false);
    return ok
        ? Results.Json(new { success = true }, jsonSerializerOptions)
        : Results.Json(new { success = false, error = err }, jsonSerializerOptions);
});

app.MapPost("/api/library/movies/{id:int}/refresh-cast", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);
    var (ok, err) = await repo.RefreshMovieCastFromTmdbAsync(id, tmdb, ct).ConfigureAwait(false);
    return ok
        ? Results.Json(new { success = true }, jsonSerializerOptions)
        : Results.Json(new { success = false, error = err }, jsonSerializerOptions);
});

app.MapPost("/api/library/series/{id:int}/refresh-cast", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);
    var (ok, err) = await repo.RefreshShowCastFromTmdbAsync(id, tmdb, ct).ConfigureAwait(false);
    return ok
        ? Results.Json(new { success = true }, jsonSerializerOptions)
        : Results.Json(new { success = false, error = err }, jsonSerializerOptions);
});

app.MapPost("/api/cast/refresh", async (HttpRequest http, LibraryRepository repo, ILoggerFactory logFactory,
        CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
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

app.MapPost("/api/library/movies/{id:int}/rematch-from-file", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);
    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
    var (ok, newId, err) = await pipeline.RematchMovieByLibraryIdAsync(id, null, ct).ConfigureAwait(false);
    if (!ok)
        return Results.Json(new { success = false, error = err ?? "Re-match failed." }, jsonSerializerOptions);
    return Results.Json(new { success = true, libraryId = newId }, jsonSerializerOptions);
});

/// <summary>Remove library row and attach file to a specific TMDB movie id (manual fix).</summary>
app.MapPost("/api/library/movies/{id:int}/match-tmdb", async (int id, MatchTmdbBody body, LibraryRepository repo,
        RatingsRefreshQueue ratingsRefreshQueue, CancellationToken ct) =>
{
    if (body.TmdbId <= 0)
        return Results.Json(new { success = false, error = "Invalid TMDB id." }, jsonSerializerOptions);

    var path = await repo.GetMovieFilePathByLibraryIdAsync(id, ct).ConfigureAwait(false);
    if (string.IsNullOrWhiteSpace(path))
        return Results.Json(new { success = false, error = "Movie not found or file path is empty." }, jsonSerializerOptions);

    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);

    if (!await repo.DeleteMovieByIdAsync(id, ct).ConfigureAwait(false))
        return Results.Json(new { success = false, error = "Movie could not be removed." }, jsonSerializerOptions);

    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
    var applied = await pipeline.MatchFileWithTmdbAsync(path, body.TmdbId, "Movie", ct).ConfigureAwait(false);
    if (!applied)
        return Results.Json(new { success = false, error = "Could not apply that TMDB title to this file." }, jsonSerializerOptions);

    var newId = await repo.GetLibraryMovieIdByFilePathAsync(path, ct).ConfigureAwait(false);
    ratingsRefreshQueue.TryEnqueueSingle(body.TmdbId, "Movie");
    return Results.Json(new { success = true, libraryId = newId }, jsonSerializerOptions);
});

app.MapPost("/api/library/series/{id:int}/rematch-from-folder", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);
    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
    var (ok, newId, err) = await pipeline.RematchShowByLibraryIdAsync(id, null, ct).ConfigureAwait(false);
    if (!ok)
        return Results.Json(new { success = false, error = err ?? "Re-match failed." }, jsonSerializerOptions);
    return Results.Json(new { success = true, libraryId = newId }, jsonSerializerOptions);
});

app.MapPost("/api/library/series/{id:int}/match-tmdb", async (int id, MatchTmdbBody body, LibraryRepository repo,
        RatingsRefreshQueue ratingsRefreshQueue, CancellationToken ct) =>
{
    if (body.TmdbId <= 0)
        return Results.Json(new { success = false, error = "Invalid TMDB id." }, jsonSerializerOptions);

    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);

    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
    var (ok, newId, err) = await pipeline.MatchShowFolderToTmdbAsync(id, body.TmdbId, ct).ConfigureAwait(false);
    if (!ok)
        return Results.Json(new { success = false, error = err ?? "Could not apply that series to this folder." },
            jsonSerializerOptions);

    ratingsRefreshQueue.TryEnqueueSingle(body.TmdbId, "Series");
    return Results.Json(new { success = true, libraryId = newId }, jsonSerializerOptions);
});

app.MapPost("/api/library/episodes/{id:int}/rematch-from-file", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);

    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
    var (ok, showId, episodeId, err) = await pipeline.RematchEpisodeByLibraryIdAsync(id, null, ct).ConfigureAwait(false);
    if (!ok)
        return Results.Json(new { success = false, error = err ?? "Re-match failed." }, jsonSerializerOptions);

    return Results.Json(new { success = true, showId, episodeId }, jsonSerializerOptions);
});

app.MapPost("/api/library/episodes/{id:int}/match-tmdb", async (int id, MatchTmdbBody body, LibraryRepository repo,
        RatingsRefreshQueue ratingsRefreshQueue, CancellationToken ct) =>
{
    if (body.TmdbId <= 0)
        return Results.Json(new { success = false, error = "Invalid TMDB id." }, jsonSerializerOptions);

    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);

    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
    var (ok, showId, episodeId, err) = await pipeline.RematchEpisodeFileToTmdbAsync(id, body.TmdbId, ct)
        .ConfigureAwait(false);
    if (!ok)
        return Results.Json(new { success = false, error = err ?? "Re-link failed." }, jsonSerializerOptions);

    ratingsRefreshQueue.TryEnqueueSingle(body.TmdbId, "Series");
    return Results.Json(new { success = true, showId, episodeId }, jsonSerializerOptions);
});

app.MapPost("/api/library/bulk-rescan-series", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var body = await request.ReadFromJsonAsync<BulkRescanSeriesRequest>(cancellationToken: ct).ConfigureAwait(false);
    if (body?.ShowIds == null || body.ShowIds.Length == 0)
        return Results.Json(new { success = false, error = "No series IDs provided." }, jsonSerializerOptions);

    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { success = false, error = "TMDB API key not configured." }, jsonSerializerOptions);

    var pipeline = new ScanPipeline(new FileScanner(), tmdb, repo);
    var results = new List<object>();
    var successCount = 0;
    var failureCount = 0;

    foreach (var showId in body.ShowIds)
    {
        var (ok, newId, err) = await pipeline.RematchShowByLibraryIdAsync(showId, null, ct).ConfigureAwait(false);
        if (ok)
        {
            successCount++;
            results.Add(new { showId, success = true, newLibraryId = newId });
        }
        else
        {
            failureCount++;
            results.Add(new { showId, success = false, error = err ?? "Re-match failed." });
        }
    }

    return Results.Json(new
    {
        success = true,
        totalProcessed = body.ShowIds.Length,
        successCount,
        failureCount,
        results
    }, jsonSerializerOptions);
});

app.MapPost("/api/library/prefetch-metadata", async (LibraryRepository repo, HttpContext http, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
    {
        http.Response.StatusCode = StatusCodes.Status400BadRequest;
        await http.Response.WriteAsJsonAsync(new { success = false, error = "TMDB API key not configured." },
            jsonSerializerOptions, cancellationToken: ct).ConfigureAwait(false);
        return;
    }

    http.Response.ContentType = "application/x-ndjson; charset=utf-8";
    http.Response.Headers.CacheControl = "no-cache";
    await http.Response.StartAsync(ct).ConfigureAwait(false);

    await foreach (var ev in repo.PrefetchAllLibraryMetadataStreamAsync(tmdb, ct).ConfigureAwait(false))
    {
        var line = JsonSerializer.Serialize(ev, jsonSerializerOptions) + "\n";
        await http.Response.WriteAsync(line, cancellationToken: ct).ConfigureAwait(false);
        await http.Response.Body.FlushAsync(ct).ConfigureAwait(false);
    }
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

// —— Unmatched ——
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
    var dtos = result.Items.Select(ToScanLogDto).ToList();
    return Results.Json(new
    {
        items = dtos,
        total = result.TotalItems,
        totalPages = TotalPages(result.TotalItems, pageSize),
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
    CancellationToken ct) =>
{
    var logs = await repo.GetAllScanLogsAsync(ct).ConfigureAwait(false);
    var log = logs.FirstOrDefault(l => l.Id == id && l.Status == "Unmatched");
    if (log == null)
        return Results.Json(new { success = false, matchedTitle = (string?)null, siblingsFound = 0, siblingIds = Array.Empty<int>(), parentFolder = (string?)null }, jsonSerializerOptions);

    var tmdb = TmdbClientFactory.Create();
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

    Console.WriteLine($"Match complete (scanLogId={id}). Siblings found: {siblingIds.Count}, parentFolder={parentFolder}");

    ratingsRefreshQueue.TryEnqueueSingle(body.TmdbId, mediaTypeResolved);
    // Use Json + options so properties are camelCase (Results.Ok uses different defaults and breaks the SPA).
    return Results.Json(new
    {
        success = true,
        matchedTitle,
        siblingsFound = siblingIds.Count,
        siblingIds = siblingIds.ToList(),
        parentFolder
    }, jsonSerializerOptions);
});

app.MapPost("/api/unmatched/bulk-match", async (BulkMatchBody body, LibraryRepository repo, LibraryContext db, CancellationToken ct) =>
{
    var ids = body.Ids ?? Array.Empty<int>();
    if (ids.Length == 0)
        return Results.Json(new { success = true, matched = 0 }, jsonSerializerOptions);

    var tmdb = TmdbClientFactory.Create();
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

app.MapPost("/api/unmatched/smart-scan", (SmartMatchRuntime sm, IServiceScopeFactory scopes) =>
{
    if (sm.IsRunning)
        return Results.Conflict(new { error = "Smart auto-match already running." });

    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.BadRequest(new { error = "TMDB API key not configured." });

    sm.BeginJob();
    var token = sm.Token;

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
            /* cancelled — still report partial counts below */
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Smart auto-match: " + ex);
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
                Console.Error.WriteLine("Smart auto-match finalize: " + ex);
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

app.MapPost("/api/unmatched/search", async (UnmatchedSearchBody body, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
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
    List<(TmdbSearchResult Result, string Media)> combined;

    if (mtRaw.Equals("Both", StringComparison.OrdinalIgnoreCase))
    {
        var movies = await tmdb.SearchAsync(q, "Movie", false, ct, 12).ConfigureAwait(false);
        var series = await tmdb.SearchAsync(q, "Series", false, ct, 12).ConfigureAwait(false);
        if ((movies.Count + series.Count) < 6 && !string.Equals(qFallback, q, StringComparison.Ordinal))
        {
            var movies2 = await tmdb.SearchAsync(qFallback, "Movie", false, ct, 12).ConfigureAwait(false);
            var series2 = await tmdb.SearchAsync(qFallback, "Series", false, ct, 12).ConfigureAwait(false);
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
        var list = await tmdb.SearchAsync(q, mtRaw, false, ct, 14).ConfigureAwait(false);
        if (list.Count < 7 && !string.Equals(qFallback, q, StringComparison.Ordinal))
        {
            var fallback = await tmdb.SearchAsync(qFallback, mtRaw, false, ct, 14).ConfigureAwait(false);
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
            mediaType = mt
        };
    }).ToList();
    return Results.Json(payload, jsonSerializerOptions);
});

// —— Online stream (TMDB helpers; search uses POST /api/unmatched/search) ——
app.MapGet("/api/stream/imdb-id/{tmdbId:int}", async (int tmdbId, string? mediaType, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { imdbId = (string?)null }, jsonSerializerOptions);
    var mt = string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase) ? "Series" : "Movie";
    var imdb = await tmdb.TryGetImdbIdAsync(tmdbId, mt, ct).ConfigureAwait(false);
    return Results.Json(new { imdbId = imdb }, jsonSerializerOptions);
});

app.MapGet("/api/stream/tv/{tmdbId:int}/seasons", async (int tmdbId, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);
    if (tmdbId <= 0)
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);

    var n = await tmdb.TryGetTvNumberOfSeasonsAsync(tmdbId, ct).ConfigureAwait(false);
    if (n is null or <= 0)
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);

    var rows = new List<object>();
    for (var season = 1; season <= n.Value; season++)
    {
        var header = await tmdb.TryGetTvSeasonHeaderAsync(tmdbId, season, ct).ConfigureAwait(false);
        int episodeCount;
        string name;
        if (!header.HasValue)
        {
            episodeCount = 0;
            name = $"Season {season}";
        }
        else
        {
            episodeCount = header.Value.EpisodeCount;
            name = string.IsNullOrWhiteSpace(header.Value.Name)
                ? $"Season {season}"
                : header.Value.Name.Trim();
        }

        rows.Add(new { seasonNumber = season, episodeCount, name });
    }

    return Results.Json(rows, jsonSerializerOptions);
});

// —— Stream TMDB details (for StreamingDetailsPage) ——
app.MapGet("/api/stream/details/{tmdbId:int}", async (int tmdbId, string? mediaType, CancellationToken ct) =>
{
    var apiKey = AppSettings.ResolvedTmdbApiKey;
    if (!AppSettings.IsValidTmdbKey(apiKey) || tmdbId <= 0)
        return Results.Json(new { error = "TMDB not configured." }, jsonSerializerOptions);

    var isMovie = !string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase);
    var endpoint = isMovie ? $"movie/{tmdbId}" : $"tv/{tmdbId}";
    var appendTo = "videos,recommendations,external_ids";
    var url = $"https://api.themoviedb.org/3/{endpoint}?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US&append_to_response={appendTo}";

    try
    {
        using var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0");
        var json = await http.GetStringAsync(new Uri(url), ct).ConfigureAwait(false);
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var root = doc.RootElement;

        var title = root.TryGetProperty("title", out var t) ? t.GetString()
            : root.TryGetProperty("name", out var n) ? n.GetString() : null;
        var overview = root.TryGetProperty("overview", out var ov) ? ov.GetString() : null;
        var posterPath = root.TryGetProperty("poster_path", out var pp) ? pp.GetString() : null;
        var backdropPath = root.TryGetProperty("backdrop_path", out var bp) ? bp.GetString() : null;
        var voteAverage = root.TryGetProperty("vote_average", out var va) && va.TryGetDouble(out var vd) ? vd : 0;
        var releaseDate = root.TryGetProperty("release_date", out var rd) ? rd.GetString()
            : root.TryGetProperty("first_air_date", out var fa) ? fa.GetString() : null;
        var imdbId = root.TryGetProperty("external_ids", out var ext) && ext.TryGetProperty("imdb_id", out var im)
            ? im.GetString() : null;
        var numberOfSeasons = root.TryGetProperty("number_of_seasons", out var ns) && ns.TryGetInt32(out var nsi) ? nsi : 0;

        var genres = new List<string>();
        if (root.TryGetProperty("genres", out var genresEl) && genresEl.ValueKind == System.Text.Json.JsonValueKind.Array)
            foreach (var g in genresEl.EnumerateArray())
                if (g.TryGetProperty("name", out var gn)) genres.Add(gn.GetString() ?? "");

        // Trailers: pick YouTube trailers, Official Trailer first
        var trailers = new List<StreamTrailerEntry>();
        if (root.TryGetProperty("videos", out var vids) && vids.TryGetProperty("results", out var vidArr)
            && vidArr.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var v in vidArr.EnumerateArray())
            {
                var site = v.TryGetProperty("site", out var si) ? si.GetString() : null;
                var vtype = v.TryGetProperty("type", out var vt) ? vt.GetString() : null;
                var vkey = v.TryGetProperty("key", out var vk) ? vk.GetString() : null;
                var vname = v.TryGetProperty("name", out var vn) ? vn.GetString() : null;
                if (site == "YouTube" && !string.IsNullOrEmpty(vkey))
                    trailers.Add(new StreamTrailerEntry(vname, vkey!, vtype, $"https://www.youtube.com/watch?v={vkey}"));
            }
        }
        var officialTrailer = trailers.FirstOrDefault(x => x.Type == "Trailer");
        var featuredTrailer = officialTrailer ?? trailers.FirstOrDefault();
        var featuredTrailerObj = featuredTrailer == null ? null : new
        {
            name = featuredTrailer.Name, key = featuredTrailer.Key,
            type = featuredTrailer.Type, youtubeUrl = featuredTrailer.YoutubeUrl
        };

        // Recommendations
        var recs = new List<object>();
        if (root.TryGetProperty("recommendations", out var recsEl) && recsEl.TryGetProperty("results", out var recArr)
            && recArr.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var r in recArr.EnumerateArray().Take(10))
            {
                var recTitle = r.TryGetProperty("title", out var rt) ? rt.GetString()
                    : r.TryGetProperty("name", out var rn) ? rn.GetString() : null;
                var recId = r.TryGetProperty("id", out var ri) && ri.TryGetInt32(out var rid) ? rid : 0;
                var recPoster = r.TryGetProperty("poster_path", out var rp) ? rp.GetString() : null;
                var recDate = r.TryGetProperty("release_date", out var rrd) ? rrd.GetString()
                    : r.TryGetProperty("first_air_date", out var rfa) ? rfa.GetString() : null;
                var recMt = r.TryGetProperty("media_type", out var rmt) ? rmt.GetString() : (isMovie ? "movie" : "tv");
                if (recId > 0 && !string.IsNullOrEmpty(recTitle))
                    recs.Add(new
                    {
                        id = recId, title = recTitle,
                        posterUrl = string.IsNullOrEmpty(recPoster) ? null : $"https://image.tmdb.org/t/p/w185{recPoster}",
                        year = recDate?.Length >= 4 ? recDate[..4] : null,
                        mediaType = recMt == "tv" ? "Series" : "Movie",
                    });
            }
        }

        return Results.Json(new
        {
            tmdbId, title, overview,
            posterUrl = string.IsNullOrEmpty(posterPath) ? null : $"https://image.tmdb.org/t/p/w500{posterPath}",
            backdropUrl = string.IsNullOrEmpty(backdropPath) ? null : $"https://image.tmdb.org/t/p/w1280{backdropPath}",
            voteAverage, releaseDate, year = releaseDate?.Length >= 4 ? releaseDate[..4] : null,
            genres, imdbId, mediaType = isMovie ? "Movie" : "Series",
            numberOfSeasons, trailer = featuredTrailerObj, recommendations = recs,
        }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = ex.Message }, jsonSerializerOptions);
    }
});

// —— Scan ——
app.MapPost("/api/scan/start", async (ScanStartBody body, LibraryRepository repo, ScanRuntime scan, IServiceScopeFactory scopes,
        RatingsRefreshQueue ratingsRefreshQueue, CancellationToken _startupCt) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.BadRequest(new { error = "TMDB API key not configured." });

    if (scan.IsRunning)
        return Results.Conflict(new { error = "Scan already running.", jobId = scan.JobId });

    var folders = body.Folders;
    if (folders == null || folders.Length == 0)
        folders = (await repo.GetAllLibraryPathsAsync().ConfigureAwait(false)).ToArray();
    if (folders.Length == 0)
        return Results.BadRequest(new
        {
            error = "NO_LIBRARY_FOLDERS",
            message =
                "No library folders are configured. Open Settings, add at least one folder under “Library folders”, then scan again."
        });

    var jobId = scan.BeginJob();
    scan.StartCancellationSource();
    var token = scan.ScanToken;

    _ = Task.Run(async () =>
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var r = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
            var pipeline = new ScanPipeline(new FileScanner(), tmdb, r);
            var fileList = new List<string>();
            var scannerFs = new FileScanner();
            var excludedPaths = await r.GetExcludedScanPathsAsync(token).ConfigureAwait(false);
            foreach (var root in folders)
            {
                if (string.IsNullOrWhiteSpace(root)) continue;
                foreach (var f in scannerFs.ScanDirectory(root, recursive: true, excludedPaths))
                    fileList.Add(f);
            }

            var distinct = fileList.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (distinct.Count == 0)
            {
                scan.ResetProgress(0);
                await scan.BroadcastAsync(new
                {
                    type = "complete",
                    matched = 0,
                    unmatched = 0,
                    skipped = 0,
                    empty = true,
                    message =
                        "No video files were found in the selected folders. Add media files or choose a different folder."
                }, CancellationToken.None).ConfigureAwait(false);
                return;
            }

            scan.ResetProgress(distinct.Count);

            var progress = new Progress<ScanProgress>(p =>
            {
                scan.Update(p.Current, p.CurrentFile, p.MatchedSoFar, p.UnmatchedSoFar);
                _ = scan.BroadcastAsync(new
                {
                    type = "progress",
                    current = p.Current,
                    total = p.Total,
                    file = string.IsNullOrEmpty(p.CurrentFile)
                        ? ""
                        : Path.GetFileNameWithoutExtension(p.CurrentFile),
                    p.MatchedSoFar,
                    p.UnmatchedSoFar,
                    skipped = p.SkippedSoFar
                }, CancellationToken.None);
            });

            var result = await pipeline.RunScanOnFilesAsync(distinct, progress, token).ConfigureAwait(false);
            await scan.BroadcastAsync(new
            {
                type = "complete",
                result.Matched,
                result.Unmatched,
                skipped = result.SkippedAlreadyMatched
            }, CancellationToken.None).ConfigureAwait(false);
            ratingsRefreshQueue.TryEnqueueStaleSweep();
        }
        catch (OperationCanceledException)
        {
            await scan.BroadcastAsync(new { type = "cancelled" }, CancellationToken.None).ConfigureAwait(false);
        }
        finally
        {
            scan.DisposeCancellationSource();
            scan.EndJob();
        }
    }, CancellationToken.None);

    return Results.Json(new { jobId });
});

app.MapGet("/api/scan/progress", (ScanRuntime scan) =>
{
    return Results.Json(new
    {
        isRunning = scan.IsRunning,
        total = scan.Total,
        current = scan.Current,
        currentFile = scan.CurrentFile,
        matched = scan.Matched,
        unmatched = scan.Unmatched,
        percent = scan.Percent
    });
});

app.MapPost("/api/scan/cancel", (ScanRuntime scan) =>
{
    scan.CancelScan();
    return Results.Ok();
});

app.MapGet("/api/scan/stream", async (HttpContext ctx, ScanRuntime scan, CancellationToken ct) =>
{
    ctx.Response.Headers.Append("Content-Type", "text/event-stream");
    ctx.Response.Headers.Append("Cache-Control", "no-cache");
    ctx.Response.Headers.Append("Connection", "keep-alive");

    var reader = scan.Subscribe(out var subId);
    try
    {
        await foreach (var msg in reader.ReadAllAsync(ct).ConfigureAwait(false))
        {
            await ctx.Response.WriteAsync("data: " + msg + "\n\n", ct).ConfigureAwait(false);
            await ctx.Response.Body.FlushAsync(ct).ConfigureAwait(false);
        }
    }
    finally
    {
        scan.Unsubscribe(subId);
    }
});

// —— Watch history ——
app.MapGet("/api/history", async (LibraryRepository repo, int limit = 10, bool includeSuppressed = false,
        CancellationToken ct = default) =>
{
    var tmdb = TmdbClientFactory.Create();
    var cap = Math.Clamp(limit, 1, 200);
    var list = (await repo.GetRecentHistoryAsync(cap, includeSuppressed, ct).ConfigureAwait(false)).ToList();
    foreach (var h in list)
    {
        // (1) Empty poster → resolve from library file path.
        // (2) Stale/missing file on disk → ToImageUrl returns null after mapping — resolve again from library.
        if (string.IsNullOrWhiteSpace(h.PosterLocalPath) ||
            string.IsNullOrWhiteSpace(ImageUrls.ToImageUrl(h.PosterLocalPath)))
        {
            var resolved = await repo.TryResolvePosterPathForPlayedFileAsync(h.FilePath, h.MediaType, ct)
                .ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(resolved))
                h.PosterLocalPath = resolved;
        }

        if (string.IsNullOrWhiteSpace(ImageUrls.ToImageUrl(h.PosterLocalPath)))
        {
            var altType = string.Equals(h.MediaType, "Series", StringComparison.OrdinalIgnoreCase)
                ? "Movie"
                : "Series";
            var again = await repo.TryResolvePosterPathForPlayedFileAsync(h.FilePath, altType, ct).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(again))
                h.PosterLocalPath = again;
        }

        if (string.IsNullOrWhiteSpace(ImageUrls.ToImageUrl(h.PosterLocalPath)))
        {
            var fromTitle = await repo.TryResolvePosterFromHistoryTitleAsync(h.Title, h.MediaType, ct)
                .ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(fromTitle))
                h.PosterLocalPath = fromTitle;
        }

        if (tmdb != null &&
            string.IsNullOrWhiteSpace(ImageUrls.ToImageUrl(h.PosterLocalPath)) &&
            string.IsNullOrWhiteSpace(h.PosterRemoteUrl))
        {
            var tid = await repo.TryGetTmdbIdForHistoryPlaybackAsync(h.FilePath, h.MediaType, h.Title, ct)
                .ConfigureAwait(false);
            if (tid.HasValue && tid.Value > 0)
            {
                var mt = string.Equals(h.MediaType, "Movie", StringComparison.OrdinalIgnoreCase)
                    ? "Movie"
                    : "Series";
                var art = await tmdb.GetArtworkPathsAsync(tid.Value, mt, ct).ConfigureAwait(false);
                var posterPath = art.HasValue ? art.Value.PosterPath : null;
                if (string.IsNullOrEmpty(posterPath))
                {
                    var other = mt == "Movie" ? "Series" : "Movie";
                    var artAlt = await tmdb.GetArtworkPathsAsync(tid.Value, other, ct).ConfigureAwait(false);
                    posterPath = artAlt.HasValue ? artAlt.Value.PosterPath : null;
                }

                if (!string.IsNullOrEmpty(posterPath))
                    h.PosterRemoteUrl = $"https://image.tmdb.org/t/p/w342{posterPath}";
            }
        }

        if (string.Equals(h.MediaType, "Series", StringComparison.OrdinalIgnoreCase))
        {
            var ep = await repo.TryGetEpisodeByFilePathAsync(h.FilePath, ct).ConfigureAwait(false);
            if (ep != null)
            {
                h.LibraryShowId = ep.ShowId;
                h.LibraryEpisodeId = ep.Id;
                // Continue Watching label must reflect the currently tracked history episode,
                // not a show-level "next episode" guess that can drift to S1E1.
                h.NextUpLabel = $"S{ep.Season} E{ep.EpisodeNumber}";
            }
        }
        else if (string.Equals(h.MediaType, "Movie", StringComparison.OrdinalIgnoreCase))
        {
            var movie = await repo.TryGetMovieByFilePathAsync(h.FilePath, ct).ConfigureAwait(false);
            if (movie != null)
                h.LibraryMovieId = movie.Id;
        }

        var backdropPath = await repo.TryGetBackdropPathForPlayedFileAsync(h.FilePath, h.MediaType, ct)
            .ConfigureAwait(false);
        if (!string.IsNullOrWhiteSpace(backdropPath))
            h.BackdropLocalPath = backdropPath;
    }

    return Results.Json(list.Select(ImageUrls.MapWatchHistory).ToList(), jsonSerializerOptions);
});

async Task<IResult> HomeMediaRowsJson(LibraryRepository repo,
    Func<CancellationToken, Task<List<MediaCardDto>>> load, CancellationToken ct)
{
    var raw = await load(ct).ConfigureAwait(false);
    var mapped = raw.Select(ImageUrls.MapMediaCard).ToList();
    var tmdb = TmdbClientFactory.Create();
    if (tmdb != null)
        await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(mapped, tmdb, ct).ConfigureAwait(false);
    return Results.Json(mapped, jsonSerializerOptions);
}

app.MapGet("/api/home/top-rated", async (LibraryRepository repo, CancellationToken ct) =>
    await HomeMediaRowsJson(repo, c => repo.GetHomeTopRatedAsync(8, c), ct).ConfigureAwait(false));

app.MapGet("/api/home/arabic-picks", async (LibraryRepository repo, CancellationToken ct) =>
    await HomeMediaRowsJson(repo, c => repo.GetHomeArabicPicksAsync(20, c), ct).ConfigureAwait(false));

app.MapGet("/api/home/binge-series", async (LibraryRepository repo, CancellationToken ct) =>
    await HomeMediaRowsJson(repo, c => repo.GetHomeBingeSeriesAsync(20, c), ct).ConfigureAwait(false));

app.MapGet("/api/home/movie-night", async (LibraryRepository repo, CancellationToken ct) =>
    await HomeMediaRowsJson(repo, c => repo.GetHomeMovieNightAsync(10, null, c), ct).ConfigureAwait(false));

app.MapGet("/api/home/layout", async (LibraryRepository repo, CancellationToken ct) =>
{
    var raw = await repo.GetHomeLayoutJsonAsync(ct).ConfigureAwait(false);
    if (string.IsNullOrWhiteSpace(raw))
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);
    return Results.Text(raw.Trim(), "application/json");
});

app.MapPost("/api/home/layout", async (HttpRequest req, LibraryRepository repo, CancellationToken ct) =>
{
    using var reader = new StreamReader(req.Body);
    var body = (await reader.ReadToEndAsync(ct).ConfigureAwait(false)).Trim();
    if (string.IsNullOrWhiteSpace(body))
        return Results.BadRequest();
    await repo.SaveHomeLayoutJsonAsync(body, ct).ConfigureAwait(false);
    return Results.Ok();
});

app.MapPost("/api/home/section/query", async (HomeSectionQuery query, LibraryRepository repo, CancellationToken ct) =>
{
    var rows = await repo.ResolveHomeSectionAsync(query, ct).ConfigureAwait(false);
    var mapped = rows.Select(ImageUrls.MapMediaCard).ToList();
    var tmdb = TmdbClientFactory.Create();
    if (tmdb != null)
        await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(mapped, tmdb, ct).ConfigureAwait(false);
    return Results.Json(mapped, jsonSerializerOptions);
});

app.MapGet("/api/home/featured-fallback", async (LibraryRepository repo, CancellationToken ct) =>
{
    var dto = await repo.GetHomeFeaturedFallbackAsync(ct).ConfigureAwait(false);
    if (dto == null)
        return Results.Json(new { card = (object?)null }, jsonSerializerOptions);
    var mapped = ImageUrls.MapMediaCard(dto);
    var list = new List<MediaCardDto> { mapped };
    var tmdb = TmdbClientFactory.Create();
    if (tmdb != null)
        await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(list, tmdb, ct).ConfigureAwait(false);
    return Results.Json(new { card = list[0] }, jsonSerializerOptions);
});

app.MapPost("/api/history", async (HistoryAddBody body, LibraryRepository repo, CancellationToken ct) =>
{
    var id = await repo.AddToHistoryAsync(
        body.FilePath ?? "",
        body.Title ?? "",
        body.PosterPath,
        body.MediaType ?? "Movie",
        body.DurationSeconds,
        ct,
        body.SuppressContinueWatching == true).ConfigureAwait(false);
    return Results.Json(new { id });
});

app.MapPost("/api/history/{id:int}/stopped", async (int id, StoppedBody body, LibraryRepository repo, LibraryContext db, CancellationToken ct) =>
{
    var stopped = body.StoppedAt.Kind == DateTimeKind.Unspecified
        ? DateTime.SpecifyKind(body.StoppedAt, DateTimeKind.Utc)
        : body.StoppedAt.ToUniversalTime();

    var h = await db.WatchHistories.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct).ConfigureAwait(false);
    if (h == null)
        return Results.NotFound();

    var started = h.StartedAt ?? h.OpenedAt;
    var sessionSeconds = Math.Max(0, (int)(stopped - started).TotalSeconds);

    if (body.PositionSeconds is >= 0 and var pos)
    {
        await repo.FinalizeWatchHistoryStoppedWithPositionAsync(id, stopped, pos, ct).ConfigureAwait(false);
    }
    else if (sessionSeconds > 0)
    {
        await repo.UpdateWatchHistoryAfterReturnAsync(id, stopped, sessionSeconds, ct).ConfigureAwait(false);
    }
    else
    {
        var hTracked = await db.WatchHistories.FirstOrDefaultAsync(x => x.Id == id, ct).ConfigureAwait(false);
        if (hTracked == null)
            return Results.NotFound();
        if (hTracked.IsStopFinalized)
            return Results.Ok();
        hTracked.StoppedAt = stopped;
        hTracked.IsStopFinalized = true;
        hTracked.LastHeartbeatAtUtc = stopped;
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    return Results.Ok();
});

app.MapPost("/api/history/{id:int}/progress", async (int id, HistoryProgressBody body, LibraryRepository repo, CancellationToken ct) =>
{
    if (body.PositionSeconds < 0)
        return Results.BadRequest(new { error = "Invalid position." });

    await repo.UpdateWatchHistoryProgressAsync(id, body.PositionSeconds, body.DurationSeconds, body.MarkWatching ?? true,
        ct).ConfigureAwait(false);
    return Results.Ok();
});

app.MapGet("/api/series/{id:int}/next-episode",
    async (int id, int? currentEpisodeId, LibraryRepository repo, CancellationToken ct) =>
    {
        var show = await repo.GetShowByIdAsync(id, ct).ConfigureAwait(false);
        if (show == null)
            return Results.NotFound();

        var eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
        Episode? next;
        if (currentEpisodeId is { } cid)
            next = LibraryRepository.GetNextEpisodeInOrder(eps, cid);
        else
            next = LibraryRepository.GetNextEpisodeForShow(eps);
        if (next == null)
            return Results.Json(new { next = (object?)null }, jsonSerializerOptions);

        return Results.Json(new
        {
            next = new
            {
                id = next.Id,
                filePath = next.FilePath,
                season = next.Season,
                episodeNumber = next.EpisodeNumber,
                title = next.Title,
            }
        }, jsonSerializerOptions);
    });

app.MapGet("/api/series/{id:int}/previous-episode", async (int id, int currentEpisodeId, LibraryRepository repo,
        CancellationToken ct) =>
{
    var show = await repo.GetShowByIdAsync(id, ct).ConfigureAwait(false);
    if (show == null)
        return Results.NotFound();

    var eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
    var prev = LibraryRepository.GetPreviousEpisodeInOrder(eps, currentEpisodeId);
    if (prev == null)
        return Results.Json(new { previous = (object?)null }, jsonSerializerOptions);

    return Results.Json(new
    {
        previous = new
        {
            id = prev.Id,
            filePath = prev.FilePath,
            season = prev.Season,
            episodeNumber = prev.EpisodeNumber,
            title = prev.Title,
        }
    }, jsonSerializerOptions);
});

app.MapGet("/api/playback/resolve-by-path", async (string filePath, LibraryRepository repo, LibraryContext db, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(filePath))
        return Results.BadRequest(new { error = "filePath is required." });

    var ep = await repo.TryGetEpisodeByFilePathAsync(filePath, ct).ConfigureAwait(false);
    if (ep != null)
    {
        var show = await db.Shows.AsNoTracking()
            .Where(s => s.Id == ep.ShowId)
            .Select(s => new { s.Id, s.Title, PosterPath = s.SelectedPosterPath ?? s.PosterLocalPath })
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);
        var title = !string.IsNullOrWhiteSpace(ep.Title)
            ? ep.Title!
            : $"{show?.Title ?? "Series"} · S{ep.Season}E{ep.EpisodeNumber}";
        return Results.Json(new
        {
            mediaType = "Series",
            filePath = ep.FilePath,
            title,
            posterPath = show?.PosterPath,
            libraryShowId = ep.ShowId,
            libraryEpisodeId = ep.Id,
            season = ep.Season,
            episodeNumber = ep.EpisodeNumber,
        }, jsonSerializerOptions);
    }

    var movie = await repo.TryGetMovieByFilePathAsync(filePath, ct).ConfigureAwait(false);
    if (movie != null)
    {
        return Results.Json(new
        {
            mediaType = "Movie",
            filePath = movie.FilePath,
            title = movie.Title,
            posterPath = movie.SelectedPosterPath ?? movie.PosterLocalPath,
            libraryMovieId = movie.Id,
        }, jsonSerializerOptions);
    }

    return Results.NotFound(new { error = "No library media found for file path." });
});

app.MapDelete("/api/history/{id:int}", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var ok = await repo.RemoveContinueWatchingByHistoryIdAsync(id, ct).ConfigureAwait(false);
    return ok
        ? Results.Json(new { success = true }, jsonSerializerOptions)
        : Results.NotFound();
});

app.MapPost("/api/history/{id:int}/dismiss", async (int id, HistoryDismissBody? body, LibraryRepository repo,
    CancellationToken ct) =>
{
    var mark = body?.MarkCompleted == true;
    var ok = await repo.ContinueWatchingDismissAsync(id, mark, ct).ConfigureAwait(false);
    return ok
        ? Results.Json(new { success = true }, jsonSerializerOptions)
        : Results.NotFound();
});

// —— Lists ——
app.MapGet("/api/lists", async (LibraryRepository repo, CancellationToken ct) =>
{
    var rows = await repo.GetUserListSummaryRowsAsync(ct).ConfigureAwait(false);
    return Results.Json(rows);
});

app.MapGet("/api/lists/{id:int}", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var list = await repo.GetUserListByIdAsync(id, ct).ConfigureAwait(false);
    if (list == null)
        return Results.NotFound();
    return Results.Json(new
    {
        id = list.Id,
        name = list.Name,
        isDefault = list.IsDefault
    }, jsonSerializerOptions);
});

app.MapPost("/api/lists", async (CreateListBody body, LibraryRepository repo, CancellationToken ct) =>
{
    try
    {
        var list = await repo.CreateUserListAsync(body.Name ?? "", ct).ConfigureAwait(false);
        return Results.Json(list);
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
});

app.MapPut("/api/lists/{id:int}", async (int id, RenameListBody body, LibraryRepository repo, CancellationToken ct) =>
{
    var ok = await repo.RenameUserListAsync(id, body.Name ?? "", ct).ConfigureAwait(false);
    return ok
        ? Results.Json(new { success = true }, jsonSerializerOptions)
        : Results.BadRequest(new { error = "Could not rename list (duplicate name or built-in list)." });
});

app.MapDelete("/api/lists/{id:int}", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var ok = await repo.DeleteUserListAsync(id, ct).ConfigureAwait(false);
    return Results.Json(new { success = ok });
});

app.MapGet("/api/lists/{id:int}/items", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var rows = await repo.GetListItemRowsAsync(id, ct).ConfigureAwait(false);
    var cards = new List<MediaCardDto>();
    foreach (var row in rows)
    {
        if (string.Equals(row.MediaType, "Series", StringComparison.OrdinalIgnoreCase) &&
            row.LibraryDatabaseId is { } sid)
        {
            var s = await repo.GetShowByIdAsync(sid, ct).ConfigureAwait(false);
            if (s != null)
            {
                cards.Add(ToCardFromShow(s));
                continue;
            }
        }
        else if (row.LibraryDatabaseId is { } mid)
        {
            var m = await repo.GetMovieByIdAsync(mid, ct).ConfigureAwait(false);
            if (m != null)
            {
                cards.Add(ToCardFromMovie(m));
                continue;
            }
        }

        cards.Add(new MediaCardDto
        {
            Id = row.LibraryDatabaseId ?? 0,
            TmdbId = row.TmdbId,
            Title = row.Title,
            Year = row.Year,
            PosterLocalPath = row.PosterLocalPath,
            IsArabic = false,
            TmdbMediaType = string.Equals(row.MediaType, "Series", StringComparison.OrdinalIgnoreCase)
                ? "Series"
                : "Movie"
        });
    }

    var mapped = cards.Select(ImageUrls.MapMediaCard).ToList();
    var tmdbList = TmdbClientFactory.Create();
    await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(mapped, tmdbList, ct).ConfigureAwait(false);
    return Results.Json(mapped);
});

app.MapPost("/api/lists/{id:int}/items", async (int id, AddListItemBody body, LibraryRepository repo, CancellationToken ct) =>
{
    await repo.AddListItemAsync(id, body.TmdbId, body.MediaType ?? "Movie", ct).ConfigureAwait(false);
    return Results.Json(new { success = true });
});

app.MapGet("/api/lists/{id:int}/contains", async (int id, int tmdbId, string? mediaType, LibraryRepository repo, CancellationToken ct) =>
{
    var mt = string.IsNullOrWhiteSpace(mediaType) ? "Movie" : mediaType!;
    var inList = await repo.IsInListAsync(id, tmdbId, mt, ct).ConfigureAwait(false);
    return Results.Json(new { inList }, jsonSerializerOptions);
});

app.MapGet("/api/lists/{id:int}/tmdb-ids", async (int id, string? mediaType, LibraryRepository repo, CancellationToken ct) =>
{
    var mt = string.IsNullOrWhiteSpace(mediaType) ? "Movie" : mediaType!;
    var set = await repo.GetListTmdbKeySetForMediaTypeAsync(id, mt, ct).ConfigureAwait(false);
    return Results.Json(set.Order().ToArray(), jsonSerializerOptions);
});

app.MapDelete("/api/lists/{listId:int}/items/{tmdbId:int}", async (int listId, int tmdbId, string? mediaType, LibraryRepository repo, CancellationToken ct) =>
{
    var mt = string.IsNullOrWhiteSpace(mediaType) ? "Movie" : mediaType!;
    await repo.RemoveListItemAsync(listId, tmdbId, mt, ct).ConfigureAwait(false);
    return Results.Json(new { success = true });
});

// —— People ——
app.MapGet("/api/people/{tmdbId:int}", async (int tmdbId, LibraryRepository reqRepo, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { person = (object?)null, localAppearances = Array.Empty<object>() });

    var person = await tmdb.GetPersonDetailsAsync(tmdbId, ct).ConfigureAwait(false);
    var local = await reqRepo.GetLibraryMediaForPersonAsync(tmdbId, ct).ConfigureAwait(false);
    object? personOut = null;
    if (person != null)
    {
        personOut = new
        {
            person.Id,
            person.Name,
            person.Biography,
            person.ProfilePath,
            profileImageUrl = ImageUrls.ToImageUrl(person.ProfileLocalPath),
            person.Birthday,
            person.PlaceOfBirth,
            person.KnownFor
        };
    }

    return Results.Json(new { person = personOut, localAppearances = local.Select(ImageUrls.MapLocalSimilar).ToList() });
});

// —— Images ——
app.MapGet("/api/images/{tmdbId:int}/posters", async (int tmdbId, string mediaType, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(Array.Empty<TmdbImage>());
    var mt = string.IsNullOrWhiteSpace(mediaType) ? "Movie" : mediaType;
    var images = await tmdb.GetImagesAsync(tmdbId, mt, ct).ConfigureAwait(false);
    return Results.Json(images.Posters);
});

app.MapGet("/api/images/{tmdbId:int}/backdrops", async (int tmdbId, string mediaType, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(Array.Empty<TmdbImage>());
    var mt = string.IsNullOrWhiteSpace(mediaType) ? "Movie" : mediaType;
    var images = await tmdb.GetImagesAsync(tmdbId, mt, ct).ConfigureAwait(false);
    return Results.Json(images.Backdrops);
});

app.MapPost("/api/images/{id:int}/select", async (int id, ImageSelectBody body, LibraryRepository repo, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.BadRequest(new { success = false });

    var mt = body.MediaType ?? "Movie";
    if (!string.IsNullOrWhiteSpace(body.PosterPath))
    {
        var local = await tmdb.DownloadImageAsync(body.PosterPath, $"poster_pick_{body.TmdbId}.jpg", ct)
            .ConfigureAwait(false);
        await repo.UpdatePosterAsync(id, mt, local, ct).ConfigureAwait(false);
    }

    if (!string.IsNullOrWhiteSpace(body.BackdropPath))
    {
        var local = await tmdb
            .DownloadImageAsync(body.BackdropPath, $"backdrop_pick_{body.TmdbId}.jpg", ct, null, "w1280")
            .ConfigureAwait(false);
        await repo.UpdateBackdropAsync(id, mt, local, ct).ConfigureAwait(false);
    }

    return Results.Json(new { success = true });
});

app.MapPost("/api/library/cleanup", async (LibraryContext db, CancellationToken ct) =>
{
    var removedEpisodes = 0;
    var removedShows = 0;
    var removedMovies = 0;

    // Remove episodes whose files no longer exist
    var episodes = await db.Episodes.ToListAsync(ct).ConfigureAwait(false);
    foreach (var ep in episodes)
    {
        if (string.IsNullOrEmpty(ep.FilePath) || File.Exists(ep.FilePath))
            continue;
        db.Episodes.Remove(ep);
        removedEpisodes++;
    }

    await db.SaveChangesAsync(ct).ConfigureAwait(false);

    // Remove shows that have no episodes OR whose folder is gone OR have no folder path (smart match ghosts)
    var shows = await db.Shows.Include(s => s.Episodes).ToListAsync(ct).ConfigureAwait(false);
    var ghostShows = new List<Show>();
    foreach (var show in shows)
    {
        var hasNoEpisodes = !show.Episodes.Any();
        var folderGone = !string.IsNullOrEmpty(show.FolderPath) && !Directory.Exists(show.FolderPath);
        var noFolderPath = string.IsNullOrEmpty(show.FolderPath);
        
        // Remove if: no episodes AND (folder is gone OR no folder path at all)
        // This catches smart match entries that were added but never had files
        if (hasNoEpisodes && (folderGone || noFolderPath))
            ghostShows.Add(show);
    }

    if (ghostShows.Count > 0)
    {
        var showTmdbIds = ghostShows.Select(s => s.TmdbId).ToList();
        var castForShows = await db.CastMembers
            .Where(c => showTmdbIds.Contains(c.MediaId) && c.MediaType == "Series")
            .ToListAsync(ct)
            .ConfigureAwait(false);
        db.CastMembers.RemoveRange(castForShows);
        db.Shows.RemoveRange(ghostShows);
        removedShows = ghostShows.Count;
    }

    // Remove movies whose files no longer exist OR have no file path (smart match ghosts)
    var movies = await db.Movies.ToListAsync(ct).ConfigureAwait(false);
    var ghostMovies = new List<Movie>();
    foreach (var movie in movies)
    {
        var noFilePath = string.IsNullOrEmpty(movie.FilePath);
        var fileGone = !string.IsNullOrEmpty(movie.FilePath) && !File.Exists(movie.FilePath);
        
        // Remove if: no file path at all OR file path exists but file is gone
        // This catches smart match entries that were added but never had files
        if (noFilePath || fileGone)
            ghostMovies.Add(movie);
    }
    
    if (ghostMovies.Count > 0)
    {
        var movieTmdbIds = ghostMovies.Select(m => m.TmdbId).ToList();
        var castForMovies = await db.CastMembers
            .Where(c => movieTmdbIds.Contains(c.MediaId) && c.MediaType == "Movie")
            .ToListAsync(ct)
            .ConfigureAwait(false);
        db.CastMembers.RemoveRange(castForMovies);
        db.Movies.RemoveRange(ghostMovies);
        removedMovies = ghostMovies.Count;
    }

    await db.SaveChangesAsync(ct).ConfigureAwait(false);

    return Results.Json(new
    {
        removedShows,
        removedMovies,
        removedEpisodes,
        message = $"Removed {removedShows} shows, {removedMovies} movies, {removedEpisodes} orphan episodes (including smart match entries without files)"
    }, jsonSerializerOptions);
});

app.MapPost("/api/library/refresh-artwork", async (LibraryContext db, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.BadRequest(new { error = "TMDB API key not configured." });

    var movies = await db.Movies.Where(m => m.IsMatched && m.TmdbId > 0).ToListAsync(ct).ConfigureAwait(false);
    var shows = await db.Shows.Where(s => s.IsMatched && s.TmdbId > 0).ToListAsync(ct).ConfigureAwait(false);

    var failures = 0;

    foreach (var m in movies)
    {
        var art = await tmdb.GetArtworkPathsAsync(m.TmdbId, "Movie", ct).ConfigureAwait(false);
        if (art == null)
        {
            failures++;
            continue;
        }

        var (posterPath, backdropPath) = art.Value;
        try
        {
            if (!string.IsNullOrEmpty(posterPath))
                m.PosterLocalPath = await tmdb
                    .DownloadImageAsync(posterPath, $"poster_Movie_{m.TmdbId}.jpg", ct)
                    .ConfigureAwait(false);
            if (!string.IsNullOrEmpty(backdropPath))
                m.BackdropLocalPath = await tmdb
                    .DownloadImageAsync(backdropPath, $"backdrop_{m.TmdbId}.jpg", ct, null, "w1280")
                    .ConfigureAwait(false);
        }
        catch
        {
            failures++;
        }
    }

    foreach (var s in shows)
    {
        var art = await tmdb.GetArtworkPathsAsync(s.TmdbId, "Series", ct).ConfigureAwait(false);
        if (art == null)
        {
            failures++;
            continue;
        }

        var (posterPath, backdropPath) = art.Value;
        try
        {
            if (!string.IsNullOrEmpty(posterPath))
                s.PosterLocalPath = await tmdb
                    .DownloadImageAsync(posterPath, $"poster_Series_{s.TmdbId}.jpg", ct)
                    .ConfigureAwait(false);
            if (!string.IsNullOrEmpty(backdropPath))
                s.BackdropLocalPath = await tmdb
                    .DownloadImageAsync(backdropPath, $"backdrop_{s.TmdbId}.jpg", ct, null, "w1280")
                    .ConfigureAwait(false);
        }
        catch
        {
            failures++;
        }
    }

    await db.SaveChangesAsync(ct).ConfigureAwait(false);

    return Results.Json(new
    {
        movies = movies.Count,
        shows = shows.Count,
        failures
    }, jsonSerializerOptions);
});

app.MapGet("/api/library/title-search", async (string? q, LibraryContext db, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
    {
        return Results.Json(new { movies = Array.Empty<object>(), shows = Array.Empty<object>() },
            jsonSerializerOptions);
    }

    var term = q.Trim();
    var lower = term.ToLowerInvariant();
    var movies = await db.Movies.AsNoTracking()
        .Where(m => m.Title.ToLower().Contains(lower))
        .OrderBy(m => m.Title)
        .Take(50)
        .Select(m => new { kind = "movie", id = m.Id, title = m.Title, year = m.Year })
        .ToListAsync(ct)
        .ConfigureAwait(false);
    var shows = await db.Shows.AsNoTracking()
        .Where(s => s.Title.ToLower().Contains(lower))
        .OrderBy(s => s.Title)
        .Take(50)
        .Select(s => new { kind = "series", id = s.Id, title = s.Title, year = s.Year })
        .ToListAsync(ct)
        .ConfigureAwait(false);

    return Results.Json(new { movies, shows }, jsonSerializerOptions);
});

/// <summary>Maps TMDB ids from online streaming search to library movie/episode ids for watch status.</summary>
app.MapGet("/api/library/watch-target", async (
    int tmdbId,
    string? mediaType,
    int? season,
    int? episode,
    LibraryRepository repo,
    CancellationToken ct) =>
{
    if (tmdbId <= 0)
        return Results.Json(new { matched = false }, jsonSerializerOptions);
    var mt = string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase) ? "Series" : "Movie";
    if (mt == "Movie")
    {
        var movie = await repo.GetMovieByTmdbIdAsync(tmdbId, ct).ConfigureAwait(false);
        if (movie is not { IsMatched: true })
            return Results.Json(new { matched = false }, jsonSerializerOptions);
        return Results.Json(new { matched = true, movieId = movie.Id }, jsonSerializerOptions);
    }

    if (season is null || season < 1 || episode is null || episode < 1)
        return Results.Json(new { matched = false }, jsonSerializerOptions);
    var show = await repo.GetShowByTmdbIdAsync(tmdbId, ct).ConfigureAwait(false);
    if (show is not { IsMatched: true })
        return Results.Json(new { matched = false }, jsonSerializerOptions);
    var eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
    var ep = eps.FirstOrDefault(e => e.Season == season.Value && e.EpisodeNumber == episode.Value);
    if (ep == null)
        return Results.Json(new { matched = false }, jsonSerializerOptions);
    return Results.Json(new { matched = true, episodeId = ep.Id }, jsonSerializerOptions);
});

app.MapDelete("/api/library/movie/{id:int}", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var ok = await repo.DeleteMovieByIdAsync(id, ct).ConfigureAwait(false);
    return ok ? Results.Ok(new { success = true }) : Results.NotFound();
});

app.MapDelete("/api/library/show/{id:int}", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var ok = await repo.DeleteShowByIdAsync(id, ct).ConfigureAwait(false);
    return ok ? Results.Ok(new { success = true }) : Results.NotFound();
});

app.MapPost("/api/maintenance/clear-image-cache", () =>
{
    var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Pitflix",
        "Images");
    var deleted = 0;
    try
    {
        if (Directory.Exists(root))
        {
            foreach (var f in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
            {
                try
                {
                    File.Delete(f);
                    deleted++;
                }
                catch
                {
                    // skip locked files
                }
            }
        }
    }
    catch
    {
        return Results.Json(new { success = false, deleted, message = "Could not clear cache." },
            jsonSerializerOptions);
    }

    return Results.Json(new { success = true, deleted, message = $"Deleted {deleted} cached image files." },
        jsonSerializerOptions);
});

app.MapPost("/api/episodes/{id:int}/watch", async (int id, EpisodeWatchBody body, LibraryRepository repo, CancellationToken ct) =>
{
    var status = string.IsNullOrWhiteSpace(body.WatchStatus)
        ? WatchStatuses.Unwatched
        : body.WatchStatus!;
    if (!WatchStatuses.IsValid(status))
        return Results.BadRequest();

    await repo.UpdateEpisodeWatchStatusAsync(id, status, ct).ConfigureAwait(false);
    return Results.Json(new { success = true }, jsonSerializerOptions);
});

// —— Settings ——
app.MapGet("/api/settings", async (LibraryRepository repo, LibraryContext db, CancellationToken ct) =>
{
    await repo.EnsureLibraryFoldersTableAsync(ct).ConfigureAwait(false);
    var key = await repo.GetSettingAsync("TmdbApiKey", ct).ConfigureAwait(false);
    var masked = MaskKey(key);
    var osKey = await repo.GetSettingAsync("OpenSubtitlesApiKey", ct).ConfigureAwait(false);
    var osMasked = MaskKey(osKey);
    var paths = await repo.GetAllLibraryPathsAsync(ct).ConfigureAwait(false);
    var pinnedScanPaths = (await repo.GetPinnedScanPathsAsync(ct).ConfigureAwait(false)).ToList();
    var excludedScanPaths = (await repo.GetExcludedScanPathsAsync(ct).ConfigureAwait(false)).ToList();
    var matchedMovies = await repo.CountMatchedMoviesAsync(ct).ConfigureAwait(false);
    var matchedSeries = await repo.CountMatchedShowsAsync(ct).ConfigureAwait(false);
    var unmatchedCount = await db.ScanLogs.AsNoTracking().CountAsync(x => x.Status == "Unmatched", ct)
        .ConfigureAwait(false);
    var mediaPlayerPath = await repo.GetSettingAsync("MediaPlayerPath", ct).ConfigureAwait(false) ?? "";
    var useBuiltinRaw = await repo.GetSettingAsync("UseBuiltinPlayer", ct).ConfigureAwait(false);
    var useBuiltinPlayer = string.IsNullOrWhiteSpace(useBuiltinRaw) ||
                           string.Equals(useBuiltinRaw, "true", StringComparison.OrdinalIgnoreCase);

    var scanToastsRaw = await repo.GetSettingAsync("LibraryScanDesktopToasts", ct).ConfigureAwait(false);
    var libraryScanDesktopToasts = string.IsNullOrWhiteSpace(scanToastsRaw) ||
                                   string.Equals(scanToastsRaw, "true", StringComparison.OrdinalIgnoreCase);

    var setupRaw = await repo.GetSettingAsync("SetupComplete", ct).ConfigureAwait(false);
    var setupComplete = string.Equals(setupRaw, "true", StringComparison.OrdinalIgnoreCase);

    var stepRaw = await repo.GetSettingAsync("SetupWizardStep", ct).ConfigureAwait(false);
    int? setupWizardStep = int.TryParse(stepRaw, out var ws) ? ws : null;
    var wizardJson = await repo.GetSettingAsync("SetupWizardState", ct).ConfigureAwait(false);
    object? setupWizardState = null;
    if (!string.IsNullOrWhiteSpace(wizardJson))
    {
        try
        {
            setupWizardState = JsonSerializer.Deserialize<object>(wizardJson);
        }
        catch
        {
            setupWizardState = null;
        }
    }

    return Results.Json(new
    {
        tmdbApiKey = masked,
        openSubtitlesApiKey = osMasked,
        libraryPaths = paths,
        pinnedScanPaths,
        excludedScanPaths,
        matchedMovies,
        matchedSeries,
        unmatchedCount,
        mediaPlayerPath,
        useBuiltinPlayer,
        libraryScanDesktopToasts,
        setupComplete,
        setupWizardStep,
        setupWizardState
    });
});

app.MapPost("/api/settings", async (SettingsBody body, LibraryRepository repo, CancellationToken ct) =>
{
    if (body.LibraryPaths != null)
    {
        var existing = await repo.GetAllLibraryPathsAsync(ct).ConfigureAwait(false);
        foreach (var p in existing)
        {
            if (!body.LibraryPaths.Contains(p, StringComparer.OrdinalIgnoreCase))
                await repo.RemoveLibraryPathAsync(p, ct).ConfigureAwait(false);
        }

        foreach (var p in body.LibraryPaths)
        {
            if (!string.IsNullOrWhiteSpace(p))
                await repo.SaveLibraryPathAsync(p.Trim(), ct).ConfigureAwait(false);
        }
    }

    if (!string.IsNullOrWhiteSpace(body.TmdbApiKey) &&
        !body.TmdbApiKey.Contains("PASTE_YOUR_KEY", StringComparison.OrdinalIgnoreCase))
        await repo.SaveSettingAsync("TmdbApiKey", body.TmdbApiKey.Trim(), ct).ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.OpenSubtitlesApiKey))
        await repo.SaveSettingAsync("OpenSubtitlesApiKey", body.OpenSubtitlesApiKey.Trim(), ct).ConfigureAwait(false);

    if (body.OpenSubtitlesAppName != null)
        await repo.SaveSettingAsync("OpenSubtitlesAppName", body.OpenSubtitlesAppName.Trim(), ct).ConfigureAwait(false);

    if (body.MediaPlayerPath != null)
        await repo.SaveSettingAsync("MediaPlayerPath", body.MediaPlayerPath.Trim(), ct).ConfigureAwait(false);

    if (body.UseBuiltinPlayer.HasValue)
        await repo.SaveSettingAsync("UseBuiltinPlayer", body.UseBuiltinPlayer.Value ? "true" : "false", ct)
            .ConfigureAwait(false);

    if (body.LibraryScanDesktopToasts.HasValue)
        await repo.SaveSettingAsync("LibraryScanDesktopToasts", body.LibraryScanDesktopToasts.Value ? "true" : "false", ct)
            .ConfigureAwait(false);

    AppSettings.ResolveTmdbApiKeyFromSources(repo);
    AppSettings.ResolveOpenSubtitlesFromSources(repo);
    return Results.Json(new { success = true });
});

app.MapGet("/api/settings/verify-tmdb", async (string? key, CancellationToken ct) =>
{
    var k = key?.Trim();
    if (string.IsNullOrEmpty(k))
        return Results.Json(new { valid = false, error = "Key is required." }, jsonSerializerOptions);

    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        var url = $"https://api.themoviedb.org/3/configuration?api_key={Uri.EscapeDataString(k)}";
        using var res = await http.GetAsync(url, ct).ConfigureAwait(false);
        if (res.IsSuccessStatusCode)
            return Results.Json(new { valid = true, error = (string?)null }, jsonSerializerOptions);

        var err = res.StatusCode == HttpStatusCode.Unauthorized
            ? "Unauthorized — check the key."
            : $"TMDB returned {(int)res.StatusCode}.";
        return Results.Json(new { valid = false, error = err }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        return Results.Json(new { valid = false, error = ex.Message }, jsonSerializerOptions);
    }
});

app.MapGet("/api/settings/verify-opensubtitles", async (string? key, CancellationToken ct) =>
{
    var k = key?.Trim();
    if (string.IsNullOrEmpty(k))
        return Results.Json(new { valid = false, error = "Key is required." }, jsonSerializerOptions);

    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        http.DefaultRequestHeaders.TryAddWithoutValidation("Api-Key", k);
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix Setup v1.0");
        using var res = await http
            .GetAsync(new Uri("https://api.opensubtitles.com/api/v1/infos/languages"), ct)
            .ConfigureAwait(false);
        if (res.IsSuccessStatusCode)
            return Results.Json(new { valid = true, error = (string?)null }, jsonSerializerOptions);

        var err = res.StatusCode == HttpStatusCode.Unauthorized
            ? "Unauthorized — check the API key."
            : $"OpenSubtitles returned {(int)res.StatusCode}.";
        return Results.Json(new { valid = false, error = err }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        return Results.Json(new { valid = false, error = ex.Message }, jsonSerializerOptions);
    }
});

app.MapGet("/api/settings/path-exists", (string? path) =>
{
    var p = path?.Trim();
    if (string.IsNullOrEmpty(p))
        return Results.Json(new { exists = false });
    try
    {
        return Results.Json(new { exists = Directory.Exists(p) });
    }
    catch
    {
        return Results.Json(new { exists = false });
    }
});

app.MapPost("/api/settings/wizard-progress", async (WizardProgressBody body, LibraryRepository repo, CancellationToken ct) =>
{
    var step = Math.Clamp(body.Step, 1, 4);
    await repo.SaveSettingAsync("SetupWizardStep", step.ToString(), ct)
        .ConfigureAwait(false);
    var json = string.IsNullOrWhiteSpace(body.StateJson) ? "{}" : body.StateJson!;
    await repo.SaveSettingAsync("SetupWizardState", json, ct).ConfigureAwait(false);
    return Results.Json(new { success = true });
});

app.MapPost("/api/settings/complete-setup",
    async (CompleteSetupBody body, LibraryRepository repo, CancellationToken ct) =>
    {
        await repo.EnsureLibraryFoldersTableAsync(ct).ConfigureAwait(false);

        if (!body.TmdbSkipped && AppSettings.IsValidTmdbKey(body.TmdbApiKey))
            await repo.SaveSettingAsync("TmdbApiKey", body.TmdbApiKey!.Trim(), ct).ConfigureAwait(false);

        if (!body.OpenSubtitlesSkipped && !string.IsNullOrWhiteSpace(body.OpenSubtitlesApiKey))
            await repo.SaveSettingAsync("OpenSubtitlesApiKey", body.OpenSubtitlesApiKey.Trim(), ct)
                .ConfigureAwait(false);

        if (body.LibraryPaths != null)
        {
            foreach (var p in body.LibraryPaths)
            {
                if (string.IsNullOrWhiteSpace(p))
                    continue;
                var t = p.Trim();
                if (Directory.Exists(t))
                    await repo.SaveLibraryPathAsync(t, ct).ConfigureAwait(false);
            }
        }

        await repo.SaveSettingAsync("SetupComplete", "true", ct).ConfigureAwait(false);
        await repo.SaveSettingAsync("SetupWizardStep", "", ct).ConfigureAwait(false);
        await repo.SaveSettingAsync("SetupWizardState", "", ct).ConfigureAwait(false);

        AppSettings.ResolveTmdbApiKeyFromSources(repo);
        AppSettings.ResolveOpenSubtitlesFromSources(repo);
        return Results.Json(new { success = true });
    });

app.MapGet("/api/settings/media-player-candidates", () =>
{
    if (!OperatingSystem.IsWindows())
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);

    var list = new List<object>();
    var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    void TryAdd(string label, string path)
    {
        try
        {
            if (File.Exists(path) && !seenPaths.Contains(path))
            {
                list.Add(new { label, path });
                seenPaths.Add(path);
            }
        }
        catch
        {
            /* ignore */
        }
    }

    var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
    var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
    
    // Standard installation paths
    TryAdd("VLC", Path.Combine(pf, "VideoLAN", "VLC", "vlc.exe"));
    TryAdd("VLC (32-bit)", Path.Combine(pf86, "VideoLAN", "VLC", "vlc.exe"));
    TryAdd("mpv", Path.Combine(pf, "mpv", "mpv.exe"));
    TryAdd("MPC-HC 64-bit", Path.Combine(pf86, "MPC-HC", "mpc-hc64.exe"));
    TryAdd("MPC-HC 64-bit", Path.Combine(pf, "MPC-HC", "mpc-hc64.exe"));
    TryAdd("MPC-HC", Path.Combine(pf86, "MPC-HC", "mpc-hc.exe"));
    TryAdd("MPC-HC", Path.Combine(pf, "MPC-HC", "mpc-hc.exe"));
    TryAdd("MPC-BE 64-bit", Path.Combine(pf, "MPC-BE x64", "mpc-be64.exe"));
    TryAdd("MPC-BE", Path.Combine(pf86, "MPC-BE", "mpc-be.exe"));
    TryAdd("PotPlayer", Path.Combine(pf, "DAUM", "PotPlayer", "PotPlayerMini64.exe"));
    TryAdd("PotPlayer (x86)", Path.Combine(pf86, "DAUM", "PotPlayer", "PotPlayerMini64.exe"));
    TryAdd("PotPlayer", Path.Combine(pf, "DAUM", "PotPlayer", "PotPlayerMini.exe"));
    TryAdd("KMPlayer", Path.Combine(pf86, "KMPlayer", "kmplayer.exe"));
    TryAdd("KMPlayer", Path.Combine(pf, "KMPlayer", "kmplayer.exe"));
    TryAdd("Windows Media Player", Path.Combine(pf, "Windows Media Player", "wmplayer.exe"));
    
    // Scan C:\Program Files for common player executables
    var playerNames = new[] 
    { 
        "vlc.exe", "mpv.exe", "mpc-hc64.exe", "mpc-hc.exe", "mpc-be64.exe", "mpc-be.exe",
        "PotPlayerMini64.exe", "PotPlayerMini.exe", "kmplayer.exe", "smplayer.exe",
        "bsplayer.exe", "gomplayer.exe", "zoom player.exe"
    };
    
    try
    {
        // Scan Program Files
        if (Directory.Exists(pf))
        {
            foreach (var dir in Directory.GetDirectories(pf))
            {
                foreach (var playerName in playerNames)
                {
                    var exePath = Path.Combine(dir, playerName);
                    if (File.Exists(exePath) && !seenPaths.Contains(exePath))
                    {
                        var dirName = Path.GetFileName(dir);
                        TryAdd($"{dirName} ({playerName})", exePath);
                    }
                    
                    // Check one level deeper
                    try
                    {
                        foreach (var subDir in Directory.GetDirectories(dir))
                        {
                            var subExePath = Path.Combine(subDir, playerName);
                            if (File.Exists(subExePath) && !seenPaths.Contains(subExePath))
                            {
                                var subDirName = Path.GetFileName(subDir);
                                TryAdd($"{subDirName} ({playerName})", subExePath);
                            }
                        }
                    }
                    catch { /* ignore subdirectory scan errors */ }
                }
            }
        }
        
        // Scan Program Files (x86)
        if (Directory.Exists(pf86) && !string.Equals(pf, pf86, StringComparison.OrdinalIgnoreCase))
        {
            foreach (var dir in Directory.GetDirectories(pf86))
            {
                foreach (var playerName in playerNames)
                {
                    var exePath = Path.Combine(dir, playerName);
                    if (File.Exists(exePath) && !seenPaths.Contains(exePath))
                    {
                        var dirName = Path.GetFileName(dir);
                        TryAdd($"{dirName} ({playerName})", exePath);
                    }
                    
                    // Check one level deeper
                    try
                    {
                        foreach (var subDir in Directory.GetDirectories(dir))
                        {
                            var subExePath = Path.Combine(subDir, playerName);
                            if (File.Exists(subExePath) && !seenPaths.Contains(subExePath))
                            {
                                var subDirName = Path.GetFileName(subDir);
                                TryAdd($"{subDirName} ({playerName})", subExePath);
                            }
                        }
                    }
                    catch { /* ignore subdirectory scan errors */ }
                }
            }
        }
    }
    catch
    {
        /* ignore scan errors */
    }

    return Results.Json(list, jsonSerializerOptions);
});

// Legacy: autostart is handled by the Tauri desktop app (tauri-plugin-autostart) using the real UI exe.
// These routes are unused by current Settings UI but kept for older clients / tooling.
app.MapGet("/api/settings/autostart-status", () =>
{
    if (!OperatingSystem.IsWindows())
        return Results.Json(new { enabled = false, supported = false }, jsonSerializerOptions);

    try
    {
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false);
        var value = key?.GetValue("Pitflix");
        var enabled = value != null;
        return Results.Json(new { enabled, supported = true }, jsonSerializerOptions);
    }
    catch
    {
        return Results.Json(new { enabled = false, supported = true, error = "Cannot read registry" }, jsonSerializerOptions);
    }
});

app.MapPost("/api/settings/autostart", async (HttpRequest request, CancellationToken ct) =>
{
    if (!OperatingSystem.IsWindows())
        return Results.BadRequest(new { error = "Autostart is only supported on Windows." });

    var req = await request.ReadFromJsonAsync<AutostartRequest>(cancellationToken: ct).ConfigureAwait(false);
    var enable = req?.Enable ?? false;

    try
    {
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
        if (key == null)
            return Results.BadRequest(new { error = "Cannot access Windows startup registry." });

        if (enable)
        {
            // Get the path to the Pitflix executable
            var exePath = Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrEmpty(exePath))
                return Results.BadRequest(new { error = "Cannot determine executable path." });

            // For the Tauri app, we want to launch the UI exe, not the API
            // Check if we're running as the bundled API (inside Pitflix app directory)
            var exeDir = Path.GetDirectoryName(exePath);
            if (exeDir != null)
            {
                // Look for Pitflix.exe in parent or same directory
                var uiExe = Path.Combine(exeDir, "Pitflix.exe");
                if (!File.Exists(uiExe))
                {
                    // Try parent directory
                    var parentDir = Directory.GetParent(exeDir)?.FullName;
                    if (parentDir != null)
                    {
                        uiExe = Path.Combine(parentDir, "Pitflix.exe");
                        if (File.Exists(uiExe))
                            exePath = uiExe;
                    }
                }
                else
                {
                    exePath = uiExe;
                }
            }

            key.SetValue("Pitflix", $"\"{exePath}\"");
        }
        else
        {
            key.DeleteValue("Pitflix", false);
        }

        return Results.Ok(new { success = true, enabled = enable });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = $"Failed to update autostart: {ex.Message}" });
    }
});

app.MapPost("/api/settings/paths", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var req = await request.ReadFromJsonAsync<PathRequest>(cancellationToken: ct).ConfigureAwait(false);
    var path = req?.Path?.Trim();
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { error = "Path is required." });
    if (!Directory.Exists(path))
        return Results.BadRequest(new { error = "Folder not found on disk" });

    await repo.EnsureLibraryFoldersTableAsync(ct).ConfigureAwait(false);
    await repo.SaveLibraryPathAsync(path, ct).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

app.MapDelete("/api/settings/paths", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var req = await request.ReadFromJsonAsync<PathRequest>(cancellationToken: ct).ConfigureAwait(false);
    var path = req?.Path?.Trim();
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { error = "Path is required." });

    await repo.EnsureLibraryFoldersTableAsync(ct).ConfigureAwait(false);
    await repo.RemoveLibraryPathAsync(path, ct).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

app.MapPost("/api/settings/pinned-paths", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var req = await request.ReadFromJsonAsync<PathRequest>(cancellationToken: ct).ConfigureAwait(false);
    var path = req?.Path?.Trim();
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { error = "Path is required." });
    if (!Directory.Exists(path))
        return Results.BadRequest(new { error = "Folder not found on disk" });

    await repo.AddPinnedScanPathAsync(path, ct).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

app.MapDelete("/api/settings/pinned-paths", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var req = await request.ReadFromJsonAsync<PathRequest>(cancellationToken: ct).ConfigureAwait(false);
    var path = req?.Path?.Trim();
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { error = "Path is required." });

    await repo.RemovePinnedScanPathAsync(path, ct).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

app.MapPost("/api/settings/excluded-paths", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var req = await request.ReadFromJsonAsync<PathRequest>(cancellationToken: ct).ConfigureAwait(false);
    var path = req?.Path?.Trim();
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { error = "Path is required." });
    if (!Directory.Exists(path))
        return Results.BadRequest(new { error = "Folder not found on disk" });

    await repo.AddExcludedScanPathAsync(path, ct).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

app.MapDelete("/api/settings/excluded-paths", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var req = await request.ReadFromJsonAsync<PathRequest>(cancellationToken: ct).ConfigureAwait(false);
    var path = req?.Path?.Trim();
    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { error = "Path is required." });

    await repo.RemoveExcludedScanPathAsync(path, ct).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

app.MapDelete("/api/library/delete-from-device", async (HttpRequest request, LibraryRepository repo, CancellationToken ct) =>
{
    var req = await request.ReadFromJsonAsync<DeleteFromDeviceRequest>(cancellationToken: ct).ConfigureAwait(false);
    var path = req?.Path?.Trim();
    var mediaType = req?.MediaType?.Trim();
    var libraryId = req?.LibraryId ?? 0;

    if (string.IsNullOrWhiteSpace(path))
        return Results.BadRequest(new { error = "Path is required." });
    
    if (string.IsNullOrWhiteSpace(mediaType))
        return Results.BadRequest(new { error = "Media type is required." });

    try
    {
        if (mediaType == "Series")
        {
            if (!Directory.Exists(path))
                return Results.BadRequest(new { error = "Series folder not found on device." });
            
            Directory.Delete(path, recursive: true);
            
            if (libraryId > 0)
            {
                var show = await repo.GetShowByIdAsync(libraryId, ct).ConfigureAwait(false);
                if (show != null)
                {
                    await repo.DeleteShowByIdAsync(show.Id, ct).ConfigureAwait(false);
                }
            }
        }
        else if (mediaType == "Movie")
        {
            if (!File.Exists(path))
                return Results.BadRequest(new { error = "Movie file not found on device." });
            
            File.Delete(path);
            
            if (libraryId > 0)
            {
                var movie = await repo.GetMovieByIdAsync(libraryId, ct).ConfigureAwait(false);
                if (movie != null)
                {
                    await repo.DeleteMovieByIdAsync(movie.Id, ct).ConfigureAwait(false);
                }
            }
        }
        else
        {
            return Results.BadRequest(new { error = "Invalid media type." });
        }

        return Results.Ok(new { success = true });
    }
    catch (UnauthorizedAccessException)
    {
        return Results.BadRequest(new { error = "Access denied. Check file/folder permissions." });
    }
    catch (IOException ex)
    {
        return Results.BadRequest(new { error = $"Could not delete: {ex.Message}" });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = $"Failed to delete: {ex.Message}" });
    }
});

app.MapPost("/api/library/cleanup-missing-files", async (LibraryRepository repo, CancellationToken ct) =>
{
    try
    {
        var removedEpisodes = 0;
        var removedMovies = 0;
        var removedShows = 0;

        // Clean up episodes with missing files
        var allShows = await repo.GetAllShowsAsync(ct).ConfigureAwait(false);
        foreach (var show in allShows)
        {
            var episodes = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
            var missingEpisodes = episodes.Where(e => !string.IsNullOrWhiteSpace(e.FilePath) && !File.Exists(e.FilePath)).ToList();
            
            foreach (var ep in missingEpisodes)
            {
                await repo.DeleteEpisodeAsync(ep.Id, ct).ConfigureAwait(false);
                removedEpisodes++;
            }

            // If show has no episodes left, delete the show
            var remainingEpisodes = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
            if (remainingEpisodes.Count == 0)
            {
                await repo.DeleteShowByIdAsync(show.Id, ct).ConfigureAwait(false);
                removedShows++;
            }
        }

        // Clean up movies with missing files
        var allMovies = await repo.GetAllMoviesAsync(ct).ConfigureAwait(false);
        var missingMovies = allMovies.Where(m => !string.IsNullOrWhiteSpace(m.FilePath) && !File.Exists(m.FilePath)).ToList();
        
        foreach (var movie in missingMovies)
        {
            await repo.DeleteMovieByIdAsync(movie.Id, ct).ConfigureAwait(false);
            removedMovies++;
        }

        return Results.Ok(new
        {
            success = true,
            removedEpisodes,
            removedMovies,
            removedShows,
            message = $"Cleaned up {removedEpisodes} episodes, {removedMovies} movies, and {removedShows} shows with missing files."
        });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = $"Cleanup failed: {ex.Message}" });
    }
});

/// <summary>Opens a Windows folder dialog in the API process (works from the browser UI on the same PC).</summary>
app.MapPost("/api/settings/native-pick-folder", () =>
{
    if (!OperatingSystem.IsWindows())
    {
        return Results.Json(
            new { path = (string?)null, error = "Native folder picker needs Pitflix.API running on Windows." },
            jsonSerializerOptions);
    }

    try
    {
        var path = NativeWindowsDialogs.PickFolder("Select a folder to add to your library");
        return Results.Json(new { path, error = (string?)null }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        return Results.Json(new { path = (string?)null, error = ex.Message }, jsonSerializerOptions);
    }
});

app.MapPost("/api/settings/native-pick-executable", () =>
{
    if (!OperatingSystem.IsWindows())
    {
        return Results.Json(
            new { path = (string?)null, error = "Native file picker needs Pitflix.API running on Windows." },
            jsonSerializerOptions);
    }

    try
    {
        var path = NativeWindowsDialogs.PickExecutable("Choose media player (.exe)");
        return Results.Json(new { path, error = (string?)null }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        return Results.Json(new { path = (string?)null, error = ex.Message }, jsonSerializerOptions);
    }
});

// —— Stats ——
app.MapGet("/api/stats", async (LibraryRepository repo, LibraryContext db, CancellationToken ct) =>
{
    var totalMovies = await db.Movies.AsNoTracking().CountAsync(m => m.IsMatched, ct).ConfigureAwait(false);
    var totalSeries = await db.Shows.AsNoTracking().CountAsync(s => s.IsMatched, ct).ConfigureAwait(false);
    var totalUnmatched = await db.ScanLogs.AsNoTracking().CountAsync(x => x.Status == "Unmatched", ct)
        .ConfigureAwait(false);
    var arabicMovies = await db.Movies.AsNoTracking().CountAsync(m => m.IsMatched && m.IsArabic, ct)
        .ConfigureAwait(false);
    var englishMovies = await db.Movies.AsNoTracking().CountAsync(m => m.IsMatched && !m.IsArabic, ct)
        .ConfigureAwait(false);
    var arabicSeries = await db.Shows.AsNoTracking().CountAsync(s => s.IsMatched && s.IsArabic, ct)
        .ConfigureAwait(false);
    var englishSeries = await db.Shows.AsNoTracking().CountAsync(s => s.IsMatched && !s.IsArabic, ct)
        .ConfigureAwait(false);
    var moviesUnwatched = await db.Movies.AsNoTracking()
        .CountAsync(m => m.IsMatched && m.WatchStatus == WatchStatuses.Unwatched, ct).ConfigureAwait(false);
    var moviesWatching = await db.Movies.AsNoTracking()
        .CountAsync(m => m.IsMatched && m.WatchStatus == WatchStatuses.Watching, ct).ConfigureAwait(false);
    var moviesCompleted = await db.Movies.AsNoTracking()
        .CountAsync(m => m.IsMatched && m.WatchStatus == WatchStatuses.Completed, ct).ConfigureAwait(false);
    var seriesUnwatched = await db.Shows.AsNoTracking()
        .CountAsync(s => s.IsMatched && s.WatchStatus == WatchStatuses.Unwatched, ct).ConfigureAwait(false);
    var seriesWatching = await db.Shows.AsNoTracking()
        .CountAsync(s => s.IsMatched && s.WatchStatus == WatchStatuses.Watching, ct).ConfigureAwait(false);
    var seriesCompleted = await db.Shows.AsNoTracking()
        .CountAsync(s => s.IsMatched && s.WatchStatus == WatchStatuses.Completed, ct).ConfigureAwait(false);
    var imgPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Pitflix", "Images");
    var imgExists = Directory.Exists(imgPath);
    var imgCount = imgExists ? Directory.GetFiles(imgPath).Length : 0;

    return Results.Json(new
    {
        totalMovies,
        totalSeries,
        totalUnmatched,
        arabicMovies,
        englishMovies,
        arabicSeries,
        englishSeries,
        moviesUnwatched,
        moviesWatching,
        moviesCompleted,
        seriesUnwatched,
        seriesWatching,
        seriesCompleted,
        imagesCachePath = ImageUrls.ImagesRoot,
        imagesFolderExists = imgExists,
        imagesRootFileCount = imgCount
    });
});

app.MapGet("/api/stats/watch", async (LibraryRepository repo, CancellationToken ct) =>
{
    var b = await repo.GetWatchStatisticsBundleAsync(ct).ConfigureAwait(false);
    var tmdb = TmdbClientFactory.Create();
    var recent = new List<MediaCardDto>();
    foreach (var o in b.RecentlyCompleted)
    {
        if (o is Movie mm)
            recent.Add(ToCardFromMovie(mm));
        else if (o is Show ss)
            recent.Add(ToCardFromShow(ss));
    }

    var mapped = recent.Select(ImageUrls.MapMediaCard).ToList();
    await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(mapped, tmdb, ct).ConfigureAwait(false);
    return Results.Json(new
    {
        totalWatchTimeMinutes = b.TotalWatchTimeMinutes,
        thisWeekMinutes = b.ThisWeekMinutes,
        thisMonthMinutes = b.ThisMonthMinutes,
        totalMoviesWatched = b.TotalMoviesWatched,
        totalEpisodesWatched = b.TotalEpisodesWatched,
        totalSeriesCompleted = b.TotalSeriesCompleted,
        topGenres = b.TopGenres.Select(g => new { genre = g.Genre, count = g.Count }).ToList(),
        topLanguage = b.TopLanguage,
        recentlyCompleted = mapped,
        watchStreak = b.WatchStreak,
        movieVsSeries = new { moviePercent = b.MoviePercent, seriesPercent = b.SeriesPercent },
        mostWatchedGenre = b.MostWatchedGenre,
        averageMovieRating = b.AverageMovieRating,
        averageSeriesRating = b.AverageSeriesRating,
        currentlyWatchingCount = b.CurrentlyWatchingCount,
        episodesCompletedThisWeek = b.EpisodesCompletedThisWeek,
        seriesCompletionPercent = b.SeriesCompletionPercent,
        showsWatchingLibrary = b.ShowsWatchingLibrary,
        decadeTop = b.DecadeTop.Select(d => new { decade = d.DecadeLabel, count = d.Count }).ToList(),
        rewatchSessionsApprox = b.RewatchSessionsApprox
    }, jsonSerializerOptions);
});

OpenSubtitlesClient? CreateOpenSubtitlesClient(IConfiguration cfg)
{
    var key = AppSettings.ResolvedOpenSubtitlesApiKey?.Trim();
    if (string.IsNullOrEmpty(key))
        key = cfg["OpenSubtitlesApiKey"]?.Trim();
    if (string.IsNullOrEmpty(key))
        return null;
    var app = AppSettings.ResolvedOpenSubtitlesAppName?.Trim()
        ?? cfg["OpenSubtitlesAppName"]?.Trim();
    return new OpenSubtitlesClient(key, string.IsNullOrEmpty(app) ? "Pitflix" : app);
}

static object SubtitleRowJson(SubtitleResult s) => new
{
    subtitleId = s.SubtitleId,
    language = s.Language,
    releaseName = s.ReleaseName,
    downloadCount = s.DownloadCount,
    ratings = s.Ratings,
    isHearingImpaired = s.IsHearingImpaired,
    isMachineTranslated = s.IsMachineTranslated,
    format = s.Format,
    fileId = s.FileId,
    fileName = s.FileName
};

app.MapGet("/api/subtitles/movie/{id:int}", async (int id, LibraryRepository repo, IConfiguration cfg,
    CancellationToken ct) =>
{
    using var os = CreateOpenSubtitlesClient(cfg);
    if (os == null || !os.IsConfigured)
        return Results.Json(new { items = Array.Empty<object>(), error = (string?)null }, jsonSerializerOptions);

    var m = await repo.GetMovieByIdAsync(id, ct).ConfigureAwait(false);
    if (m == null)
        return Results.NotFound();

    var outcome = await os.SearchAsync(m.Title, null, null, "movie", m.TmdbId, ct).ConfigureAwait(false);
    return Results.Json(new
    {
        items = outcome.Items.Select(SubtitleRowJson).ToList(),
        error = outcome.Error
    }, jsonSerializerOptions);
});

app.MapGet("/api/subtitles/episode/{id:int}", async (int id, LibraryContext db, IConfiguration cfg, CancellationToken ct) =>
{
    using var os = CreateOpenSubtitlesClient(cfg);
    if (os == null || !os.IsConfigured)
        return Results.Json(new { items = Array.Empty<object>(), error = (string?)null }, jsonSerializerOptions);

    var ep = await db.Episodes.AsNoTracking()
        .Include(e => e.Show)
        .FirstOrDefaultAsync(e => e.Id == id, ct)
        .ConfigureAwait(false);
    if (ep?.Show == null)
        return Results.NotFound();

    var outcome = await os
        .SearchAsync(ep.Show.Title, ep.Season, ep.EpisodeNumber, "episode", ep.Show.TmdbId, ct)
        .ConfigureAwait(false);
    return Results.Json(new
    {
        items = outcome.Items.Select(SubtitleRowJson).ToList(),
        error = outcome.Error
    }, jsonSerializerOptions);
});

app.MapGet("/api/subtitles/search", async (string? query, string? type, int? season, int? episode, int? parentTmdbId,
    int? tmdbId, IConfiguration cfg, CancellationToken ct) =>
{
    using var os = CreateOpenSubtitlesClient(cfg);
    if (os == null || !os.IsConfigured)
        return Results.Json(new { items = Array.Empty<object>(), error = (string?)null }, jsonSerializerOptions);

    var q = query?.Trim() ?? "";
    if (string.IsNullOrEmpty(q))
        return Results.Json(new { items = Array.Empty<object>(), error = "Enter a search query." }, jsonSerializerOptions);

    var mediaType = string.Equals(type, "episode", StringComparison.OrdinalIgnoreCase) ? "episode" : "movie";
    int? tmdb = null;
    if (mediaType == "episode")
    {
        if (parentTmdbId is > 0)
            tmdb = parentTmdbId;
    }
    else if (tmdbId is > 0)
        tmdb = tmdbId;

    var outcome = await os.SearchAsync(q, season, episode, mediaType, tmdb, ct).ConfigureAwait(false);
    return Results.Json(new
    {
        items = outcome.Items.Select(SubtitleRowJson).ToList(),
        error = outcome.Error
    }, jsonSerializerOptions);
});

app.MapPost("/api/subtitles/download", async (SubtitleDownloadBody body, IConfiguration cfg, CancellationToken ct) =>
{
    using var os = CreateOpenSubtitlesClient(cfg);
    if (os == null || !os.IsConfigured)
        return Results.Json(new { success = false, savedPath = (string?)null, error = "OpenSubtitles API key not configured." }, jsonSerializerOptions);

    var path = body.VideoFilePath ?? "";
    var lang = string.IsNullOrWhiteSpace(body.LanguageCode) ? "en" : body.LanguageCode!;
    var (ok, saved, err) = await os.DownloadAsync(body.FileId, path, lang, ct).ConfigureAwait(false);
    return ok
        ? Results.Json(new { success = true, savedPath = saved, error = (string?)null }, jsonSerializerOptions)
        : Results.Json(new { success = false, savedPath = (string?)null, error = err }, jsonSerializerOptions);
});

// —— SubDL subtitle provider ——
app.MapGet("/api/subtitles/subdl/search", async (
    string? imdbId, int? tmdbId, string? title,
    string? mediaType, int? season, int? episode,
    LibraryRepository repo, CancellationToken ct) =>
{
    var sdlKey = await repo.GetSettingAsync("SubDlApiKey", ct).ConfigureAwait(false);
    using var sdl = new SubDlClient(sdlKey);
    var mt = string.IsNullOrWhiteSpace(mediaType) ? "Movie" : mediaType!;
    var outcome = await sdl.SearchAsync(title, imdbId, tmdbId, mt, season, episode, ct).ConfigureAwait(false);
    var items = outcome.Items.Select(s => new
    {
        releaseName = s.ReleaseName, language = s.Language,
        fullLink = s.FullLink, isHearingImpaired = s.IsHearingImpaired, format = s.Type,
    }).ToList();
    return Results.Json(new { items, error = outcome.Error }, jsonSerializerOptions);
});

app.MapPost("/api/subtitles/subdl/download", async (SubDlDownloadBody body, LibraryRepository repo, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(body.FullLink) || string.IsNullOrWhiteSpace(body.VideoFilePath))
        return Results.Json(new { success = false, savedPath = (string?)null, error = "Missing link or path." }, jsonSerializerOptions);

    var sdlKey = await repo.GetSettingAsync("SubDlApiKey", ct).ConfigureAwait(false);
    using var sdl = new SubDlClient(sdlKey);
    var (ok, saved, err) = await sdl.DownloadAsync(body.FullLink, body.VideoFilePath, body.Language ?? "", ct).ConfigureAwait(false);
    return ok
        ? Results.Json(new { success = true, savedPath = saved, error = (string?)null }, jsonSerializerOptions)
        : Results.Json(new { success = false, savedPath = (string?)null, error = err }, jsonSerializerOptions);
});

// —— GET /images/... (endpoint fallback: runs if middleware + static files pass through) ——
app.MapGet("/images/{**relativePath}", (string relativePath, HttpContext ctx) =>
{
    var decoded = Uri.UnescapeDataString(relativePath ?? "").Replace('/', Path.DirectorySeparatorChar);
    if (string.IsNullOrEmpty(decoded) || decoded.Contains("..", StringComparison.Ordinal))
        return Results.BadRequest();

    var root = Path.GetFullPath(imagesPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
    var fullPath = Path.GetFullPath(Path.Combine(root, decoded));
    var rootWithSep = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
    if (!fullPath.Equals(root, StringComparison.OrdinalIgnoreCase) &&
        !fullPath.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase))
        return Results.BadRequest();

    if (!File.Exists(fullPath))
        return Results.NotFound();

    ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
    ctx.Response.Headers["Cache-Control"] = "public,max-age=86400";
    return Results.File(fullPath, contentType: ImageContentTypeForExtension(fullPath));
});

// —— Play ——
app.MapPost("/api/play", async (PlayBody body, LibraryRepository repo, CancellationToken ct) =>
{
    try
    {
        if (string.IsNullOrWhiteSpace(body.FilePath) || !File.Exists(body.FilePath))
            return Results.Json(new { success = false, error = "File not found." });

        var filePath = body.FilePath!;
        var title = string.IsNullOrWhiteSpace(body.Title)
            ? Path.GetFileNameWithoutExtension(filePath)
            : body.Title!.Trim();
        var mediaType = string.IsNullOrWhiteSpace(body.MediaType) ? "Movie" : body.MediaType!.Trim();
        var duration = body.DurationSeconds ?? 0;
        if (duration < 0)
            duration = 0;

        if (body.SkipHistoryAdd != true)
            await repo.AddToHistoryAsync(filePath, title, body.PosterPath, mediaType, duration, ct).ConfigureAwait(false);

        var configured = await repo.GetSettingAsync("MediaPlayerPath", ct).ConfigureAwait(false);
        var trimmedExe = configured?.Trim();

        // No configured player: use the OS default app for this file type (not forced VLC).
        if (string.IsNullOrWhiteSpace(trimmedExe))
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = filePath,
                UseShellExecute = true,
            });
            return Results.Json(new { success = true });
        }

        var exe = trimmedExe;

        var startArg = "";
        if (body.StartSeconds is > 0 and var sec)
        {
            if (exe.Contains("vlc", StringComparison.OrdinalIgnoreCase))
                startArg = $" --start-time={sec}";
            else if (exe.Contains("mpv", StringComparison.OrdinalIgnoreCase))
                startArg = $" --start={sec}";
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = exe,
            Arguments = $"\"{filePath}\"{startArg}",
            UseShellExecute = true
        });
        return Results.Json(new { success = true });
    }
    catch (Exception ex)
    {
        return Results.Json(new { success = false, error = ex.Message });
    }
});

app.MapPost("/api/library/bulk-watch", async (BulkWatchBody body, LibraryRepository repo, CancellationToken ct) =>
{
    var status = body.WatchStatus ?? "";
    if (!WatchStatuses.IsValid(status))
        return Results.BadRequest(new { error = "Invalid watch status." });

    foreach (var id in body.MovieIds ?? Array.Empty<int>())
        await repo.UpdateMovieWatchStatusAsync(id, status, ct).ConfigureAwait(false);

    foreach (var id in body.ShowIds ?? Array.Empty<int>())
        await repo.UpdateShowWatchStatusAsync(id, status, ct).ConfigureAwait(false);

    return Results.Json(new { success = true }, jsonSerializerOptions);
});

app.MapPost("/api/library/bulk-remove", async (BulkLibraryIdsBody body, LibraryRepository repo, CancellationToken ct) =>
{
    foreach (var id in body.MovieIds ?? Array.Empty<int>())
        await repo.DeleteMovieByIdAsync(id, ct).ConfigureAwait(false);
    foreach (var id in body.ShowIds ?? Array.Empty<int>())
        await repo.DeleteShowByIdAsync(id, ct).ConfigureAwait(false);
    return Results.Json(new { success = true }, jsonSerializerOptions);
});

app.MapPost("/api/library/bulk-delete-from-device", async (BulkLibraryIdsBody body, LibraryRepository repo, CancellationToken ct) =>
{
    var errors = new List<string>();
    var filesDeleted = 0;

    foreach (var mid in body.MovieIds ?? Array.Empty<int>())
    {
        var m = await repo.GetMovieByIdAsync(mid, ct).ConfigureAwait(false);
        if (m == null)
            continue;
        if (!string.IsNullOrWhiteSpace(m.FilePath) && File.Exists(m.FilePath))
        {
            try
            {
                File.Delete(m.FilePath);
                filesDeleted++;
            }
            catch (Exception ex)
            {
                errors.Add($"{m.Title}: {ex.Message}");
                continue;
            }
        }

        await repo.DeleteMovieByIdAsync(mid, ct).ConfigureAwait(false);
    }

    foreach (var sid in body.ShowIds ?? Array.Empty<int>())
    {
        var eps = await repo.GetEpisodesForShowAsync(sid, ct).ConfigureAwait(false);
        foreach (var ep in eps)
        {
            if (string.IsNullOrWhiteSpace(ep.FilePath) || !File.Exists(ep.FilePath))
                continue;
            try
            {
                File.Delete(ep.FilePath);
                filesDeleted++;
            }
            catch (Exception ex)
            {
                errors.Add($"Show {sid} S{ep.Season}E{ep.EpisodeNumber}: {ex.Message}");
            }
        }

        await repo.DeleteShowByIdAsync(sid, ct).ConfigureAwait(false);
    }

    return Results.Json(new { success = true, filesDeleted, errors }, jsonSerializerOptions);
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

app.MapPost("/api/recommendations/from", async (RecommendationFromBody? body, CancellationToken ct) =>
{
    if (body == null || body.TmdbId <= 0)
    {
        return Results.Json(
            new { error = "Invalid body: tmdbId (TMDB id) and mediaType (movie or tv) are required.", items = Array.Empty<object>() },
            jsonSerializerOptions,
            statusCode: 400);
    }

    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { error = "TMDB API key not configured.", items = Array.Empty<object>() }, jsonSerializerOptions, statusCode: 400);

    var filter = string.IsNullOrWhiteSpace(body.Filter) ? "both" : body.Filter!;
    var mt = string.IsNullOrWhiteSpace(body.MediaType) ? "movie" : body.MediaType!;
    var isMovie = mt.Equals("movie", StringComparison.OrdinalIgnoreCase);
    try
    {
        var list = await ContentRecommendationBuilder
            .BuildAsync(tmdb, body.TmdbId, isMovie ? "Movie" : "Series", filter, ct)
            .ConfigureAwait(false);
        return Results.Json(new { items = list, error = (string?)null }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        return Results.Json(
            new { error = "Could not build recommendations from TMDB.", detail = ex.Message, items = Array.Empty<object>() },
            jsonSerializerOptions,
            statusCode: 502);
    }
});

/// <summary>Proxy TMDB stills so desktop WebViews can load award/catalog art without hitting <c>image.tmdb.org</c> directly.</summary>
async Task<IResult> ProxyTmdbImageAsync(string? size, string? file, CancellationToken ct)
{
    size = size?.Trim();
    file = file?.Trim().TrimStart('/') ?? "";
    if (!Regex.IsMatch(size ?? "", @"^(?i)(original|[wh]\d+)$") ||
        string.IsNullOrEmpty(file) ||
        !Regex.IsMatch(file, @"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,240}$"))
        return Results.BadRequest();

    var upstream = $"https://image.tmdb.org/t/p/{size}/{file}";
    using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(45) };
    try
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, upstream);
        req.Headers.TryAddWithoutValidation("User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
        req.Headers.TryAddWithoutValidation("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
        using var resp = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (resp.StatusCode == HttpStatusCode.NotFound)
            return Results.NotFound();
        if (!resp.IsSuccessStatusCode)
            return Results.StatusCode((int)resp.StatusCode);
        var bytes = await resp.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
        var ctMedia = resp.Content.Headers.ContentType?.MediaType ?? "image/jpeg";
        return Results.Bytes(bytes, ctMedia);
    }
    catch
    {
        return Results.StatusCode(502);
    }
}

// Prefer query string (reliable); path form kept for old links.
app.MapGet("/api/img/tmdb", async (string? size, string? file, CancellationToken ct) =>
    await ProxyTmdbImageAsync(size, file, ct).ConfigureAwait(false));

app.MapGet("/api/img/tmdb/{size}/{*filename}", async (string size, string? filename, CancellationToken ct) =>
    await ProxyTmdbImageAsync(size, filename, ct).ConfigureAwait(false));

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

app.MapGet("/api/home/coming-soon", async (CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
    {
        return Results.Json(
            new { movies = Array.Empty<object>(), tv = Array.Empty<object>() },
            jsonSerializerOptions);
    }

    var moviesRaw = await tmdb.GetUpcomingMoviesAsync(1, ct).ConfigureAwait(false);
    var movies = moviesRaw
        .Where(m => TrailersFeedHelpers.IsStrictlyFutureReleaseDate(m.ReleaseDate))
        .ToList();

    var today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
    var tvRaw = await tmdb.DiscoverTvFirstAirFromAsync(today, 1, ct).ConfigureAwait(false);
    var tv = tvRaw
        .Where(t => TrailersFeedHelpers.IsStrictlyFutureReleaseDate(t.ReleaseDate))
        .ToList();

    object MapMovie(Pitflix.Core.Models.TmdbDiscoverItem x)
    {
        var ov = x.Overview ?? "";
        return new
        {
            tmdbId = x.Id,
            mediaType = "movie",
            title = x.Title,
            releaseDate = x.ReleaseDate,
            posterUrl = string.IsNullOrEmpty(x.PosterPath)
                ? null
                : $"https://image.tmdb.org/t/p/w342{x.PosterPath}",
            overview = ov.Length > 160 ? ov[..160] + "…" : ov,
            voteAverage = x.VoteAverage
        };
    }

    object MapTv(Pitflix.Core.Models.TmdbDiscoverItem x)
    {
        var ov = x.Overview ?? "";
        return new
        {
            tmdbId = x.Id,
            mediaType = "tv",
            title = x.Title,
            releaseDate = x.ReleaseDate,
            posterUrl = string.IsNullOrEmpty(x.PosterPath)
                ? null
                : $"https://image.tmdb.org/t/p/w342{x.PosterPath}",
            overview = ov.Length > 160 ? ov[..160] + "…" : ov,
            voteAverage = x.VoteAverage
        };
    }

    return Results.Json(new
        {
            movies = movies.Take(12).Select(MapMovie).ToList(),
            tv = tv.Take(12).Select(MapTv).ToList()
        },
        jsonSerializerOptions);
});

app.MapGet("/api/home/next-episodes/pins", async (LibraryRepository repo, CancellationToken ct) =>
{
    var ids = await repo.GetNextEpisodesPinnedShowIdsAsync(ct).ConfigureAwait(false);
    return Results.Json(new { showIds = ids }, jsonSerializerOptions);
});

app.MapPut("/api/home/next-episodes/pins", async (NextEpisodesPinsDto body, LibraryRepository repo, CancellationToken ct) =>
{
    await repo.SaveNextEpisodesPinnedShowIdsAsync(body.ShowIds, ct).ConfigureAwait(false);
    return Results.Ok();
});

app.MapGet("/api/home/next-episodes/followed", async (LibraryRepository repo, CancellationToken ct) =>
{
    var list = await repo.GetFollowedExternalShowsAsync(ct).ConfigureAwait(false);
    return Results.Json(list, jsonSerializerOptions);
});

app.MapPut("/api/home/next-episodes/followed", async (List<FollowedExternalShow>? body, LibraryRepository repo,
    CancellationToken ct) =>
{
    if (body == null)
        return Results.BadRequest();
    await repo.SaveFollowedExternalShowsAsync(body, ct).ConfigureAwait(false);
    return Results.Ok();
});

app.MapGet("/api/home/next-episodes", async (LibraryContext db, LibraryRepository repo, string? view, int? limit,
    CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);
    var viewKey = string.Equals(view, "all", StringComparison.OrdinalIgnoreCase) ? "all" : "priority";
    var limitCap = viewKey == "all" ? 240 : 96;
    var takeLimit = Math.Clamp(limit ?? (viewKey == "all" ? 160 : 48), 12, limitCap);

    var pinnedIds = await repo.GetNextEpisodesPinnedShowIdsAsync(ct).ConfigureAwait(false);
    var pinnedSet = pinnedIds.Count == 0 ? null : pinnedIds.ToHashSet();

    List<(int Id, string? Title, int TmdbId, string? PosterLocalPath, string? SelectedPosterPath)> pinnedShows;
    if (pinnedSet == null || pinnedSet.Count == 0)
        pinnedShows = new List<(int Id, string? Title, int TmdbId, string? PosterLocalPath, string? SelectedPosterPath)>();
    else
    {
        var rawPinned = await db.Shows.AsNoTracking()
            .Where(s => pinnedSet.Contains(s.Id) && s.IsMatched && s.TmdbId > 0)
            .Select(s => new { s.Id, s.Title, s.TmdbId, s.PosterLocalPath, s.SelectedPosterPath })
            .ToListAsync(ct)
            .ConfigureAwait(false);
        pinnedShows = rawPinned.ConvertAll(s => (s.Id, (string?)s.Title, s.TmdbId, s.PosterLocalPath, s.SelectedPosterPath));
    }

    var restQuery = db.Shows.AsNoTracking().Where(s => s.IsMatched && s.TmdbId > 0);
    if (pinnedSet is { Count: > 0 })
        restQuery = restQuery.Where(s => !pinnedSet.Contains(s.Id));

    var restTake = viewKey == "all" ? 1500 : 900;
    var rawRest = await restQuery
        .OrderByDescending(s => s.DateAdded)
        .Take(restTake)
        .Select(s => new { s.Id, s.Title, s.TmdbId, s.PosterLocalPath, s.SelectedPosterPath })
        .ToListAsync(ct)
        .ConfigureAwait(false);
    var rest = rawRest.ConvertAll(s => (s.Id, (string?)s.Title, s.TmdbId, s.PosterLocalPath, s.SelectedPosterPath));

    var shows = new List<(int Id, string? Title, int TmdbId, string? PosterLocalPath, string? SelectedPosterPath)>(
        pinnedShows.Count + rest.Count);
    shows.AddRange(pinnedShows);
    shows.AddRange(rest);

    var libTmdbIds = shows.Select(s => s.TmdbId).ToHashSet();
    var followedExternal = (await repo.GetFollowedExternalShowsAsync(ct).ConfigureAwait(false))
        .Where(f => !libTmdbIds.Contains(f.TmdbId))
        .ToList();

    var today = DateOnly.FromDateTime(DateTime.UtcNow);
    var bag = new ConcurrentBag<(int Tier, bool Pinned, DateOnly Air, string SortTitle, object Row)>();

    await Parallel.ForEachAsync(shows, new ParallelOptions { MaxDegreeOfParallelism = 6, CancellationToken = ct },
        async (s, token) =>
        {
            try
            {
                var air = await tmdb.TryGetTvNextAiringAsync(s.TmdbId, token).ConfigureAwait(false);
                if (air == null || air.Value.NextEpisode == null)
                    return;
                var ne = air.Value.NextEpisode;
                var name = (string?)ne["name"] ?? "";
                var ad = (string?)ne["air_date"];
                var sn = (int?)ne["season_number"];
                var en = (int?)ne["episode_number"];
                if (string.IsNullOrEmpty(ad) || ad.Length < 10)
                    return;
                if (!DateOnly.TryParse(ad.AsSpan(0, 10), out var airDay))
                    return;
                if (airDay < today)
                    return;
                var isPinned = pinnedSet != null && pinnedSet.Contains(s.Id);
                var posterUrl = ImageUrls.ToImageUrl(s.SelectedPosterPath ?? s.PosterLocalPath);
                var row = new
                {
                    kind = "library",
                    libraryShowId = s.Id,
                    showTitle = s.Title,
                    showTmdbId = s.TmdbId,
                    episodeTitle = name,
                    season = sn,
                    episodeNumber = en,
                    airDate = ad,
                    pinned = isPinned,
                    posterUrl,
                };
                var tier = viewKey == "all" ? 1 : (isPinned ? 0 : 1);
                bag.Add((tier, isPinned, airDay, s.Title ?? "", row));
            }
            catch
            {
                /* skip show */
            }
        }).ConfigureAwait(false);

    await Parallel.ForEachAsync(followedExternal, new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = ct },
        async (f, token) =>
        {
            try
            {
                var air = await tmdb.TryGetTvNextAiringAsync(f.TmdbId, token).ConfigureAwait(false);
                if (air == null || air.Value.NextEpisode == null)
                    return;
                var ne = air.Value.NextEpisode;
                var name = (string?)ne["name"] ?? "";
                var ad = (string?)ne["air_date"];
                var sn = (int?)ne["season_number"];
                var en = (int?)ne["episode_number"];
                if (string.IsNullOrEmpty(ad) || ad.Length < 10)
                    return;
                if (!DateOnly.TryParse(ad.AsSpan(0, 10), out var airDay))
                    return;
                if (airDay < today)
                    return;
                string? posterUrl = null;
                if (!string.IsNullOrWhiteSpace(f.PosterPath))
                {
                    var p = f.PosterPath.Trim();
                    posterUrl = p.StartsWith("http", StringComparison.OrdinalIgnoreCase)
                        ? p
                        : $"https://image.tmdb.org/t/p/w500{p.TrimStart('/')}";
                }
                var row = new
                {
                    kind = "followed",
                    libraryShowId = (int?)null,
                    showTitle = string.IsNullOrWhiteSpace(f.Title) ? air.Value.ShowName : f.Title,
                    showTmdbId = f.TmdbId,
                    episodeTitle = name,
                    season = sn,
                    episodeNumber = en,
                    airDate = ad,
                    pinned = false,
                    posterUrl,
                    followed = true,
                };
                bag.Add((2, false, airDay, f.Title ?? "", row));
            }
            catch
            {
                /* skip */
            }
        }).ConfigureAwait(false);

    var ordered = (viewKey == "all"
            ? bag.OrderBy(x => x.Air).ThenBy(x => x.SortTitle, StringComparer.OrdinalIgnoreCase)
            : bag.OrderBy(x => x.Tier)
                .ThenByDescending(x => x.Pinned)
                .ThenBy(x => x.Air)
                .ThenBy(x => x.SortTitle, StringComparer.OrdinalIgnoreCase))
        .Select(x => x.Row)
        .Take(takeLimit)
        .ToList();

    return Results.Json(ordered, jsonSerializerOptions);
});

app.MapGet("/api/home/watching-currently", async (LibraryRepository repo, CancellationToken ct) =>
{
    var rows = await repo.GetCurrentlyWatchingSeriesAsync(21, 200, ct).ConfigureAwait(false);
    var tmdb = TmdbClientFactory.Create();
    var list = rows
        .Select(r => WatchingCurrentlyApiRow.From(r, ImageUrls.ToImageUrl(r.SelectedPosterPath ?? r.PosterLocalPath)))
        .ToList();
    if (tmdb != null && list.Count > 0)
    {
        await Parallel.ForEachAsync(list, new ParallelOptions { MaxDegreeOfParallelism = 5, CancellationToken = ct },
            async (row, token) =>
            {
                if (!string.IsNullOrEmpty(row.PosterUrl) || row.ShowTmdbId <= 0)
                    return;
                try
                {
                    var art = await tmdb.GetArtworkPathsAsync(row.ShowTmdbId, "Series", token).ConfigureAwait(false);
                    if (art != null && !string.IsNullOrEmpty(art.Value.PosterPath))
                        row.PosterUrl = $"https://image.tmdb.org/t/p/w500{art.Value.PosterPath}";
                }
                catch
                {
                    /* optional */
                }
            }).ConfigureAwait(false);
    }

    return Results.Json(list, jsonSerializerOptions);
});

/// <summary>TMDB TV search for shows not necessarily in the library (Next Episodes discovery).</summary>
app.MapGet("/api/discover/tv-search", async (string? q, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null || string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);

    var hits = await tmdb.SearchAsync(q.Trim(), "Series", false, ct, maxResults: 15).ConfigureAwait(false);
    var mapped = hits.Select(h => new
    {
        tmdbId = h.Id,
        title = h.Title,
        year = string.IsNullOrEmpty(h.ReleaseDate) || h.ReleaseDate.Length < 4
            ? (int?)null
            : int.TryParse(h.ReleaseDate.AsSpan(0, 4), out var y) ? y : null,
        posterUrl = string.IsNullOrEmpty(h.PosterPath) ? null : $"https://image.tmdb.org/t/p/w342{h.PosterPath}",
    }).ToList();
    return Results.Json(mapped, jsonSerializerOptions);
});

/// <summary>Next airing block for any TMDB TV id (library not required).</summary>
app.MapGet("/api/discover/tv-schedule", async (int tmdbId, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null || tmdbId <= 0)
        return Results.Json(null, jsonSerializerOptions);

    var air = await tmdb.TryGetTvNextAiringAsync(tmdbId, ct).ConfigureAwait(false);
    if (air == null || air.Value.NextEpisode == null)
    {
        return Results.Json(new
        {
            ok = false,
            showTitle = air?.ShowName,
            message = "TMDB has no next episode to air for this series (ended, paused, or data missing)."
        }, jsonSerializerOptions);
    }

    var ne = air.Value.NextEpisode;
    var name = (string?)ne["name"] ?? "";
    var ad = (string?)ne["air_date"];
    var sn = (int?)ne["season_number"];
    var en = (int?)ne["episode_number"];
    return Results.Json(new
    {
        ok = true,
        showTitle = air.Value.ShowName,
        tmdbId = tmdbId,
        episodeTitle = name,
        season = sn,
        episodeNumber = en,
        airDate = ad
    }, jsonSerializerOptions);
});

async Task<IResult> HomeTrailersLatestCore(TrailersRepository trailersRepo, TmdbClient tmdb, ILogger<Program> logger,
    CancellationToken ct)
{
    var rows = await PersistedTrailerUiFeed.BuildAsync(trailersRepo, tmdb, limit: 120, mediaType: null, ct)
        .ConfigureAwait(false);
    var today = DateOnly.FromDateTime(DateTime.UtcNow);
    var recentReleaseCutoff = today.AddDays(-75);
    var freshTrailerCutoffUtc = DateTime.UtcNow.AddDays(-21);

    bool TryParseDateOnly(string? ymd, out DateOnly d)
    {
        d = default;
        if (string.IsNullOrWhiteSpace(ymd) || ymd.Length < 10)
            return false;
        return DateOnly.TryParse(ymd.AsSpan(0, 10), out d);
    }

    int Bucket(Pitflix.API.Services.Trailers.TrailerCardUiRow r)
    {
        var hasPub = r.TrailerPublishedAtUtc != default;
        var isFreshTrailer = hasPub && r.TrailerPublishedAtUtc >= freshTrailerCutoffUtc;

        if (TryParseDateOnly(r.ReleaseDate, out var release))
        {
            if (release > today)
                return 0; // unreleased (upcoming) first
            
            // If it already released, only show if it's VERY recent (last 75 days)
            if (release >= recentReleaseCutoff)
                return 1; // recently released

            // If it's older than 75 days, we don't want it in "Latest" even if the trailer is new,
            // because the user doesn't want "old" series/movies showing up just because of a new trailer.
            return 9; // too old for "latest"
        }

        // Unknown release date: keep only if trailer itself is very recent.
        if (isFreshTrailer)
            return 3;
        return 9;
    }

    rows = rows
        .Select(r => (Row: r, B: Bucket(r)))
        .Where(x => x.B < 9)
        .OrderBy(x => x.B)
        .ThenByDescending(x => x.Row.TrailerPublishedAtUtc)
        .ThenBy(x => x.Row.Title, StringComparer.OrdinalIgnoreCase)
        .Select(x => x.Row)
        .Take(20)
        .ToList();

    if (rows.Count == 0)
        logger.LogInformation("Home trailers latest: no rows passed latest-window gate (run ingestion or widen channels).");
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

async Task<IResult> HomeTrailersUpcomingCore(TrailersCuratedPriorityProvider curated, TmdbClient tmdb,
    CancellationToken ct)
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

/// <summary>Backward compatible — same as <c>/api/home/trailers/latest</c>.</summary>
app.MapGet("/api/home/trailers", async (TrailersRepository trailersRepo, ILogger<Program> logger, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);
    return await HomeTrailersLatestCore(trailersRepo, tmdb, logger, ct).ConfigureAwait(false);
});

app.MapGet("/api/home/trailers/latest", async (TrailersRepository trailersRepo, ILogger<Program> logger, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);
    return await HomeTrailersLatestCore(trailersRepo, tmdb, logger, ct).ConfigureAwait(false);
});

/// <summary>One-shot RSS fetch + TMDB resolve stats (does not return full Home latest cards).</summary>
app.MapGet("/api/home/trailers/rss-status", async (IHttpClientFactory httpFactory, IConfiguration configuration,
        ILogger<Program> logger, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
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

app.MapGet("/api/home/trailers/upcoming", async (TrailersCuratedPriorityProvider curated, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);
    return await HomeTrailersUpcomingCore(curated, tmdb, ct).ConfigureAwait(false);
});

object TrailerApiModel(TrailerItem x) => new
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
        return Results.Json(new { ok = false, error = ex.Message }, jsonSerializerOptions);
    }
});

/// <param name="mode">latest | trending | upcoming | upcoming-movies | upcoming-tv | all-upcoming</param>
/// <param name="filter">movie | tv | all</param>
/// <param name="search">When at least 2 characters, TMDB search replaces the usual discover pool (still respects filter).</param>
app.MapGet("/api/trailers/browse", async (TrailersRepository trailersRepo, TrailersCuratedPriorityProvider curated,
        IHttpClientFactory httpFactory,
        IConfiguration configuration, ILogger<Program> logger, string? mode, string? filter, string? search,
        CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
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
    var pool = new List<Pitflix.Core.Models.TmdbDiscoverItem>();
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

// Diagnostics + ping (registered last — avoids any odd ordering with top-level local functions)
app.MapGet("/api/ping", () => Results.Text("pitflix-api", "text/plain"));
app.MapGet("/api/debug/images", () => BuildImageFolderDiagnostics(imagesPath));
app.MapGet("/api/diagnostics/image-cache", () => BuildImageFolderDiagnostics(imagesPath));

Console.WriteLine($"Pitflix.API → {publicBase}  (images: {publicBase}/images/…)");

bool PortInUse(IOException ex)
{
    for (Exception? e = ex; e != null; e = e.InnerException)
    {
        if (e is SocketException { SocketErrorCode: SocketError.AddressAlreadyInUse })
            return true;
    }

    return false;
}

try
{
    app.Run();
}
catch (IOException ex) when (PortInUse(ex))
{
    Console.Error.WriteLine();
    Console.Error.WriteLine("Port already in use — another Pitflix.API (or app) is using this URL.");
    Console.Error.WriteLine("Fix: close that terminal, or stop the process:");
    Console.Error.WriteLine("  netstat -ano | findstr \":5001\"   (use the LISTENING PID)");
    Console.Error.WriteLine("  taskkill /PID <pid> /F");
    Console.Error.WriteLine("Or use another port:");
    Console.Error.WriteLine("  dotnet run --launch-profile http-alt");
    Console.Error.WriteLine("  (then set Pitflix.UI VITE_API_ORIGIN=http://127.0.0.1:5002)");
    Console.Error.WriteLine();
    Environment.Exit(1);
}

// —— helpers & DTOs ——

static IResult BuildImageFolderDiagnostics(string cacheRoot)
{
    var exists = Directory.Exists(cacheRoot);
    string[] sample = Array.Empty<string>();
    var rootFiles = exists ? Directory.GetFiles(cacheRoot).Length : 0;
    var subfolders = new List<object>();

    if (exists)
    {
        try
        {
            sample = Directory.GetFiles(cacheRoot)
                .Select(Path.GetFileName)
                .Where(n => n != null)
                .Take(8)
                .ToArray()!;

            subfolders = Directory.GetDirectories(cacheRoot)
                .Select(d => new
                {
                    folder = Path.GetFileName(d),
                    count = Directory.GetFiles(d).Length
                })
                .Where(x => x.folder is not null)
                .Cast<object>()
                .ToList();
        }
        catch
        {
            subfolders = new List<object>();
            sample = Array.Empty<string>();
        }
    }

    return Results.Json(new
    {
        path = cacheRoot,
        exists,
        rootFiles,
        rootFileCount = rootFiles,
        fileCount = rootFiles, // backward-ish compat
        subfolders,
        sampleFiles = sample
    });
}

static string ImageContentTypeForExtension(string path) =>
    Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        ".bmp" => "image/bmp",
        ".svg" => "image/svg+xml",
        _ => "image/jpeg",
    };

static async Task<object> MakePageAsync(IReadOnlyList<MediaCardDto> rawItems, int total, int page, int pageSize,
    TmdbClient? tmdb, CancellationToken ct)
{
    var mapped = rawItems.Select(ImageUrls.MapMediaCard).ToList();
    await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(mapped, tmdb, ct).ConfigureAwait(false);
    return new
    {
        items = mapped,
        total,
        totalPages = TotalPages(total, pageSize),
        currentPage = page
    };
}

static int TotalPages(int total, int pageSize)
{
    var ps = Math.Max(1, pageSize);
    return total <= 0 ? 1 : (int)Math.Ceiling(total / (double)ps);
}

static string? MapSortOption(string sort) =>
    sort.ToLowerInvariant() switch
    {
        "year" => "Year ↓",
        "rating" => "Rating",
        "dateadded" => "Date added",
        _ => null
    };

static async Task<(List<MediaCardDto> items, int total)> QueryMediaCardsAsync(
    LibraryContext db,
    LibraryRepository repo,
    bool isMovie,
    bool isArabic,
    string? search,
    string? genre,
    string watch,
    string sort,
    int page,
    int pageSize,
    CancellationToken ct)
{
    var sortOpt = MapSortOption(sort);
    var watchNorm = watch.ToLowerInvariant();
    if (watchNorm == "watched")
        return await QueryWatchedPageAsync(db, isMovie, isArabic, search, genre, sort, page, pageSize, ct)
            .ConfigureAwait(false);

    string? watchForRepo = watchNorm switch
    {
        "unwatched" => WatchStatuses.Unwatched,
        "watching" => WatchStatuses.Watching,
        "completed" => WatchStatuses.Completed,
        _ => null
    };

    if (isMovie)
    {
        var r = await repo.GetMovieCardPageAsync(isArabic, search, genre, watchForRepo, sortOpt, page, pageSize, ct)
            .ConfigureAwait(false);
        return (r.Items.ToList(), r.TotalItems);
    }
    else
    {
        var r = await repo.GetShowCardPageAsync(isArabic, search, genre, watchForRepo, sortOpt, page, pageSize, ct)
            .ConfigureAwait(false);
        return (r.Items.ToList(), r.TotalItems);
    }
}

static async Task<(List<MediaCardDto> items, int total)> QueryWatchedPageAsync(
    LibraryContext db,
    bool isMovie,
    bool isArabic,
    string? search,
    string? genre,
    string sort,
    int page,
    int pageSize,
    CancellationToken ct)
{
    if (isMovie)
    {
        var q = db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.IsArabic == isArabic &&
                        m.WatchStatus != WatchStatuses.Unwatched);
        q = ApplyMovieFilters(q, search, genre);
        q = ApplyMovieSort(q, sort);
        var total = await q.CountAsync(ct).ConfigureAwait(false);
        var skip = Math.Max(0, (Math.Max(1, page) - 1) * Math.Max(1, pageSize));
        var rows = await q.Skip(skip).Take(Math.Max(1, pageSize))
            .Select(m => new MediaCardDto
            {
                Id = m.Id,
                TmdbId = m.TmdbId,
                Title = m.Title,
                Year = m.Year,
                VoteAverage = m.VoteAverage,
                PosterLocalPath = m.PosterLocalPath,
                SelectedPosterPath = m.SelectedPosterPath,
                IsArabic = m.IsArabic,
                WatchStatus = m.WatchStatus,
                DateAdded = m.DateAdded,
                GenresCsv = m.Genres,
                Overview = m.Overview == null
                    ? null
                    : (m.Overview.Length > 200 ? m.Overview.Substring(0, 200) : m.Overview),
                BackdropLocalPath = m.BackdropLocalPath,
                SelectedBackdropPath = m.SelectedBackdropPath,
                MediaFilePath = m.FilePath,
                TmdbMediaType = "Movie"
            })
            .ToListAsync(ct)
            .ConfigureAwait(false);
        return (rows, total);
    }
    else
    {
        var q = db.Shows.AsNoTracking()
            .Where(s => s.IsMatched && s.IsArabic == isArabic &&
                        s.WatchStatus != WatchStatuses.Unwatched);
        q = ApplyShowFilters(q, search, genre);
        q = ApplyShowSort(q, sort);
        var total = await q.CountAsync(ct).ConfigureAwait(false);
        var skip = Math.Max(0, (Math.Max(1, page) - 1) * Math.Max(1, pageSize));
        var rows = await q.Skip(skip).Take(Math.Max(1, pageSize))
            .Select(s => new MediaCardDto
            {
                Id = s.Id,
                TmdbId = s.TmdbId,
                Title = s.Title,
                Year = s.Year,
                VoteAverage = s.VoteAverage,
                PosterLocalPath = s.PosterLocalPath,
                SelectedPosterPath = s.SelectedPosterPath,
                IsArabic = s.IsArabic,
                WatchStatus = s.WatchStatus,
                DateAdded = s.DateAdded,
                GenresCsv = s.Genres,
                Overview = s.Overview == null
                    ? null
                    : (s.Overview.Length > 200 ? s.Overview.Substring(0, 200) : s.Overview),
                BackdropLocalPath = s.BackdropLocalPath,
                SelectedBackdropPath = s.SelectedBackdropPath,
                TmdbMediaType = "Series"
            })
            .ToListAsync(ct)
            .ConfigureAwait(false);
        return (rows, total);
    }
}

static IQueryable<Movie> ApplyMovieFilters(IQueryable<Movie> q, string? search, string? genre)
{
    if (!string.IsNullOrWhiteSpace(search))
    {
        var term = search.Trim();
        var lower = term.ToLower();
        // SQLite collation can end up case-sensitive depending on environment; normalize to lower-case.
        q = q.Where(m => m.Title.ToLower().Contains(lower));
    }

    if (!string.IsNullOrWhiteSpace(genre) && !genre.Equals("All", StringComparison.OrdinalIgnoreCase))
        q = q.Where(m => m.Genres != null && m.Genres.Contains(genre));
    return q;
}

static IQueryable<Show> ApplyShowFilters(IQueryable<Show> q, string? search, string? genre)
{
    if (!string.IsNullOrWhiteSpace(search))
    {
        var term = search.Trim();
        var lower = term.ToLower();
        // SQLite collation can end up case-sensitive depending on environment; normalize to lower-case.
        q = q.Where(s => s.Title.ToLower().Contains(lower));
    }

    if (!string.IsNullOrWhiteSpace(genre) && !genre.Equals("All", StringComparison.OrdinalIgnoreCase))
        q = q.Where(s => s.Genres != null && s.Genres.Contains(genre));
    return q;
}

static IQueryable<Movie> ApplyMovieSort(IQueryable<Movie> q, string sort) =>
    sort.ToLowerInvariant() switch
    {
        "year" => q.OrderByDescending(m => m.Year ?? 0),
        "rating" => q.OrderByDescending(m => m.VoteAverage),
        "dateadded" => q.OrderByDescending(m => m.DateAdded),
        _ => q.OrderBy(m => m.Title)
    };

static IQueryable<Show> ApplyShowSort(IQueryable<Show> q, string sort) =>
    sort.ToLowerInvariant() switch
    {
        "year" => q.OrderByDescending(s => s.Year ?? 0),
        "rating" => q.OrderByDescending(s => s.VoteAverage),
        "dateadded" => q.OrderByDescending(s => s.DateAdded),
        _ => q.OrderBy(s => s.Title)
    };

static MediaCardDto ToMediaCardFromSimilar(LocalSimilarRow r) =>
    new()
    {
        Id = r.DatabaseId,
        TmdbId = r.TmdbId,
        Title = r.Title,
        Year = r.Year,
        VoteAverage = 0,
        PosterLocalPath = r.PosterLocalPath,
        IsArabic = false,
        DateAdded = default,
        GenresCsv = null,
        Overview = null,
        MediaFilePath = null,
        TmdbMediaType = string.Equals(r.MediaKind, "Series", StringComparison.OrdinalIgnoreCase)
            ? "Series"
            : "Movie"
    };

static MediaCardDto ToCardFromMovie(Movie m) =>
    new()
    {
        Id = m.Id,
        TmdbId = m.TmdbId,
        Title = m.Title,
        Year = m.Year,
        VoteAverage = m.VoteAverage,
        PosterLocalPath = m.PosterLocalPath,
        SelectedPosterPath = m.SelectedPosterPath,
        IsArabic = m.IsArabic,
        WatchStatus = m.WatchStatus,
        DateAdded = m.DateAdded,
        GenresCsv = m.Genres,
        Overview = m.Overview != null && m.Overview.Length > 200 ? m.Overview[..200] : m.Overview,
        BackdropLocalPath = m.BackdropLocalPath,
        SelectedBackdropPath = m.SelectedBackdropPath,
        MediaFilePath = m.FilePath,
        TmdbMediaType = "Movie"
    };

static MediaCardDto ToCardFromShow(Show s) =>
    new()
    {
        Id = s.Id,
        TmdbId = s.TmdbId,
        Title = s.Title,
        Year = s.Year,
        VoteAverage = s.VoteAverage,
        PosterLocalPath = s.PosterLocalPath,
        SelectedPosterPath = s.SelectedPosterPath,
        IsArabic = s.IsArabic,
        WatchStatus = s.WatchStatus,
        DateAdded = s.DateAdded,
        GenresCsv = s.Genres,
        Overview = s.Overview != null && s.Overview.Length > 200 ? s.Overview[..200] : s.Overview,
        BackdropLocalPath = s.BackdropLocalPath,
        SelectedBackdropPath = s.SelectedBackdropPath,
        TmdbMediaType = "Series"
    };

static string MaskKey(string? key)
{
    if (string.IsNullOrEmpty(key))
        return "";
    if (key.Length <= 4)
        return "****";
    return new string('*', Math.Min(12, key.Length - 4)) + key[^4..];
}

static ScanLogDto ToScanLogDto(ScanLog s)
{
    object? suggestions = null;
    if (!string.IsNullOrWhiteSpace(s.SuggestionsJson))
    {
        try
        {
            suggestions = JsonSerializer.Deserialize<object>(s.SuggestionsJson);
        }
        catch
        {
            suggestions = null;
        }
    }

    var mediaType = FileScanner.InferMediaType(s.FilePath);
    if (string.IsNullOrEmpty(mediaType))
        mediaType = "Movie";

    return new ScanLogDto(s.Id, s.FilePath, s.CleanName, s.Status, s.MatchedTitle, s.TmdbId, s.Confidence,
        suggestions, mediaType, s.ScannedAt);
}

internal sealed record ScanLogDto(
    int Id,
    string FilePath,
    string CleanName,
    string Status,
    string? MatchedTitle,
    int? TmdbId,
    string? Confidence,
    object? Suggestions,
    string MediaType,
    DateTime ScannedAt);

internal sealed record MatchBody(int TmdbId, string? MediaType);
internal sealed record BulkMatchBody(int[]? Ids, int TmdbId, string? MediaType, string? Title);
internal sealed record EpisodeWatchBody(string WatchStatus);
internal sealed record MediaWatchStatusBody(string? WatchStatus);
internal sealed record UnmatchedSearchBody(string? Query, string? MediaType);
internal sealed record ScanStartBody(string[]? Folders);
internal sealed record HistoryAddBody(string? FilePath, string? Title, string? PosterPath, string? MediaType,
    int DurationSeconds, bool? SuppressContinueWatching);
internal sealed record StoppedBody(DateTime StoppedAt, int? PositionSeconds);
internal sealed record HistoryProgressBody(int PositionSeconds, int? DurationSeconds, bool? MarkWatching);
internal sealed record HistoryDismissBody(bool? MarkCompleted);
internal sealed record CreateListBody(string? Name);

internal sealed record RenameListBody(string? Name);
internal sealed record AddListItemBody(int TmdbId, string? MediaType);
internal sealed record ImageSelectBody(int TmdbId, string? MediaType, string? PosterPath, string? BackdropPath);
internal sealed record SettingsBody(string? TmdbApiKey, string? OpenSubtitlesApiKey, string? OpenSubtitlesAppName,
    List<string>? LibraryPaths, string? MediaPlayerPath, bool? UseBuiltinPlayer, bool? LibraryScanDesktopToasts);

internal sealed record WizardProgressBody(int Step, string? StateJson);

internal sealed record CompleteSetupBody(
    string? TmdbApiKey,
    bool TmdbSkipped,
    string? OpenSubtitlesApiKey,
    bool OpenSubtitlesSkipped,
    List<string>? LibraryPaths,
    bool FoldersSkipped);

internal sealed record SubtitleDownloadBody(int FileId, string? VideoFilePath, string? LanguageCode);
internal sealed record SubDlDownloadBody(string? FullLink, string? VideoFilePath, string? Language);
internal sealed record StreamTrailerEntry(string? Name, string Key, string? Type, string YoutubeUrl);

internal sealed record BulkWatchBody(int[]? MovieIds, int[]? ShowIds, string? WatchStatus);

internal sealed record BulkLibraryIdsBody(int[]? MovieIds, int[]? ShowIds);

internal sealed record MatchTmdbBody(int TmdbId);
internal sealed record BulkRescanSeriesRequest(int[] ShowIds);
internal sealed record RecommendationFromBody(int TmdbId, string? MediaType, string? Filter);
internal sealed record PathRequest(string? Path);
internal sealed record DeleteFromDeviceRequest(string? Path, string? MediaType, int? LibraryId);
internal sealed record AutostartRequest(bool Enable);
internal sealed record PlayBody(string? FilePath, int? StartSeconds, string? Title, string? PosterPath,
    string? MediaType, int? DurationSeconds, bool? SkipHistoryAdd);
