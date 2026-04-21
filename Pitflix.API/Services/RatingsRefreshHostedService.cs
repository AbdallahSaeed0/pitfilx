using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pitflix.Core.Database;

namespace Pitflix.API.Services;

/// <summary>Drains <see cref="RatingsRefreshQueue"/> and periodically refreshes stale <see cref="Pitflix.Core.Models.RatingsSnapshot"/> rows.</summary>
public sealed class RatingsRefreshHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly RatingsRefreshQueue _queue;
    private readonly IConfiguration _configuration;
    private readonly ILogger<RatingsRefreshHostedService> _log;

    public RatingsRefreshHostedService(
        IServiceScopeFactory scopeFactory,
        RatingsRefreshQueue queue,
        IConfiguration configuration,
        ILogger<RatingsRefreshHostedService> log)
    {
        _scopeFactory = scopeFactory;
        _queue = queue;
        _configuration = configuration;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        var pollMinutes = Math.Clamp(_configuration.GetValue("Pitflix:Ratings:PollMinutes", 5), 1, 120);
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(pollMinutes));
        var pollTask = timer.WaitForNextTickAsync(stoppingToken).AsTask();
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                var waitRead = _queue.Reader.WaitToReadAsync(stoppingToken).AsTask();
                var finished = await Task.WhenAny(waitRead, pollTask).ConfigureAwait(false);

                if (ReferenceEquals(finished, waitRead) && waitRead.Result)
                {
                    var drainMax = Math.Clamp(_configuration.GetValue("Pitflix:Ratings:ChannelDrainMax", 32), 1, 200);
                    var drained = 0;
                    while (drained < drainMax && _queue.Reader.TryRead(out var item))
                    {
                        drained++;
                        await ProcessWorkItemAsync(item, stoppingToken).ConfigureAwait(false);
                    }
                }

                if (ReferenceEquals(finished, pollTask))
                {
                    try
                    {
                        await ProcessStaleBatchAsync(stoppingToken).ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        _log.LogWarning(ex, "Ratings refresh: periodic stale batch failed");
                    }

                    pollTask = timer.WaitForNextTickAsync(stoppingToken).AsTask();
                }
            }
        }
        catch (OperationCanceledException)
        {
            /* shutdown */
        }
    }

    private async Task ProcessWorkItemAsync(RatingsRefreshWorkItem item, CancellationToken ct)
    {
        if (item.TmdbId == RatingsRefreshQueue.StaleSweepTmdbId)
        {
            await ProcessStaleBatchAsync(ct).ConfigureAwait(false);
            return;
        }

        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var enrich = scope.ServiceProvider.GetRequiredService<RatingsEnrichmentService>();
            await enrich.EnrichAndPersistAsync(item.TmdbId, item.MediaType, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Ratings refresh: single enrich failed for {Id} {Media}", item.TmdbId, item.MediaType);
        }
    }

    private async Task ProcessStaleBatchAsync(CancellationToken ct)
    {
        var batch = Math.Clamp(_configuration.GetValue("Pitflix:Ratings:StaleBatchSize", 20), 1, 100);
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<RatingsSnapshotRepository>();
        var enrich = scope.ServiceProvider.GetRequiredService<RatingsEnrichmentService>();
        var stale = await repo.GetStaleSnapshotKeysAsync(DateTime.UtcNow, batch, ct).ConfigureAwait(false);
        if (stale.Count == 0)
            return;

        foreach (var (tmdbId, mediaType) in stale)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                await enrich.EnrichAndPersistAsync(tmdbId, mediaType, ct).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _log.LogDebug(ex, "Ratings refresh: stale row failed for {Id} {Media}", tmdbId, mediaType);
            }
        }

        _log.LogInformation("Ratings refresh: stale batch processed Count={Count}", stale.Count);
    }
}
