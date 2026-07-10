using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Pitflix.API;
using Pitflix.API.Dtos;
using Pitflix.API.Endpoints;
using Pitflix.API.Services;
using Pitflix.API.Services.Awards;
using Pitflix.API.Services.Browse;
using Pitflix.API.Services.Supabase;
using Pitflix.API.Services.Trailers;
using Pitflix.API.Services.Trakt;
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

// Default 5280 avoids Windows Hyper-V reserved ranges (often 4931?5030, which block 5001).
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
                "http://localhost:5959",
                "http://127.0.0.1:5959",
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
builder.Services.AddHttpClient("Wikidata", c =>
{
    c.BaseAddress = new Uri("https://query.wikidata.org/");
    c.Timeout = TimeSpan.FromSeconds(30);
    c.DefaultRequestHeaders.Add("User-Agent", "PitFlix/1.0 (awards lookup; contact via github)");
    c.DefaultRequestHeaders.Add("Accept", "application/sparql-results+json");
});
builder.Services.AddSingleton<WikidataAwardsService>();
builder.Services.AddSingleton<IResolvedApiKeysAccessor, ResolvedApiKeysAccessor>();
builder.Services.AddSingleton<ITmdbClientFactory, TmdbClientFactory>();
builder.Services.AddSingleton<PhpImdbGrabberClient>();
builder.Services.AddSingleton<RatingsAggregationService>();
builder.Services.AddScoped<RatingsEnrichmentService>();
builder.Services.AddScoped<RatingsPersistedReadService>();
builder.Services.AddScoped<WatchSoMuchScraperService>();
builder.Services.AddScoped<YtsScraperService>();
builder.Services.AddScoped<TpbScraperService>();
builder.Services.AddScoped<PsaScraperService>();
builder.Services.AddScoped<ImdbParentsGuideService>();
builder.Services.AddHostedService<ParentsGuidePrewarmHostedService>();
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
builder.Services.AddSingleton<BrowseSettingsStore>();
builder.Services.AddSingleton<BrowseDownloadJobTracker>();
builder.Services.AddSingleton<BrowseDownloadService>();
builder.Services.AddScoped<IptvService>();
builder.Services.AddSingleton<MdbListService>();
builder.Services.AddSingleton<TvdbService>();
builder.Services.AddSingleton<Pitflix.API.Services.Letterboxd.LetterboxdService>();
builder.Services.AddSingleton(sp =>
{
    var cfg = sp.GetRequiredService<IConfiguration>();
    var redirectUri = cfg["Pitflix:Trakt:RedirectUri"]?.Trim();
    if (string.IsNullOrWhiteSpace(redirectUri))
        redirectUri = "http://localhost:5280/api/trakt/callback";
    return new TraktRedirectOptions(redirectUri);
});
builder.Services.AddSingleton<TraktApiClient>();
builder.Services.AddSingleton<TraktIdResolver>();
builder.Services.AddScoped<TraktAuthService>();
builder.Services.AddScoped<TraktSyncService>();
builder.Services.AddScoped<TraktScrobbleService>();
builder.Services.AddScoped<TraktPlaybackSyncService>();
builder.Services.AddScoped<TraktRecommendationsService>();
builder.Services.AddScoped<SupabaseSyncRepository>();
builder.Services.AddScoped<SupabaseSyncService>();
builder.Services.AddSingleton<SupabaseRestClient>();
builder.Services.AddHostedService<SupabaseSyncHostedService>();
builder.Services.AddScoped<LibraryExportBuilder>();
builder.Services.AddSingleton<SupabaseAuthClient>();
builder.Services.AddSingleton<SupabaseUserClient>();
builder.Services.AddScoped<MobileAccountSyncService>();
builder.Services.AddHostedService<MobileAccountSyncHostedService>();
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(
        new[] { "application/json", "text/plain", "application/javascript", "text/css" });
});

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<LibraryContext>();
    db.Database.EnsureCreated();
    var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
    await repo.EnsureLibraryFoldersTableAsync();
    await repo.EnsureSelectedImageColumnsAsync();
    await repo.EnsureEpisodeStillLocalPathColumnAsync();
    await repo.EnsureShowDroppedColumnAsync();
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
    // IMPORTANT: capture the IServiceProvider, not the scoped `repo` ? each background operation
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
    await AddLetterboxdTablesMigration.RunIfNeededAsync(repo);
    await AddSkipSegmentsMigration.RunIfNeededAsync(repo);
    await AddOutroSecondsBeforeEndMigration.RunIfNeededAsync(repo);
    await AddDetectionSourceMigration.RunIfNeededAsync(repo);
    await AddShowNetworkMigration.RunIfNeededAsync(repo);
    await AddCompletedFromPlaybackMigration.RunIfNeededAsync(repo);
    await AddMdbListEpisodeRatingsCacheMigration.RunIfNeededAsync(repo);
    await AddIptvTablesMigration.RunIfNeededAsync(repo);
    await AddTraktTablesMigration.RunIfNeededAsync(repo);
    await AddSupabaseSyncTablesMigration.RunIfNeededAsync(repo);
    var awardNomineeCacheRepo = scope.ServiceProvider.GetRequiredService<AwardNomineeCacheRepository>();
    await awardNomineeCacheRepo.EnsureTableAsync(CancellationToken.None).ConfigureAwait(false);
    AppSettings.ResolveTmdbApiKeyFromSources(repo);
    AppSettings.ResolveOpenSubtitlesFromSources(repo);
    AppSettings.ResolveTraktCredentialsFromSources(repo);
    AppSettings.ResolveSupabaseCredentialsFromSources(repo);

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
app.UseResponseCompression();
app.UseWebSockets();

// 2) Manual /images GET ? serves files directly (bypasses static-file quirks).
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
    context.Response.ContentType = ImageServeHelpers.ImageContentTypeForExtension(fullPath);
    await context.Response.SendFileAsync(fullPath).ConfigureAwait(false);
});

// 3) Static files (backup) ? same physical root, /images request path
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

// ?? Movies & catalog ??
app.MapCatalogEndpoints(jsonSerializerOptions);

// ?? Library detail (movie / series) ??

app.MapLibraryDetailEndpoints(jsonSerializerOptions);

// ?? Library ??

app.MapLibraryEndpoints(jsonSerializerOptions);
app.MapLibraryExportEndpoints(jsonSerializerOptions);
app.MapMobileSyncEndpoints(jsonSerializerOptions);

app.MapUnmatchedEndpoints(jsonSerializerOptions);

app.MapTvTimeReviewEndpoints(jsonSerializerOptions); // TEMPORARY -- remove after the TV Time import review is done

// ?? Online stream (TMDB helpers; search uses POST /api/unmatched/search) ??

app.MapStreamEndpoints(jsonSerializerOptions);


app.MapScanEndpoints();

app.MapHistoryEndpoints(jsonSerializerOptions);

app.MapListsEndpoints(jsonSerializerOptions);

app.MapPeopleEndpoints(jsonSerializerOptions);

app.MapSettingsEndpoints(jsonSerializerOptions);
app.MapLetterboxdEndpoints(jsonSerializerOptions);

app.MapStatsEndpoints(jsonSerializerOptions);

app.MapSubtitlesEndpoints(jsonSerializerOptions);
app.MapWsmEndpoints(jsonSerializerOptions);
app.MapYtsEndpoints(jsonSerializerOptions);
app.MapTpbEndpoints(jsonSerializerOptions);
app.MapPsaEndpoints(jsonSerializerOptions);
app.MapRatingsEndpoints(jsonSerializerOptions);
app.MapAwardsEndpoints(jsonSerializerOptions);


app.MapHomeEndpoints(jsonSerializerOptions);

app.MapTrailersEndpoints(jsonSerializerOptions);



app.MapSkipEndpoints(jsonSerializerOptions);
app.MapPlayerControlEndpoints(jsonSerializerOptions);

app.MapMiscEndpoints(jsonSerializerOptions, imagesPath);
app.MapIptvEndpoints(jsonSerializerOptions);
app.MapTraktEndpoints(jsonSerializerOptions);
app.MapBrowseEndpoints(jsonSerializerOptions);

app.Logger.LogInformation("Pitflix.API ? {PublicBase}  (images: {PublicBase}/images/?)", publicBase, publicBase);

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
    Console.Error.WriteLine("Cannot bind to the listen URL ? Windows blocked the port (socket error 10013).");
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
    Console.Error.WriteLine("Port already in use ? another Pitflix.API (or app) is using this URL.");
    Console.Error.WriteLine("Fix: close that terminal, or stop the process:");
    Console.Error.WriteLine("  netstat -ano | findstr \":5280\"   (use the LISTENING PID)");
    Console.Error.WriteLine("  taskkill /PID <pid> /F");
    Console.Error.WriteLine("Or use another port:");
    Console.Error.WriteLine("  dotnet run --launch-profile http-alt");
    Console.Error.WriteLine("  (then set Pitflix.UI VITE_API_ORIGIN=http://127.0.0.1:5281)");
    Console.Error.WriteLine();
    Environment.Exit(1);
}

// Request/body record types moved to RequestModels.cs
