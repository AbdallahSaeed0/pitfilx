using Microsoft.Extensions.Logging;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services;

/// <summary>
/// Group 2a/2d of the intro/outro skip feature: chapter markers (highest confidence,
/// via the existing <see cref="ChapterDetectorService"/> ffprobe probe) with a heuristic
/// fixed-offset fallback baked into that same probe. Audio fingerprinting (2c) and AniSkip
/// (2b) are future layers that would slot in here and only write when their own confidence
/// clears the threshold — this service never overwrites a higher-confidence existing value
/// with a lower-confidence one for the same segment.
/// </summary>
public sealed class SkipSegmentDetectionService
{
    private readonly SkipSegmentsRepository _repo;
    private readonly ILogger<SkipSegmentDetectionService> _logger;

    public SkipSegmentDetectionService(SkipSegmentsRepository repo, ILogger<SkipSegmentDetectionService> logger)
    {
        _repo = repo;
        _logger = logger;
    }

    /// <summary>
    /// Scans up to the first few episodes of a season for embedded chapter markers and
    /// persists a season-level result. Always writes a row — even when both intro and outro
    /// stay null — so a "ran, found nothing confident" season doesn't look identical to
    /// "never ran" on the next request.
    /// </summary>
    public async Task<SeasonSkipSegment> DetectAndStoreForSeasonAsync(int showId, int seasonNumber,
        CancellationToken ct = default)
    {
        var episodes = await _repo.GetSeasonEpisodesAsync(showId, seasonNumber, take: 5, ct).ConfigureAwait(false);

        double? introEnd = null, outroStart = null, outroDuration = null;
        string? introSource = null, outroSource = null;
        var sampleCount = 0;

        foreach (var ep in episodes)
        {
            if (!File.Exists(ep.FilePath))
                continue;

            var durationHint = await _repo.TryGetKnownDurationSecondsAsync(ep.FilePath, ct).ConfigureAwait(false);
            ChapterDetectorService.ChapterResult result;
            try
            {
                result = await ChapterDetectorService
                    .DetectAsync(ep.FilePath, "Series", durationHint, null, ct)
                    .ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                // ChapterDetectorService.DetectAsync already swallows its own errors and
                // returns an empty result — this catch is only a safety net for something
                // unexpected (e.g. cancellation) so one bad file doesn't abort the season scan.
                _logger.LogDebug(ex, "Skip detection: probe failed for {File}", ep.FilePath);
                continue;
            }

            sampleCount++;

            // Prefer an actual chapter-tagged match (confidence 1.0) over anything already
            // captured from an earlier episode's heuristic guess.
            var hasIntroChapter = result.Chapters.Any(c => ChapterDetectorService.IsIntroChapter(c.Title));
            var hasOutroChapter = result.Chapters.Any(c => ChapterDetectorService.IsOutroChapter(c.Title));

            if (result.IntroEnd is double ie && (introSource != "chapter") && (hasIntroChapter || introEnd == null))
            {
                introEnd = ie;
                introSource = hasIntroChapter ? "chapter" : "heuristic";
            }

            if (result.OutroStart is double os && (outroSource != "chapter") && (hasOutroChapter || outroStart == null))
            {
                outroStart = os;
                outroSource = hasOutroChapter ? "chapter" : "heuristic";
                outroDuration = (double?)durationHint ?? (result.Chapters.Count > 0 ? result.Chapters[^1].EndSec : null);
            }

            // Stop early once both segments have a real chapter match — no need to keep probing files.
            if (introSource == "chapter" && outroSource == "chapter")
                break;
        }

        var segment = new SeasonSkipSegment
        {
            ShowId = showId,
            SeasonNumber = seasonNumber,
            IntroStartSeconds = introEnd != null ? 0 : null,
            IntroEndSeconds = introEnd,
            IntroConfidence = introSource == "chapter" ? 1.0 : introSource == "heuristic" ? 0.3 : null,
            IntroSource = introSource,
            OutroStartSeconds = outroStart,
            OutroEndSeconds = outroStart != null ? outroDuration : null,
            OutroConfidence = outroSource == "chapter" ? 1.0 : outroSource == "heuristic" ? 0.3 : null,
            OutroSource = outroSource,
            SampleEpisodeCount = sampleCount,
            ComputedAt = DateTime.UtcNow,
        };

        return await _repo.UpsertSeasonSegmentAsync(segment, ct).ConfigureAwait(false);
    }
}
