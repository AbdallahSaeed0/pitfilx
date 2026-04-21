namespace Pitflix.API.Services.Trailers;

/// <summary>Last trailer monitor cycle for ops/debug (GET /api/trailers/monitor/status).</summary>
public sealed class TrailerMonitorRuntime
{
    private readonly object _lock = new();
    private DateTime _lastRunUtc;
    private int _channelsPolled;
    private int _uploadsFetched;
    private int _searchFetched;
    private int _newUploadsSeen;
    private int _acceptedInserted;
    private int _rejectedTitleFilter;
    private int _unmatched;
    private bool _fallbackSearchUsed;
    private bool _quotaStopped;
    private string? _lastError;

    public void RecordRun(TrailerIngestionRunResult r)
    {
        lock (_lock)
        {
            _lastRunUtc = DateTime.UtcNow;
            _channelsPolled = r.ChannelsPolled;
            _uploadsFetched = r.UploadsFetchedCount;
            _searchFetched = r.SearchFetchedCount;
            _newUploadsSeen = r.NewUploadsSeenCount;
            _acceptedInserted = r.InsertedOrUpdatedCount;
            _rejectedTitleFilter = r.FilteredOutCount;
            _unmatched = r.UnmatchedCount;
            _fallbackSearchUsed = r.FallbackSearchUsed;
            _quotaStopped = r.QuotaStopped;
            _lastError = r.Error;
        }
    }

    public TrailerMonitorStatusDto Snapshot()
    {
        lock (_lock)
        {
            return new TrailerMonitorStatusDto(
                _lastRunUtc,
                _channelsPolled,
                _uploadsFetched,
                _searchFetched,
                _newUploadsSeen,
                _acceptedInserted,
                _rejectedTitleFilter,
                _unmatched,
                _fallbackSearchUsed,
                _quotaStopped,
                _lastError);
        }
    }
}

public sealed record TrailerMonitorStatusDto(
    DateTime LastRunUtc,
    int ChannelsPolled,
    int UploadsFetched,
    int SearchFetched,
    int NewUploadsSinceWatermark,
    int AcceptedInserted,
    int RejectedTitleFilter,
    int UnmatchedOrLowConfidence,
    bool FallbackSearchUsed,
    bool QuotaStopped,
    string? LastError);
