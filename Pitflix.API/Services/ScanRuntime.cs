using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading.Channels;

namespace Pitflix.API.Services;

public sealed class ScanRuntime
{
    private readonly ConcurrentDictionary<Guid, ChannelWriter<string>> _writers = new();
    private CancellationTokenSource? _scanCts;

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

    public double Percent => Total <= 0 ? 0 : 100.0 * Current / Total;

    public void ResetProgress(int total)
    {
        Total = total;
        Current = 0;
        CurrentFile = "";
        Matched = 0;
        Unmatched = 0;
    }

    public void Update(int current, string currentFile, int matched, int unmatched)
    {
        Current = current;
        CurrentFile = currentFile;
        Matched = matched;
        Unmatched = unmatched;
    }

    public string BeginJob()
    {
        JobId = Guid.NewGuid().ToString("N");
        IsRunning = true;
        return JobId;
    }

    public void EndJob()
    {
        IsRunning = false;
        JobId = null;
        foreach (var kv in _writers)
        {
            kv.Value.TryComplete();
            _writers.TryRemove(kv.Key, out _);
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
