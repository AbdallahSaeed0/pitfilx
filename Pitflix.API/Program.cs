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
builder.Logging.AddProvider(new SkipDebugFileLoggerProvider());

// Default 5280 avoids Windows Hyper-V reserved ranges (often 4931–5030, which block 5001).
// Override: $env:PITFLIX_LISTEN_URLS='http://127.0.0.1:5280'; dotnet run
var listenRaw = Environment.GetEnvironmentVariable("PITFLIX_LISTEN_URLS")?.Trim()
    ?? Environment.GetEnvironmentVariable("ASPNETCORE_URLS")?.Trim()
    ?? builder.Configuration["Pitflix:ListenUrls"]?.Trim()
    ?? "http://127.0.0.1:5280";
var listenAddresses = listenRaw.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
if (listenAddresses.Length == 0)
    listenAddresses = new[] { "http://127.0.0.1:5280" };
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
builder.Services.AddScoped<SkipSegmentsRepository>();
builder.Services.AddScoped<SkipSegmentDetectionService>();
builder.Services.AddScoped<AudioFingerprintService>();
builder.Services.AddSingleton<SkipFingerprintQueue>();
builder.Services.AddHostedService<SkipFingerprintHostedService>();
builder.Services.AddSingleton<ScanRuntime>();
builder.Services.AddSingleton<SmartMatchRuntime>();
builder.Services.AddHostedService<LibraryAutoScanService>();
builder.Services.AddHostedService<PinnedFolderScanService>();
builder.Services.AddHostedService<TrailerIngestionHostedService>();
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient();
builder.Services.AddHttpClient(nameof(OmdbRatingClient));
builder.Services.AddHttpClient("Wikidata", c =>
{
    c.BaseAddress = new Uri("https://query.wikidata.org/");
    c.Timeout = TimeSpan.FromSeconds(30);
    c.DefaultRequestHeaders.Add("User-Agent", "PitFlix/1.0 (awards lookup; contact via github)");
    c.DefaultRequestHeaders.Add("Accept", "application/sparql-results+json");
});
builder.Services.AddSingleton<WikidataAwardsService>();
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
builder.Services.AddSingleton<PlayerService>();
builder.Services.AddSingleton<MdbListService>();
builder.Services.AddSingleton<TvdbService>();

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<LibraryContext>();
    db.Database.EnsureCreated();
    var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
    await repo.EnsureLibraryFoldersTableAsync();
    await repo.EnsureSelectedImageColumnsAsync();
    await repo.EnsureEpisodeStillLocalPathColumnAsync();
    await repo.EnsureListItemMetadataColumnsAsync();
    await repo.EnsureWatchHistoryResumeColumnsAsync();
    await repo.EnsureWatchStatusColumnsAsync();
    await repo.EnsureUserListTablesAndSeedAsync();
    await repo.EnsureCastMemberPersonTmdbIdColumnAsync();
    await repo.EnsureCastMemberProfilePathAndBillingOrderColumnsAsync();
    await repo.EnsureCrewCacheJsonColumnsAsync();
    await AddMetadataRefreshedAtMigration.RunIfNeededAsync(repo);
    await repo.EnsureKeywordsJsonColumnsAsync();
    await repo.EnsureContentRatingColumnAsync();
    await repo.EnsureUnifiedTrackingAsync();
    // Back-fill TmdbId / SeasonNumber / EpisodeNumber on history rows created before enrichment was added.
    // Runs in the background so it never delays startup.
    // IMPORTANT: capture the IServiceProvider, not the scoped `repo` — each background operation
    // must own its own scope/DbContext to avoid EF Core concurrency violations.
    var serviceProvider = app.Services;
    _ = Task.Run(async () =>
    {
        try
        {
            await using var bgScope = serviceProvider.CreateAsyncScope();
            var bgRepo = bgScope.ServiceProvider.GetRequiredService<LibraryRepository>();
            await bgRepo.ReEnrichHistoryRowsAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch { /* best-effort */ }
    });
    var trailersRepo = scope.ServiceProvider.GetRequiredService<TrailersRepository>();
    await trailersRepo.EnsureTrailersTableAsync();
    await trailersRepo.EnsureTrailerChannelSyncStatesTableAsync();
    var ratingsSnapshotRepo = scope.ServiceProvider.GetRequiredService<RatingsSnapshotRepository>();
    await ratingsSnapshotRepo.EnsureRatingsSnapshotsTableAsync();
    await AddMdbListTvdbTablesMigration.RunIfNeededAsync(repo);
    await AddSkipSegmentsMigration.RunIfNeededAsync(repo);
    await AddOutroSecondsBeforeEndMigration.RunIfNeededAsync(repo);
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
app.UseWebSockets();

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

    // Keywords: lazy-populate from TMDB on first visit
    var keywords = new List<object>();
    if (movie.TmdbId > 0 && tmdb != null)
    {
        if (string.IsNullOrEmpty(movie.KeywordsJson))
        {
            var kws = await tmdb.TryGetKeywordsWithNamesAsync(movie.TmdbId, "Movie", ct).ConfigureAwait(false);
            if (kws.Count > 0)
            {
                var kwJson = System.Text.Json.JsonSerializer.Serialize(kws.Select(k => new { id = k.Id, name = k.Name }));
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
                var parsed = System.Text.Json.JsonSerializer.Deserialize<List<System.Text.Json.JsonElement>>(movie.KeywordsJson);
                if (parsed != null)
                    keywords = parsed.Select(e => (object)new { id = e.GetProperty("id").GetInt32(), name = e.GetProperty("name").GetString() }).ToList();
            }
            catch { /* ignore malformed cache */ }
        }
    }

    // TMDB similar (cross-referenced with local library)
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

    // Collection membership
    object? collection = null;
    if (movie.TmdbId > 0 && tmdb != null)
    {
        var colInfo = await tmdb.TryGetMovieCollectionInfoAsync(movie.TmdbId, ct).ConfigureAwait(false);
        if (colInfo.HasValue)
            collection = new { id = colInfo.Value.CollectionId, name = colInfo.Value.CollectionName };
    }

    // Content rating: lazy-populate from TMDB (US theatrical certification)
    var contentRating = movie.ContentRating;
    if (contentRating == null && movie.TmdbId > 0 && tmdb != null)
    {
        contentRating = await tmdb.TryGetMovieCertificationAsync(movie.TmdbId, "US", ct).ConfigureAwait(false);
        if (contentRating != null)
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE Movies SET ContentRating = {0} WHERE Id = {1}", contentRating, movie.Id)
                .ConfigureAwait(false);
    }

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

app.MapGet("/api/series/{id:int}", async (int id, LibraryRepository repo, LibraryContext db, CancellationToken ct) =>
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
                    voteAverage = header?.VoteAverage,
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
                        voteAverage = header?.VoteAverage,
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

    // Keywords: lazy-populate from TMDB on first visit
    var keywords = new List<object>();
    if (show.TmdbId > 0 && tmdb != null)
    {
        if (string.IsNullOrEmpty(show.KeywordsJson))
        {
            var kws = await tmdb.TryGetKeywordsWithNamesAsync(show.TmdbId, "Series", ct).ConfigureAwait(false);
            if (kws.Count > 0)
            {
                var kwJson = System.Text.Json.JsonSerializer.Serialize(kws.Select(k => new { id = k.Id, name = k.Name }));
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
                var parsed = System.Text.Json.JsonSerializer.Deserialize<List<System.Text.Json.JsonElement>>(show.KeywordsJson);
                if (parsed != null)
                    keywords = parsed.Select(e => (object)new { id = e.GetProperty("id").GetInt32(), name = e.GetProperty("name").GetString() }).ToList();
            }
            catch { /* ignore malformed cache */ }
        }
    }

    // TMDB similar (cross-referenced with local library)
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

    // Content rating: lazy-populate from TMDB (US TV rating)
    var contentRating = show.ContentRating;
    if (contentRating == null && show.TmdbId > 0 && tmdb != null)
    {
        contentRating = await tmdb.TryGetTvCertificationAsync(show.TmdbId, "US", ct).ConfigureAwait(false);
        if (contentRating != null)
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE Shows SET ContentRating = {0} WHERE Id = {1}", contentRating, show.Id)
                .ConfigureAwait(false);
    }

    return Results.Json(new
    {
        show = showOut,
        cast = cast.Select(ImageUrls.MapCastMember).ToList(),
        crew = crew.Select(ImageUrls.MapCrewMember).ToList(),
        episodes = episodesGrouped,
        seasonsSummary,
        nextEpisode,
        similar,
        tmdbSimilar,
        keywords,
        contentRating,
    }, jsonSerializerOptions);
});

// —— Video extras (featurettes, behind-the-scenes, clips) ——

app.MapGet("/api/movies/{id:int}/videos", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var movie = await repo.GetMovieByIdAsync(id, ct).ConfigureAwait(false);
    if (movie == null || movie.TmdbId <= 0) return Results.NotFound();
    var tmdb = TmdbClientFactory.Create();
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

app.MapGet("/api/series/{id:int}/videos", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var show = await repo.GetShowByIdAsync(id, ct).ConfigureAwait(false);
    if (show == null || show.TmdbId <= 0) return Results.NotFound();
    var tmdb = TmdbClientFactory.Create();
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
    CancellationToken ct) =>
{
    var show = await repo.GetShowByIdAsync(id, ct).ConfigureAwait(false);
    if (show == null)
        return Results.NotFound();

    var eps = await repo.GetEpisodesForShowAsync(show.Id, ct).ConfigureAwait(false);
    eps = eps.Where(e => !string.IsNullOrWhiteSpace(e.FilePath) && File.Exists(e.FilePath)).ToList();
    var inSeason = eps.Where(e => e.Season == season).OrderBy(e => e.EpisodeNumber).ToList();
    var tmdb = TmdbClientFactory.Create();

    IReadOnlyDictionary<int, (string? Name, string? StillPath, double? VoteAverage, string? Overview)>? tmdbMap = null;
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
        string? overview = null;
        if (tmdbMap != null && tmdbMap.TryGetValue(e.EpisodeNumber, out var meta))
        {
            if (meta.VoteAverage is > 0) tvVote = meta.VoteAverage;
            overview = meta.Overview;
        }
        double? imdbVote = await ratings.TryGetEpisodeImdbRatingAsync(show.TmdbId, season, e.EpisodeNumber, ct)
            .ConfigureAwait(false);
        return (object)new
        {
            e.Id,
            e.Season,
            episodeNumber = e.EpisodeNumber,
            e.Title,
            overview,
            e.FilePath,
            e.SubtitlePath,
            e.WatchStatus,
            stillLocalPath = EpStill(e),
            tmdbVoteAverage = tvVote,
            imdbVoteAverage = imdbVote
        };
    })).ConfigureAwait(false);

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
    // Detect Arabic characters to enable bilingual TMDB search (en-US + ar)
    var hasArabic = q.Any(c => c >= '؀' && c <= 'ۿ');
    List<(TmdbSearchResult Result, string Media)> combined;

    if (mtRaw.Equals("Both", StringComparison.OrdinalIgnoreCase))
    {
        var movies = await tmdb.SearchAsync(q, "Movie", hasArabic, ct, 12).ConfigureAwait(false);
        var series = await tmdb.SearchAsync(q, "Series", hasArabic, ct, 12).ConfigureAwait(false);
        if ((movies.Count + series.Count) < 6 && !string.Equals(qFallback, q, StringComparison.Ordinal))
        {
            var movies2 = await tmdb.SearchAsync(qFallback, "Movie", hasArabic, ct, 12).ConfigureAwait(false);
            var series2 = await tmdb.SearchAsync(qFallback, "Series", hasArabic, ct, 12).ConfigureAwait(false);
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
        var list = await tmdb.SearchAsync(q, mtRaw, hasArabic, ct, 14).ConfigureAwait(false);
        if (list.Count < 7 && !string.Equals(qFallback, q, StringComparison.Ordinal))
        {
            var fallback = await tmdb.SearchAsync(qFallback, mtRaw, hasArabic, ct, 14).ConfigureAwait(false);
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

app.MapGet("/api/stream/tv/{tmdbId:int}/season/{seasonNumber:int}/episodes", async (int tmdbId, int seasonNumber, CancellationToken ct) =>
{
    var apiKey = AppSettings.ResolvedTmdbApiKey;
    if (!AppSettings.IsValidTmdbKey(apiKey) || tmdbId <= 0 || seasonNumber <= 0)
        return Results.Json(new { episodes = Array.Empty<object>(), error = "Invalid request." }, jsonSerializerOptions);

    try
    {
        using var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0");
        var url = $"https://api.themoviedb.org/3/tv/{tmdbId}/season/{seasonNumber}?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
        var json = await http.GetStringAsync(new Uri(url), ct).ConfigureAwait(false);
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var root = doc.RootElement;

        static string? Str(System.Text.Json.JsonElement el, string key) =>
            el.TryGetProperty(key, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;
        static int Int32(System.Text.Json.JsonElement el, string key) =>
            el.TryGetProperty(key, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.Number ? v.GetInt32() : 0;
        static double Dbl(System.Text.Json.JsonElement el, string key) =>
            el.TryGetProperty(key, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.Number ? v.GetDouble() : 0;

        var seasonName = Str(root, "name") ?? $"Season {seasonNumber}";
        var seasonOverview = Str(root, "overview");
        var seasonPosterPath = Str(root, "poster_path");
        var seasonPosterUrl = string.IsNullOrWhiteSpace(seasonPosterPath)
            ? null : $"https://image.tmdb.org/t/p/w342{seasonPosterPath}";

        var episodes = new List<object>();
        if (root.TryGetProperty("episodes", out var epsArr) && epsArr.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var ep in epsArr.EnumerateArray())
            {
                var epNum = Int32(ep, "episode_number");
                var epTitle = Str(ep, "name") ?? $"Episode {epNum}";
                var epOverview = Str(ep, "overview");
                var airDate = Str(ep, "air_date");
                var runtime = Int32(ep, "runtime");
                var vote = Dbl(ep, "vote_average");
                var stillPath = Str(ep, "still_path");
                var stillUrl = string.IsNullOrWhiteSpace(stillPath)
                    ? null : $"https://image.tmdb.org/t/p/w300{stillPath}";

                episodes.Add(new
                {
                    episodeNumber = epNum,
                    title = epTitle,
                    overview = epOverview,
                    airDate,
                    runtime,
                    voteAverage = vote,
                    stillUrl,
                });
            }
        }

        return Results.Json(new { seasonName, seasonOverview, seasonPosterUrl, episodes, error = (string?)null }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        return Results.Json(new { episodes = Array.Empty<object>(), error = ex.Message }, jsonSerializerOptions);
    }
});

// —— Stream TMDB details (for StreamingDetailsPage) ——
app.MapGet("/api/stream/details/{tmdbId:int}", async (int tmdbId, string? mediaType, CancellationToken ct) =>
{
    var apiKey = AppSettings.ResolvedTmdbApiKey;
    if (!AppSettings.IsValidTmdbKey(apiKey) || tmdbId <= 0)
        return Results.Json(new { error = "TMDB not configured." }, jsonSerializerOptions);

    var isMovie = !string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase);
    var endpoint = isMovie ? $"movie/{tmdbId}" : $"tv/{tmdbId}";
    var appendTo = "videos,recommendations,external_ids,credits";
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
        var voteCount = root.TryGetProperty("vote_count", out var vc) && vc.TryGetInt32(out var vci) ? vci : 0;
        var releaseDate = root.TryGetProperty("release_date", out var rd) ? rd.GetString()
            : root.TryGetProperty("first_air_date", out var fa) ? fa.GetString() : null;
        var imdbId = root.TryGetProperty("external_ids", out var ext) && ext.TryGetProperty("imdb_id", out var im)
            ? im.GetString() : null;
        var numberOfSeasons = root.TryGetProperty("number_of_seasons", out var ns) && ns.TryGetInt32(out var nsi) ? nsi : 0;

        var genres = new List<string>();
        if (root.TryGetProperty("genres", out var genresEl) && genresEl.ValueKind == System.Text.Json.JsonValueKind.Array)
            foreach (var g in genresEl.EnumerateArray())
                if (g.TryGetProperty("name", out var gn)) genres.Add(gn.GetString() ?? "");

        // Seasons (TV only)
        var seasons = new List<object>();
        if (!isMovie && root.TryGetProperty("seasons", out var seasonsEl) && seasonsEl.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var s in seasonsEl.EnumerateArray())
            {
                var sNum = s.TryGetProperty("season_number", out var sn) && sn.TryGetInt32(out var sni) ? sni : -1;
                if (sNum < 1) continue; // skip specials (season 0)
                var sName = s.TryGetProperty("name", out var snm) ? snm.GetString() : null;
                var sEps = s.TryGetProperty("episode_count", out var se) && se.TryGetInt32(out var sei) ? sei : 0;
                var sAir = s.TryGetProperty("air_date", out var sa) ? sa.GetString() : null;
                var sPoster = s.TryGetProperty("poster_path", out var sp) ? sp.GetString() : null;
                seasons.Add(new
                {
                    seasonNumber = sNum,
                    name = sName ?? $"Season {sNum}",
                    episodeCount = sEps,
                    airDate = sAir,
                    posterUrl = string.IsNullOrEmpty(sPoster) ? null : $"https://image.tmdb.org/t/p/w185{sPoster}",
                });
            }
        }

        // Cast (top 12)
        var cast = new List<object>();
        if (root.TryGetProperty("credits", out var creditsEl) && creditsEl.TryGetProperty("cast", out var castArr)
            && castArr.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var p in castArr.EnumerateArray().Take(12))
            {
                var pName = p.TryGetProperty("name", out var pn) ? pn.GetString() : null;
                var pChar = p.TryGetProperty("character", out var pc) ? pc.GetString() : null;
                var pProfile = p.TryGetProperty("profile_path", out var pp2) ? pp2.GetString() : null;
                var pId = p.TryGetProperty("id", out var pi) && pi.TryGetInt32(out var pii) ? pii : 0;
                if (!string.IsNullOrEmpty(pName))
                    cast.Add(new
                    {
                        id = pId,
                        name = pName,
                        character = pChar,
                        profileUrl = string.IsNullOrEmpty(pProfile) ? null : $"https://image.tmdb.org/t/p/w185{pProfile}",
                    });
            }
        }

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

        // Collection (movies only)
        object? belongsToCollection = null;
        if (isMovie && root.TryGetProperty("belongs_to_collection", out var colEl)
            && colEl.ValueKind == System.Text.Json.JsonValueKind.Object)
        {
            var colId = colEl.TryGetProperty("id", out var ci) && ci.TryGetInt32(out var civ) ? civ : 0;
            var colName = colEl.TryGetProperty("name", out var cn) ? cn.GetString() : null;
            var colPoster = colEl.TryGetProperty("poster_path", out var cp) ? cp.GetString() : null;
            if (colId > 0)
                belongsToCollection = new
                {
                    id = colId,
                    name = colName,
                    posterUrl = string.IsNullOrEmpty(colPoster) ? null : $"https://image.tmdb.org/t/p/w342{colPoster}",
                };
        }

        return Results.Json(new
        {
            tmdbId, title, overview,
            posterUrl = string.IsNullOrEmpty(posterPath) ? null : $"https://image.tmdb.org/t/p/w500{posterPath}",
            backdropUrl = string.IsNullOrEmpty(backdropPath) ? null : $"https://image.tmdb.org/t/p/w1280{backdropPath}",
            voteAverage, voteCount, releaseDate, year = releaseDate?.Length >= 4 ? releaseDate[..4] : null,
            genres, imdbId, mediaType = isMovie ? "Movie" : "Series",
            numberOfSeasons, seasons, cast, trailer = featuredTrailerObj, recommendations = recs,
            collection = belongsToCollection,
        }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = ex.Message }, jsonSerializerOptions);
    }
});

// —— Stream TMDB Discover (trending / popular / top-rated / upcoming) ——
app.MapGet("/api/stream/discover", async (string? category, CancellationToken ct) =>
{
    var apiKey = AppSettings.ResolvedTmdbApiKey;
    if (!AppSettings.IsValidTmdbKey(apiKey))
        return Results.Json(Array.Empty<object>(), jsonSerializerOptions);

    var cat = (category ?? "trending-movie").Trim().ToLowerInvariant();

    string tmdbUrl;
    bool defaultIsMovie;

    switch (cat)
    {
        case "trending-movie":
            tmdbUrl = $"https://api.themoviedb.org/3/trending/movie/week?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
            defaultIsMovie = true;
            break;
        case "trending-tv":
            tmdbUrl = $"https://api.themoviedb.org/3/trending/tv/week?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
            defaultIsMovie = false;
            break;
        case "popular-movie":
            tmdbUrl = $"https://api.themoviedb.org/3/movie/popular?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
            defaultIsMovie = true;
            break;
        case "popular-tv":
            tmdbUrl = $"https://api.themoviedb.org/3/tv/popular?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
            defaultIsMovie = false;
            break;
        case "top-rated-movie":
            tmdbUrl = $"https://api.themoviedb.org/3/movie/top_rated?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
            defaultIsMovie = true;
            break;
        case "top-rated-tv":
            tmdbUrl = $"https://api.themoviedb.org/3/tv/top_rated?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
            defaultIsMovie = false;
            break;
        case "upcoming":
            tmdbUrl = $"https://api.themoviedb.org/3/movie/upcoming?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
            defaultIsMovie = true;
            break;
        default:
            tmdbUrl = $"https://api.themoviedb.org/3/trending/movie/week?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
            defaultIsMovie = true;
            break;
    }

    try
    {
        using var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0");
        var json = await http.GetStringAsync(new Uri(tmdbUrl), ct).ConfigureAwait(false);
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var root = doc.RootElement;

        var items = new List<object>();
        if (root.TryGetProperty("results", out var results) && results.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var item in results.EnumerateArray().Take(20))
            {
                var id = item.TryGetProperty("id", out var idEl) && idEl.TryGetInt32(out var idVal) ? idVal : 0;
                if (id <= 0) continue;

                var title = item.TryGetProperty("title", out var tt) ? tt.GetString()
                    : item.TryGetProperty("name", out var nn) ? nn.GetString() : null;
                if (string.IsNullOrEmpty(title)) continue;

                var overview = item.TryGetProperty("overview", out var ov) ? ov.GetString() : null;
                var posterPath = item.TryGetProperty("poster_path", out var pp) ? pp.GetString() : null;
                var backdropPath = item.TryGetProperty("backdrop_path", out var bp) ? bp.GetString() : null;
                var voteAvg = item.TryGetProperty("vote_average", out var va) && va.TryGetDouble(out var vd) ? vd : 0;
                var relDate = item.TryGetProperty("release_date", out var rd) ? rd.GetString()
                    : item.TryGetProperty("first_air_date", out var fa) ? fa.GetString() : null;
                var mediaTypeField = item.TryGetProperty("media_type", out var mt) ? mt.GetString() : null;
                var isMovie = mediaTypeField == null ? defaultIsMovie : mediaTypeField != "tv";

                items.Add(new
                {
                    id,
                    title,
                    overview,
                    posterUrl = string.IsNullOrEmpty(posterPath) ? null : $"https://image.tmdb.org/t/p/w342{posterPath}",
                    backdropUrl = string.IsNullOrEmpty(backdropPath) ? null : $"https://image.tmdb.org/t/p/w1280{backdropPath}",
                    voteAverage = voteAvg,
                    year = relDate?.Length >= 4 ? relDate[..4] : null,
                    mediaType = isMovie ? "Movie" : "Series",
                });
            }
        }

        return Results.Json(items, jsonSerializerOptions);
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
                "No library folders are configured. Open Settings, add at least one folder under \"Library folders\", then scan again."
        });

    var jobId = await scan.BeginJobAsync().ConfigureAwait(false);
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
                scan.Update(p.Current, p.CurrentFile, p.MatchedSoFar, p.UnmatchedSoFar, p.SkippedSoFar);
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
            await scan.EndJobAsync().ConfigureAwait(false);
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
        bool lite = false, CancellationToken ct = default) =>
{
    var cap = Math.Clamp(limit, 1, 200);
    var list = (await repo.GetRecentHistoryAsync(cap, includeSuppressed, ct).ConfigureAwait(false)).ToList();
    // `lite=true` skips the per-row poster/backdrop/TMDB/episode enrichment below —
    // callers that only need raw resume-position fields (e.g. usePlayback's
    // "where did I leave off" lookup) were paying for ~7 sequential DB/TMDB
    // calls per history row (up to 200 rows) just to compute a resume second.
    var tmdb = lite ? null : TmdbClientFactory.Create();
    foreach (var h in lite ? Enumerable.Empty<WatchHistory>() : list)
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
            PosterRemoteUrl = row.PosterRemoteUrl,
            ImdbId = row.ImdbId,
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
    await repo.AddListItemAsync(id, body.TmdbId, body.MediaType ?? "Movie",
        body.Title, body.PosterRemoteUrl, body.ImdbId, ct).ConfigureAwait(false);
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

app.MapGet("/api/people/{tmdbId:int}/stream-credits", async (int tmdbId, CancellationToken ct) =>
{
    var apiKey = AppSettings.ResolvedTmdbApiKey;
    if (!AppSettings.IsValidTmdbKey(apiKey) || tmdbId <= 0)
        return Results.Json(new { credits = Array.Empty<object>(), error = "TMDB not configured." }, jsonSerializerOptions);

    try
    {
        using var handler = new System.Net.Http.HttpClientHandler
        {
            AutomaticDecompression = System.Net.DecompressionMethods.GZip | System.Net.DecompressionMethods.Deflate
        };
        using var http = new HttpClient(handler);
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0");
        var url = $"https://api.themoviedb.org/3/person/{tmdbId}/combined_credits?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
        var json = await http.GetStringAsync(new Uri(url), ct).ConfigureAwait(false);
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var root = doc.RootElement;

        static string? Str(System.Text.Json.JsonElement el, string key) =>
            el.TryGetProperty(key, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;
        static int? Int32(System.Text.Json.JsonElement el, string key) =>
            el.TryGetProperty(key, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.Number ? v.GetInt32() : null;
        static double Dbl(System.Text.Json.JsonElement el, string key) =>
            el.TryGetProperty(key, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.Number ? v.GetDouble() : 0;

        var castCredits  = new List<object>();
        var crewCredits  = new List<object>();
        var seenCast     = new HashSet<int>();
        var seenCrew     = new HashSet<string>(); // "id:job" to allow director + writer same film

        foreach (var section in new[] { "cast", "crew" })
        {
            if (!root.TryGetProperty(section, out var arr) || arr.ValueKind != System.Text.Json.JsonValueKind.Array)
                continue;
            foreach (var item in arr.EnumerateArray())
            {
                var id = Int32(item, "id");
                if (id is null) continue;

                var mediaType = Str(item, "media_type");
                var title = Str(item, "title") ?? Str(item, "name");
                if (string.IsNullOrWhiteSpace(title)) continue;

                var posterPath = Str(item, "poster_path");
                var posterUrl = string.IsNullOrWhiteSpace(posterPath)
                    ? null : $"https://image.tmdb.org/t/p/w342{posterPath}";
                var releaseDate = Str(item, "release_date") ?? Str(item, "first_air_date");
                var year = releaseDate?.Length >= 4 ? releaseDate[..4] : null;
                var voteAverage = Dbl(item, "vote_average");
                var mt = string.Equals(mediaType, "tv", StringComparison.OrdinalIgnoreCase) ? "Series" : "Movie";

                if (section == "cast")
                {
                    if (!seenCast.Add(id.Value)) continue;
                    var character = Str(item, "character");
                    castCredits.Add(new { id = id.Value, title, mediaType = mt, posterUrl, year, voteAverage, character, job = (string?)null, creditType = "cast" });
                }
                else
                {
                    var job = Str(item, "job");
                    if (string.IsNullOrWhiteSpace(job)) continue;
                    var crewKey = $"{id.Value}:{job}";
                    if (!seenCrew.Add(crewKey)) continue;
                    crewCredits.Add(new { id = id.Value, title, mediaType = mt, posterUrl, year, voteAverage, character = (string?)null, job, creditType = "crew" });
                }
            }
        }

        static List<object> Top(List<object> list, int n) =>
            list.Cast<dynamic>().OrderByDescending(x => (double)x.voteAverage).Take(n).Cast<object>().ToList();

        return Results.Json(new
        {
            cast  = Top(castCredits,  50),
            crew  = Top(crewCredits,  40),
            error = (string?)null
        }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        return Results.Json(new { credits = Array.Empty<object>(), error = ex.Message }, jsonSerializerOptions);
    }
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
    var sdlKey = await repo.GetSettingAsync("SubDlApiKey", ct).ConfigureAwait(false);
    var sdlMasked = MaskKey(sdlKey);
    var mdblistKey = await repo.GetSettingAsync("MdblistApiKey", ct).ConfigureAwait(false);
    var mdblistMasked = MaskKey(mdblistKey);
    var tvdbKey = await repo.GetSettingAsync("TvdbApiKey", ct).ConfigureAwait(false);
    var tvdbMasked = MaskKey(tvdbKey);
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
    var playerMode = await repo.GetSettingAsync("PlayerMode", ct).ConfigureAwait(false) ?? "detached";

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
        subDlApiKey = sdlMasked,
        mdblistApiKey = mdblistMasked,
        tvdbApiKey = tvdbMasked,
        libraryPaths = paths,
        pinnedScanPaths,
        excludedScanPaths,
        matchedMovies,
        matchedSeries,
        unmatchedCount,
        mediaPlayerPath,
        useBuiltinPlayer,
        playerMode,
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

    if (!string.IsNullOrWhiteSpace(body.SubDlApiKey))
        await repo.SaveSettingAsync("SubDlApiKey", body.SubDlApiKey.Trim(), ct).ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.MdblistApiKey))
        await repo.SaveSettingAsync("MdblistApiKey", body.MdblistApiKey.Trim(), ct).ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.TvdbApiKey))
        await repo.SaveSettingAsync("TvdbApiKey", body.TvdbApiKey.Trim(), ct).ConfigureAwait(false);

    if (body.OpenSubtitlesAppName != null)
        await repo.SaveSettingAsync("OpenSubtitlesAppName", body.OpenSubtitlesAppName.Trim(), ct).ConfigureAwait(false);

    if (body.MediaPlayerPath != null)
        await repo.SaveSettingAsync("MediaPlayerPath", body.MediaPlayerPath.Trim(), ct).ConfigureAwait(false);

    if (body.UseBuiltinPlayer.HasValue)
        await repo.SaveSettingAsync("UseBuiltinPlayer", body.UseBuiltinPlayer.Value ? "true" : "false", ct)
            .ConfigureAwait(false);

    if (!string.IsNullOrWhiteSpace(body.PlayerMode))
        await repo.SaveSettingAsync("PlayerMode", body.PlayerMode.Trim(), ct).ConfigureAwait(false);

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

app.MapGet("/api/settings/verify-subdl", async (string? key, CancellationToken ct) =>
{
    var k = key?.Trim();
    if (string.IsNullOrEmpty(k))
        return Results.Json(new { valid = false, error = "Key is required." }, jsonSerializerOptions);

    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        // Use a known IMDB ID (The Godfather) for a reliable probe
        var url = $"https://api.subdl.com/api/v1/subtitles?api_key={Uri.EscapeDataString(k)}&imdb_id=tt0068646&type=movie";
        using var res = await http.GetAsync(url, ct).ConfigureAwait(false);

        if (res.StatusCode == HttpStatusCode.Unauthorized || res.StatusCode == HttpStatusCode.Forbidden)
            return Results.Json(new { valid = false, error = "Unauthorized — check the API key." }, jsonSerializerOptions);

        if (res.IsSuccessStatusCode)
        {
            // SubDL returns {"status":false,...} for invalid keys even on 200
            var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            try
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("status", out var statusEl))
                {
                    // status can be bool true/false or int 1/0
                    var ok = statusEl.ValueKind == JsonValueKind.True
                        || (statusEl.ValueKind == JsonValueKind.Number && statusEl.GetInt32() == 1);
                    if (!ok)
                    {
                        var msg = doc.RootElement.TryGetProperty("message", out var m) ? m.GetString() : null;
                        return Results.Json(new { valid = false, error = msg ?? "Invalid API key." }, jsonSerializerOptions);
                    }
                }
            }
            catch { /* If we can't parse, assume valid (empty result is OK) */ }
            return Results.Json(new { valid = true, error = (string?)null }, jsonSerializerOptions);
        }

        return Results.Json(new { valid = false, error = $"SubDL returned {(int)res.StatusCode}." }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        return Results.Json(new { valid = false, error = ex.Message }, jsonSerializerOptions);
    }
});

app.MapGet("/api/settings/verify-mdblist", async (string? key, CancellationToken ct) =>
{
    var k = key?.Trim();
    if (string.IsNullOrEmpty(k))
        return Results.Json(new { valid = false, error = "Key is required." }, jsonSerializerOptions);

    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        // Probe with The Shawshank Redemption (tt0111161)
        var url = $"https://mdblist.com/api/?i=tt0111161&apikey={Uri.EscapeDataString(k)}";
        using var res = await http.GetAsync(url, ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
            return Results.Json(new { valid = false, error = $"MDBList returned {(int)res.StatusCode}." }, jsonSerializerOptions);

        var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(body);
        // MDBList returns { "error": true, "message": "..." } on bad key
        if (doc.RootElement.TryGetProperty("error", out var errEl) && errEl.ValueKind == JsonValueKind.True)
        {
            var msg = doc.RootElement.TryGetProperty("message", out var m) ? m.GetString() : null;
            return Results.Json(new { valid = false, error = msg ?? "Invalid API key." }, jsonSerializerOptions);
        }

        // Extract IMDb score for the toast
        float? imdbScore = null;
        if (doc.RootElement.TryGetProperty("ratings", out var ratingsEl))
        {
            foreach (var item in ratingsEl.EnumerateArray())
            {
                if (!item.TryGetProperty("source", out var src) || src.GetString() != "imdb") continue;
                if (!item.TryGetProperty("value", out var val)) continue;
                if (val.ValueKind == JsonValueKind.Number)
                    imdbScore = val.GetSingle();
                else if (val.ValueKind == JsonValueKind.String &&
                         float.TryParse(val.GetString(), System.Globalization.NumberStyles.Any,
                             System.Globalization.CultureInfo.InvariantCulture, out var parsed))
                    imdbScore = parsed;
            }
        }

        // Include a raw body snippet to help diagnose parsing issues
        var rawSnippet = body.Length > 600 ? body[..600] + "…" : body;
        return Results.Json(new { valid = true, imdbScore, rawSnippet, error = (string?)null }, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        return Results.Json(new { valid = false, error = ex.Message }, jsonSerializerOptions);
    }
});

app.MapGet("/api/settings/verify-tvdb", async (string? key, CancellationToken ct) =>
{
    var k = key?.Trim();
    if (string.IsNullOrEmpty(k))
        return Results.Json(new { valid = false, error = "Key is required." }, jsonSerializerOptions);

    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api4.thetvdb.com/v4/login");
        req.Content = JsonContent.Create(new { apikey = k });
        using var res = await http.SendAsync(req, ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
            return Results.Json(new { valid = false, error = $"TVDB returned {(int)res.StatusCode}." }, jsonSerializerOptions);

        var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        using var doc = JsonDocument.Parse(body);
        if (!doc.RootElement.TryGetProperty("data", out var data) ||
            !data.TryGetProperty("token", out _))
            return Results.Json(new { valid = false, error = "TVDB did not return a token." }, jsonSerializerOptions);

        return Results.Json(new { valid = true, error = (string?)null }, jsonSerializerOptions);
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

// ── Unified watch tracking ───────────────────────────────────────────────────

app.MapPost("/api/history/mark-watched", async (HttpRequest req, LibraryRepository repo, CancellationToken ct) =>
{
    var body = await req.ReadFromJsonAsync<UnifiedWatchBody>(cancellationToken: ct).ConfigureAwait(false);
    if (body == null || body.TmdbId <= 0)
        return Results.Json(new { success = false, error = "tmdbId is required." }, jsonSerializerOptions, statusCode: 400);

    var source = string.IsNullOrWhiteSpace(body.Source) ? "manual" : body.Source.Trim().ToLowerInvariant();
    if (source is not ("streaming" or "manual"))
        source = "manual";

    await repo.RecordUnifiedWatchAsync(
        tmdbId: body.TmdbId,
        imdbId: body.ImdbId?.Trim(),
        mediaType: body.MediaType ?? "Movie",
        title: body.Title ?? "",
        posterUrl: body.PosterUrl?.Trim(),
        source: source,
        seasonNumber: body.SeasonNumber,
        episodeNumber: body.EpisodeNumber,
        estimatedSeconds: body.RuntimeMinutes > 0 ? body.RuntimeMinutes * 60 : 0,
        ct: ct).ConfigureAwait(false);

    return Results.Json(new { success = true }, jsonSerializerOptions);
});

// ── Watch history re-enrichment (back-fill analytics on old rows) ────────────

app.MapPost("/api/history/re-enrich", async (LibraryRepository repo, CancellationToken ct) =>
{
    var updated = await repo.ReEnrichHistoryRowsAsync(ct).ConfigureAwait(false);
    return Results.Json(new { success = true, updatedRows = updated }, jsonSerializerOptions);
});

// ── Coming Soon ──────────────────────────────────────────────────────────────

app.MapGet("/api/coming-soon", async (LibraryRepository repo, CancellationToken ct) =>
{
    var rows = await repo.GetPinnedComingSoonAsync(ct).ConfigureAwait(false);
    return Results.Json(rows.Select(r => new
    {
        r.Id, r.TmdbId, r.MediaType, r.Title,
        r.PosterUrl, r.ReleaseDate, r.TrailerUrl, r.Overview, r.PinnedAt
    }), jsonSerializerOptions);
});

app.MapPost("/api/coming-soon", async (HttpRequest req, LibraryRepository repo, CancellationToken ct) =>
{
    var body = await req.ReadFromJsonAsync<PinComingSoonBody>(cancellationToken: ct).ConfigureAwait(false);
    if (body == null || body.TmdbId <= 0)
        return Results.Json(new { success = false, error = "tmdbId is required." }, jsonSerializerOptions, statusCode: 400);

    var item = new PinnedComingSoon
    {
        TmdbId = body.TmdbId,
        MediaType = body.MediaType ?? "Movie",
        Title = body.Title ?? "",
        PosterUrl = body.PosterUrl?.Trim(),
        ReleaseDate = body.ReleaseDate?.Trim(),
        TrailerUrl = body.TrailerUrl?.Trim(),
        Overview = body.Overview?.Trim(),
    };
    var saved = await repo.PinComingSoonAsync(item, ct).ConfigureAwait(false);
    return Results.Json(new { success = true, id = saved?.Id }, jsonSerializerOptions);
});

app.MapDelete("/api/coming-soon/{id:int}", async (int id, LibraryRepository repo, CancellationToken ct) =>
{
    var ok = await repo.UnpinComingSoonAsync(id, ct).ConfigureAwait(false);
    return ok
        ? Results.Json(new { success = true }, jsonSerializerOptions)
        : Results.NotFound(new { success = false, error = "Not found." });
});

// ── Trailer embed URL for local library items ────────────────────────────────

app.MapGet("/api/trailers/embed", async (int? tmdbId, string? mediaType, TrailersRepository trailersRepo, CancellationToken ct) =>
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
    var tmdb = TmdbClientFactory.Create();
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

static string? TrailerYoutubeKey(string? raw)
{
    if (string.IsNullOrWhiteSpace(raw)) return null;
    var m = Regex.Match(raw, @"(?:v=|youtu\.be/|embed/)([A-Za-z0-9_-]{11})");
    if (m.Success) return m.Groups[1].Value;
    if (Regex.IsMatch(raw, @"^[A-Za-z0-9_-]{11}$")) return raw;
    return null;
}

static string? YoutubeEmbedUrl(string? raw)
{
    if (string.IsNullOrWhiteSpace(raw)) return null;
    // Already an embed URL
    if (raw.Contains("/embed/", StringComparison.Ordinal)) return raw;
    // Extract v= param from watch URL: youtube.com/watch?v=XXXX or youtu.be/XXXX
    var vidMatch = Regex.Match(raw, @"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})");
    if (vidMatch.Success)
        return $"https://www.youtube.com/embed/{vidMatch.Groups[1].Value}?autoplay=1";
    // Bare video ID (11 chars)
    if (Regex.IsMatch(raw, @"^[A-Za-z0-9_-]{11}$"))
        return $"https://www.youtube.com/embed/{raw}?autoplay=1";
    return null;
}

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

// Duplicate detection — finds movies and episodes that appear more than once in the library
app.MapGet("/api/library/duplicates", async (LibraryRepository repo, LibraryContext db, CancellationToken ct) =>
{
    var allMovies = await repo.GetAllMoviesAsync(ct).ConfigureAwait(false);

    // Movie duplicates: group by TmdbId (matched) or normalised title+year (unmatched)
    var movieGroups = allMovies
        .GroupBy(m => m.TmdbId > 0
            ? $"tmdb:{m.TmdbId}"
            : $"title:{m.Title.Trim().ToLowerInvariant()}:{m.Year}")
        .Where(g => g.Count() > 1)
        .Select(g =>
        {
            var first = g.First();
            var posterUrl = string.IsNullOrEmpty(first.SelectedPosterPath)
                ? (string.IsNullOrEmpty(first.PosterLocalPath) ? null : $"{publicBase}/images/{Path.GetFileName(first.PosterLocalPath)}")
                : $"{publicBase}/images/{Path.GetFileName(first.SelectedPosterPath)}";
            return new
            {
                tmdbId    = first.TmdbId,
                title     = first.Title,
                year      = first.Year,
                posterUrl,
                copies = g.Select(m => new
                {
                    id          = m.Id,
                    filePath    = m.FilePath,
                    fileExists  = File.Exists(m.FilePath),
                    fileSize    = TryGetFileSize(m.FilePath),
                    dateAdded   = m.DateAdded,
                    watchStatus = m.WatchStatus,
                }).OrderBy(c => c.dateAdded).ToList(),
            };
        })
        .OrderBy(g => g.title)
        .ToList();

    // Episode duplicates: group by ShowId + Season + EpisodeNumber, joined with show title
    var epRows = await db.Episodes.AsNoTracking()
        .GroupBy(e => new { e.ShowId, e.Season, e.EpisodeNumber })
        .Where(g => g.Count() > 1)
        .ToListAsync(ct).ConfigureAwait(false);

    var showIds = epRows.Select(g => g.Key.ShowId).Distinct().ToList();
    var showMap = await db.Shows.AsNoTracking()
        .Where(s => showIds.Contains(s.Id))
        .ToDictionaryAsync(s => s.Id, s => s.Title, ct).ConfigureAwait(false);

    // Re-fetch the actual episodes for those groups so we have FilePath etc.
    var dupEpIds = new List<int>();
    foreach (var grp in epRows)
    {
        dupEpIds.AddRange(grp.Select(e => e.Id));
    }
    var dupEpisodes = await db.Episodes.AsNoTracking()
        .Where(e => dupEpIds.Contains(e.Id))
        .ToListAsync(ct).ConfigureAwait(false);

    var episodeDuplicates = dupEpisodes
        .GroupBy(e => $"{e.ShowId}:{e.Season}:{e.EpisodeNumber}")
        .Where(g => g.Count() > 1)
        .Select(g =>
        {
            var first = g.First();
            showMap.TryGetValue(first.ShowId, out var showTitle);
            return new
            {
                showId        = first.ShowId,
                showTitle     = showTitle ?? "Unknown Show",
                season        = first.Season,
                episodeNumber = first.EpisodeNumber,
                episodeTitle  = first.Title,
                copies = g.Select(e => new
                {
                    id          = e.Id,
                    filePath    = e.FilePath,
                    fileExists  = File.Exists(e.FilePath),
                    fileSize    = TryGetFileSize(e.FilePath),
                    watchStatus = e.WatchStatus,
                }).OrderBy(c => c.id).ToList(),
            };
        })
        .OrderBy(g => g.showTitle).ThenBy(g => g.season).ThenBy(g => g.episodeNumber)
        .ToList();

    return Results.Json(new
    {
        movieDuplicates   = movieGroups,
        episodeDuplicates,
        totalMovieDuplicateGroups   = movieGroups.Count,
        totalEpisodeDuplicateGroups = episodeDuplicates.Count,
    }, jsonSerializerOptions);

    static long? TryGetFileSize(string path)
    {
        try { return string.IsNullOrEmpty(path) ? null : new FileInfo(path).Length; }
        catch { return null; }
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

// —— MDBList ratings ——
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

// Batch cache-only ratings lookup for filmography cards — no new API calls, pure SQLite reads.
// ids = comma-separated "movie:123,tv:456,movie:789" strings (max 200).
app.MapGet("/api/ratings/batch-cached", async (string? ids, LibraryContext db, CancellationToken ct) =>
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

    // ── RatingsSnapshots: indexed on (TmdbId, MediaType) ────────────────────
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

    // ── MdbListRatingsCache: keyed by ImdbId but TmdbId column exists ────────
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
                var m = System.Text.Json.JsonSerializer.Deserialize<Pitflix.API.Services.MdbListRatings>(json,
                    new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
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
        return new
        {
            key,
            tmdbRating    = snap.tmdb,
            imdbRating    = snap.imdb ?? (mdb.imdb.HasValue ? $"{mdb.imdb:F1}" : null),
            rtCritics     = snap.rt   ?? (mdb.rt.HasValue   ? $"{(int)mdb.rt.Value}%" : null),
            rtAudience    = snap.rtAud ?? (mdb.rtAud.HasValue ? $"{(int)mdb.rtAud.Value}%" : null),
            metacritic    = mdb.mc.HasValue    ? (int?)mdb.mc.Value    : null,
            letterboxd    = mdb.lb.HasValue    ? (float?)mdb.lb.Value  : null,
            trakt         = mdb.trakt.HasValue ? (float?)mdb.trakt.Value : null,
        };
    }).ToList();

    return Results.Json(new { results }, jsonSerializerOptions);
});

// —— TVDB endpoints ——
app.MapGet("/api/tvdb/artworks", async (int? tmdbId, string? mediaType, TvdbService tvdb, CancellationToken ct) =>
{
    if (tmdbId is null or <= 0 || string.IsNullOrWhiteSpace(mediaType))
        return Results.BadRequest();

    var artworks = await tvdb.GetArtworksAsync(tmdbId.Value, mediaType, ct).ConfigureAwait(false);
    if (artworks is null)
        return Results.NotFound();

    return Results.Json(artworks.Select(a => new
    {
        url       = a.Url,
        thumbnail = a.Thumbnail,
        type      = a.Type,
        score     = a.Score,
        width     = a.Width,
        height    = a.Height,
    }), jsonSerializerOptions);
});

app.MapGet("/api/tvdb/people", async (int? tmdbId, string? mediaType, TvdbService tvdb, CancellationToken ct) =>
{
    if (tmdbId is null or <= 0 || string.IsNullOrWhiteSpace(mediaType))
        return Results.BadRequest();

    var people = await tvdb.GetPeopleAsync(tmdbId.Value, mediaType, ct).ConfigureAwait(false);
    if (people is null)
        return Results.NotFound();

    return Results.Json(people.Select(p => new
    {
        personName    = p.PersonName,
        characterName = p.CharacterName,
        imageUrl      = p.ImageUrl,
        role          = p.Role,
    }), jsonSerializerOptions);
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

// Awards nominations for a specific title — live from Wikidata (no preload needed).
app.MapGet("/api/awards/for-title", async (int tmdbId, string? mediaType, string? imdbId, WikidataAwardsService wikidata, CancellationToken ct) =>
{
    if (tmdbId <= 0) return Results.BadRequest();
    var isTv = string.Equals(mediaType, "tv", StringComparison.OrdinalIgnoreCase)
            || string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase);

    // Try TMDB ID first; fall back to IMDb ID (P345) which has much better Wikidata coverage.
    var raw = await wikidata.GetAwardsAsync(tmdbId, isTv, ct).ConfigureAwait(false);
    if (raw.Count == 0 && !string.IsNullOrWhiteSpace(imdbId))
        raw = await wikidata.GetAwardsByImdbIdAsync(imdbId, ct).ConfigureAwait(false);
    if (raw.Count == 0 && !string.IsNullOrWhiteSpace(imdbId) && TmdbClientFactory.Create() is null)
    {
        // no TMDB configured — already tried imdbId above, nothing more to do
    }
    else if (raw.Count == 0 && string.IsNullOrWhiteSpace(imdbId) && TmdbClientFactory.Create() is { } tmdbFallback)
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
app.MapGet("/api/awards/for-person", async (int tmdbId, WikidataAwardsService wikidata, CancellationToken ct) =>
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
    var tmdbClient = TmdbClientFactory.Create();
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

app.MapGet("/api/home/coming-soon", async (LibraryRepository repo, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
    {
        return Results.Json(
            new { movies = Array.Empty<object>(), tv = Array.Empty<object>() },
            jsonSerializerOptions);
    }

    var today = DateOnly.FromDateTime(DateTime.UtcNow);
    var todayStr = today.ToString("yyyy-MM-dd");
    var cutoffStr = today.AddDays(30).ToString("yyyy-MM-dd");

    // Fetch movies, new series, TMDB candidate pools, AND library shows — all in parallel
    var moviesTask        = tmdb.GetUpcomingMoviesAsync(1, ct);
    var newTvTask         = tmdb.DiscoverTvFirstAirFromAsync(todayStr, 1, ct);
    var trendingTvTask    = tmdb.GetTrendingTvWeekAsync(ct);
    var onTheAirTask1     = tmdb.GetOnTheAirTvAsync(1, ct);
    var onTheAirTask2     = tmdb.GetOnTheAirTvAsync(2, ct);
    var popularTvTask1    = tmdb.DiscoverPopularTvAsync(1, ct);
    var popularTvTask2    = tmdb.DiscoverPopularTvAsync(2, ct);
    var libraryShowsTask  = repo.GetAllShowsAsync(ct);
    await Task.WhenAll(moviesTask, newTvTask, trendingTvTask, onTheAirTask1, onTheAirTask2, popularTvTask1, popularTvTask2, libraryShowsTask).ConfigureAwait(false);

    var movies = moviesTask.Result
        .Where(m => TrailersFeedHelpers.IsStrictlyFutureReleaseDate(m.ReleaseDate))
        .ToList();

    // New series: first_air_date is strictly in the future
    var newSeries = newTvTask.Result
        .Where(t => TrailersFeedHelpers.IsStrictlyFutureReleaseDate(t.ReleaseDate))
        .ToList();

    // Library shows → TmdbDiscoverItem stubs so they always enter the candidate pool.
    // This guarantees shows the user is already watching appear if a new season is coming.
    static string? ExtractPosterPath(string? url)
    {
        if (string.IsNullOrEmpty(url)) return null;
        var marker = "image.tmdb.org/t/p/";
        var idx = url.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return null;
        var afterSize = url[(idx + marker.Length)..];
        var slash = afterSize.IndexOf('/');
        return slash >= 0 ? afterSize[slash..] : null;
    }

    var libraryStubs = libraryShowsTask.Result
        .Where(s => s.IsMatched && s.TmdbId > 0)
        .Select(s => new TmdbDiscoverItem
        {
            Id         = s.TmdbId,
            MediaType  = "tv",
            Title      = s.Title,
            PosterPath = ExtractPosterPath(s.PosterRemoteUrl) ?? "",
        })
        .ToList();

    // Candidate pool: library shows first (guaranteed), then TMDB public lists — all deduplicated.
    var newSeriesIds = new HashSet<int>(newSeries.Select(s => s.Id));
    var candidates = libraryStubs
        .Concat(trendingTvTask.Result)
        .Concat(onTheAirTask1.Result)
        .Concat(onTheAirTask2.Result)
        .Concat(popularTvTask1.Result)
        .Concat(popularTvTask2.Result)
        .GroupBy(s => s.Id)
        .Select(g => g.First())
        .Where(s => !newSeriesIds.Contains(s.Id))
        .Take(80)
        .ToList();

    // Enrich each candidate with a concurrency cap to avoid TMDB rate-limiting.
    // Keep shows whose next_episode_to_air is season 2+ and airs within the next 30 days.
    var sem = new SemaphoreSlim(6, 6);
    var enrichTasks = candidates.Select(async show =>
    {
        await sem.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var info = await tmdb.TryGetTvNextAiringAsync(show.Id, ct).ConfigureAwait(false);
            var next = info?.NextEpisode;
            if (next == null) return ((TmdbDiscoverItem Show, int SeasonNumber, string AirDate)?)null;
            var seasonNum  = (int?)next["season_number"];
            var episodeNum = (int?)next["episode_number"];
            var airDate    = (string?)next["air_date"];
            // Season 2+ premiere only — episode 1 means the season hasn't started yet
            if (seasonNum == null || seasonNum < 2 || episodeNum != 1) return null;
            if (string.IsNullOrEmpty(airDate)) return null;
            if (string.Compare(airDate, todayStr,  StringComparison.Ordinal) < 0) return null;
            if (string.Compare(airDate, cutoffStr, StringComparison.Ordinal) > 0) return null;
            return ((TmdbDiscoverItem Show, int SeasonNumber, string AirDate)?)(Show: show, SeasonNumber: seasonNum.Value, AirDate: airDate!);
        }
        finally { sem.Release(); }
    });

    var enriched = (await Task.WhenAll(enrichTasks).ConfigureAwait(false))
        .Where(r => r != null)
        .Select(r => r!.Value)
        .OrderBy(e => e.AirDate)
        .ToList();

    // Merge: new series first, then upcoming seasons (already ordered by air date); deduplicate by tmdbId
    var seenIds = new HashSet<int>(newSeries.Select(s => s.Id));
    var mergedTv = newSeries.Select(s => (Show: s, SeasonNumber: (int?)null, AirDate: s.ReleaseDate)).ToList();
    foreach (var e in enriched)
    {
        if (seenIds.Add(e.Show.Id))
            mergedTv.Add((e.Show, (int?)e.SeasonNumber, e.AirDate));
    }

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
            voteAverage = x.VoteAverage,
            seasonNumber = (int?)null
        };
    }

    return Results.Json(new
        {
            movies = movies.Take(12).Select(MapMovie).ToList(),
            tv = mergedTv.Take(20).Select(e =>
            {
                var x = e.Show;
                var ov = x.Overview ?? "";
                return new
                {
                    tmdbId = x.Id,
                    mediaType = "tv",
                    title = x.Title,
                    releaseDate = e.AirDate,
                    posterUrl = string.IsNullOrEmpty(x.PosterPath)
                        ? null
                        : $"https://image.tmdb.org/t/p/w342{x.PosterPath}",
                    overview = ov.Length > 160 ? ov[..160] + "…" : ov,
                    voteAverage = x.VoteAverage,
                    seasonNumber = e.SeasonNumber
                };
            }).ToList()
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
    // Show trailers for content released within this window (movie hit theaters recently).
    const int RecentlyReleasedWindowDays = 60;
    // For content with an OLD release date (e.g. an ongoing show whose first season aired
    // years ago), still show the trailer if it was published very recently — this is the
    // "House of the Dragon Season 3" case where TMDB's first_air_date is 2022 but a
    // brand-new season trailer just dropped.
    var freshOngoingCutoffUtc = DateTime.UtcNow.AddDays(-21);
    // For content with NO release date at all, be more generous (90 days) since these
    // are typically unannounced upcoming titles where the date isn't on TMDB yet.
    var freshNoDateCutoffUtc = DateTime.UtcNow.AddDays(-90);

    bool TryParseDateOnly(string? ymd, out DateOnly d)
    {
        d = default;
        if (string.IsNullOrWhiteSpace(ymd) || ymd.Length < 10)
            return false;
        return DateOnly.TryParse(ymd.AsSpan(0, 10), out d);
    }

    bool IsUpcomingOrRecent(Pitflix.API.Services.Trailers.TrailerCardUiRow r)
    {
        var hasPub = r.TrailerPublishedAtUtc != default;

        if (TryParseDateOnly(r.ReleaseDate, out var release))
        {
            // Upcoming — not yet released
            if (release > today) return true;

            // Recently released — within the 60-day window
            if (release >= today.AddDays(-RecentlyReleasedWindowDays)) return true;

            // Release date is older than 60 days (e.g. ongoing TV show whose first season
            // aired years ago). Still show if the trailer itself is very fresh (≤21 days),
            // which is the signal that a new season / new content is being promoted.
            return hasPub && r.TrailerPublishedAtUtc >= freshOngoingCutoffUtc;
        }

        // No release date on TMDB — show if the trailer clip was published within 90 days.
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

// —— Library Browse ——

// Decade browsing: returns movies or shows (or both) filtered by decade
app.MapGet("/api/library/browse/decade", async (
    LibraryContext db,
    int decade,
    string mediaType = "all",
    CancellationToken ct = default) =>
{
    var decadeStart = (decade / 10) * 10;
    var decadeEnd = decadeStart + 10;
    var tmdb = TmdbClientFactory.Create();
    var results = new List<object>();

    var rawCards = new List<MediaCardDto>();

    if (!string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase))
    {
        var movies = await db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.Year.HasValue && m.Year >= decadeStart && m.Year < decadeEnd)
            .OrderByDescending(m => m.VoteAverage)
            .Take(120)
            .ToListAsync(ct).ConfigureAwait(false);
        rawCards.AddRange(movies.Select(ToCardFromMovie));
    }

    if (!string.Equals(mediaType, "Movie", StringComparison.OrdinalIgnoreCase))
    {
        var shows = await db.Shows.AsNoTracking()
            .Where(s => s.IsMatched && s.Year.HasValue && s.Year >= decadeStart && s.Year < decadeEnd)
            .OrderByDescending(s => s.VoteAverage)
            .Take(120)
            .ToListAsync(ct).ConfigureAwait(false);
        rawCards.AddRange(shows.Select(ToCardFromShow));
    }

    await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(rawCards, tmdb, ct).ConfigureAwait(false);
    var mappedCards = rawCards.OrderByDescending(c => c.VoteAverage).Select(ImageUrls.MapMediaCard).ToList();
    return Results.Json(new { decade = decadeStart, items = mappedCards, total = mappedCards.Count }, jsonSerializerOptions);
});

// Keyword browsing: returns library items whose KeywordsJson contains the given keyword name
app.MapGet("/api/library/browse/keyword", async (
    LibraryContext db,
    string keyword,
    string mediaType = "all",
    CancellationToken ct = default) =>
{
    if (string.IsNullOrWhiteSpace(keyword))
        return Results.Json(new { items = Array.Empty<object>(), total = 0 }, jsonSerializerOptions);

    var needle = keyword.Trim().ToLowerInvariant();
    var tmdb = TmdbClientFactory.Create();
    var rawCards = new List<MediaCardDto>();

    if (!string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase))
    {
        var movies = await db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.KeywordsJson != null &&
                        EF.Functions.Like(m.KeywordsJson.ToLower(), $"%\"name\":\"{needle}\"%"))
            .OrderByDescending(m => m.VoteAverage)
            .Take(80)
            .ToListAsync(ct).ConfigureAwait(false);
        rawCards.AddRange(movies.Select(ToCardFromMovie));
    }

    if (!string.Equals(mediaType, "Movie", StringComparison.OrdinalIgnoreCase))
    {
        var shows = await db.Shows.AsNoTracking()
            .Where(s => s.IsMatched && s.KeywordsJson != null &&
                        EF.Functions.Like(s.KeywordsJson.ToLower(), $"%\"name\":\"{needle}\"%"))
            .OrderByDescending(s => s.VoteAverage)
            .Take(80)
            .ToListAsync(ct).ConfigureAwait(false);
        rawCards.AddRange(shows.Select(ToCardFromShow));
    }

    await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(rawCards, tmdb, ct).ConfigureAwait(false);
    var mappedCards = rawCards.Select(ImageUrls.MapMediaCard).ToList();
    return Results.Json(new { keyword, items = mappedCards, total = mappedCards.Count }, jsonSerializerOptions);
});

// TMDB collection details — used by streaming page to show all collection parts
app.MapGet("/api/stream/collection/{collectionId:int}", async (int collectionId, CancellationToken ct) =>
{
    var tmdb = TmdbClientFactory.Create();
    if (tmdb == null)
        return Results.Json(new { error = "TMDB API key not configured." }, jsonSerializerOptions);

    var col = await tmdb.TryGetCollectionAsync(collectionId, ct).ConfigureAwait(false);
    if (col == null)
        return Results.NotFound();

    return Results.Json(new
    {
        id = col.Id,
        name = col.Name,
        overview = col.Overview,
        posterUrl = string.IsNullOrEmpty(col.PosterPath) ? null : $"https://image.tmdb.org/t/p/w500{col.PosterPath}",
        backdropUrl = string.IsNullOrEmpty(col.BackdropPath) ? null : $"https://image.tmdb.org/t/p/w1280{col.BackdropPath}",
        parts = col.Parts.Select(p => new
        {
            tmdbId = p.Id,
            title = p.Title,
            posterUrl = string.IsNullOrEmpty(p.PosterPath) ? null : $"https://image.tmdb.org/t/p/w342{p.PosterPath}",
            releaseDate = p.ReleaseDate,
            year = p.ReleaseDate?.Length >= 4 ? p.ReleaseDate[..4] : null,
            voteAverage = p.VoteAverage,
        }).ToList(),
    }, jsonSerializerOptions);
});

// Chapter / intro-outro detection — used by the player overlay for "Skip Intro" / "Skip Credits" buttons
app.MapGet("/api/playback/chapters", async (
    string? filePath,
    string? mediaType,
    double? duration,
    CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(filePath))
        return Results.BadRequest(new { error = "filePath is required." });

    if (!File.Exists(filePath))
        return Results.NotFound(new { error = "File not found." });

    var result = await Pitflix.API.Services.ChapterDetectorService.DetectAsync(
        filePath, mediaType, duration, null, ct).ConfigureAwait(false);

    return Results.Json(new
    {
        chapters = result.Chapters.Select(c => new
        {
            id = c.Id,
            title = c.Title,
            startSec = c.StartSec,
            endSec = c.EndSec,
        }).ToList(),
        introEnd = result.IntroEnd,
        outroStart = result.OutroStart,
        source = result.Source,
    }, jsonSerializerOptions);
});

// —— Skip detection (intro/outro) ——
// Season is not a first-class entity in this schema (Episode.Season is just an int),
// so season-level rows are addressed by (showId, seasonNumber) rather than a SeasonId.
app.MapGet("/api/skip/season/{showId:int}/{seasonNumber:int}", async (
    int showId, int seasonNumber, SkipSegmentsRepository repo, CancellationToken ct) =>
{
    var segment = await repo.GetSeasonSegmentAsync(showId, seasonNumber, ct).ConfigureAwait(false);
    return segment is null ? Results.NotFound() : Results.Json(segment, jsonSerializerOptions);
});

app.MapGet("/api/skip/episode/{episodeId:int}", async (
    int episodeId, SkipSegmentsRepository repo, SkipSegmentDetectionService detector,
    SkipFingerprintQueue fpQueue, CancellationToken ct) =>
{
    var episode = await repo.GetEpisodeAsync(episodeId, ct).ConfigureAwait(false);
    if (episode is null)
        return Results.NotFound(new { error = "Episode not found." });

    var segment = await repo.GetSeasonSegmentAsync(episode.ShowId, episode.Season, ct).ConfigureAwait(false);
    if (segment is null)
    {
        // Lazily compute on first request for this season instead of requiring a separate
        // background pass — chapter probing is a single cheap ffprobe call per sampled file.
        segment = await detector.DetectAndStoreForSeasonAsync(episode.ShowId, episode.Season, ct)
            .ConfigureAwait(false);
    }

    // Chapter markers (and eventually AniSkip) are confident enough on their own. Only fall
    // back to the slower audio-fingerprint layer when at least one segment still has no
    // confirmed source, there are enough scanned episodes to correlate, and we haven't already
    // tried recently — the ComputedAt cooldown stops this from re-queuing on every episode view
    // once a season has been attempted (including a "found nothing confident" attempt).
    var hasConfirmedIntro = segment.IntroSource is "chapter" or "anilist";
    var hasConfirmedOutro = segment.OutroSource is "chapter" or "anilist";
    if (!hasConfirmedIntro || !hasConfirmedOutro)
    {
        var staleEnough = DateTime.UtcNow - segment.ComputedAt > TimeSpan.FromHours(6);
        if (staleEnough)
        {
            var episodeCount = await repo.CountSeasonEpisodesAsync(episode.ShowId, episode.Season, ct)
                .ConfigureAwait(false);
            if (episodeCount >= 3)
                fpQueue.TryEnqueue(episode.ShowId, episode.Season);
        }
    }

    var over = await repo.GetEpisodeOverrideAsync(episodeId, ct).ConfigureAwait(false);

    object? intro = null;
    if (over?.SuppressIntro == true)
        intro = null;
    else if (over?.IntroStartSeconds != null && over.IntroEndSeconds != null)
        intro = new { start = over.IntroStartSeconds, end = over.IntroEndSeconds, confidence = 1.0, source = over.Source };
    else if (segment.IntroStartSeconds != null && segment.IntroEndSeconds != null)
        intro = new { start = segment.IntroStartSeconds, end = segment.IntroEndSeconds, confidence = segment.IntroConfidence, source = segment.IntroSource };

    // Outro: a fingerprint-sourced season row stores the window as seconds-before-end (see
    // SeasonSkipSegment doc) because absolute timestamps don't transfer across episodes of
    // different runtime. Resolve to absolute using THIS episode's own duration when possible;
    // fall back to the stored (season-reference-episode-relative) absolute value only if this
    // episode's duration can't be resolved at all.
    double? outroStart = segment.OutroStartSeconds;
    double? outroEnd = segment.OutroEndSeconds;
    if (segment.OutroSource == "fingerprint" &&
        segment.OutroSecondsBeforeEndStart != null && segment.OutroSecondsBeforeEndEnd != null)
    {
        var episodeDuration = await repo.TryGetKnownDurationSecondsAsync(episode.FilePath, ct).ConfigureAwait(false)
            ?? await ChapterDetectorService.GetDurationSecondsAsync(episode.FilePath, ct).ConfigureAwait(false);
        if (episodeDuration is { } dur)
        {
            outroStart = dur - segment.OutroSecondsBeforeEndStart.Value;
            outroEnd = dur - segment.OutroSecondsBeforeEndEnd.Value;
        }
    }

    object? outro = null;
    if (over?.SuppressOutro == true)
        outro = null;
    else if (over?.OutroStartSeconds != null && over.OutroEndSeconds != null)
        outro = new { start = over.OutroStartSeconds, end = over.OutroEndSeconds, confidence = 1.0, source = over.Source };
    else if (outroStart != null && outroEnd != null)
        outro = new { start = outroStart, end = outroEnd, confidence = segment.OutroConfidence, source = segment.OutroSource };

    return Results.Json(new { intro, outro }, jsonSerializerOptions);
});

app.MapPost("/api/skip/season/{showId:int}/{seasonNumber:int}/rescan", async (
    int showId, int seasonNumber, SkipSegmentDetectionService detector, SkipFingerprintQueue fpQueue,
    SkipSegmentsRepository repo, CancellationToken ct) =>
{
    // Re-run chapter detection synchronously (cheap) and re-queue fingerprinting (slow,
    // off the request path) — both already prefer/never-downgrade an existing chapter-sourced
    // value, so this is safe to call even on a season that's already fully resolved.
    var segment = await detector.DetectAndStoreForSeasonAsync(showId, seasonNumber, ct).ConfigureAwait(false);

    var episodeCount = await repo.CountSeasonEpisodesAsync(showId, seasonNumber, ct).ConfigureAwait(false);
    if (episodeCount >= 3)
        fpQueue.TryEnqueue(showId, seasonNumber);

    return Results.Json(segment, jsonSerializerOptions);
});

// —— Player microservice ——

app.MapPost("/api/player/play", async (PlayerPlayBody body, PlayerService playerService, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(body.FilePath))
        return Results.BadRequest(new { error = "filePath is required." });

    try
    {
        var session = await playerService.StartAsync(
            body.FilePath,
            body.MediaId,
            body.EpisodeId,
            body.StartPosition ?? 0.0,
            body.SubtitleTrack,
            body.Player,
            ct).ConfigureAwait(false);
        return Results.Json(session, jsonSerializerOptions);
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message);
    }
});

app.MapPost("/api/player/attach", async (PlayerAttachBody body, PlayerService playerService, CancellationToken ct) =>
{
    try
    {
        var session = await playerService.AttachWindowAsync(body.Hwnd, ct).ConfigureAwait(false);
        return Results.Json(session, jsonSerializerOptions);
    }
    catch (InvalidOperationException ex)
    {
        return Results.NotFound(new { error = ex.Message });
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message);
    }
});

app.MapPost("/api/player/command", async (PlayerCommandBody body, PlayerService playerService) =>
{
    var session = playerService.GetSession();
    if (session is null)
        return Results.NotFound(new { error = "No active player session." });

    // "subtitle" uses a native int for sid — handle separately to preserve JSON type.
    if (body.Command == "subtitle")
    {
        var trackId = (int)(body.Value ?? 0);
        await playerService.SendRawCommandAsync(["set_property", "sid", (object)trackId])
                           .ConfigureAwait(false);
        return Results.Ok(new { success = true });
    }

    string[] ipcCommand = body.Command switch
    {
        "pause"  => ["cycle", "pause"],
        "seek"   => ["seek", (body.Value ?? 0).ToString("F3"), "absolute"],
        "stop"   => ["quit"],
        "next"   => ["playlist-next"],
        "prev"   => ["playlist-prev"],
        "volume" => ["set_property", "volume", (body.Value ?? 100).ToString("F1")],
        _        => []
    };

    if (ipcCommand.Length == 0)
        return Results.BadRequest(new { error = $"Unknown command: {body.Command}" });

    await playerService.SendCommandAsync(ipcCommand).ConfigureAwait(false);

    if (body.Command == "stop")
        await playerService.StopAsync().ConfigureAwait(false);

    return Results.Ok(new { success = true });
});

// Raw mpv command — WPF companion sends every command (pause, seek, sid, etc.) here.
// Body: { "args": ["set_property", "pause", "no"] }  — all values as strings.
app.MapPost("/api/player/mpv-command", async (PlayerMpvCommandBody body, PlayerService playerService) =>
{
    var session = playerService.GetSession();
    if (session is null)
        return Results.NotFound(new { error = "No active player session." });
    await playerService.SendCommandAsync(body.Args).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

// Batch playlist build — one call replaces N individual IPC loadfile calls from the WPF companion.
// Body: { "files": [...paths...], "current": "currently playing path" }
app.MapPost("/api/player/playlist", async (PlayerPlaylistBody body, PlayerService playerService) =>
{
    var session = playerService.GetSession();
    if (session is null)
        return Results.NotFound(new { error = "No active player session." });
    await playerService.BuildPlaylistAsync(body.Files, body.Current).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

app.MapGet("/api/player/session", (PlayerService playerService) =>
{
    var session = playerService.GetSession();
    return session is null
        ? Results.NotFound(new { error = "No active player session." })
        : Results.Json(session, jsonSerializerOptions);
});

app.MapPost("/api/player/stop", async (PlayerService playerService) =>
{
    await playerService.StopAsync().ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

// PitflixPlayer calls this synchronously from its OnClosed handler so the
// user's final position is committed to the WatchHistory row BEFORE the
// window actually closes — that way the moment Tauri's main window regains
// focus and the React app's focus listener fires + refetches history, the
// DB already has the up-to-date value.  Without this round-trip the save
// happened only via the async HandleMpvExited hook, which can fire after
// React has already refetched the (stale) old row.
app.MapPost("/api/player/save-progress-now", async (PlayerService playerService, CancellationToken ct) =>
{
    await playerService.SaveProgressNowAsync(ct).ConfigureAwait(false);
    return Results.Ok(new { success = true });
});

app.MapGet("/api/player/tracks", async (PlayerService playerService) =>
{
    // Returns both subtitle AND audio tracks; the WPF companion routes by
    // `type` ("sub" / "audio") into separate menus.  Previously this
    // projection stripped the type field, leaving the audio menu permanently
    // empty (one of the user-reported regressions).
    var tracks = await playerService.GetSubtitleTracksAsync().ConfigureAwait(false);
    return Results.Json(
        tracks.Select(t => new { index = t.Index, language = t.Language, title = t.Title, type = t.Type }),
        jsonSerializerOptions);
});

app.Map("/api/player/ws", async (HttpContext ctx, PlayerService playerService) =>
{
    if (!ctx.WebSockets.IsWebSocketRequest)
    {
        ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    using var ws = await ctx.WebSockets.AcceptWebSocketAsync().ConfigureAwait(false);
    var wsJsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    static ValueTask SendJson<T>(System.Net.WebSockets.WebSocket socket, T value, JsonSerializerOptions opts, CancellationToken ct)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, opts);
        return socket.SendAsync(bytes.AsMemory(), System.Net.WebSockets.WebSocketMessageType.Text, true, ct);
    }

    // Send current session immediately on connect
    var initial = playerService.GetSession();
    await SendJson(ws, initial, wsJsonOpts, CancellationToken.None).ConfigureAwait(false);

    while (ws.State == System.Net.WebSockets.WebSocketState.Open)
    {
        await Task.Delay(1000).ConfigureAwait(false);

        if (ws.State != System.Net.WebSockets.WebSocketState.Open)
            break;

        var current = playerService.GetSession();

        if (current is null || current.IsStopped)
        {
            try
            {
                await SendJson(ws, new { isStopped = true }, wsJsonOpts, CancellationToken.None).ConfigureAwait(false);
                await ws.CloseAsync(System.Net.WebSockets.WebSocketCloseStatus.NormalClosure, "session ended", CancellationToken.None).ConfigureAwait(false);
            }
            catch { /* client already disconnected */ }
            break;
        }

        try
        {
            await SendJson(ws, current, wsJsonOpts, CancellationToken.None).ConfigureAwait(false);
        }
        catch
        {
            break;
        }
    }
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
catch (SocketException ex) when (ex.SocketErrorCode == SocketError.AccessDenied)
{
    Console.Error.WriteLine();
    Console.Error.WriteLine("Cannot bind to the listen URL — Windows blocked the port (socket error 10013).");
    Console.Error.WriteLine("Common cause: Hyper-V / WSL reserved port ranges (check with):");
    Console.Error.WriteLine("  netsh interface ipv4 show excludedportrange protocol=tcp");
    Console.Error.WriteLine($"Tried: {string.Join("; ", listenAddresses)}");
    Console.Error.WriteLine("Fix: pick a port outside excluded ranges, e.g.:");
    Console.Error.WriteLine("  $env:PITFLIX_LISTEN_URLS='http://127.0.0.1:5280'; dotnet run");
    Console.Error.WriteLine("  (set Pitflix.UI VITE_API_ORIGIN to the same origin)");
    Console.Error.WriteLine();
    Environment.Exit(1);
}
catch (IOException ex) when (PortInUse(ex))
{
    Console.Error.WriteLine();
    Console.Error.WriteLine("Port already in use — another Pitflix.API (or app) is using this URL.");
    Console.Error.WriteLine("Fix: close that terminal, or stop the process:");
    Console.Error.WriteLine("  netstat -ano | findstr \":5280\"   (use the LISTENING PID)");
    Console.Error.WriteLine("  taskkill /PID <pid> /F");
    Console.Error.WriteLine("Or use another port:");
    Console.Error.WriteLine("  dotnet run --launch-profile http-alt");
    Console.Error.WriteLine("  (then set Pitflix.UI VITE_API_ORIGIN=http://127.0.0.1:5281)");
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
        WatchStatus = r.WatchStatus ?? "",
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
internal sealed record AddListItemBody(int TmdbId, string? MediaType, string? Title = null, string? PosterRemoteUrl = null, string? ImdbId = null);
internal sealed record ImageSelectBody(int TmdbId, string? MediaType, string? PosterPath, string? BackdropPath);
internal sealed record SettingsBody(string? TmdbApiKey, string? OpenSubtitlesApiKey, string? OpenSubtitlesAppName,
    string? SubDlApiKey, string? MdblistApiKey, string? TvdbApiKey,
    List<string>? LibraryPaths, string? MediaPlayerPath, bool? UseBuiltinPlayer, bool? LibraryScanDesktopToasts,
    string? PlayerMode);

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

internal sealed record UnifiedWatchBody(
    int TmdbId, string? ImdbId, string? MediaType, string? Title,
    string? PosterUrl, string? Source, int? SeasonNumber, int? EpisodeNumber, int RuntimeMinutes);

internal sealed record PinComingSoonBody(
    int TmdbId, string? MediaType, string? Title,
    string? PosterUrl, string? ReleaseDate, string? TrailerUrl, string? Overview);

internal sealed record PlayerPlayBody(
    string? FilePath, int MediaId, int? EpisodeId,
    double? StartPosition, string? SubtitleTrack,
    string? Player = null);

/// <summary>Body for POST /api/player/attach — carries the WPF child HWND.</summary>
internal sealed record PlayerAttachBody(long Hwnd);

internal sealed record PlayerCommandBody(string Command, double? Value);
internal sealed record PlayerMpvCommandBody(string[] Args);
internal sealed record PlayerPlaylistBody(string[] Files, string Current);
