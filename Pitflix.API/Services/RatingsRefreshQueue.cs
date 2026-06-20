using System.Threading.Channels;

namespace Pitflix.API.Services;

/// <summary>Work queue for ratings enrichment: single titles or a stale sweep sentinel.</summary>
public sealed class RatingsRefreshQueue
{
    private readonly Channel<RatingsRefreshWorkItem> _channel = Channel.CreateUnbounded<RatingsRefreshWorkItem>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

    private volatile bool _isProcessing;
    private long _processedTotal;
    private string? _lastError;
    private DateTime? _lastProcessedUtc;

    public ChannelReader<RatingsRefreshWorkItem> Reader => _channel.Reader;

    /// <summary>Sentinel processed as a stale-snapshot batch in the worker.</summary>
    public const int StaleSweepTmdbId = -1;

    public bool IsProcessing => _isProcessing;

    public long ProcessedTotal => Interlocked.Read(ref _processedTotal);

    public string? LastError => _lastError;

    public DateTime? LastProcessedUtc => _lastProcessedUtc;

    public int QueueDepth
    {
        get
        {
            try
            {
                return _channel.Reader.Count;
            }
            catch
            {
                return 0;
            }
        }
    }

    public bool TryEnqueueSingle(int tmdbId, string? mediaType)
    {
        if (tmdbId <= 0)
            return false;
        var mt = string.IsNullOrWhiteSpace(mediaType) ? "movie" : mediaType.Trim();
        return _channel.Writer.TryWrite(new RatingsRefreshWorkItem(tmdbId, mt));
    }

    public void TryEnqueueStaleSweep() =>
        _channel.Writer.TryWrite(new RatingsRefreshWorkItem(StaleSweepTmdbId, ""));

    internal void MarkProcessingStart() => _isProcessing = true;

    internal void MarkProcessingEnd() => _isProcessing = false;

    internal void MarkProcessed()
    {
        Interlocked.Increment(ref _processedTotal);
        _lastProcessedUtc = DateTime.UtcNow;
    }

    internal void MarkFailed(string? error)
    {
        if (!string.IsNullOrWhiteSpace(error))
            _lastError = error;
    }
}

public readonly record struct RatingsRefreshWorkItem(int TmdbId, string MediaType);
