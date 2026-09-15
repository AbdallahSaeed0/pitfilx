using System.Collections.Concurrent;
using Pitflix.Core.Database;

namespace Pitflix.API.Services;

/// <summary>
/// Keeps Shows' persisted "next episode airing" cache warm (see AddNextAiringCacheMigration) so
/// /api/home/next-episodes ("Up Next") can read instantly from the database instead of doing a
/// live TMDB lookup per show on every request — that live-lookup-per-request pattern was the
/// actual source of Up Next's multi-second load time. This runs the same TMDB lookups, just in
/// the background on a schedule, off the request path entirely.
/// </summary>
public sealed class NextAiringRefreshHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<NextAiringRefreshHostedService> _log;

    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan StaleAfter = TimeSpan.FromHours(6);
    private const int BatchSize = 250;

    public NextAiringRefreshHostedService(IServiceScopeFactory scopeFactory, ILogger<NextAiringRefreshHostedService> log)
    {
        _scopeFactory = scopeFactory;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let startup-time services (library scan, etc.) get a head start on the DB.
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RefreshBatchAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "NextAiringRefresh: cycle failed");
            }

            try
            {
                await Task.Delay(Interval, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task RefreshBatchAsync(CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        var tmdbClientFactory = scope.ServiceProvider.GetRequiredService<ITmdbClientFactory>();
        var tmdb = tmdbClientFactory.Create();
        if (tmdb == null)
            return;

        var staleBefore = DateTime.UtcNow - StaleAfter;
        var candidates = await repo.GetShowsForNextAiringRefreshAsync(BatchSize, staleBefore, ct).ConfigureAwait(false);
        if (candidates.Count == 0)
            return;

        var results = new ConcurrentBag<(int ShowId, string? Name, int? Season, int? Number, string? AirDate)>();
        await Parallel.ForEachAsync(candidates, new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
            async (s, token) =>
            {
                try
                {
                    var air = await tmdb.TryGetTvNextAiringAsync(s.TmdbId, token).ConfigureAwait(false);
                    var ne = air?.NextEpisode;
                    results.Add((
                        s.Id,
                        (string?)ne?["name"],
                        (int?)ne?["season_number"],
                        (int?)ne?["episode_number"],
                        (string?)ne?["air_date"]));
                }
                catch
                {
                    // Still record the attempt (all-null) so this show isn't retried every cycle —
                    // same as a "checked, nothing upcoming" result. It'll naturally get retried
                    // once StaleAfter elapses.
                    results.Add((s.Id, null, null, null, null));
                }
            }).ConfigureAwait(false);

        await repo.SaveNextAiringResultsAsync(results.ToList(), ct).ConfigureAwait(false);
        _log.LogInformation("NextAiringRefresh: refreshed {Count} shows", results.Count);
    }
}
