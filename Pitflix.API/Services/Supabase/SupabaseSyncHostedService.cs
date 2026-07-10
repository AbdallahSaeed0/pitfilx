namespace Pitflix.API.Services.Supabase;

/// <summary>Drives the mobile-sync module: pushes local list/list-item/watch-event changes on a
/// short cadence (default 60s — this doubles as the initial backfill, see
/// <see cref="SupabaseSyncService"/>), and pulls mobile-originated changes from Supabase on a
/// longer cadence (default 5 min). Entirely gated by the "Sync with Mobile" toggle — when off, the
/// loop keeps running but does no work and makes no HTTP calls; nothing is ever deleted on toggle-off.</summary>
public sealed class SupabaseSyncHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<SupabaseSyncHostedService> _log;

    public SupabaseSyncHostedService(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<SupabaseSyncHostedService> log)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        var pushIntervalSeconds = Math.Clamp(
            _configuration.GetValue("Pitflix:Supabase:PushIntervalSeconds", 60), 15, 3600);
        var pollMinutes = Math.Clamp(
            _configuration.GetValue("Pitflix:Supabase:PollIntervalMinutes", 5), 1, 120);
        var pushBatchSize = Math.Clamp(
            _configuration.GetValue("Pitflix:Supabase:PushBatchSize", 200), 1, 2000);
        var pullBatchSize = Math.Clamp(
            _configuration.GetValue("Pitflix:Supabase:PullBatchSize", 200), 1, 2000);

        var pullEveryNTicks = Math.Max(1, (pollMinutes * 60) / pushIntervalSeconds);
        var tick = 0;

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(pushIntervalSeconds));
        try
        {
            do
            {
                tick++;
                try
                {
                    await RunOnceAsync(pushBatchSize, pullBatchSize, tick % pullEveryNTicks == 0, stoppingToken)
                        .ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "Supabase sync: tick failed");
                }
            } while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false));
        }
        catch (OperationCanceledException)
        {
            /* shutdown */
        }
    }

    private async Task RunOnceAsync(int pushBatchSize, int pullBatchSize, bool alsoPull, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<SupabaseSyncRepository>();

        if (!await repo.GetSyncEnabledAsync(ct).ConfigureAwait(false))
            return;

        var service = scope.ServiceProvider.GetRequiredService<SupabaseSyncService>();
        await service.PushLocalChangesAsync(pushBatchSize, ct).ConfigureAwait(false);

        if (alsoPull)
            await service.PullRemoteChangesAsync(pullBatchSize, ct).ConfigureAwait(false);
    }
}
