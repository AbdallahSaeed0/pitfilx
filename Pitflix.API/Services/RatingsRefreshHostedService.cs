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
        var burstMax = Math.Clamp(_configuration.GetValue("Pitflix:Ratings:ChannelDrainMax", 32), 1, 200);
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(pollMinutes));

        // Created once; only replaced after the tick is consumed.
        // PeriodicTimer allows only one active WaitForNextTickAsync at a time —
        // recreating it on every loop iteration (the old pattern) throws when
        // a previous call is still in-flight after WaitToReadAsync wins WhenAny.
        var pollTask = timer.WaitForNextTickAsync(stoppingToken).AsTask();

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                var processed = await DrainQueueBurstAsync(burstMax, stoppingToken).ConfigureAwait(false);
                if (processed > 0)
                {
                    _log.LogInformation(
                        "Ratings refresh: processed {Processed} item(s), {Pending} still queued",
                        processed, _queue.QueueDepth);
                    continue;
                }

                var waitRead = _queue.Reader.WaitToReadAsync(stoppingToken).AsTask();
                var finished = await Task.WhenAny(waitRead, pollTask).ConfigureAwait(false);

                if (ReferenceEquals(finished, waitRead) && waitRead.IsCompletedSuccessfully && waitRead.Result)
                {
                    await DrainQueueBurstAsync(burstMax, stoppingToken).ConfigureAwait(false);
                    // pollTask is still pending — reuse it on the next iteration.
                    continue;
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

                    // Tick consumed — arm the next one.
                    pollTask = timer.WaitForNextTickAsync(stoppingToken).AsTask();
                }
            }
        }
        catch (OperationCanceledException)
        {
            /* shutdown */
        }
    }

    private async Task<int> DrainQueueBurstAsync(int burstMax, CancellationToken ct)
    {
        var processed = 0;
        while (processed < burstMax && _queue.Reader.TryRead(out var item))
        {
            processed++;
            await ProcessWorkItemAsync(item, ct).ConfigureAwait(false);
        }

        return processed;
    }

    private async Task ProcessWorkItemAsync(RatingsRefreshWorkItem item, CancellationToken ct)
    {
        if (item.TmdbId == RatingsRefreshQueue.StaleSweepTmdbId)
        {
            await ProcessStaleBatchAsync(ct).ConfigureAwait(false);
            return;
        }

        _queue.MarkProcessingStart();
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var enrich = scope.ServiceProvider.GetRequiredService<RatingsEnrichmentService>();
            var outcome = await enrich.EnrichAndPersistAsync(item.TmdbId, item.MediaType, ct).ConfigureAwait(false);
            if (outcome.Snapshot != null)
                _queue.MarkProcessed();
            else if (!string.IsNullOrWhiteSpace(outcome.FailureReason))
                _queue.MarkFailed(outcome.FailureReason);
        }
        catch (Exception ex)
        {
            _queue.MarkFailed(ex.Message);
            _log.LogDebug(ex, "Ratings refresh: single enrich failed for {Id} {Media}", item.TmdbId, item.MediaType);
        }
        finally
        {
            _queue.MarkProcessingEnd();
        }
    }

    private async Task ProcessStaleBatchAsync(CancellationToken ct)
    {
        var batch = Math.Clamp(_configuration.GetValue("Pitflix:Ratings:StaleBatchSize", 20), 1, 100);
        _queue.MarkProcessingStart();
        try
        {
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
                    var outcome = await enrich.EnrichAndPersistAsync(tmdbId, mediaType, ct).ConfigureAwait(false);
                    if (outcome.Snapshot != null)
                        _queue.MarkProcessed();
                    else if (!string.IsNullOrWhiteSpace(outcome.FailureReason))
                        _queue.MarkFailed(outcome.FailureReason);
                }
                catch (Exception ex)
                {
                    _queue.MarkFailed(ex.Message);
                    _log.LogDebug(ex, "Ratings refresh: stale row failed for {Id} {Media}", tmdbId, mediaType);
                }
            }

            _log.LogInformation("Ratings refresh: stale batch processed Count={Count}", stale.Count);
        }
        finally
        {
            _queue.MarkProcessingEnd();
        }
    }
}
