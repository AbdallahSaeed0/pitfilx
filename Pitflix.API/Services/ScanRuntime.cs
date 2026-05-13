using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading.Channels;

namespace Pitflix.API.Services;

public sealed class ScanRuntime
{
    private readonly ConcurrentDictionary<Guid, ChannelWriter<string>> _writers = new();
    private CancellationTokenSource? _scanCts;
    private readonly SemaphoreSlim _scanLock = new(1, 1);
    private DateTime _scanStartedAt = DateTime.MinValue;

    public CancellationToken ScanToken => _scanCts?.Token ?? CancellationToken.None;

    public void StartCancellationSource() =>
        _scanCts = new CancellationTokenSource();

    public void CancelScan()
    {
        _scanCts?.Cancel();
    }

    public void DisposeCancellationSource()
    {
        _scanCts?.Dispose();
        _scanCts = null;
    }

    public string? JobId { get; private set; }
    public bool IsRunning { get; private set; }
    public int Total { get; private set; }
    public int Current { get; private set; }
    public string CurrentFile { get; private set; } = "";
    public int Matched { get; private set; }
    public int Unmatched { get; private set; }
    /// <summary>
    /// Paths skipped cheaply during scan: already in the library, or unchanged unmatched (no TMDB re-query).
    /// </summary>
    public int Skipped { get; private set; }

    public double Percent => Total <= 0 ? 0 : 100.0 * Current / Total;

    /// <summary>
    /// Check if scan has been running for an unusually long time (potential hang).
    /// </summary>
    public TimeSpan ScanRunningDuration => IsRunning ? DateTime.UtcNow - _scanStartedAt : TimeSpan.Zero;

    public void ResetProgress(int total)
    {
        Total = total;
        Current = 0;
        CurrentFile = "";
        Matched = 0;
        Unmatched = 0;
        Skipped = 0;
    }

    public void Update(int current, string currentFile, int matched, int unmatched, int skipped)
    {
        Current = current;
        CurrentFile = currentFile;
        Matched = matched;
        Unmatched = unmatched;
        Skipped = skipped;
    }

    public async Task<string?> BeginJobAsync(CancellationToken cancellationToken = default)
    {
        var acquired = await _scanLock.WaitAsync(0, cancellationToken).ConfigureAwait(false);
        if (!acquired)
            return null;
        
        try
        {
            if (IsRunning)
                return null;
            
            JobId = Guid.NewGuid().ToString("N");
            IsRunning = true;
            _scanStartedAt = DateTime.UtcNow;
            return JobId;
        }
        finally
        {
            _scanLock.Release();
        }
    }

    public async Task EndJobAsync()
    {
        await _scanLock.WaitAsync().ConfigureAwait(false);
        try
        {
            IsRunning = false;
            JobId = null;
            _scanStartedAt = DateTime.MinValue;
            foreach (var kv in _writers)
            {
                kv.Value.TryComplete();
                _writers.TryRemove(kv.Key, out _);
            }
        }
        finally
        {
            _scanLock.Release();
        }
    }

    /// <summary>
    /// Force cleanup of scan state (use when scan is detected as hung or abandoned).
    /// </summary>
    public async Task ForceResetAsync()
    {
        await _scanLock.WaitAsync().ConfigureAwait(false);
        try
        {
            _scanCts?.Cancel();
            _scanCts?.Dispose();
            _scanCts = null;
            IsRunning = false;
            JobId = null;
            _scanStartedAt = DateTime.MinValue;
            Total = 0;
            Current = 0;
            CurrentFile = "";
            Matched = 0;
            Unmatched = 0;
            Skipped = 0;
            
            foreach (var kv in _writers)
            {
                kv.Value.TryComplete();
                _writers.TryRemove(kv.Key, out _);
            }
        }
        finally
        {
            _scanLock.Release();
        }
    }

    public ChannelReader<string> Subscribe(out Guid subId)
    {
        subId = Guid.NewGuid();
        var channel = Channel.CreateUnbounded<string>();
        _writers[subId] = channel.Writer;
        return channel.Reader;
    }

    public void Unsubscribe(Guid subId)
    {
        if (_writers.TryRemove(subId, out var w))
            w.TryComplete();
    }

    public async Task BroadcastAsync(object payload, CancellationToken cancellationToken = default)
    {
        var json = JsonSerializer.Serialize(payload);
        foreach (var kv in _writers)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                await kv.Value.WriteAsync(json, cancellationToken).ConfigureAwait(false);
            }
            catch (ChannelClosedException)
            {
                _writers.TryRemove(kv.Key, out _);
            }
        }
    }
}
