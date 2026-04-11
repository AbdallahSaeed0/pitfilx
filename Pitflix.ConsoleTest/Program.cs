using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Api;
using Pitflix.Core.Config;
using Pitflix.Core.Database;
using Pitflix.Core.Models;
using Pitflix.Core.Parser;
using Pitflix.Core.Scanner;

const string root = @"F:\Series\English\";

string[] demoPaths =
[
    @"F:\Series\English\OnlyMurders\S1\S01E01.mkv",
    @"F:\Series\English\OnlyMurders\S01E01.mkv",
    @"F:\Series\عربي\Abb.Wa.Laken.S01E01.WEB-DL.AKWAM.mp4",
    @"F:\Series\عربي\Ibn.El.Nadi.S01E07.mp4",
    @"F:\Series\عربي\Ibn.El_Nadi.S01EP03.mp4",
    @"F:\Movies\عربي\Al.Deef\[EgyBest].Al.Deef.2019.HDRip.1080p.x264.mp4",
    @"F:\Movies\English\Bloodline.2020.1080P.WEB-DL.akwam.net.mp4",
    @"F:\Movies\عربي\الناطر\movie.mkv",
    @"F:\Movies\عربي\Ahwak\Ahwak.2015.mkv",
    @"F:\Series\English\Marvel's Daredevil S01E01 WEBRip 720p.mkv",
    @"F:\Series\Engilsh\Stranger Things\S1\01.mkv",
    @"F:\Series\Engilsh\Stranger Things\S1\02.mkv",
    @"F:\Series\Engilsh\Stranger Things\S2\01.mkv",
    @"F:\Series\Engilsh\Game Of Thrones\S3\Episode 1.mkv"
];

var scanner = new FileScanner();
var scanned = scanner.ScanDirectory(root);

Console.WriteLine($"Scan root: {root}");
Console.WriteLine($"Found {scanned.Count} video file(s).");
Console.WriteLine();

IReadOnlyList<string> files = scanned.Count > 0 ? scanned : demoPaths;
if (scanned.Count == 0)
{
    Console.WriteLine("(No files under this path on this machine — demo parses from spec examples:)");
    Console.WriteLine();
}

foreach (var path in files)
{
    var r = NameParser.Parse(path);
    Console.WriteLine(path);
    Console.WriteLine(
        $"  CleanName: {r.CleanName} | S{r.Season?.ToString() ?? "-"} E{r.Episode?.ToString() ?? "-"} | Year: {r.Year?.ToString() ?? "-"} | Arabic: {r.IsArabic} | MediaType: {r.MediaType} | Confidence: {r.Confidence}");
    Console.WriteLine();
}

var byShow = files
    .Select(p => (Path: p, Result: NameParser.Parse(p)))
    .GroupBy(x => x.Result.CleanName, StringComparer.OrdinalIgnoreCase)
    .OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase);

Console.WriteLine("=== Grouped by parsed show name (CleanName) ===");
foreach (var g in byShow)
{
    Console.WriteLine($"{g.Key} ({g.Count()} file(s))");
    foreach (var item in g.OrderBy(x => x.Result.Season).ThenBy(x => x.Result.Episode))
    {
        var r = item.Result;
        Console.WriteLine($"  S{r.Season?.ToString() ?? "?"}E{r.Episode?.ToString() ?? "?"} — {Path.GetFileName(item.Path)}");
    }

    Console.WriteLine();
}

await RunTmdbDemoAsync(files);
await RunPhase3Async(demoPaths);

static string YearFromReleaseDate(string? releaseDate)
{
    if (string.IsNullOrEmpty(releaseDate) || releaseDate.Length < 4)
        return "-";
    return releaseDate[..4];
}

static async Task RunTmdbDemoAsync(IReadOnlyList<string> files)
{
    Console.WriteLine();
    Console.WriteLine("=== Phase 2 — TMDB (first parsed title: Only Murders) ===");
    Console.WriteLine();

    var settings = new AppSettings();
    var apiKey = AppSettings.TryLoadTmdbApiKeyFromLocalFile()
        ?? Environment.GetEnvironmentVariable("TMDB_API_KEY")
        ?? settings.TmdbApiKey;
    if (string.IsNullOrWhiteSpace(apiKey) || apiKey.Contains("PASTE_YOUR_KEY", StringComparison.OrdinalIgnoreCase))
    {
        Console.WriteLine("TMDB demo skipped: set Config/AppSettings TmdbApiKey or environment variable TMDB_API_KEY.");
        return;
    }

    var parsedOm = files
        .Select(p => NameParser.Parse(p))
        .FirstOrDefault(r => string.Equals(r.CleanName, "Only Murders", StringComparison.OrdinalIgnoreCase));
    var searchTitle = parsedOm?.CleanName ?? "Only Murders";
    if (parsedOm == null)
        Console.WriteLine("(No file parsed as 'Only Murders'; searching TMDB with title \"Only Murders\" anyway.)");

    using var http = new HttpClient();
    var tmdb = new TmdbClient(http, apiKey);

    try
    {
        var searchResults = await tmdb.SearchAsync(searchTitle, "Series", false).ConfigureAwait(false);
        Console.WriteLine($"Search: \"{searchTitle}\" (Series, en-US) — {searchResults.Count} result(s) (max 5)");
        Console.WriteLine();
        Console.WriteLine("Top 3 search results:");
        foreach (var r in searchResults.Take(3))
        {
            Console.WriteLine(
                $"  Id={r.Id} | Title={r.Title} | Year={YearFromReleaseDate(r.ReleaseDate)} | Popularity={r.Popularity:F2}");
        }

        if (searchResults.Count == 0)
        {
            Console.WriteLine("No results; skipping details and download.");
            return;
        }

        var top = searchResults[0];
        Console.WriteLine();
        Console.WriteLine($"Details for top result Id={top.Id}:");
        var details = await tmdb.GetDetailsAsync(top.Id, "Series").ConfigureAwait(false);

        var overviewPreview = details.Overview.Length <= 100
            ? details.Overview
            : details.Overview[..100] + "…";
        Console.WriteLine($"  Title: {details.Title}");
        Console.WriteLine($"  Overview (first 100 chars): {overviewPreview}");
        Console.WriteLine($"  Vote Average: {details.VoteAverage:F1}");
        Console.WriteLine("  First 3 cast:");
        foreach (var c in details.Cast.Take(3))
            Console.WriteLine($"    - {c.Name} as {c.Character}");

        Console.WriteLine("  First 3 similar:");
        foreach (var s in details.Similar.Take(3))
            Console.WriteLine($"    - {s.Title} (Id={s.Id}, Year={YearFromReleaseDate(s.ReleaseDate)})");

        if (string.IsNullOrEmpty(details.PosterPath))
        {
            Console.WriteLine();
            Console.WriteLine("No poster path from API; skip download.");
            return;
        }

        var localPoster = await tmdb.DownloadImageAsync(details.PosterPath, $"poster_{details.Id}.jpg")
            .ConfigureAwait(false);
        Console.WriteLine();
        Console.WriteLine($"Poster saved to: {localPoster}");
    }
    catch (Exception ex)
    {
        Console.WriteLine();
        Console.WriteLine($"TMDB demo failed: {ex.Message}");
    }
}

static async Task RunPhase3Async(string[] demoPaths)
{
    Console.WriteLine();
    Console.WriteLine("=== Phase 3 — SQLite + ScanPipeline ===");
    Console.WriteLine();

    var settings = new AppSettings();
    var apiKey = AppSettings.TryLoadTmdbApiKeyFromLocalFile()
        ?? Environment.GetEnvironmentVariable("TMDB_API_KEY")
        ?? settings.TmdbApiKey;
    if (string.IsNullOrWhiteSpace(apiKey) || apiKey.Contains("PASTE_YOUR_KEY", StringComparison.OrdinalIgnoreCase))
    {
        Console.WriteLine("Phase 3 skipped: TMDB API key not configured.");
        return;
    }

    Console.WriteLine($"Database: {LibraryPaths.DatabaseFilePath}");
    await using var ctx = LibraryContext.Create();
    await ctx.Database.EnsureDeletedAsync().ConfigureAwait(false);
    await ctx.Database.EnsureCreatedAsync().ConfigureAwait(false);
    Console.WriteLine("Database initialized (recreated for demo).");
    Console.WriteLine();

    var repo = new LibraryRepository(ctx);
    using var http = new HttpClient();
    var tmdb = new TmdbClient(http, apiKey);
    var scanner = new FileScanner();
    var pipeline = new ScanPipeline(scanner, tmdb, repo);

    var progress = new Progress<ScanProgress>(p =>
    {
        Console.WriteLine($"  [{p.Current}/{p.Total}] {p.Status}: {Path.GetFileName(p.CurrentFile)}");
    });

    Console.WriteLine($"Running scan on {demoPaths.Length} demo path(s)…");
    var scanResult = await pipeline.RunScanOnFilesAsync(demoPaths, progress).ConfigureAwait(false);

    Console.WriteLine();
    Console.WriteLine("--- Scan summary ---");
    Console.WriteLine($"  Total files (distinct): {scanResult.TotalFiles}");
    Console.WriteLine($"  Matched:              {scanResult.Matched}");
    Console.WriteLine($"  Unmatched:            {scanResult.Unmatched}");
    Console.WriteLine($"  Skipped (already):    {scanResult.SkippedAlreadyMatched}");
    Console.WriteLine();

    var shows = await repo.GetAllShowsAsync().ConfigureAwait(false);
    Console.WriteLine($"--- Shows in database ({shows.Count}) ---");
    foreach (var s in shows)
    {
        Console.WriteLine(
            $"  Id={s.Id} Tmdb={s.TmdbId} | {s.Title} | Year={s.Year?.ToString() ?? "-"} | Arabic={s.IsArabic} | Poster={s.PosterLocalPath ?? "(none)"}");
    }

    Console.WriteLine();
    var logs = await repo.GetAllScanLogsAsync().ConfigureAwait(false);
    Console.WriteLine($"--- ScanLogs ({logs.Count}) ---");
    foreach (var log in logs)
    {
        var sug = "";
        if (!string.IsNullOrEmpty(log.SuggestionsJson))
        {
            var snip = log.SuggestionsJson.Length <= 100
                ? log.SuggestionsJson
                : log.SuggestionsJson[..100] + "…";
            sug = $" | Suggestions={snip}";
        }

        Console.WriteLine(
            $"  {log.Status} | {log.Confidence} | {Path.GetFileName(log.FilePath)} | Tmdb={log.TmdbId?.ToString() ?? "-"} | {log.MatchedTitle ?? "-"}{sug}");
    }

    var firstPoster = shows.FirstOrDefault(s => !string.IsNullOrEmpty(s.PosterLocalPath))?.PosterLocalPath
        ?? (await repo.GetAllMoviesAsync().ConfigureAwait(false)).FirstOrDefault(m => !string.IsNullOrEmpty(m.PosterLocalPath))
            ?.PosterLocalPath;
    Console.WriteLine();
    Console.WriteLine(firstPoster != null
        ? $"Example saved poster path: {firstPoster}"
        : "No poster paths saved in this run.");
}
