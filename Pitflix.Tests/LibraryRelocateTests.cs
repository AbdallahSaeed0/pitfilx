using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;
using Pitflix.Core.Models;
using Xunit;

namespace Pitflix.Tests;

/// <summary>Relocating moved files/folders and re-linking a movie-matched file as an episode.</summary>
public sealed class LibraryRelocateTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "pitflix-relocate-" + Guid.NewGuid().ToString("N"));
    private readonly LibraryContext _db;
    private readonly LibraryRepository _repo;

    public LibraryRelocateTests()
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

    private string Touch(string relative)
    {
        var p = Path.Combine(_dir, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(p)!);
        File.WriteAllText(p, "x");
        return p;
    }

    [Fact]
    public async Task RelocateMovie_KeepsWatchStateAndMovesHistoryAndScanLog()
    {
        var oldPath = Path.Combine(_dir, "old", "X-Men (2006).mkv");
        var newPath = Touch(Path.Combine("new", "X-Men (2006).mkv"));
        var movie = new Movie { TmdbId = 36668, Title = "X-Men", FilePath = oldPath, IsMatched = true, WatchStatus = WatchStatuses.Completed };
        _db.Movies.Add(movie);
        _db.WatchHistories.Add(new WatchHistory { FilePath = oldPath, Title = "X-Men", MediaType = "Movie", OpenedAt = DateTime.UtcNow });
        _db.ScanLogs.Add(new ScanLog { FilePath = oldPath, Status = "Matched", TmdbId = 36668, MatchedTitle = "X-Men" });
        _db.ScanLogs.Add(new ScanLog { FilePath = newPath, Status = "Unmatched" });
        await _db.SaveChangesAsync();

        var (ok, err) = await _repo.RelocateMovieFileAsync(movie.Id, newPath);

        Assert.True(ok, err);
        _db.ChangeTracker.Clear();
        var m = await _db.Movies.SingleAsync();
        Assert.Equal(newPath, m.FilePath);
        Assert.Equal(WatchStatuses.Completed, m.WatchStatus);
        Assert.Equal(newPath, (await _db.WatchHistories.SingleAsync()).FilePath);
        var log = await _db.ScanLogs.SingleAsync();
        Assert.Equal(newPath, log.FilePath);
        Assert.Equal("Matched", log.Status);
    }

    [Fact]
    public async Task RelocateMovie_RejectsMissingFile()
    {
        var movie = new Movie { TmdbId = 1, Title = "A", FilePath = Path.Combine(_dir, "a.mkv") };
        _db.Movies.Add(movie);
        await _db.SaveChangesAsync();

        var (ok, _) = await _repo.RelocateMovieFileAsync(movie.Id, Path.Combine(_dir, "nope.mkv"));
        Assert.False(ok);
    }

    [Fact]
    public async Task RelocateShowFolder_UpdatesMappedEpisodesOnly()
    {
        var show = new Show { TmdbId = 1399, Title = "Show", FolderPath = Path.Combine(_dir, "old") };
        _db.Shows.Add(show);
        await _db.SaveChangesAsync();
        var e1 = new Episode { ShowId = show.Id, Season = 1, EpisodeNumber = 1, FilePath = Path.Combine(_dir, "old", "S01E01.mkv") };
        var e2 = new Episode { ShowId = show.Id, Season = 1, EpisodeNumber = 2, FilePath = Path.Combine(_dir, "old", "S01E02.mkv") };
        _db.Episodes.AddRange(e1, e2);
        await _db.SaveChangesAsync();
        var newE1 = Touch(Path.Combine("new", "S01E01.mkv"));
        var newFolder = Path.Combine(_dir, "new");

        var (ok, _) = await _repo.RelocateShowFolderAsync(show.Id, newFolder, new Dictionary<int, string> { [e1.Id] = newE1 });

        Assert.True(ok);
        _db.ChangeTracker.Clear();
        Assert.Equal(newFolder, (await _db.Shows.SingleAsync()).FolderPath);
        Assert.Equal(newE1, (await _db.Episodes.SingleAsync(e => e.Id == e1.Id)).FilePath);
        Assert.Equal(e2.FilePath, (await _db.Episodes.SingleAsync(e => e.Id == e2.Id)).FilePath);
    }

    [Fact]
    public async Task FinishMovieToEpisodeRelink_RemovesMovieAndCarriesWatchState()
    {
        var path = Touch("Show.Ep5.mkv");
        var show = new Show { TmdbId = 1399, Title = "The Show", IsMatched = true };
        var movie = new Movie { TmdbId = 999, Title = "Wrong Movie", FilePath = path, WatchStatus = WatchStatuses.Completed };
        _db.Shows.Add(show);
        _db.Movies.Add(movie);
        _db.CastMembers.Add(new CastMember { MediaId = 999, MediaType = "Movie", Name = "Someone" });
        _db.WatchHistories.Add(new WatchHistory { FilePath = path, Title = "Wrong Movie", MediaType = "Movie", TmdbId = 999, OpenedAt = DateTime.UtcNow });
        await _db.SaveChangesAsync();
        var ep = new Episode { ShowId = show.Id, Season = 1, EpisodeNumber = 5, FilePath = path };
        _db.Episodes.Add(ep);
        await _db.SaveChangesAsync();

        await _repo.FinishMovieToEpisodeRelinkAsync(movie.Id, ep.Id);

        _db.ChangeTracker.Clear();
        Assert.False(await _db.Movies.AnyAsync());
        Assert.False(await _db.CastMembers.AnyAsync(c => c.MediaId == 999 && c.MediaType == "Movie"));
        Assert.Equal(WatchStatuses.Completed, (await _db.Episodes.SingleAsync()).WatchStatus);
        var h = await _db.WatchHistories.SingleAsync();
        Assert.Equal("Series", h.MediaType);
        Assert.Equal(1399, h.TmdbId);
        Assert.Equal(1, h.SeasonNumber);
        Assert.Equal(5, h.EpisodeNumber);
    }
}
