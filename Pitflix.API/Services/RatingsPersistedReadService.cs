using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services;

public sealed record RatingsPersistedRow(RatingsSnapshot Snapshot, bool WasSeeded, bool IsStale);

public sealed record RatingsPersistedReadResult(bool Ok, RatingsPersistedRow? Row, string? FailureReason);

/// <summary>Reads <see cref="RatingsSnapshot"/> rows, seeds on miss, queues refresh when stale.</summary>
public sealed class RatingsPersistedReadService
{
    private readonly RatingsSnapshotRepository _snapshots;
    private readonly RatingsEnrichmentService _enrichment;
    private readonly RatingsRefreshQueue _queue;

    public RatingsPersistedReadService(
        RatingsSnapshotRepository snapshots,
        RatingsEnrichmentService enrichment,
        RatingsRefreshQueue queue)
    {
        _snapshots = snapshots;
        _enrichment = enrichment;
        _queue = queue;
    }

    /// <summary><paramref name="mediaType"/> must be <c>Movie</c> or <c>Series</c>.</summary>
    public async Task<RatingsPersistedReadResult> GetPersistedReadAsync(int tmdbId, string mediaType,
        CancellationToken ct = default)
    {
        if (tmdbId <= 0 || string.IsNullOrWhiteSpace(mediaType))
            return new RatingsPersistedReadResult(false, null, "invalid_input");

        var row = await _snapshots.GetSnapshotAsync(tmdbId, mediaType, ct).ConfigureAwait(false);
        if (row != null)
            return OkFromSnapshot(row, wasSeeded: false);

        var outcome = await _enrichment.EnrichAndPersistAsync(tmdbId, mediaType, ct).ConfigureAwait(false);
        if (outcome.Snapshot == null)
            return new RatingsPersistedReadResult(false, null, outcome.FailureReason ?? "seed_failed");

        return OkFromSnapshot(outcome.Snapshot, wasSeeded: true);
    }

    private RatingsPersistedReadResult OkFromSnapshot(RatingsSnapshot row, bool wasSeeded)
    {
        var stale = row.NextRefreshAtUtc <= DateTime.UtcNow;
        if (stale)
            _queue.TryEnqueueSingle(row.TmdbId, row.MediaType);

        return new RatingsPersistedReadResult(true, new RatingsPersistedRow(row, wasSeeded, stale), null);
    }

    public static RatingsAggregateDto ToAggregateDto(RatingsSnapshot s, bool wasSeeded, bool isStale) =>
        new(
            FetchedAtUtc: s.RatingsLastUpdatedAtUtc,
            TmdbVoteAverage: s.TmdbRating,
            TmdbVoteCount: s.TmdbVoteCount,
            ImdbId: s.ImdbId,
            ImdbRatingDisplay: s.ImdbRating,
            ImdbVoteCountDisplay: s.ImdbVotes,
            ImdbRatingSource: InferImdbSource(s),
            RottenTomatoesCritics: s.RottenTomatoesCritics,
            RottenTomatoesAudience: s.RottenTomatoesAudience,
            SecondarySourceVia: "persisted",
            SecondarySourceMatchKind: wasSeeded ? "persisted_seeded" : "persisted",
            FromSnapshot: true,
            IsStale: isStale);

    private static string? InferImdbSource(RatingsSnapshot s)
    {
        if (string.IsNullOrWhiteSpace(s.ImdbRating))
            return null;
        var m = s.SourceMask;
        if ((m & RatingsSourceMask.Mdblist) != 0)
            return "mdblist";
        if ((m & RatingsSourceMask.PhpImdb) != 0)
            return "php-imdb-detail";
        return "tmdb";
    }
}
