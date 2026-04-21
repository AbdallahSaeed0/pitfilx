using System.Threading.Channels;

namespace Pitflix.API.Services;

/// <summary>Work queue for ratings enrichment: single titles or a stale sweep sentinel.</summary>
public sealed class RatingsRefreshQueue
{
    private readonly Channel<RatingsRefreshWorkItem> _channel = Channel.CreateUnbounded<RatingsRefreshWorkItem>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

    public ChannelReader<RatingsRefreshWorkItem> Reader => _channel.Reader;

    /// <summary>Sentinel processed as a stale-snapshot batch in the worker.</summary>
    public const int StaleSweepTmdbId = -1;

    public bool TryEnqueueSingle(int tmdbId, string? mediaType)
    {
        if (tmdbId <= 0)
            return false;
        var mt = string.IsNullOrWhiteSpace(mediaType) ? "movie" : mediaType.Trim();
        return _channel.Writer.TryWrite(new RatingsRefreshWorkItem(tmdbId, mt));
    }

    public void TryEnqueueStaleSweep() =>
        _channel.Writer.TryWrite(new RatingsRefreshWorkItem(StaleSweepTmdbId, ""));
}

public readonly record struct RatingsRefreshWorkItem(int TmdbId, string MediaType);
