using System.Globalization;
using System.IO.Compression;
using Microsoft.Data.Sqlite;
using Pitflix.Core.Database;
using Pitflix.Core.Net;

[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("Pitflix.API.Tests")]

namespace Pitflix.API.Services;

/// <summary>
/// Per-episode IMDb ratings from IMDb's official daily datasets (datasets.imdbws.com, free for personal
/// / non-commercial use). OMDb leaves many rated episodes as "N/A", so this is the primary source and
/// OMDb only a fallback for episodes the dataset doesn't have yet.
///
/// <c>title.ratings.tsv.gz</c> (~8 MB) is refreshed daily, <c>title.episode.tsv.gz</c> (~50 MB) weekly.
/// The two are joined into a compact SQLite file (<c>imdb\imdb-episodes.db</c>: show, season, episode →
/// rating) that is rebuilt off to the side and swapped in, and works fully offline once built.
/// </summary>
public sealed class ImdbDatasetService : BackgroundService
{
    private const string RatingsUrl = "https://datasets.imdbws.com/title.ratings.tsv.gz";
    private const string EpisodesUrl = "https://datasets.imdbws.com/title.episode.tsv.gz";
    private static readonly TimeSpan RatingsMaxAge = TimeSpan.FromDays(1);
    private static readonly TimeSpan EpisodesMaxAge = TimeSpan.FromDays(7);

    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<ImdbDatasetService> _log;
    private readonly string _dir;
    private readonly string _dbPath;
    private readonly ReaderWriterLockSlim _swapLock = new();
    private readonly SemaphoreSlim _refreshGate = new(1, 1);

    /// <summary>"tt123:2" → episode → rating. Cleared whenever a new dataset is swapped in.</summary>
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, IReadOnlyDictionary<int, double>> _seasonCache = new();

    public ImdbDatasetService(IHttpClientFactory httpFactory, ILogger<ImdbDatasetService> log)
        : this(httpFactory, log, Path.Combine(Path.GetDirectoryName(LibraryPaths.DatabaseFilePath)!, "imdb")) { }

    internal ImdbDatasetService(IHttpClientFactory httpFactory, ILogger<ImdbDatasetService> log, string dataDir)
    {
        _httpFactory = httpFactory;
        _log = log;
        _dir = dataDir;
        _dbPath = Path.Combine(_dir, "imdb-episodes.db");
    }

    public bool IsAvailable => File.Exists(_dbPath);
    public DateTime? BuiltAtUtc => IsAvailable ? File.GetLastWriteTimeUtc(_dbPath) : null;
    public bool IsRefreshing { get; private set; }
    public string? LastError { get; private set; }
    public long EpisodeCount { get; private set; }

    /// <summary>Bumped on every rebuild — callers fold it into their own memo keys so answers memoized
    /// before the dataset existed (e.g. OMDb fallbacks) don't outlive it.</summary>
    public int Generation => _generation;
    private int _generation;

    /// <summary>All rated episodes of one season (episode → rating); empty when unknown.</summary>
    public IReadOnlyDictionary<int, double> GetSeasonRatings(string? showImdbId, int season)
    {
        var showId = ParseTconst(showImdbId);
        if (showId <= 0 || season < 0 || !IsAvailable) return Empty;
        var key = $"{showId}:{season}";
        if (_seasonCache.TryGetValue(key, out var hit)) return hit;

        var map = new Dictionary<int, double>();
        _swapLock.EnterReadLock();
        try
        {
            using var conn = new SqliteConnection(ReadOnlyConnectionString());
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT Episode, Rating FROM EpisodeRatings WHERE ShowId = $s AND Season = $n";
            cmd.Parameters.AddWithValue("$s", showId);
            cmd.Parameters.AddWithValue("$n", season);
            using var r = cmd.ExecuteReader();
            while (r.Read()) map[r.GetInt32(0)] = Math.Round(r.GetDouble(1), 1);
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "IMDb dataset lookup failed");
            return Empty;
        }
        finally
        {
            _swapLock.ExitReadLock();
        }
        _seasonCache[key] = map;
        return map;
    }

    /// <summary>A movie's or show's own IMDb rating and vote count from the daily file, or null.</summary>
    public (double Rating, int Votes)? GetTitleRating(string? imdbId)
    {
        var id = ParseTconst(imdbId);
        if (id <= 0 || !IsAvailable) return null;
        _swapLock.EnterReadLock();
        try
        {
            using var conn = new SqliteConnection(ReadOnlyConnectionString());
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT Rating, Votes FROM TitleRatings WHERE Id = $i";
            cmd.Parameters.AddWithValue("$i", id);
            using var r = cmd.ExecuteReader();
            return r.Read() ? (Math.Round(r.GetDouble(0), 1), r.GetInt32(1)) : null;
        }
        catch (Exception ex)
        {
            // Older database without the table (until its one-time rebuild) lands here too.
            _log.LogDebug(ex, "IMDb title rating lookup failed");
            return null;
        }
        finally
        {
            _swapLock.ExitReadLock();
        }
    }

    private bool HasTitleRatings()
    {
        try
        {
            using var conn = new SqliteConnection(ReadOnlyConnectionString());
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'TitleRatings'";
            return cmd.ExecuteScalar() is not null;
        }
        catch
        {
            return false;
        }
    }

    public double? GetEpisodeRating(string? showImdbId, int season, int episode) =>
        GetSeasonRatings(showImdbId, season).TryGetValue(episode, out var r) ? r : null;

    public double? GetSeasonAverage(string? showImdbId, int season)
    {
        var map = GetSeasonRatings(showImdbId, season);
        return map.Count == 0 ? null : Math.Round(map.Values.Average(), 1);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(45), stoppingToken).ConfigureAwait(false); }
        catch (OperationCanceledException) { return; }

        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try { await RefreshAsync(force: false, stoppingToken).ConfigureAwait(false); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception ex) { _log.LogWarning("IMDb dataset refresh failed: {Msg}", ex.Message); }
        } while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false));
    }

    /// <summary>Downloads whatever is stale (or everything when <paramref name="force"/>) and rebuilds.</summary>
    public async Task RefreshAsync(bool force, CancellationToken ct)
    {
        if (NetworkStatus.IsOffline && !IsAvailable) return;
        if (!await _refreshGate.WaitAsync(0, ct).ConfigureAwait(false)) return;
        IsRefreshing = true;
        try
        {
            Directory.CreateDirectory(_dir);
            var ratingsGz = Path.Combine(_dir, "title.ratings.tsv.gz");
            var episodesGz = Path.Combine(_dir, "title.episode.tsv.gz");

            var changed = false;
            if (!NetworkStatus.IsOffline)
            {
                changed |= await DownloadIfStaleAsync(EpisodesUrl, episodesGz, force ? TimeSpan.Zero : EpisodesMaxAge, ct).ConfigureAwait(false);
                changed |= await DownloadIfStaleAsync(RatingsUrl, ratingsGz, force ? TimeSpan.Zero : RatingsMaxAge, ct).ConfigureAwait(false);
            }
            if (!File.Exists(ratingsGz) || !File.Exists(episodesGz)) return;
            // Databases built before TitleRatings existed get rebuilt once from the files on disk.
            if (!changed && IsAvailable && HasTitleRatings()) return;

            await Task.Run(() => Build(ratingsGz, episodesGz, ct), ct).ConfigureAwait(false);
            LastError = null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LastError = ex.Message;
            throw;
        }
        finally
        {
            IsRefreshing = false;
            _refreshGate.Release();
        }
    }

    private async Task<bool> DownloadIfStaleAsync(string url, string target, TimeSpan maxAge, CancellationToken ct)
    {
        if (File.Exists(target) && DateTime.UtcNow - File.GetLastWriteTimeUtc(target) < maxAge) return false;
        var http = _httpFactory.CreateClient(nameof(ImdbDatasetService));
        http.Timeout = Timeout.InfiniteTimeSpan;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromMinutes(15));
        using var resp = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
        resp.EnsureSuccessStatusCode();
        var tmp = target + ".download";
        await using (var fs = File.Create(tmp))
            await resp.Content.CopyToAsync(fs, timeout.Token).ConfigureAwait(false);
        File.Move(tmp, target, overwrite: true);
        _log.LogInformation("IMDb dataset: downloaded {File} ({Mb:F1} MB)", Path.GetFileName(target), new FileInfo(target).Length / 1048576.0);
        return true;
    }

    internal void Build(string ratingsGz, string episodesGz, CancellationToken ct)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();

        // tconst → rating (only titles with votes are in this file).
        var ratings = new Dictionary<int, (float Rating, int Votes)>(1_800_000);
        foreach (var line in ReadGzLines(ratingsGz))
        {
            var f = Split(line, 3);
            if (f is null) continue;
            var id = ParseTconst(f[0]);
            if (id <= 0 || !float.TryParse(f[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var rating)) continue;
            int.TryParse(f[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out var votes);
            ratings[id] = (rating, votes);
        }
        ct.ThrowIfCancellationRequested();

        var tmp = _dbPath + ".building";
        if (File.Exists(tmp)) File.Delete(tmp);
        long rows = 0;
        using (var conn = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = tmp, Pooling = false }.ToString()))
        {
            conn.Open();
            using (var ddl = conn.CreateCommand())
            {
                ddl.CommandText = """
                    PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
                    CREATE TABLE EpisodeRatings (
                        ShowId INTEGER NOT NULL, Season INTEGER NOT NULL, Episode INTEGER NOT NULL,
                        Rating REAL NOT NULL, Votes INTEGER NOT NULL,
                        PRIMARY KEY (ShowId, Season, Episode)) WITHOUT ROWID;
                    """;
                ddl.ExecuteNonQuery();
            }
            using var tx = conn.BeginTransaction();
            using var ins = conn.CreateCommand();
            ins.Transaction = tx;
            ins.CommandText = "INSERT OR REPLACE INTO EpisodeRatings VALUES ($s, $n, $e, $r, $v)";
            var pS = ins.Parameters.Add("$s", SqliteType.Integer);
            var pN = ins.Parameters.Add("$n", SqliteType.Integer);
            var pE = ins.Parameters.Add("$e", SqliteType.Integer);
            var pR = ins.Parameters.Add("$r", SqliteType.Real);
            var pV = ins.Parameters.Add("$v", SqliteType.Integer);
            ins.Prepare();

            // tconst  parentTconst  seasonNumber  episodeNumber
            foreach (var line in ReadGzLines(episodesGz))
            {
                var f = Split(line, 4);
                if (f is null) continue;
                var epId = ParseTconst(f[0]);
                if (epId <= 0 || !ratings.Remove(epId, out var rt)) continue;
                var showId = ParseTconst(f[1]);
                if (showId <= 0 || !int.TryParse(f[2], out var season) || !int.TryParse(f[3], out var episode)) continue;
                pS.Value = showId; pN.Value = season; pE.Value = episode; pR.Value = rt.Rating; pV.Value = rt.Votes;
                ins.ExecuteNonQuery();
                if (++rows % 100_000 == 0) ct.ThrowIfCancellationRequested();
            }

            // What's left in `ratings` is every rated title that isn't an episode — movies, series,
            // miniseries… Their IMDb rating straight from IMDb's daily file: fresher than MDBList,
            // which kept a brand-new show at its first-day 311 votes for a week.
            using (var ddl2 = conn.CreateCommand())
            {
                ddl2.Transaction = tx;
                ddl2.CommandText =
                    "CREATE TABLE TitleRatings (Id INTEGER NOT NULL PRIMARY KEY, Rating REAL NOT NULL, Votes INTEGER NOT NULL) WITHOUT ROWID;";
                ddl2.ExecuteNonQuery();
            }
            using var insTitle = conn.CreateCommand();
            insTitle.Transaction = tx;
            insTitle.CommandText = "INSERT OR REPLACE INTO TitleRatings VALUES ($i, $r, $v)";
            var tI = insTitle.Parameters.Add("$i", SqliteType.Integer);
            var tR = insTitle.Parameters.Add("$r", SqliteType.Real);
            var tV = insTitle.Parameters.Add("$v", SqliteType.Integer);
            insTitle.Prepare();
            foreach (var (titleId, rt) in ratings)
            {
                tI.Value = titleId; tR.Value = rt.Rating; tV.Value = rt.Votes;
                insTitle.ExecuteNonQuery();
            }
            tx.Commit();
        }

        _swapLock.EnterWriteLock();
        try
        {
            File.Move(tmp, _dbPath, overwrite: true);
            _seasonCache.Clear();
            Interlocked.Increment(ref _generation);
        }
        finally
        {
            _swapLock.ExitWriteLock();
        }
        EpisodeCount = rows;
        _log.LogInformation("IMDb dataset: built {Rows:N0} rated episodes in {Sec:F1}s", rows, sw.Elapsed.TotalSeconds);
    }

    private string ReadOnlyConnectionString() =>
        new SqliteConnectionStringBuilder { DataSource = _dbPath, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString();

    private static readonly IReadOnlyDictionary<int, double> Empty = new Dictionary<int, double>();

    private static IEnumerable<string> ReadGzLines(string path)
    {
        using var fs = File.OpenRead(path);
        using var gz = new GZipStream(fs, CompressionMode.Decompress);
        using var reader = new StreamReader(gz, bufferSize: 1 << 16);
        reader.ReadLine(); // header
        while (reader.ReadLine() is { } line) yield return line;
    }

    /// <summary>First <paramref name="count"/> tab-separated fields, or null when the line is short.</summary>
    private static string[]? Split(string line, int count)
    {
        var parts = line.Split('\t', count + 1);
        return parts.Length < count ? null : parts;
    }

    /// <summary>"tt0944947" → 944947; anything else → 0.</summary>
    public static int ParseTconst(string? s)
    {
        if (string.IsNullOrEmpty(s) || s.Length < 3 || s[0] != 't' || s[1] != 't') return 0;
        return int.TryParse(s.AsSpan(2), NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 0;
    }
}
