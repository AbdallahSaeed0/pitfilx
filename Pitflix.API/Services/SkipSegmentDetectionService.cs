using Microsoft.Extensions.Logging;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services;

/// <summary>
/// Group 2a/2d of the intro/outro skip feature: chapter markers (highest confidence, via the
/// existing <see cref="ChapterDetectorService"/> ffprobe probe), then a cascade of three
/// community-timestamp databases tried in order — TheIntroDB (TMDB-keyed, see
/// <see cref="TheIntroDbService"/>), IntroDB (IMDb-keyed, TV-only, see <see cref="IntroDbService"/>),
/// SkipDB (IMDb-keyed, see <see cref="SkipDbService"/>) — then a heuristic fixed-offset fallback
/// baked into the chapter probe itself. Audio fingerprinting (2c) is a further layer that slots in
/// after this and only writes when its own confidence clears the threshold — this service never
/// overwrites a higher-confidence existing value with a lower-confidence one for the same segment.
///
/// The three external sources are tried whole-response, not per-segment: the first one that
/// matches anything for an episode "serves" that episode and the rest aren't tried, mirroring the
/// experiment's actual question (which source serves each title) rather than merging partial hits
/// across sources.
/// </summary>
public sealed class SkipSegmentDetectionService
{
    /// <summary>IntroDB and SkipDB both expose a real confidence score (confirmed live) — TheIntroDB
    /// doesn't, so it has no gate and is instead flagged for manual spot-check (see IntroConfidence
    /// below). Starting strict per the brief; loosen once there's evidence it's too conservative.</summary>
    private const double MinExternalConfidence = 0.7;

    private readonly SkipSegmentsRepository _repo;
    private readonly RatingsSnapshotRepository _ratingsSnapshots;
    private readonly ITmdbClientFactory _tmdbClientFactory;
    private readonly TheIntroDbService _theIntroDb;
    private readonly IntroDbService _introDbApp;
    private readonly SkipDbService _skipDb;
    private readonly ILogger<SkipSegmentDetectionService> _logger;

    public SkipSegmentDetectionService(
        SkipSegmentsRepository repo, RatingsSnapshotRepository ratingsSnapshots, ITmdbClientFactory tmdbClientFactory,
        TheIntroDbService theIntroDb, IntroDbService introDbApp, SkipDbService skipDb,
        ILogger<SkipSegmentDetectionService> logger)
    {
        _repo = repo;
        _ratingsSnapshots = ratingsSnapshots;
        _tmdbClientFactory = tmdbClientFactory;
        _theIntroDb = theIntroDb;
        _introDbApp = introDbApp;
        _skipDb = skipDb;
        _logger = logger;
    }

    /// <summary>Source priority for the intro/outro assignment below — higher wins. Kept in one
    /// place so chapter markers beat all three external sources (tried in the order below), which
    /// beat the fixed-offset heuristic already baked into <see cref="ChapterDetectorService"/>'s
    /// result.</summary>
    private static int SourcePriority(string? source) => source switch
    {
        "chapter" => 5,
        "theintrodb" => 4,
        "introdb" => 3,
        "skipdb" => 2,
        "heuristic" => 1,
        _ => 0,
    };

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
        var showTmdbId = await _repo.GetShowTmdbIdAsync(showId, ct).ConfigureAwait(false);
        var showImdbId = showTmdbId is { } stid
            ? await ResolveImdbIdAsync(stid, "Series", ct).ConfigureAwait(false)
            : null;

        double? introStart = null, introEnd = null, outroStart = null, outroDuration = null;
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

            if (result.IntroEnd is double ie && SourcePriority("chapter") > SourcePriority(introSource) &&
                (hasIntroChapter || introEnd == null))
            {
                // Chapter/heuristic detection only ever reports where the intro ENDS — it assumes
                // (correctly, for those two sources) that the intro plays from the start of the file.
                introStart = 0;
                introEnd = ie;
                introSource = hasIntroChapter ? "chapter" : "heuristic";
            }

            if (result.OutroStart is double os && SourcePriority("chapter") > SourcePriority(outroSource) &&
                (hasOutroChapter || outroStart == null))
            {
                outroStart = os;
                outroSource = hasOutroChapter ? "chapter" : "heuristic";
                outroDuration = (double?)durationHint ?? (result.Chapters.Count > 0 ? result.Chapters[^1].EndSec : null);
            }

            // External source cascade: only worth trying when this episode still lacks a real
            // chapter match for at least one segment.
            if (!hasIntroChapter || !hasOutroChapter)
            {
                // WatchHistory-derived durationHint is only populated after the file has actually
                // been opened once, and the chapter-array fallback needs the file to actually have
                // embedded chapters — neither holds for a fresh, chapterless rip (confirmed live:
                // several test shows had zero chapters and no watch history, which silently dropped
                // every outro candidate until this fallback was added). GetDurationSecondsAsync is
                // the same lightweight ffprobe duration probe the chromaprint tier already uses for
                // this exact purpose, so this reuses existing infrastructure rather than adding a
                // new one — called only when the cheaper hints above came up empty.
                double? probedDuration = (double?)durationHint
                    ?? (result.Chapters.Count > 0 ? result.Chapters[^1].EndSec : null);
                probedDuration ??= await ChapterDetectorService.GetDurationSecondsAsync(ep.FilePath, ct)
                    .ConfigureAwait(false);

                var external = await TryExternalSourcesAsync(
                    showTmdbId, showImdbId, seasonNumber, ep.EpisodeNumber, probedDuration, ct).ConfigureAwait(false);

                if (external != null)
                {
                    // Only consider a segment external-source-eligible if THIS episode's own
                    // chapter probe didn't already confirm it — guards both the season fallback
                    // below and the per-episode override write from ever contradicting a real
                    // chapter tag.
                    var introCandidate = hasIntroChapter ? null : external.Intro;
                    var outroCandidate = hasOutroChapter ? null : external.Outro;

                    // Season-level accumulator: fallback for episodes beyond the sample cap below
                    // that never get their own override written.
                    if (introCandidate is { } ic && SourcePriority(external.Source) > SourcePriority(introSource))
                    {
                        introStart = ic.Start;
                        introEnd = ic.End;
                        introSource = external.Source;
                        _logger.LogInformation(
                            "Skip detection: {Source} intro (season fallback) ShowId={ShowId} Season={Season} [{Start:F1}-{End:F1}s]",
                            external.Source, showId, seasonNumber, ic.Start, ic.End);
                    }
                    if (outroCandidate is { } oc && SourcePriority(external.Source) > SourcePriority(outroSource))
                    {
                        outroStart = oc.Start;
                        outroSource = external.Source;
                        outroDuration = oc.Duration;
                        _logger.LogInformation(
                            "Skip detection: {Source} outro (season fallback) ShowId={ShowId} Season={Season} [{Start:F1}-{End:F1}s]",
                            external.Source, showId, seasonNumber, oc.Start, oc.End);
                    }

                    // Per-episode override: these sources' timing genuinely varies episode to
                    // episode (a recap-heavy episode pushes the title card later) — reusing one
                    // sampled episode's window for the whole season is wrong here, unlike
                    // chapter/chromaprint where a season generally repeats the same cold-open
                    // structure. Written for every sampled episode that got a valid candidate, not
                    // just whichever "won" above.
                    if (introCandidate != null || outroCandidate != null)
                    {
                        await UpsertExternalEpisodeOverrideAsync(
                            ep.Id, external.Source, introCandidate, outroCandidate, ct).ConfigureAwait(false);
                    }

                    _logger.LogInformation(
                        "Skip detection: {Source} served ShowId={ShowId} S{Season}E{Episode}",
                        external.Source, showId, seasonNumber, ep.EpisodeNumber);
                }
            }

            // Stop early once both segments have a real chapter match — no need to keep probing files.
            if (introSource == "chapter" && outroSource == "chapter")
                break;
        }

        var segment = new SeasonSkipSegment
        {
            ShowId = showId,
            SeasonNumber = seasonNumber,
            IntroStartSeconds = introStart,
            IntroEndSeconds = introEnd,
            IntroConfidence = ExternalSourceDisplayConfidence(introSource),
            IntroSource = introSource,
            OutroStartSeconds = outroStart,
            OutroEndSeconds = outroStart != null ? outroDuration : null,
            OutroConfidence = ExternalSourceDisplayConfidence(outroSource),
            OutroSource = outroSource,
            // Absolute OutroStartSeconds/OutroEndSeconds above come from whichever single sampled
            // episode had the chapter/heuristic match — reusing them as-is for every other episode
            // in the season is wrong whenever runtimes differ (the credits "chapter" endpoint's
            // GET /api/skip/episode/{id} only re-derives from these SecondsBeforeEnd fields, so
            // without them chapter-sourced outro fires at the sampled episode's absolute timestamp
            // regardless of the actual episode's duration). Distance-from-end is stable across
            // episodes (credits are a fixed-length asset appended at the end), so store that too.
            OutroSecondsBeforeEndStart = outroStart != null && outroDuration != null
                ? outroDuration - outroStart : null,
            OutroSecondsBeforeEndEnd = outroStart != null && outroDuration != null ? 0.0 : null,
            SampleEpisodeCount = sampleCount,
            ComputedAt = DateTime.UtcNow,
        };

        return await _repo.UpsertSeasonSegmentAsync(segment, ct).ConfigureAwait(false);
    }

    private static double? ExternalSourceDisplayConfidence(string? source) => source switch
    {
        "chapter" => 1.0,
        // TheIntroDB exposes no confidence/submission-count field (confirmed against the live
        // API) — this value is a flag for later manual quality spot-checks, not a measured
        // confidence. IntroDB/SkipDB both have a real confidence already gated to >= 0.7 before
        // a result is ever accepted (see MinExternalConfidence), so their stored value reflects
        // that they cleared the bar, not the source's own reported number — the client trust list
        // gates on source name, not on this field, for all three.
        "theintrodb" or "introdb" or "skipdb" => 0.8,
        "heuristic" => 0.3,
        _ => null,
    };

    /// <summary>Resolves a title's IMDb id for the IMDb-keyed sources (IntroDB, SkipDB). Cheapest
    /// path first: <see cref="RatingsSnapshotRepository"/> already caches it from ratings
    /// enrichment for most titles; falls back to <see cref="TmdbClient.TryGetImdbIdAsync"/> (TMDB's
    /// own external_ids endpoint — NOT OMDB, which is a separate, unrelated ratings source in this
    /// codebase) only when nothing's cached yet.</summary>
    private async Task<string?> ResolveImdbIdAsync(int tmdbId, string mediaType, CancellationToken ct)
    {
        var cached = await _ratingsSnapshots.GetSnapshotAsync(tmdbId, mediaType, ct).ConfigureAwait(false);
        if (!string.IsNullOrWhiteSpace(cached?.ImdbId))
            return cached.ImdbId;

        var tmdb = _tmdbClientFactory.Create();
        if (tmdb == null)
            return null;

        return await tmdb.TryGetImdbIdAsync(tmdbId, mediaType, ct).ConfigureAwait(false);
    }

    private sealed record ExternalSourceResult(
        string Source,
        (double Start, double End)? Intro,
        (double Start, double End, double Duration)? Outro);

    /// <summary>
    /// Tries TheIntroDB, then IntroDB, then SkipDB, in that order — whole-response, not
    /// per-segment: the first source that matches anything for this episode "serves" it, and the
    /// rest aren't tried. This mirrors the actual experiment (which source serves each title) rather
    /// than merging partial hits from multiple sources into one synthetic result.
    /// </summary>
    private async Task<ExternalSourceResult?> TryExternalSourcesAsync(
        int? tmdbId, string? imdbId, int seasonNumber, int episodeNumber, double? probedDuration, CancellationToken ct)
    {
        if (tmdbId is { } tid)
        {
            var r = await _theIntroDb.GetForEpisodeAsync(tid, seasonNumber, episodeNumber, ct).ConfigureAwait(false);
            if (r != null)
            {
                // No confidence field on this source (confirmed live) — no gate.
                var intro = ValidateIntroWindow(r.IntroStartSeconds, r.IntroEndSeconds, null, null, probedDuration);
                var outro = ValidateOutroWindow(r.OutroStartSeconds, r.OutroEndSeconds, null, null, probedDuration);
                if (intro != null || outro != null)
                    return new ExternalSourceResult("theintrodb", intro, outro);
            }
        }

        if (imdbId != null)
        {
            // IntroDB is TV-only (confirmed live: /segments 400s without season+episode, so there's
            // no movie query shape to use) — fine here since this whole method only runs from the
            // season/episode detection path anyway.
            var idb = await _introDbApp.GetForEpisodeAsync(imdbId, seasonNumber, episodeNumber, ct).ConfigureAwait(false);
            if (idb != null)
            {
                var intro = ValidateIntroWindow(
                    idb.IntroStartSeconds, idb.IntroEndSeconds, idb.IntroConfidence, MinExternalConfidence, probedDuration);
                var outro = ValidateOutroWindow(
                    idb.OutroStartSeconds, idb.OutroEndSeconds, idb.OutroConfidence, MinExternalConfidence, probedDuration);
                if (intro != null || outro != null)
                {
                    _logger.LogInformation(
                        "Skip detection: IntroDB match S{Season}E{Episode} submissions intro={IntroCount} outro={OutroCount}",
                        seasonNumber, episodeNumber, idb.IntroSubmissionCount, idb.OutroSubmissionCount);
                    return new ExternalSourceResult("introdb", intro, outro);
                }
            }

            var sdb = await _skipDb.GetForEpisodeAsync(imdbId, seasonNumber, episodeNumber, ct).ConfigureAwait(false);
            if (sdb != null)
            {
                // "out-of-range" is SkipDB's own match-quality flag, independent of (and more
                // specific than) its numeric confidence — live testing showed passing the
                // documented `duration` param actually produces this even for a correct duration,
                // so that param is deliberately not sent; still checked here defensively in case a
                // future response carries it without our asking.
                var intro = sdb.IntroMatch == "out-of-range" ? null : ValidateIntroWindow(
                    sdb.IntroStartSeconds, sdb.IntroEndSeconds, sdb.IntroConfidence, MinExternalConfidence, probedDuration);
                var outro = sdb.OutroMatch == "out-of-range" ? null : ValidateOutroWindow(
                    sdb.OutroStartSeconds, sdb.OutroEndSeconds, sdb.OutroConfidence, MinExternalConfidence, probedDuration);
                if (intro != null || outro != null)
                    return new ExternalSourceResult("skipdb", intro, outro);
            }
        }

        return null;
    }

    /// <summary>
    /// Validates an intro window from any of the three external sources. Live testing found at
    /// least one garbage entry (a TheIntroDB "intro" segment with a zero-length window — the live
    /// Friends S01E01 response) — so results are sanity-checked rather than trusted outright.
    ///
    /// Uses its own bounds rather than <see cref="SkipSignalBoundingWindow.ValidateIntro"/>: that
    /// shared bound assumes (correctly, for chapter/heuristic/chromaprint) an intro starting near 0
    /// (its MaxIntroStartSeconds caps at 150s), but these sources legitimately report non-zero
    /// starts for a "previously on" recap immediately followed by the title card (confirmed live —
    /// Stranger Things S01E01 reports 505.4-555.0s on both TheIntroDB and IntroDB).
    /// </summary>
    private static (double Start, double End)? ValidateIntroWindow(
        double? startSeconds, double? endSeconds, double? confidence, double? minConfidence, double? durationHint)
    {
        if (endSeconds is not { } end) return null;
        if (confidence is { } c && minConfidence is { } min && c < min) return null;

        var start = startSeconds ?? 0;
        if (start < 0 || end <= start) return null;
        var length = end - start;
        if (length is < 1.0 or > 300.0) return null;
        var ceiling = durationHint is { } dur ? Math.Min(dur * 0.35, 900.0) : 900.0;
        return end <= ceiling ? (start, end) : null;
    }

    /// <summary>Validates an outro (credits) window from any of the three external sources, reusing
    /// the shared <see cref="SkipSignalBoundingWindow.ValidateOutro"/> unchanged — "credits sit near
    /// the end" holds for all of them. An end timestamp is frequently omitted ("runs to end of
    /// file" in these sources' own semantics), which needs a known episode duration to resolve to
    /// an absolute timestamp; returns null (skip storing rather than guessing) when duration is
    /// unknown, same as the chapter/heuristic branch above already does.</summary>
    private static (double Start, double End, double Duration)? ValidateOutroWindow(
        double? startSeconds, double? endSeconds, double? confidence, double? minConfidence, double? durationHint)
    {
        if (startSeconds is not { } start) return null;
        if (confidence is { } c && minConfidence is { } min && c < min) return null;

        var end = endSeconds ?? durationHint;
        if (end is not { } e || durationHint is not { } dur) return null;
        return SkipSignalBoundingWindow.ValidateOutro(start, e, dur) ? (start, e, dur) : null;
    }

    /// <summary>Persists one episode's validated external-source result as a per-episode override —
    /// takes precedence over the season-level segment at serve time (see SkipEndpoints), so other
    /// episodes in the sample get their own accurate window instead of inheriting whatever episode
    /// the season-level accumulator happened to capture first. Merges with (rather than replacing)
    /// any existing override row so this never blanks out a field it has no new data for, and never
    /// touches a row a user set manually.</summary>
    private async Task UpsertExternalEpisodeOverrideAsync(
        int episodeId, string source, (double Start, double End)? introCandidate,
        (double Start, double End, double Duration)? outroCandidate, CancellationToken ct)
    {
        var existing = await _repo.GetEpisodeOverrideAsync(episodeId, ct).ConfigureAwait(false);
        if (existing?.Source == "manual")
            return;

        await _repo.UpsertEpisodeOverrideAsync(new EpisodeSkipOverride
        {
            EpisodeId = episodeId,
            IntroStartSeconds = introCandidate?.Start ?? existing?.IntroStartSeconds,
            IntroEndSeconds = introCandidate?.End ?? existing?.IntroEndSeconds,
            OutroStartSeconds = outroCandidate?.Start ?? existing?.OutroStartSeconds,
            OutroEndSeconds = outroCandidate?.End ?? existing?.OutroEndSeconds,
            SuppressIntro = existing?.SuppressIntro ?? false,
            SuppressOutro = existing?.SuppressOutro ?? false,
            Source = source,
        }, ct).ConfigureAwait(false);
    }
}
