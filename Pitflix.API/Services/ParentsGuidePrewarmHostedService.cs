using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.API.Services;

/// <summary>
/// Background sweep that quietly warms the Parents Guide durable cache for titles already in the
/// library, using IMDb ids the ratings pipeline has already resolved (<see cref="Pitflix.Core.Models.RatingsSnapshot.ImdbId"/>).
/// Each fetch through the scrape proxy takes ~7-8s, so this processes a small batch per tick rather
/// than bursting — the goal is that by the time a user opens a title's page, it's already cached.
/// </summary>
public sealed class ParentsGuidePrewarmHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ParentsGuidePrewarmHostedService> _log;

    private const int BatchSizePerTick = 3;
    private static readonly TimeSpan TickInterval = TimeSpan.FromMinutes(10);

    public ParentsGuidePrewarmHostedService(IServiceScopeFactory scopeFactory,
        ILogger<ParentsGuidePrewarmHostedService> log)
    {
        _scopeFactory = scopeFactory;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            // Let the app finish starting up before doing any background scraping.
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken).ConfigureAwait(false);
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
            catch (Exception ex)
            {
                _log.LogDebug(ex, "Parents Guide prewarm tick failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false));
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<LibraryContext>();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        var parentsGuide = scope.ServiceProvider.GetRequiredService<ImdbParentsGuideService>();

        // Titles the ratings pipeline has already resolved an IMDb id for — reuse that instead of
        // re-resolving imdb ids ourselves.
        var candidates = await db.RatingsSnapshots.AsNoTracking()
            .Where(r => r.ImdbId != null && r.ImdbId != "")
            .OrderByDescending(r => r.RatingsLastUpdatedAtUtc)
            .Select(r => r.ImdbId!)
            .Distinct()
            .Take(200) // small pool to scan per tick for "not yet cached"; actual fetches capped below
            .ToListAsync(ct)
            .ConfigureAwait(false);

        var warmed = 0;
        foreach (var imdbId in candidates)
        {
            if (warmed >= BatchSizePerTick)
                break;
            ct.ThrowIfCancellationRequested();

            var settingKey = $"ParentsGuideCache:{imdbId}";
            var already = await repo.GetSettingAsync(settingKey, ct).ConfigureAwait(false);
            if (!string.IsNullOrEmpty(already))
                continue; // already warmed (or a previous attempt found nothing — either way, skip)

            await parentsGuide.TryFetchAsync(imdbId, ct).ConfigureAwait(false);
            warmed++;
        }

        if (warmed > 0)
            _log.LogDebug("Parents Guide prewarm: warmed {Count} title(s) this tick", warmed);
    }
}
