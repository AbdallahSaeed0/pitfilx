using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services;

/// <summary>
/// Slowly fills per-episode IMDb ratings (OMDb) for every show in the library, so season pages already
/// have them instead of only fetching when a season is opened. OMDb's free tier allows 1,000 requests a
/// day, so this spends at most <see cref="DailyBudget"/> of them (tracked in Settings so restarts don't
/// reset it), leaving the rest for pages the user opens. Shows being watched go first.
/// </summary>
public sealed class EpisodeRatingsBackfillHostedService : BackgroundService
{
    /// <summary>Background share of OMDb's 1,000/day free quota; the rest stays for interactive pages.</summary>
    private const int DailyBudget = 700;
    /// <summary>Per tick, so a day's budget is spread out rather than hogging OMDb in one burst.</summary>
    private const int MaxRequestsPerTick = 150;
    private static readonly TimeSpan TickInterval = TimeSpan.FromMinutes(20);
    private const string BudgetSettingKey = "OmdbBackfillBudget";

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly RatingsAggregationService _ratings;
    private readonly ILogger<EpisodeRatingsBackfillHostedService> _log;

    /// <summary>TMDB id → IMDb id (null = TMDB has none). Kept for the process lifetime so each tick
    /// doesn't re-ask TMDB about every show.</summary>
    private readonly Dictionary<int, string?> _imdbIds = new();

    public EpisodeRatingsBackfillHostedService(IServiceScopeFactory scopeFactory, RatingsAggregationService ratings,
        ILogger<EpisodeRatingsBackfillHostedService> log)
    {
        _scopeFactory = scopeFactory;
        _ratings = ratings;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            // Let startup (scans, first page loads) settle before spending OMDb quota.
            await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        using var timer = new PeriodicTimer(TickInterval);
        do
        {
            try
            {
                await RunOnceAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _log.LogDebug(ex, "Episode ratings backfill tick failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false));
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        var db = scope.ServiceProvider.GetRequiredService<LibraryContext>();

        if (string.IsNullOrWhiteSpace(await repo.GetSettingAsync("OmdbApiKey", ct).ConfigureAwait(false)))
            return;

        var today = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var usedToday = ParseBudget(await repo.GetSettingAsync(BudgetSettingKey, ct).ConfigureAwait(false), today);
        var budget = Math.Min(MaxRequestsPerTick, DailyBudget - usedToday);
        if (budget <= 0) return;

        var tmdb = scope.ServiceProvider.GetRequiredService<ITmdbClientFactory>().Create();
        if (tmdb == null) return;

        // Priority: shows in progress, then the most recently watched, then newest additions.
        // Dropped shows are skipped entirely.
        var shows = await db.Shows.AsNoTracking()
            .Where(s => s.TmdbId > 0 && s.IsMatched && !s.IsDropped)
            .Select(s => new
            {
                s.Id,
                s.TmdbId,
                s.WatchStatus,
                s.DateAdded,
                LastWatched = db.Episodes.Where(e => e.ShowId == s.Id).Max(e => e.CompletedAt),
            })
            .ToListAsync(ct).ConfigureAwait(false);
        var ordered = shows
            .OrderByDescending(s => s.WatchStatus == WatchStatuses.Watching)
            .ThenByDescending(s => s.LastWatched ?? DateTime.MinValue)
            .ThenByDescending(s => s.DateAdded)
            .ToList();

        var used = 0;
        var blocked = false;
        foreach (var show in ordered)
        {
            if (used >= budget || blocked) break;
            ct.ThrowIfCancellationRequested();

            var episodes = await db.Episodes.AsNoTracking()
                .Where(e => e.ShowId == show.Id && e.Season > 0 && e.EpisodeNumber > 0)
                .Select(e => new { e.Season, e.EpisodeNumber })
                .Distinct()
                .ToListAsync(ct).ConfigureAwait(false);
            if (episodes.Count == 0) continue;

            if (!_imdbIds.TryGetValue(show.TmdbId, out var seriesImdb))
            {
                seriesImdb = await tmdb.TryGetImdbIdAsync(show.TmdbId, "Series", ct).ConfigureAwait(false);
                _imdbIds[show.TmdbId] = seriesImdb;
            }
            if (string.IsNullOrEmpty(seriesImdb)) continue;

            var covered = await MdbListService.GetCoveredEpisodesAsync(seriesImdb, ct).ConfigureAwait(false);
            foreach (var season in episodes
                         .Where(e => !covered.Contains((e.Season, e.EpisodeNumber)))
                         .GroupBy(e => e.Season)
                         .OrderBy(g => g.Key))
            {
                if (used >= budget) break;
                var result = await _ratings.BackfillEpisodeRatingsAsync(show.TmdbId, seriesImdb, season.Key,
                    season.Select(e => e.EpisodeNumber).OrderBy(n => n).ToList(), budget - used, ct)
                    .ConfigureAwait(false);
                used += result.Requests;
                if (result.Blocked)
                {
                    blocked = true;
                    break;
                }
            }
        }

        if (used == 0 && !blocked) return;

        // OMDb said no (daily limit or a bad key): mark today's budget spent so the next ticks don't
        // keep knocking. A key fix is picked up tomorrow, or immediately by any page the user opens.
        var newUsed = blocked ? DailyBudget : usedToday + used;
        await repo.SaveSettingAsync(BudgetSettingKey, $"{today}|{newUsed}", ct).ConfigureAwait(false);
        _log.LogInformation(
            "Episode ratings backfill: {Used} OMDb request(s) this run, {Total}/{Budget} today{Blocked}",
            used, Math.Min(newUsed, DailyBudget), DailyBudget, blocked ? " (stopped: OMDb refused)" : "");
    }

    /// <summary>"yyyy-MM-dd|count" → today's count (0 when the stored day isn't today).</summary>
    private static int ParseBudget(string? stored, string today)
    {
        if (string.IsNullOrWhiteSpace(stored)) return 0;
        var parts = stored.Split('|');
        return parts.Length == 2 && parts[0] == today && int.TryParse(parts[1], out var n) ? Math.Max(0, n) : 0;
    }
}
