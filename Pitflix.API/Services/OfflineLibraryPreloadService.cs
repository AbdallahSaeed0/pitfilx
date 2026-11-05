using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;
using Pitflix.Core.Net;

namespace Pitflix.API.Services;

/// <summary>
/// Makes the library usable offline: walks every matched movie and show and requests its detail page
/// (and every season page) from this API, exactly as the UI would. Those endpoints already fill the
/// row caches (crew, keywords, studios, content rating, episode stills…) on first open, and every TMDB
/// answer they need lands in the on-disk TMDB response cache — so afterwards the pages render with no
/// internet. It also pulls the TMDB images those pages show (season posters, episode stills, cast
/// without a local photo, studio logos) through the disk-caching image proxy.
///
/// Runs a few minutes after startup and every 6 hours, touching only titles never preloaded or last
/// preloaded more than <see cref="RefreshAfter"/> ago; Settings can start a pass immediately.
/// </summary>
public sealed class OfflineLibraryPreloadService : BackgroundService
{
    private static readonly TimeSpan RefreshAfter = TimeSpan.FromDays(14);
    private static readonly TimeSpan PauseBetweenTitles = TimeSpan.FromMilliseconds(250);
    private const string StateTable = "OfflinePreloadState";

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<OfflineLibraryPreloadService> _log;
    private readonly SemaphoreSlim _runGate = new(1, 1);
    private readonly SemaphoreSlim _kick = new(0, 1);

    public OfflineLibraryPreloadService(IServiceScopeFactory scopeFactory, IHttpClientFactory httpFactory,
        ILogger<OfflineLibraryPreloadService> log)
    {
        _scopeFactory = scopeFactory;
        _httpFactory = httpFactory;
        _log = log;
    }

    // ── Progress (read by /api/offline/status) ──────────────────────────────
    public bool IsRunning { get; private set; }
    public int Total { get; private set; }
    public int Done { get; private set; }
    public string? Current { get; private set; }
    public DateTime? LastCompletedUtc { get; private set; }
    public string? LastError { get; private set; }

    /// <summary>Starts a pass now (no-op if one is already running).</summary>
    public void RequestRun()
    {
        if (_kick.CurrentCount == 0) _kick.Release();
    }

    /// <summary>(preloaded, total) across matched movies + shows, for the Settings summary.</summary>
    public async Task<(int Ready, int Total)> GetCoverageAsync(CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<LibraryContext>();
        await EnsureTableAsync(db, ct).ConfigureAwait(false);
        var items = await LoadItemsAsync(db, ct).ConfigureAwait(false);
        return (items.Count(i => i.PreloadedUtc != null), items.Count);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(TimeSpan.FromMinutes(3), stoppingToken).ConfigureAwait(false); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try { await RunPassAsync(stoppingToken).ConfigureAwait(false); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception ex)
            {
                LastError = ex.Message;
                _log.LogWarning("Offline preload pass failed: {Msg}", ex.Message);
            }

            // Sleep 6 h or until Settings asks for a pass.
            try { await _kick.WaitAsync(TimeSpan.FromHours(6), stoppingToken).ConfigureAwait(false); }
            catch (OperationCanceledException) { return; }
        }
    }

    private sealed record Item(string Kind, int Id, string Title, DateTime? PreloadedUtc);

    private async Task RunPassAsync(CancellationToken ct)
    {
        if (NetworkStatus.IsOffline) return;
        if (!await _runGate.WaitAsync(0, ct).ConfigureAwait(false)) return;
        IsRunning = true;
        LastError = null;
        Done = 0;
        try
        {
            List<Item> due;
            await using (var scope = _scopeFactory.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<LibraryContext>();
                await EnsureTableAsync(db, ct).ConfigureAwait(false);
                var cutoff = DateTime.UtcNow - RefreshAfter;
                due = (await LoadItemsAsync(db, ct).ConfigureAwait(false))
                    .Where(i => i.PreloadedUtc is null || i.PreloadedUtc < cutoff)
                    .OrderBy(i => i.PreloadedUtc ?? DateTime.MinValue)
                    .ToList();
            }
            Total = due.Count;
            var http = _httpFactory.CreateClient(nameof(OfflineLibraryPreloadService));
            http.BaseAddress = new Uri(ImageUrls.PublicBase.TrimEnd('/') + "/");
            http.Timeout = TimeSpan.FromMinutes(2);
            if (due.Count == 0)
            {
                await WarmPageExtrasAsync(http, ct).ConfigureAwait(false);
                return;
            }
            _log.LogInformation("Offline preload: {Count} title(s) to prepare", due.Count);

            foreach (var item in due)
            {
                ct.ThrowIfCancellationRequested();
                if (NetworkStatus.IsOffline)
                {
                    _log.LogInformation("Offline preload: paused — went offline after {Done}/{Total}", Done, Total);
                    break;
                }
                Current = item.Title;
                try
                {
                    var ok = item.Kind == "Movie"
                        ? await PreloadMovieAsync(http, item.Id, ct).ConfigureAwait(false)
                        : await PreloadShowAsync(http, item.Id, ct).ConfigureAwait(false);
                    // Only mark done when the network stayed up — otherwise saved data may be partial.
                    if (ok && !NetworkStatus.IsOffline)
                        await MarkPreloadedAsync(item, ct).ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
                {
                    _log.LogDebug(ex, "Offline preload failed for {Kind} {Id}", item.Kind, item.Id);
                }
                Done++;
                await Task.Delay(PauseBetweenTitles, ct).ConfigureAwait(false);
            }
            LastCompletedUtc = DateTime.UtcNow;
            _log.LogInformation("Offline preload: finished {Done}/{Total}", Done, Total);
            await WarmPageExtrasAsync(http, ct).ConfigureAwait(false);
        }
        finally
        {
            Current = null;
            IsRunning = false;
            _runGate.Release();
        }
    }

    /// <summary>Pause after an extras request that actually had to go to the network (scraping IMDb /
    /// querying Wikidata), to stay gentle on them. Answers that were already saved don't pause.</summary>
    private static readonly TimeSpan ExtrasPauseAfterNetwork = TimeSpan.FromSeconds(1);

    /// <summary>
    /// The detail page also loads two sections the main pass never requested: Awards (a Wikidata
    /// query, 0.6-0.9 s with nothing saved) and Parents Guide (an IMDb scrape, 4-6 s). Requests them
    /// for every library title, exactly as the page does, so they're saved before anyone opens it.
    /// Already-saved answers come back in milliseconds, so after the first sweep this costs little;
    /// it runs at the end of every pass (every 6 h) to pick up newly added titles.
    /// </summary>
    private async Task WarmPageExtrasAsync(HttpClient http, CancellationToken ct)
    {
        List<(string Kind, int TmdbId, string Title)> titles;
        await using (var scope = _scopeFactory.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<LibraryContext>();
            var movies = await db.Movies.AsNoTracking().Where(m => m.IsMatched && m.TmdbId > 0)
                .Select(m => new { m.TmdbId, m.Title }).ToListAsync(ct).ConfigureAwait(false);
            var shows = await db.Shows.AsNoTracking().Where(s => s.IsMatched && s.TmdbId > 0)
                .Select(s => new { s.TmdbId, s.Title }).ToListAsync(ct).ConfigureAwait(false);
            titles = movies.Select(m => ("Movie", m.TmdbId, m.Title))
                .Concat(shows.Select(s => ("Series", s.TmdbId, s.Title)))
                .Distinct()
                .ToList();
        }

        var warmed = 0;
        foreach (var (kind, tmdbId, title) in titles)
        {
            ct.ThrowIfCancellationRequested();
            if (NetworkStatus.IsOffline) return;
            Current = $"{title} (awards, parents guide)";
            var started = DateTime.UtcNow;
            try
            {
                string? imdbId = null;
                using (var idDoc = await GetJsonAsync(http, $"api/stream/imdb-id/{tmdbId}?mediaType={kind}", ct)
                           .ConfigureAwait(false))
                {
                    if (idDoc is not null && idDoc.RootElement.TryGetProperty("imdbId", out var idEl) &&
                        idEl.ValueKind == JsonValueKind.String)
                        imdbId = idEl.GetString();
                }

                var awardsMediaType = kind == "Movie" ? "movie" : "tv";
                var awardsPath = $"api/awards/for-title?tmdbId={tmdbId}&mediaType={awardsMediaType}" +
                    (string.IsNullOrWhiteSpace(imdbId) ? "" : $"&imdbId={Uri.EscapeDataString(imdbId)}");
                using (await GetJsonAsync(http, awardsPath, ct).ConfigureAwait(false)) { }

                if (!string.IsNullOrWhiteSpace(imdbId))
                    using (await GetJsonAsync(http, $"api/stream/parents-guide/{Uri.EscapeDataString(imdbId)}", ct)
                               .ConfigureAwait(false)) { }
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                _log.LogDebug(ex, "Page extras preload failed for {Kind} tmdb {TmdbId}", kind, tmdbId);
            }

            if (DateTime.UtcNow - started > TimeSpan.FromMilliseconds(300))
            {
                warmed++;
                await Task.Delay(ExtrasPauseAfterNetwork, ct).ConfigureAwait(false);
            }
        }
        if (warmed > 0)
            _log.LogInformation("Offline preload: fetched awards/parents guide for {Count} title(s)", warmed);
    }

    private async Task<bool> PreloadMovieAsync(HttpClient http, int id, CancellationToken ct)
    {
        using var doc = await GetJsonAsync(http, $"api/movies/{id}", ct).ConfigureAwait(false);
        if (doc is null) return false;
        await WarmImagesAsync(http, CollectImages(doc.RootElement), ct).ConfigureAwait(false);
        return true;
    }

    private async Task<bool> PreloadShowAsync(HttpClient http, int id, CancellationToken ct)
    {
        using var doc = await GetJsonAsync(http, $"api/series/{id}", ct).ConfigureAwait(false);
        if (doc is null) return false;
        var images = CollectImages(doc.RootElement);

        var seasons = new List<int>();
        if (doc.RootElement.TryGetProperty("seasonsSummary", out var summary) && summary.ValueKind == JsonValueKind.Array)
        {
            foreach (var s in summary.EnumerateArray())
                if (s.TryGetProperty("seasonNumber", out var n) && n.TryGetInt32(out var sn) && sn >= 0)
                    seasons.Add(sn);
        }
        var allOk = true;
        foreach (var sn in seasons.Distinct())
        {
            using var season = await GetJsonAsync(http, $"api/series/{id}/season/{sn}", ct).ConfigureAwait(false);
            if (season is null) { allOk = false; continue; }
            images.AddRange(CollectImages(season.RootElement));
        }
        await WarmImagesAsync(http, images, ct).ConfigureAwait(false);
        return allOk;
    }

    /// <summary>
    /// TMDB image URLs the library pages actually render. "More like this" rows are left out on purpose:
    /// ~40 posters per title would multiply the download size for something that isn't the library.
    /// </summary>
    private static List<string> CollectImages(JsonElement root)
    {
        var urls = new List<string>();
        void Add(JsonElement obj, string prop)
        {
            if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(prop, out var v) &&
                v.ValueKind == JsonValueKind.String && v.GetString() is { } s &&
                s.StartsWith("https://image.tmdb.org/", StringComparison.OrdinalIgnoreCase))
                urls.Add(s);
        }
        void Each(string arrayProp, Action<JsonElement> f)
        {
            if (root.TryGetProperty(arrayProp, out var arr) && arr.ValueKind == JsonValueKind.Array)
                foreach (var el in arr.EnumerateArray()) f(el);
        }
        void People(JsonElement p)
        {
            // Cast/crew photos are usually already on disk from the scan.
            var hasLocal = p.TryGetProperty("profileLocalPath", out var lp) && lp.ValueKind == JsonValueKind.String &&
                           !string.IsNullOrWhiteSpace(lp.GetString());
            if (!hasLocal) Add(p, "profileRemoteUrl");
        }
        Each("cast", People);
        Each("crew", People);
        Each("companies", c => Add(c, "logoUrl"));
        Each("seasonsSummary", s => Add(s, "posterUrl"));
        Each("episodes", e => Add(e, "stillUrl"));
        Add(root, "posterUrl");
        return urls;
    }

    /// <summary>Fetches each image through /api/img/tmdb, which saves it to disk on first request.</summary>
    private static async Task WarmImagesAsync(HttpClient http, IEnumerable<string> urls, CancellationToken ct)
    {
        foreach (var url in urls.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var m = System.Text.RegularExpressions.Regex.Match(url, @"/t/p/([^/]+)/(.+)$");
            if (!m.Success) continue;
            var path = $"api/img/tmdb?size={Uri.EscapeDataString(m.Groups[1].Value)}&file={Uri.EscapeDataString(m.Groups[2].Value)}";
            try
            {
                using var resp = await http.GetAsync(path, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
            }
            catch when (!ct.IsCancellationRequested) { /* one missing image never fails the title */ }
            if (NetworkStatus.IsOffline) return;
        }
    }

    private static async Task<JsonDocument?> GetJsonAsync(HttpClient http, string path, CancellationToken ct)
    {
        using var resp = await http.GetAsync(path, ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode) return null;
        await using var stream = await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        return await JsonDocument.ParseAsync(stream, cancellationToken: ct).ConfigureAwait(false);
    }

    // ── State table ─────────────────────────────────────────────────────────

    private static async Task EnsureTableAsync(LibraryContext db, CancellationToken ct)
    {
        await db.Database.ExecuteSqlRawAsync($"""
            CREATE TABLE IF NOT EXISTS {StateTable} (
                Kind TEXT NOT NULL, ItemId INTEGER NOT NULL, PreloadedAtUtc TEXT NOT NULL,
                PRIMARY KEY (Kind, ItemId));
            """, ct).ConfigureAwait(false);
    }

    private static async Task<List<Item>> LoadItemsAsync(LibraryContext db, CancellationToken ct)
    {
        var state = new Dictionary<(string, int), DateTime>();
        var conn = db.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync(ct).ConfigureAwait(false);
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = $"SELECT Kind, ItemId, PreloadedAtUtc FROM {StateTable}";
            await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await r.ReadAsync(ct).ConfigureAwait(false))
                if (DateTime.TryParse(r.GetString(2), null, System.Globalization.DateTimeStyles.RoundtripKind, out var at))
                    state[(r.GetString(0), r.GetInt32(1))] = at;
        }

        DateTime? At(string kind, int id) => state.TryGetValue((kind, id), out var at) ? at : null;
        var movies = await db.Movies.AsNoTracking().Where(m => m.IsMatched && m.TmdbId > 0)
            .Select(m => new { m.Id, m.Title }).ToListAsync(ct).ConfigureAwait(false);
        var shows = await db.Shows.AsNoTracking().Where(s => s.IsMatched && s.TmdbId > 0)
            .Select(s => new { s.Id, s.Title }).ToListAsync(ct).ConfigureAwait(false);
        return movies.Select(m => new Item("Movie", m.Id, m.Title, At("Movie", m.Id)))
            .Concat(shows.Select(s => new Item("Series", s.Id, s.Title, At("Series", s.Id))))
            .ToList();
    }

    private async Task MarkPreloadedAsync(Item item, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<LibraryContext>();
        await db.Database.ExecuteSqlRawAsync(
            $"INSERT INTO {StateTable} (Kind, ItemId, PreloadedAtUtc) VALUES ({{0}}, {{1}}, {{2}}) " +
            "ON CONFLICT(Kind, ItemId) DO UPDATE SET PreloadedAtUtc = excluded.PreloadedAtUtc",
            new object[] { item.Kind, item.Id, DateTime.UtcNow.ToString("O") }, ct).ConfigureAwait(false);
    }
}
