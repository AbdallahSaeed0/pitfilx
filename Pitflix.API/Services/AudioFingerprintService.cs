using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services;

/// <summary>
/// Group 2c of the intro/outro skip feature: cross-episode audio correlation for content with
/// no embedded chapters (the common case for unscripted/documentary shows like the one that
/// originally surfaced this gap).
///
/// Implementation history (the spec asked this judgment call to be documented, and it changed
/// once real testing started, so the "why" is worth keeping):
///
/// v1 correlated raw 4kHz PCM samples directly. Real-world testing on Game of Thrones showed
/// two problems: (a) independently-encoded episode files drift by a fraction of a second, not
/// a whole one, capping whole-second-granularity correlation at ~0.55 when the true alignment
/// (found by manually testing with numpy outside the app) scored 0.85; (b) even after fixing
/// that, raw-amplitude correlation is sensitive to per-file gain/mastering differences that
/// have nothing to do with whether the content is actually the same.
///
/// v2 (current) correlates a normalized RMS-energy envelope instead — 50ms frames, z-scored
/// over the whole clip so absolute loudness/mastering differences between files cancel out.
/// This also happens to dissolve problem (a): a 50ms frame already absorbs the sub-second
/// drift that needed a dedicated fine-grained search pass in v1, so that pass is gone. The
/// envelope is ~400x smaller than raw PCM for the same clip, which is what makes a much wider
/// lag search (handling shows with long, variable "Previously on..." recaps before the title
/// sequence) computationally affordable instead of needing yet another optimization pass.
///
/// Still not chromaprint/fpcalc — nothing in this codebase depends on it, and an energy
/// envelope is enough to answer "is this region of audio the same in episode A and episode B,"
/// which is all an intro/outro reuse signal needs to be.
/// </summary>
public sealed class AudioFingerprintService
{
    private const int SampleRate = 4000;
    private const double HeadClipSeconds = 300;
    // Real-world testing found outro matches getting truncated right at the 300s clip
    // boundary (start=0.0 for two different episodes — a clipping artifact, not real
    // agreement) because the actual credits run longer than 300s for some episodes once
    // post-credits/teaser content is included. Tail gets more headroom than head.
    private const double TailClipSeconds = 450;

    // Envelope: RMS energy per 50ms frame, z-score normalized over the whole clip.
    private const double EnvelopeFrameSeconds = 0.05;
    private static readonly int EnvelopeRate = (int)Math.Round(1.0 / EnvelopeFrameSeconds); // 20 frames/sec

    private const double WindowSeconds = 5;
    private const double StepSeconds = 1;
    // Now searched at full envelope resolution (no separate coarse/fine pass needed — see
    // class doc) and wide enough to cover a multi-minute cold-open/recap before the title
    // sequence, since the envelope is cheap enough to afford it.
    private const double LagSearchSeconds = 150;

    // Recalibrated for envelope-domain correlation, which behaves differently than raw-PCM
    // correlation — these are starting points pending real-world testing, not final values.
    private const double MatchCorrelationThreshold = 0.6;
    // Was 8s, then 20s. Real-world testing against actual playback (not just correlation
    // scores) found a confident, well-correlated (corr 0.98-1.00) 27s match that was 144s away
    // from the real intro and 243s away from the real credits — strong correlation only proves
    // "this exact audio repeats across episodes," not that it's the actual title sequence. A
    // real TV title sequence is a long structural unit (GoT's is ~95s); 60s is still short of
    // that but well above any short sting/ident/transition cue that could coincidentally repeat.
    private const double MinMatchSeconds = 60;
    // Real TV title sequences and credits rolls don't run past ~2 minutes — a "match" longer
    // than this is almost certainly two distinct matching bursts stitched together by gap
    // tolerance (confirmed: episode 5 correctly resolved to a clean [0-102s] run matching the
    // real intro almost exactly, while episodes 2-4 produced 161-278s runs that don't correspond
    // to anything real). Reject rather than trust an implausibly long run.
    private const double MaxMatchSeconds = 130;
    private const double ConfidenceThreshold = 0.75;
    private const int MinSampleEpisodes = 3;

    private static volatile bool _warnedMissingFfmpeg;

    private readonly SkipSegmentsRepository _repo;
    private readonly ILogger<AudioFingerprintService> _logger;

    public AudioFingerprintService(SkipSegmentsRepository repo, ILogger<AudioFingerprintService> logger)
    {
        _repo = repo;
        _logger = logger;
    }

    public async Task RunForSeasonAsync(int showId, int seasonNumber, CancellationToken ct)
    {
        var ffmpeg = ChapterDetectorService.ResolveFfmpeg();
        if (ffmpeg == null)
        {
            if (!_warnedMissingFfmpeg)
            {
                _warnedMissingFfmpeg = true;
                _logger.LogWarning(
                    "Skip fingerprinting: ffmpeg not found on PATH — install it to enable audio-based " +
                    "intro/outro detection for shows without embedded chapter markers. This is a new " +
                    "dependency for this feature specifically; nothing else in the backend required it before.");
            }
            return;
        }

        var episodes = (await _repo.GetSeasonEpisodesAsync(showId, seasonNumber, take: 5, ct).ConfigureAwait(false))
            .Where(e => File.Exists(e.FilePath))
            .ToList();
        if (episodes.Count < MinSampleEpisodes)
            return;

        var reference = episodes[0];
        var others = episodes.Skip(1).ToList();

        var refHead = await ExtractEnvelopeAsync(ffmpeg, reference.FilePath, HeadClipSeconds, fromEnd: false, ct).ConfigureAwait(false);
        var refTail = await ExtractEnvelopeAsync(ffmpeg, reference.FilePath, TailClipSeconds, fromEnd: true, ct).ConfigureAwait(false);

        var introCandidates = new List<(Episode Ep, double Start, double End)>();
        // Coordinates here are "seconds from the start of the tail clip", i.e. distance from
        // (duration - TailClipSeconds) — converted to an absolute timestamp per-episode using
        // that episode's own duration (see SeasonSkipSegment.OutroSecondsBeforeEnd* doc — episode
        // runtimes vary, so one shared conversion is wrong for episodes whose length differs).
        var outroCandidatesClipLocal = new List<(Episode Ep, double Start, double End)>();

        var refName = Path.GetFileName(reference.FilePath);
        _logger.LogInformation(
            "Skip fingerprinting: ShowId={ShowId} Season={Season} reference={RefName} comparing against {Count} other episode(s) " +
            "(threshold corr>={Threshold:F2}, run>={MinSec:F0}s, confidence>={ConfThreshold:F2}, lag search ±{Lag:F0}s)",
            showId, seasonNumber, refName, others.Count, MatchCorrelationThreshold, MinMatchSeconds, ConfidenceThreshold, LagSearchSeconds);

        foreach (var ep in others)
        {
            ct.ThrowIfCancellationRequested();
            var epName = Path.GetFileName(ep.FilePath);

            if (refHead != null)
            {
                var head = await ExtractEnvelopeAsync(ffmpeg, ep.FilePath, HeadClipSeconds, fromEnd: false, ct).ConfigureAwait(false);
                if (head == null)
                {
                    _logger.LogInformation("Skip fingerprinting: intro head extraction failed for {EpName}", epName);
                }
                else
                {
                    var attempt = FindMatchingRun(refHead, head);
                    _logger.LogInformation(
                        "Skip fingerprinting: intro vs {EpName} bestCorr={BestCorr:F2} atPos={BestPos:F1}s longestRun={RunSec:F1}s matched={Matched} start={Start:F1} end={End:F1}",
                        epName, attempt.BestCorrelation, attempt.BestPositionSeconds, attempt.LongestRunSeconds, attempt.Matched, attempt.Start, attempt.End);
                    if (attempt.Matched) introCandidates.Add((ep, attempt.Start!.Value, attempt.End!.Value));
                }
            }

            if (refTail != null)
            {
                var tail = await ExtractEnvelopeAsync(ffmpeg, ep.FilePath, TailClipSeconds, fromEnd: true, ct).ConfigureAwait(false);
                if (tail == null)
                {
                    _logger.LogInformation("Skip fingerprinting: outro tail extraction failed for {EpName}", epName);
                }
                else
                {
                    var attempt = FindMatchingRun(refTail, tail);
                    _logger.LogInformation(
                        "Skip fingerprinting: outro vs {EpName} bestCorr={BestCorr:F2} atPos={BestPos:F1}s longestRun={RunSec:F1}s matched={Matched} start={Start:F1} end={End:F1}",
                        epName, attempt.BestCorrelation, attempt.BestPositionSeconds, attempt.LongestRunSeconds, attempt.Matched, attempt.Start, attempt.End);
                    if (attempt.Matched) outroCandidatesClipLocal.Add((ep, attempt.Start!.Value, attempt.End!.Value));
                }
            }
        }

        if (refHead == null) _logger.LogInformation("Skip fingerprinting: reference intro head extraction failed for {RefName}", refName);
        if (refTail == null) _logger.LogInformation("Skip fingerprinting: reference outro tail extraction failed for {RefName}", refName);

        var totalOthers = others.Count;

        // ── Intro: cluster, and write a per-episode override for anyone outside the cluster
        // rather than silently dropping a genuinely different (but real) measurement — e.g. an
        // episode with a shorter cold-open than the rest of the season.
        var introCluster = FindLargestCluster(introCandidates);
        var introResult = SummarizeCluster(introCluster, totalOthers);
        _logger.LogInformation(
            "Skip fingerprinting: intro candidates={Count} result={Result}",
            introCandidates.Count, introResult is { } ir ? $"[{ir.Start:F1}-{ir.End:F1}s conf={ir.Confidence:F2}]" : "null");

        if (introResult != null)
        {
            foreach (var outlier in introCandidates.Where(c => !introCluster.Contains(c)))
            {
                await _repo.UpsertEpisodeOverrideAsync(new EpisodeSkipOverride
                {
                    EpisodeId = outlier.Ep.Id,
                    IntroStartSeconds = outlier.Start,
                    IntroEndSeconds = outlier.End,
                    Source = "validation_mismatch",
                }, ct).ConfigureAwait(false);
                _logger.LogInformation(
                    "Skip fingerprinting: intro override for EpisodeId={EpisodeId} ({EpName}) — measured [{Start:F1}-{End:F1}s], season cluster says [{ClusterStart:F1}-{ClusterEnd:F1}s]",
                    outlier.Ep.Id, Path.GetFileName(outlier.Ep.FilePath), outlier.Start, outlier.End, introResult.Value.Start, introResult.Value.End);
            }
        }

        // ── Outro: same clustering, but the cluster's (Start, End) are clip-local — convert to
        // seconds-before-end (duration-independent) for the season row, and to an absolute
        // per-episode override for anyone outside the cluster, using each outlier's own duration.
        (double Start, double End, double Confidence, double SecondsBeforeEndStart, double SecondsBeforeEndEnd)? outroResult = null;
        var outroCluster = FindLargestCluster(outroCandidatesClipLocal);
        var outroClusterSummary = SummarizeCluster(outroCluster, totalOthers);
        _logger.LogInformation(
            "Skip fingerprinting: outro candidates={Count} clipLocalResult={Result}",
            outroCandidatesClipLocal.Count, outroClusterSummary is { } oc ? $"[{oc.Start:F1}-{oc.End:F1}s conf={oc.Confidence:F2}]" : "null");

        if (outroClusterSummary != null)
        {
            var secondsBeforeEndStart = TailClipSeconds - outroClusterSummary.Value.Start;
            var secondsBeforeEndEnd = TailClipSeconds - outroClusterSummary.Value.End;

            var duration = await _repo.TryGetKnownDurationSecondsAsync(reference.FilePath, ct).ConfigureAwait(false)
                ?? await FirstKnownDurationAsync(others, ct).ConfigureAwait(false);
            // Absolute fallback (used only until an episode's own duration is resolvable at
            // serve time) — computed from whatever duration happened to be known here.
            var absoluteStart = duration is { } d ? Math.Max(0, d - TailClipSeconds) + outroClusterSummary.Value.Start : 0;
            var absoluteEnd = duration is { } d2 ? Math.Max(0, d2 - TailClipSeconds) + outroClusterSummary.Value.End : 0;

            outroResult = (absoluteStart, absoluteEnd, outroClusterSummary.Value.Confidence, secondsBeforeEndStart, secondsBeforeEndEnd);

            foreach (var outlier in outroCandidatesClipLocal.Where(c => !outroCluster.Contains(c)))
            {
                var epDuration = await _repo.TryGetKnownDurationSecondsAsync(outlier.Ep.FilePath, ct).ConfigureAwait(false)
                    ?? await ChapterDetectorService.GetDurationSecondsAsync(outlier.Ep.FilePath, ct).ConfigureAwait(false);
                if (epDuration is not { } epDur) continue; // can't place this episode's outro absolutely — leave it on the (wrong-for-it) season fallback rather than guess further

                var clipOffset = Math.Max(0, epDur - TailClipSeconds);
                var epStart = clipOffset + outlier.Start;
                var epEnd = clipOffset + outlier.End;

                await _repo.UpsertEpisodeOverrideAsync(new EpisodeSkipOverride
                {
                    EpisodeId = outlier.Ep.Id,
                    OutroStartSeconds = epStart,
                    OutroEndSeconds = epEnd,
                    Source = "validation_mismatch",
                }, ct).ConfigureAwait(false);
                _logger.LogInformation(
                    "Skip fingerprinting: outro override for EpisodeId={EpisodeId} ({EpName}) — measured [{Start:F1}-{End:F1}s] using its own duration={Dur:F0}s",
                    outlier.Ep.Id, Path.GetFileName(outlier.Ep.FilePath), epStart, epEnd, epDur);
            }
        }

        if (introResult == null && outroResult == null)
        {
            _logger.LogInformation(
                "Skip fingerprinting: no confident intro/outro match for ShowId={ShowId} Season={Season} " +
                "(sampled {Count} episodes) — storing the attempt so this season isn't re-queued every view.",
                showId, seasonNumber, episodes.Count);
        }

        await _repo.UpsertFingerprintResultAsync(showId, seasonNumber, introResult, outroResult, episodes.Count, ct)
            .ConfigureAwait(false);
    }

    private async Task<int?> FirstKnownDurationAsync(List<Episode> episodes, CancellationToken ct)
    {
        foreach (var ep in episodes)
        {
            var d = await _repo.TryGetKnownDurationSecondsAsync(ep.FilePath, ct).ConfigureAwait(false);
            if (d != null) return d;
        }
        return null;
    }

    /// <summary>Decodes a <paramref name="clipSeconds"/>-long clip (from the start, or from
    /// end-of-file via ffmpeg's <c>-sseof</c>) to mono 4kHz PCM, then reduces it to a normalized
    /// RMS-energy envelope (see class doc). Never throws — returns null on any failure (missing
    /// audio track, corrupt file, ffmpeg timeout, etc.).</summary>
    private static async Task<double[]?> ExtractEnvelopeAsync(string ffmpeg, string filePath, double clipSeconds, bool fromEnd, CancellationToken ct)
    {
        try
        {
            var args = fromEnd
                ? $"-sseof -{clipSeconds:F0} -i \"{filePath}\" -t {clipSeconds:F0} -vn -ac 1 -ar {SampleRate} -f s16le -"
                : $"-i \"{filePath}\" -t {clipSeconds:F0} -vn -ac 1 -ar {SampleRate} -f s16le -";

            var psi = new ProcessStartInfo(ffmpeg, args)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var proc = new Process { StartInfo = psi };
            proc.Start();

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(30));

            using var ms = new MemoryStream();
            var copyTask = proc.StandardOutput.BaseStream.CopyToAsync(ms, cts.Token);
            var stderrTask = proc.StandardError.ReadToEndAsync(cts.Token);
            await Task.WhenAll(copyTask, stderrTask, proc.WaitForExitAsync(cts.Token)).ConfigureAwait(false);

            var bytes = ms.ToArray();
            if (bytes.Length < SampleRate * 2)
                return null;

            var sampleCount = bytes.Length / 2;
            var frameLen = (int)(EnvelopeFrameSeconds * SampleRate);
            var frameCount = sampleCount / frameLen;
            if (frameCount < 2) return null;

            var envelope = new double[frameCount];
            for (var f = 0; f < frameCount; f++)
            {
                double sumSq = 0;
                var baseIdx = f * frameLen;
                for (var i = 0; i < frameLen; i++)
                {
                    var s = BitConverter.ToInt16(bytes, (baseIdx + i) * 2) / 32768.0;
                    sumSq += s * s;
                }
                envelope[f] = Math.Sqrt(sumSq / frameLen);
            }

            // Z-score normalize over the whole clip so absolute loudness/mastering differences
            // between files (different encode batches, different normalization passes) don't
            // affect correlation — only the shape of the energy contour over time matters.
            var mean = envelope.Average();
            var variance = envelope.Sum(v => (v - mean) * (v - mean)) / envelope.Length;
            var std = Math.Sqrt(variance);
            if (std < 1e-9) return null; // dead silence / no dynamic range — nothing to correlate
            for (var f = 0; f < envelope.Length; f++)
                envelope[f] = (envelope[f] - mean) / std;

            return envelope;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Diagnostic result of one clip-vs-clip comparison — kept even on a miss so the
    /// caller can log how close it got (best correlation seen, longest run found) instead of
    /// just pass/fail.</summary>
    private readonly record struct MatchAttempt(double BestCorrelation, double BestPositionSeconds, double LongestRunSeconds, double? Start, double? End)
    {
        public bool Matched => Start is not null;
    }

    // Was 1 window (1s), then 5s. 5s correctly recovered a clean, accurate match for one episode
    // (the real ~102s intro) but over-merged for three others into 161-278s runs spanning past
    // the real title sequence into unrelated content. 3s splits the difference — combined with
    // MaxMatchSeconds rejecting anything that still ends up implausibly long despite that.
    private const int MaxGapWindows = 3;

    /// <summary>Slides a <see cref="WindowSeconds"/> window across both energy envelopes (full
    /// ±<see cref="LagSearchSeconds"/> lag search at native 50ms envelope resolution — cheap
    /// enough at this scale that no separate coarse/fine pass is needed) and returns the
    /// longest contiguous run of windows whose correlation clears
    /// <see cref="MatchCorrelationThreshold"/>, if it's at least <see cref="MinMatchSeconds"/> long.</summary>
    private static MatchAttempt FindMatchingRun(double[] a, double[] b)
    {
        var len = Math.Min(a.Length, b.Length);
        var windowLen = (int)(WindowSeconds * EnvelopeRate);
        var step = Math.Max(1, (int)(StepSeconds * EnvelopeRate));
        var lag = (int)(LagSearchSeconds * EnvelopeRate);
        if (len <= windowLen) return new MatchAttempt(0, 0, 0, null, null);

        var positions = new List<double>();
        var matched = new List<bool>();
        var overallBest = 0.0;
        var overallBestPos = 0.0;
        for (var start = 0; start + windowLen <= len; start += step)
        {
            var best = -1.0;
            for (var l = -lag; l <= lag; l++)
            {
                var bStart = start + l;
                if (bStart < 0 || bStart + windowLen > len) continue;
                var corr = NormalizedCorrelation(a, start, b, bStart, windowLen);
                if (corr > best) best = corr;
            }
            if (best > overallBest) { overallBest = best; overallBestPos = start / (double)EnvelopeRate; }
            positions.Add(start / (double)EnvelopeRate);
            matched.Add(best >= MatchCorrelationThreshold);
        }

        var bestRunStart = -1;
        var bestRunLen = 0;
        var curStart = -1;
        var curLen = 0;
        var gapWindows = 0;
        for (var i = 0; i < matched.Count; i++)
        {
            if (matched[i])
            {
                if (curStart == -1) curStart = i;
                curLen++;
                gapWindows = 0;
            }
            else if (curStart != -1 && gapWindows < MaxGapWindows)
            {
                gapWindows++;
                curLen++;
            }
            else
            {
                if (curLen > bestRunLen) { bestRunLen = curLen; bestRunStart = curStart; }
                curStart = -1;
                curLen = 0;
                gapWindows = 0;
            }
        }
        if (curLen > bestRunLen) { bestRunLen = curLen; bestRunStart = curStart; }

        if (bestRunStart < 0) return new MatchAttempt(overallBest, overallBestPos, 0, null, null);
        var startSec = positions[bestRunStart];
        var endSec = positions[bestRunStart + bestRunLen - 1] + WindowSeconds;
        var runLen = endSec - startSec;
        return runLen is < MinMatchSeconds or > MaxMatchSeconds
            ? new MatchAttempt(overallBest, overallBestPos, runLen, null, null)
            : new MatchAttempt(overallBest, overallBestPos, runLen, startSec, endSec);
    }

    private static double NormalizedCorrelation(double[] a, int aStart, double[] b, int bStart, int len)
    {
        double meanA = 0, meanB = 0;
        for (var i = 0; i < len; i++) { meanA += a[aStart + i]; meanB += b[bStart + i]; }
        meanA /= len;
        meanB /= len;

        double num = 0, denA = 0, denB = 0;
        for (var i = 0; i < len; i++)
        {
            var da = a[aStart + i] - meanA;
            var db = b[bStart + i] - meanB;
            num += da * db;
            denA += da * da;
            denB += db * db;
        }
        if (denA <= 1e-9 || denB <= 1e-9) return 0;
        return num / Math.Sqrt(denA * denB);
    }

    // Was 1.0s. Real-world testing found genuine matches (corr~0.98, run length 30-100s+) with
    // start positions spread across a ~12s neighborhood (133.0, 145.0, 134.0) rather than tight
    // agreement — the "longest contiguous run" boundary is sensitive to exactly where correlation
    // crosses the threshold near the edges of an otherwise strongly-matching region, which jitters
    // more than a whole-second-level clustering tolerance can absorb. 15s still clearly separates
    // a real cluster from a true outlier (343.0 in that same test, ~200s away from the rest).
    private const double ClusterToleranceSeconds = 15.0;

    /// <summary>Finds the largest group of candidates whose Start values fall within
    /// <see cref="ClusterToleranceSeconds"/> of each other — the majority consensus. Returned
    /// as the actual candidate list (not just an average) so the caller can identify which
    /// episodes fell outside it and write a per-episode override for them instead of silently
    /// dropping a real, just-different measurement.</summary>
    private static List<(Episode Ep, double Start, double End)> FindLargestCluster(
        List<(Episode Ep, double Start, double End)> candidates)
    {
        var best = new List<(Episode Ep, double Start, double End)>();
        foreach (var c in candidates)
        {
            var cluster = candidates.Where(o => Math.Abs(o.Start - c.Start) <= ClusterToleranceSeconds).ToList();
            if (cluster.Count > best.Count) best = cluster;
        }
        return best;
    }

    /// <summary>Requires the cluster plus the reference episode itself to cover at least
    /// <see cref="MinSampleEpisodes"/> episodes, and the resulting confidence (cluster size over
    /// total comparisons) to clear <see cref="ConfidenceThreshold"/> — otherwise returns null
    /// rather than a weak guess. Confidence is capped at 0.95: 1.0 is reserved for an actual
    /// chapter marker, never for a statistical inference.</summary>
    private static (double Start, double End, double Confidence)? SummarizeCluster(
        List<(Episode Ep, double Start, double End)> cluster, int totalOthers)
    {
        if (cluster.Count == 0 || totalOthers == 0) return null;

        var matchedOthers = cluster.Count;
        if (matchedOthers + 1 < MinSampleEpisodes) return null;

        var confidence = matchedOthers / (double)totalOthers;
        if (confidence < ConfidenceThreshold) return null;

        var start = cluster.Average(c => c.Start);
        var end = cluster.Average(c => c.End);
        return (start, end, Math.Min(confidence, 0.95));
    }
}
