namespace Pitflix.API.Services.Recommendations;

public sealed class LibraryRecommendationsHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<LibraryRecommendationsHostedService> _log;

    public LibraryRecommendationsHostedService(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<LibraryRecommendationsHostedService> log)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var startupDelaySeconds = Math.Clamp(
            _configuration.GetValue("Pitflix:Recommendations:StartupDelaySeconds", 60), 0, 600);
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(startupDelaySeconds), stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            var pollHours = Math.Clamp(
                _configuration.GetValue("Pitflix:Recommendations:PollIntervalHours", 6), 1, 48);
            TimeSpan delayAfterRun;
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var svc = scope.ServiceProvider.GetRequiredService<LibraryRecommendationsService>();
                var refreshed = await svc.RefreshAsync(stoppingToken).ConfigureAwait(false);
                _log.LogInformation("Pitflix.Recommendations.Refresh Refreshed={Refreshed}", refreshed);
                delayAfterRun = TimeSpan.FromHours(pollHours);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Library recommendations background refresh failed");
                delayAfterRun = TimeSpan.FromHours(Math.Min(1, pollHours));
            }

            try
            {
                await Task.Delay(delayAfterRun, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}
