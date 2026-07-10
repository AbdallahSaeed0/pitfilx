namespace Pitflix.API.Services;

/// <summary>Pushes this desktop's watch history/lists to the linked mobile account on a 5-minute
/// cadence — mirrors PitflixAndroid's own RootShell auto-sync timer, so both sides converge
/// without either one needing to reach the other over the local network. Entirely gated by
/// whether an account is linked (see MobileAccountSyncService.IsLinkedAsync); when not linked
/// the loop keeps running but makes no calls.</summary>
public sealed class MobileAccountSyncHostedService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<MobileAccountSyncHostedService> _log;

    public MobileAccountSyncHostedService(
        IServiceScopeFactory scopeFactory, ILogger<MobileAccountSyncHostedService> log)
    {
        _scopeFactory = scopeFactory;
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

        using var timer = new PeriodicTimer(Interval);
        do
        {
            try
            {
                await RunOnceAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Mobile account sync: tick failed");
            }
        } while (await WaitForNextTickAsync(timer, stoppingToken).ConfigureAwait(false));
    }

    private static async Task<bool> WaitForNextTickAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            return await timer.WaitForNextTickAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var sync = scope.ServiceProvider.GetRequiredService<MobileAccountSyncService>();
        if (!await sync.IsLinkedAsync(ct).ConfigureAwait(false))
            return;
        await sync.PushAsync(ct).ConfigureAwait(false);
    }
}
