using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Pitflix.API.Services;

/// <summary>Drains <see cref="SkipFingerprintQueue"/> — one season's audio correlation at a time,
/// off the request path. No periodic sweep: work only arrives when GET/POST skip endpoints enqueue it.</summary>
public sealed class SkipFingerprintHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly SkipFingerprintQueue _queue;
    private readonly ILogger<SkipFingerprintHostedService> _log;

    public SkipFingerprintHostedService(
        IServiceScopeFactory scopeFactory, SkipFingerprintQueue queue, ILogger<SkipFingerprintHostedService> log)
    {
        _scopeFactory = scopeFactory;
        _queue = queue;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (await _queue.Reader.WaitToReadAsync(stoppingToken).ConfigureAwait(false))
            {
                while (_queue.Reader.TryRead(out var item))
                {
                    try
                    {
                        await using var scope = _scopeFactory.CreateAsyncScope();
                        var svc = scope.ServiceProvider.GetRequiredService<AudioFingerprintService>();
                        await svc.RunForSeasonAsync(item.ShowId, item.SeasonNumber, stoppingToken).ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        _log.LogWarning(ex, "Skip fingerprinting failed for ShowId={ShowId} Season={Season}",
                            item.ShowId, item.SeasonNumber);
                    }
                    finally
                    {
                        _queue.MarkDone(item.ShowId, item.SeasonNumber);
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
            /* shutdown */
        }
    }
}
