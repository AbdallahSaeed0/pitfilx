namespace Pitflix.API.Services;

public sealed class SmartMatchRuntime
{
    private CancellationTokenSource? _cts;

    public CancellationToken Token => _cts?.Token ?? CancellationToken.None;

    public bool IsRunning { get; private set; }
    public int Total { get; private set; }
    public int Current { get; private set; }
    public string CurrentLabel { get; private set; } = "";
    public SmartScanSummary? LastSummary { get; private set; }

    public void BeginJob()
    {
        _cts?.Dispose();
        _cts = new CancellationTokenSource();
        IsRunning = true;
        Total = 0;
        Current = 0;
        CurrentLabel = "";
        LastSummary = null;
    }

    public void SetTotal(int total) => Total = Math.Max(0, total);

    public void Update(int current, string label)
    {
        Current = current;
        CurrentLabel = label ?? "";
    }

    public void Complete(SmartScanSummary summary)
    {
        LastSummary = summary;
        IsRunning = false;
        _cts?.Dispose();
        _cts = null;
    }

    public void Cancel()
    {
        _cts?.Cancel();
    }
}

public sealed record SmartScanSummary(int Processed, int AutoMatched, int StillUnmatched, double TimeTakenSeconds);
