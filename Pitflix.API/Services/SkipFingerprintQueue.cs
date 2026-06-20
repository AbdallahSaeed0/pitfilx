using System.Collections.Concurrent;
using System.Threading.Channels;

namespace Pitflix.API.Services;

/// <summary>Work queue for audio-fingerprint correlation jobs, one per (ShowId, SeasonNumber).</summary>
public sealed class SkipFingerprintQueue
{
    private readonly Channel<SkipFingerprintWorkItem> _channel = Channel.CreateUnbounded<SkipFingerprintWorkItem>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

    // Dedup so a season isn't queued twice while a job for it is already pending/running —
    // GET /api/skip/episode/{id} can be hit repeatedly (every episode in a season resolves to
    // the same season key) well before the first job finishes.
    private readonly ConcurrentDictionary<(int ShowId, int SeasonNumber), bool> _inFlight = new();

    public ChannelReader<SkipFingerprintWorkItem> Reader => _channel.Reader;

    public bool TryEnqueue(int showId, int seasonNumber)
    {
        var key = (showId, seasonNumber);
        if (!_inFlight.TryAdd(key, true))
            return false;
        if (_channel.Writer.TryWrite(new SkipFingerprintWorkItem(showId, seasonNumber)))
            return true;
        _inFlight.TryRemove(key, out _);
        return false;
    }

    internal void MarkDone(int showId, int seasonNumber) => _inFlight.TryRemove((showId, seasonNumber), out _);
}

public readonly record struct SkipFingerprintWorkItem(int ShowId, int SeasonNumber);
