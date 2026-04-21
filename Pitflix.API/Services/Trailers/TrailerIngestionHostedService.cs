namespace Pitflix.API.Services.Trailers;

public sealed class TrailerIngestionHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<TrailerIngestionHostedService> _log;

    public TrailerIngestionHostedService(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<TrailerIngestionHostedService> log)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            var pollMinutes = Math.Clamp(_configuration.GetValue("Pitflix:Trailers:PollIntervalMinutes", 120), 15, 720);
            TimeSpan delayAfterRun;
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var svc = scope.ServiceProvider.GetRequiredService<TrailerIngestionService>();
                var result = await svc.IngestAsync(stoppingToken).ConfigureAwait(false);
                delayAfterRun = result.QuotaStopped
                    ? TimeSpan.FromHours(6)
                    : TimeSpan.FromMinutes(pollMinutes);
                _log.LogInformation(
                    "Pitflix.Trailers.Monitor Fetched={Fetched} Uploads={Up} Search={Se} Channels={Ch} NewUploads={NewUp} Filtered={Filtered} FilteredOut={FilteredOut} Matched={Matched} Inserted={Inserted} SkippedDedup={Skipped} Purged={Purged} QuotaStopped={QuotaStopped} FallbackSearch={Fallback} Error={Error}",
                    result.FetchedCount, result.UploadsFetchedCount, result.SearchFetchedCount, result.ChannelsPolled,
                    result.NewUploadsSeenCount, result.FilteredCount, result.FilteredOutCount, result.MatchedCount,
                    result.InsertedOrUpdatedCount, result.SkippedDedupCount, result.PurgedCount, result.QuotaStopped,
                    result.FallbackSearchUsed, result.Error ?? "");
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Trailers monitor run failed");
                delayAfterRun = TimeSpan.FromMinutes(Math.Min(60, pollMinutes));
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
