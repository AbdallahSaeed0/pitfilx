using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;
using Pitflix.Core.Scanner;
using Xunit;

namespace Pitflix.Tests;

/// <summary>A scan re-points library entries whose files were moved/renamed instead of matching them anew.</summary>
public sealed class MovedFileRelinkTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "pitflix-moved-" + Guid.NewGuid().ToString("N"));
    private readonly LibraryContext _db;
    private readonly LibraryRepository _repo;

    public MovedFileRelinkTests()
    {
        Directory.CreateDirectory(_dir);
        var options = new DbContextOptionsBuilder<LibraryContext>()
            .UseSqlite($"Data Source={Path.Combine(_dir, "lib.db")};Pooling=False")
            .Options;
        _db = new LibraryContext(options);
        _db.Database.EnsureCreated();
        _repo = new LibraryRepository(_db);
    }

    public void Dispose()
    {
        _db.Dispose();
        try { Directory.Delete(_dir, recursive: true); } catch { /* temp cleanup */ }
    }

    private string Write(string relative, int bytes)
    {
        var p = Path.Combine(_dir, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(p)!);
        File.WriteAllBytes(p, new byte[bytes]);
        return p;
    }

    // TMDB is never reached when a file is relinked; an unusable client proves that.
    private ScanPipeline Pipeline() => new(new FileScanner(), new TmdbClient(new HttpClient(), "unused"), _repo);

    [Fact]
    public async Task Scan_RelinksMovedAndRenamedMovie_BySize_KeepingMatchAndHistory()
    {
        var oldPath = Path.Combine(_dir, "old", "some.weird.name.mkv");
        var newPath = Write(Path.Combine("Movies", "Heat (1995)", "Heat.1995.1080p.mkv"), 4321);
        var movie = new Movie
        {
            TmdbId = 949, Title = "Heat", FilePath = oldPath, FileSize = 4321, IsMatched = true,
            WatchStatus = WatchStatuses.Completed,
        };
        _db.Movies.Add(movie);
        _db.WatchHistories.Add(new WatchHistory { FilePath = oldPath, Title = "Heat", MediaType = "Movie", OpenedAt = DateTime.UtcNow });
        await _db.SaveChangesAsync();

        var result = await Pipeline().RunScanOnFilesAsync(new[] { newPath });

        Assert.Equal(1, result.Relinked);
        _db.ChangeTracker.Clear();
        var m = await _db.Movies.SingleAsync();
        Assert.Equal(newPath, m.FilePath);
        Assert.Equal(949, m.TmdbId);
        Assert.Equal(WatchStatuses.Completed, m.WatchStatus);
        Assert.Equal(newPath, (await _db.WatchHistories.SingleAsync()).FilePath);
    }

    [Fact]
    public async Task Scan_RelinksMovedEpisode_ByName_WhenSizeUnknown_AndShowFollows()
    {
        var oldFolder = Path.Combine(_dir, "OldShows", "Severance");
        var show = new Show { TmdbId = 95396, Title = "Severance", FolderPath = oldFolder, IsMatched = true };
        _db.Shows.Add(show);
        await _db.SaveChangesAsync();
        var ep = new Episode { ShowId = show.Id, Season = 1, EpisodeNumber = 3, FilePath = Path.Combine(oldFolder, "Severance.S01E03.mkv") };
        _db.Episodes.Add(ep);
        await _db.SaveChangesAsync();
        var newPath = Write(Path.Combine("TV", "Severance", "Severance.S01E03.mkv"), 10);

        var result = await Pipeline().RunScanOnFilesAsync(new[] { newPath });

        Assert.Equal(1, result.Relinked);
        _db.ChangeTracker.Clear();
        var e = await _db.Episodes.Include(x => x.Show).SingleAsync();
        Assert.Equal(newPath, e.FilePath);
        Assert.Equal(10, e.FileSize);
        Assert.Equal(Path.Combine(_dir, "TV", "Severance"), e.Show.FolderPath);
    }

    [Fact]
    public async Task Snapshot_BackfillsSizes_AndIgnoresFilesOnUnreachableDrives()
    {
        var present = Write("here.mkv", 77);
        var unplugged = UnusedDriveLetter() is { } d ? $"{d}:\\Movies\\Gone.mkv" : null;
        _db.Movies.Add(new Movie { TmdbId = 1, Title = "Here", FilePath = present });
        _db.Movies.Add(new Movie { TmdbId = 2, Title = "Moved", FilePath = Path.Combine(_dir, "moved.mkv") });
        if (unplugged != null)
            _db.Movies.Add(new Movie { TmdbId = 3, Title = "Unplugged", FilePath = unplugged });
        await _db.SaveChangesAsync();

        var missing = await _repo.SnapshotMissingLibraryFilesAsync();

        Assert.Equal("Moved", (await _db.Movies.AsNoTracking().SingleAsync(m => m.Id == missing.Single().Id)).Title);
        Assert.Equal(77, (await _db.Movies.AsNoTracking().SingleAsync(m => m.TmdbId == 1)).FileSize);
    }

    [Fact]
    public void Matcher_SizeTieBrokenByName_OtherwiseNoGuess()
    {
        var a = new MissingLibraryFile(false, 1, @"C:\old\a.mkv", 500);
        var b = new MissingLibraryFile(false, 2, @"C:\old\b.mkv", 500);

        Assert.Equal(b, MovedFileMatcher.FindMatch(@"D:\new\b.mkv", 500, new[] { a, b }));
        Assert.Null(MovedFileMatcher.FindMatch(@"D:\new\c.mkv", 500, new[] { a, b }));
    }

    [Fact]
    public void Matcher_DoesNotNameMatchAKnownDifferentSize()
    {
        var known = new MissingLibraryFile(false, 1, @"C:\old\movie.mkv", 900);
        var unknown = new MissingLibraryFile(false, 2, @"C:\old\other.mkv", null);

        Assert.Null(MovedFileMatcher.FindMatch(@"D:\new\movie.mkv", 100, new[] { known }));
        Assert.Equal(unknown, MovedFileMatcher.FindMatch(@"D:\new\other.mkv", 100, new[] { known, unknown }));
    }

    [Fact]
    public void Matcher_RequiresSameExtensionForSizeMatch()
    {
        var m = new MissingLibraryFile(false, 1, @"C:\old\x.mp4", 500);
        Assert.Null(MovedFileMatcher.FindMatch(@"D:\new\y.mkv", 500, new[] { m }));
    }

    private static char? UnusedDriveLetter()
    {
        var used = DriveInfo.GetDrives().Select(d => char.ToUpperInvariant(d.Name[0])).ToHashSet();
        for (var c = 'Q'; c <= 'Y'; c++)
            if (!used.Contains(c))
                return c;
        return null;
    }
}
