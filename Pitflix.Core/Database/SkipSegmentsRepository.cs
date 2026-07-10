using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Models;

namespace Pitflix.Core.Database;

public sealed class SkipSegmentsRepository
{
    private readonly LibraryContext _db;

    public SkipSegmentsRepository(LibraryContext db)
    {
        _db = db;
    }

    public async Task<Episode?> GetEpisodeAsync(int episodeId, CancellationToken cancellationToken = default)
    {
        return await _db.Episodes.AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == episodeId, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Episodes for one (Show, Season), in playback order, capped to the first <paramref name="take"/>
    /// — mirrors the sampling cap used by fingerprint correlation, kept bounded here too since a season
    /// with one chapter-tagged episode is enough to resolve the whole season.</summary>
    public async Task<IReadOnlyList<Episode>> GetSeasonEpisodesAsync(int showId, int seasonNumber, int take = 5,
        CancellationToken cancellationToken = default)
    {
        return await _db.Episodes.AsNoTracking()
            .Where(e => e.ShowId == showId && e.Season == seasonNumber)
            .OrderBy(e => e.EpisodeNumber)
            .Take(Math.Clamp(take, 1, 50))
            .ToListAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Total scanned episode count for one (Show, Season) — used for the "3+ episodes" fingerprint
    /// trigger threshold, independent of the sampling cap in <see cref="GetSeasonEpisodesAsync"/>.</summary>
    public async Task<int> CountSeasonEpisodesAsync(int showId, int seasonNumber, CancellationToken cancellationToken = default)
    {
        return await _db.Episodes.AsNoTracking()
            .CountAsync(e => e.ShowId == showId && e.Season == seasonNumber, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Best-known duration for a file from prior playback, if any — episodes don't carry their
    /// own duration column, only WatchHistory does (populated once mpv has actually opened the file).</summary>
    public async Task<int?> TryGetKnownDurationSecondsAsync(string filePath, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(filePath)) return null;
        var fp = filePath.Trim();
        var row = await _db.WatchHistories.AsNoTracking()
            .Where(h => h.FilePath == fp && h.FileDurationSeconds > 0)
            .OrderByDescending(h => h.OpenedAt)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        return row?.FileDurationSeconds;
    }

    public async Task<SeasonSkipSegment?> GetSeasonSegmentAsync(int showId, int seasonNumber,
        CancellationToken cancellationToken = default)
    {
        return await _db.SeasonSkipSegments.AsNoTracking()
            .FirstOrDefaultAsync(s => s.ShowId == showId && s.SeasonNumber == seasonNumber, cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<EpisodeSkipOverride?> GetEpisodeOverrideAsync(int episodeId,
        CancellationToken cancellationToken = default)
    {
        return await _db.EpisodeSkipOverrides.AsNoTracking()
            .FirstOrDefaultAsync(o => o.EpisodeId == episodeId, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Insert or replace the row for (ShowId, SeasonNumber). Caller decides what to write —
    /// this does not merge with an existing row.</summary>
    public async Task<SeasonSkipSegment> UpsertSeasonSegmentAsync(SeasonSkipSegment segment,
        CancellationToken cancellationToken = default)
    {
        var existing = await _db.SeasonSkipSegments
            .FirstOrDefaultAsync(s => s.ShowId == segment.ShowId && s.SeasonNumber == segment.SeasonNumber,
                cancellationToken)
            .ConfigureAwait(false);

        if (existing == null)
        {
            _db.SeasonSkipSegments.Add(segment);
        }
        else
        {
            existing.IntroStartSeconds = segment.IntroStartSeconds;
            existing.IntroEndSeconds = segment.IntroEndSeconds;
            existing.IntroConfidence = segment.IntroConfidence;
            existing.IntroSource = segment.IntroSource;
            existing.OutroStartSeconds = segment.OutroStartSeconds;
            existing.OutroEndSeconds = segment.OutroEndSeconds;
            existing.OutroConfidence = segment.OutroConfidence;
            existing.OutroSource = segment.OutroSource;
            existing.OutroSecondsBeforeEndStart = segment.OutroSecondsBeforeEndStart;
            existing.OutroSecondsBeforeEndEnd = segment.OutroSecondsBeforeEndEnd;
            existing.SampleEpisodeCount = segment.SampleEpisodeCount;
            existing.ComputedAt = segment.ComputedAt;
            existing.DetectionSource = segment.DetectionSource;
            segment = existing;
        }

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return segment;
    }

    /// <summary>Merges a Tier-3 (chromaprint / blackframe / silence) result into the existing row.
    /// Never overwrites chapter/anilist segments. Sets <see cref="SeasonSkipSegment.DetectionSource"/>
    /// when any Tier-3 segment is stored.</summary>
    public async Task<SeasonSkipSegment> UpsertTier3ResultAsync(
        int showId, int seasonNumber,
        (double Start, double End, double Confidence, string Source)? introResult,
        (double Start, double End, double Confidence, string Source, double SecondsBeforeEndStart, double SecondsBeforeEndEnd)? outroResult,
        string? detectionSource,
        int sampleEpisodeCount,
        CancellationToken cancellationToken = default)
    {
        var existing = await _db.SeasonSkipSegments
            .FirstOrDefaultAsync(s => s.ShowId == showId && s.SeasonNumber == seasonNumber, cancellationToken)
            .ConfigureAwait(false);

        var isNew = existing == null;
        existing ??= new SeasonSkipSegment { ShowId = showId, SeasonNumber = seasonNumber };

        static string IntroOutroSource(string tier3Source) => tier3Source switch
        {
            "chromaprint" => "fingerprint",
            _ => tier3Source,
        };

        if (introResult is { } ir && existing.IntroSource is not ("chapter" or "anilist"))
        {
            existing.IntroStartSeconds = ir.Start;
            existing.IntroEndSeconds = ir.End;
            existing.IntroConfidence = ir.Confidence;
            existing.IntroSource = IntroOutroSource(ir.Source);
        }

        if (outroResult is { } or && existing.OutroSource is not ("chapter" or "anilist"))
        {
            existing.OutroStartSeconds = or.Start;
            existing.OutroEndSeconds = or.End;
            existing.OutroConfidence = or.Confidence;
            existing.OutroSource = IntroOutroSource(or.Source);
            if (or.Source is "chromaprint" or "blackframe" or "silence")
            {
                existing.OutroSecondsBeforeEndStart = or.SecondsBeforeEndStart;
                existing.OutroSecondsBeforeEndEnd = or.SecondsBeforeEndEnd;
            }
        }

        if (!string.IsNullOrEmpty(detectionSource))
            existing.DetectionSource = detectionSource;

        existing.SampleEpisodeCount = Math.Max(existing.SampleEpisodeCount, sampleEpisodeCount);
        existing.ComputedAt = DateTime.UtcNow;

        if (isNew)
            _db.SeasonSkipSegments.Add(existing);

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return existing;
    }

    /// <summary>Clears Tier-3 fingerprint/visual detection so a rescan can re-run the job.
    /// Chapter/anilist segments are left intact.</summary>
    public async Task ClearTier3DetectionAsync(int showId, int seasonNumber,
        CancellationToken cancellationToken = default)
    {
        var existing = await _db.SeasonSkipSegments
            .FirstOrDefaultAsync(s => s.ShowId == showId && s.SeasonNumber == seasonNumber, cancellationToken)
            .ConfigureAwait(false);
        if (existing == null) return;

        if (existing.IntroSource is "fingerprint" or "blackframe" or "silence")
        {
            existing.IntroStartSeconds = null;
            existing.IntroEndSeconds = null;
            existing.IntroConfidence = null;
            existing.IntroSource = null;
        }

        if (existing.OutroSource is "fingerprint" or "blackframe" or "silence")
        {
            existing.OutroStartSeconds = null;
            existing.OutroEndSeconds = null;
            existing.OutroConfidence = null;
            existing.OutroSource = null;
            existing.OutroSecondsBeforeEndStart = null;
            existing.OutroSecondsBeforeEndEnd = null;
        }

        existing.DetectionSource = null;
        existing.ComputedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Insert or replace the override row for one episode (at most one per episode —
    /// a later write replaces the earlier one).</summary>
    public async Task<EpisodeSkipOverride> UpsertEpisodeOverrideAsync(EpisodeSkipOverride over,
        CancellationToken cancellationToken = default)
    {
        var existing = await _db.EpisodeSkipOverrides
            .FirstOrDefaultAsync(o => o.EpisodeId == over.EpisodeId, cancellationToken).ConfigureAwait(false);

        if (existing == null)
        {
            _db.EpisodeSkipOverrides.Add(over);
        }
        else
        {
            existing.IntroStartSeconds = over.IntroStartSeconds;
            existing.IntroEndSeconds = over.IntroEndSeconds;
            existing.OutroStartSeconds = over.OutroStartSeconds;
            existing.OutroEndSeconds = over.OutroEndSeconds;
            existing.SuppressIntro = over.SuppressIntro;
            existing.SuppressOutro = over.SuppressOutro;
            existing.Source = over.Source;
            over = existing;
        }

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return over;
    }
}
