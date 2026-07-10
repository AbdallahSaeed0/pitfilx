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
/// Tier 3 tries, per segment independently: chromaprint (energy-envelope correlation) →
/// black-frame detection → silence detection. Visual signals live in
/// <see cref="SkipSignalDetector"/>.
/// </summary>
public sealed class AudioFingerprintService
{
    private const int SampleRate = 4000;
    // Intro correlation only needs the opening — searching 300s let false "Previously on"
    // matches at ~3min beat the real title sequence near the start (GoT S1 testing).
    private const double HeadIntroClipSeconds = 180;
    private const double TailClipSeconds = 450;

    private const double EnvelopeFrameSeconds = 0.05;
    private static readonly int EnvelopeRate = (int)Math.Round(1.0 / EnvelopeFrameSeconds);

    private const double WindowSeconds = 5;
    private const double StepSeconds = 1;
    private const double LagSearchSeconds = 150;

    private const double MatchCorrelationThreshold = 0.6;
    private const double MinMatchSeconds = 60;
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
        var existing = await _repo.GetSeasonSegmentAsync(showId, seasonNumber, ct).ConfigureAwait(false);
        if (!string.IsNullOrEmpty(existing?.DetectionSource))
        {
            _logger.LogDebug(
                "Skip fingerprinting: skipping ShowId={ShowId} Season={Season} — DetectionSource={Source} already set",
                showId, seasonNumber, existing.DetectionSource);
            return;
        }

        var ffmpeg = ChapterDetectorService.ResolveFfmpeg();
        if (ffmpeg == null)
        {
            if (!_warnedMissingFfmpeg)
            {
                _warnedMissingFfmpeg = true;
                _logger.LogWarning(
                    "Skip fingerprinting: ffmpeg not found on PATH — install it to enable audio-based " +
                    "intro/outro detection for shows without embedded chapter markers.");
            }
            return;
        }

        var sampleEpisodes = (await _repo.GetSeasonEpisodesAsync(showId, seasonNumber, take: 5, ct).ConfigureAwait(false))
            .Where(e => File.Exists(e.FilePath))
            .ToList();
        if (sampleEpisodes.Count < MinSampleEpisodes)
            return;

        var chromaprint = await RunChromaprintCorrelationAsync(ffmpeg, showId, seasonNumber, sampleEpisodes, ct)
            .ConfigureAwait(false);

        var introResult = chromaprint.Intro;
        var outroResult = chromaprint.Outro;
        var introSource = introResult != null ? "chromaprint" : (string?)null;
        var outroSource = outroResult != null ? "chromaprint" : (string?)null;

        var needVisualSignals = introResult == null || outroResult == null;
        if (needVisualSignals)
        {
            var seasonEpisodes = (await _repo.GetSeasonEpisodesAsync(showId, seasonNumber, take: 50, ct).ConfigureAwait(false))
                .Where(e => File.Exists(e.FilePath))
                .ToList();

            if (seasonEpisodes.Count >= MinSampleEpisodes)
            {
                var detector = new SkipSignalDetector(_logger);
                async Task<double?> ResolveDuration(Episode ep, CancellationToken token) =>
                    await _repo.TryGetKnownDurationSecondsAsync(ep.FilePath, token).ConfigureAwait(false)
                    ?? await ChapterDetectorService.GetDurationSecondsAsync(ep.FilePath, token).ConfigureAwait(false);

                if (introResult == null || outroResult == null)
                {
                    var black = await detector.DetectBlackFramesForSeasonAsync(
                        ffmpeg, seasonEpisodes, ResolveDuration, ct).ConfigureAwait(false);

                    if (introResult == null && black.Intro is { } bi)
                    {
                        introResult = (bi.IntroStart, bi.IntroEnd, bi.Confidence);
                        introSource = "blackframe";
                        _logger.LogInformation(
                            "Skip fingerprinting: blackframe intro ShowId={ShowId} Season={Season} [{Start:F1}-{End:F1}s conf={Conf:F2}]",
                            showId, seasonNumber, bi.IntroStart, bi.IntroEnd, bi.Confidence);
                    }

                    if (outroResult == null && black.Outro is { } bo)
                    {
                        outroResult = await BuildOutroResultAsync(bo.OutroStart, bo.OutroEnd, bo.Confidence, seasonEpisodes, ct)
                            .ConfigureAwait(false);
                        outroSource = "blackframe";
                        _logger.LogInformation(
                            "Skip fingerprinting: blackframe outro ShowId={ShowId} Season={Season} start={Start:F1}s conf={Conf:F2}",
                            showId, seasonNumber, bo.OutroStart, bo.Confidence);
                    }
                }

                if (introResult == null || outroResult == null)
                {
                    var silence = await detector.DetectSilenceForSeasonAsync(
                        ffmpeg, seasonEpisodes, ResolveDuration, ct).ConfigureAwait(false);

                    if (introResult == null && silence.Intro is { } si)
                    {
                        introResult = (si.IntroStart, si.IntroEnd, si.Confidence);
                        introSource = "silence";
                        _logger.LogInformation(
                            "Skip fingerprinting: silence intro ShowId={ShowId} Season={Season} [{Start:F1}-{End:F1}s conf={Conf:F2}]",
                            showId, seasonNumber, si.IntroStart, si.IntroEnd, si.Confidence);
                    }

                    if (outroResult == null && silence.Outro is { } so)
                    {
                        outroResult = await BuildOutroResultAsync(so.OutroStart, so.OutroEnd, so.Confidence, seasonEpisodes, ct)
                            .ConfigureAwait(false);
                        outroSource = "silence";
                        _logger.LogInformation(
                            "Skip fingerprinting: silence outro ShowId={ShowId} Season={Season} start={Start:F1}s conf={Conf:F2}",
                            showId, seasonNumber, so.OutroStart, so.Confidence);
                    }
                }
            }
        }

        var introTier3 = introResult is { } ir
            ? ((double, double, double, string)?)(ir.Start, ir.End, ir.Confidence, introSource!)
            : null;
        var outroTier3 = outroResult is { } or
            ? ((double, double, double, string, double, double)?)(or.Start, or.End, or.Confidence, outroSource!, or.SecondsBeforeEndStart, or.SecondsBeforeEndEnd)
            : null;

        var detectionSource =
            introSource == "chromaprint" || outroSource == "chromaprint" ? "chromaprint"
            : introSource == "blackframe" || outroSource == "blackframe" ? "blackframe"
            : introSource == "silence" || outroSource == "silence" ? "silence"
            : null;

        if (introTier3 == null && outroTier3 == null)
        {
            _logger.LogInformation(
                "Skip fingerprinting: no confident intro/outro match for ShowId={ShowId} Season={Season} " +
                "(sampled {Count} episodes) — storing the attempt so this season isn't re-queued every view.",
                showId, seasonNumber, sampleEpisodes.Count);
        }

        await _repo.UpsertTier3ResultAsync(
            showId, seasonNumber, introTier3, outroTier3, detectionSource, sampleEpisodes.Count, ct)
            .ConfigureAwait(false);
    }

    private async Task<(double Start, double End, double Confidence, double SecondsBeforeEndStart, double SecondsBeforeEndEnd)?>
        BuildOutroResultAsync(double outroStart, double outroEnd, double confidence, List<Episode> episodes, CancellationToken ct)
    {
        foreach (var ep in episodes)
        {
            var dur = await _repo.TryGetKnownDurationSecondsAsync(ep.FilePath, ct).ConfigureAwait(false)
                ?? await ChapterDetectorService.GetDurationSecondsAsync(ep.FilePath, ct).ConfigureAwait(false);
            if (dur is not { } d) continue;

            var end = Math.Min(outroEnd, d);
            if (!SkipSignalBoundingWindow.ValidateOutro(outroStart, end, d))
                return null;

            return (outroStart, end, confidence, d - outroStart, d - end);
        }
        return null;
    }

    private async Task<ChromaprintSeasonResult> RunChromaprintCorrelationAsync(
        string ffmpeg, int showId, int seasonNumber, List<Episode> episodes, CancellationToken ct)
    {
        var reference = episodes[0];
        var others = episodes.Skip(1).ToList();

        var refHead = await ExtractEnvelopeAsync(ffmpeg, reference.FilePath, HeadIntroClipSeconds, fromEnd: false, ct).ConfigureAwait(false);
        var refTail = await ExtractEnvelopeAsync(ffmpeg, reference.FilePath, TailClipSeconds, fromEnd: true, ct).ConfigureAwait(false);

        var introCandidates = new List<(Episode Ep, double Start, double End)>();
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
                var head = await ExtractEnvelopeAsync(ffmpeg, ep.FilePath, HeadIntroClipSeconds, fromEnd: false, ct).ConfigureAwait(false);
                if (head == null)
                {
                    _logger.LogInformation("Skip fingerprinting: intro head extraction failed for {EpName}", epName);
                }
                else
                {
                    var attempt = FindMatchingRun(refHead, head, preferEarliestQualifyingRun: true);
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
        var refDuration = await _repo.TryGetKnownDurationSecondsAsync(reference.FilePath, ct).ConfigureAwait(false)
            ?? await ChapterDetectorService.GetDurationSecondsAsync(reference.FilePath, ct).ConfigureAwait(false)
            ?? await FirstKnownDurationAsync(others, ct).ConfigureAwait(false)
            ?? HeadIntroClipSeconds;

        var introCluster = FindBestIntroCluster(introCandidates);
        var introSummary = SummarizeCluster(introCluster, totalOthers);
        _logger.LogInformation(
            "Skip fingerprinting: intro candidates={Count} result={Result}",
            introCandidates.Count, introSummary is { } ir ? $"[{ir.Start:F1}-{ir.End:F1}s conf={ir.Confidence:F2}]" : "null");

        (double Start, double End, double Confidence)? introResult = null;
        if (introSummary is { } intro && intro.Confidence >= ConfidenceThreshold
            && SkipSignalBoundingWindow.ValidateIntro(intro.Start, intro.End, refDuration))
        {
            introResult = (intro.Start, intro.End, intro.Confidence);
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
                    outlier.Ep.Id, Path.GetFileName(outlier.Ep.FilePath), outlier.Start, outlier.End, intro.Start, intro.End);
            }
        }
        else if (introSummary != null)
        {
            _logger.LogInformation(
                "Skip fingerprinting: intro rejected — confidence={Conf:F2} or outside bounding window (runtime={Dur:F0}s)",
                introSummary.Value.Confidence, refDuration);
        }

        (double Start, double End, double Confidence, double SecondsBeforeEndStart, double SecondsBeforeEndEnd)? outroResult = null;
        var outroCluster = FindLargestCluster(outroCandidatesClipLocal);
        var outroClusterSummary = SummarizeCluster(outroCluster, totalOthers);
        _logger.LogInformation(
            "Skip fingerprinting: outro candidates={Count} clipLocalResult={Result}",
            outroCandidatesClipLocal.Count, outroClusterSummary is { } oc ? $"[{oc.Start:F1}-{oc.End:F1}s conf={oc.Confidence:F2}]" : "null");

        if (outroClusterSummary is { } outro && outro.Confidence >= ConfidenceThreshold)
        {
            var secondsBeforeEndStart = TailClipSeconds - outro.Start;
            var secondsBeforeEndEnd = TailClipSeconds - outro.End;
            var duration = refDuration;
            var absoluteStart = Math.Max(0, duration - TailClipSeconds) + outro.Start;
            var absoluteEnd = Math.Max(0, duration - TailClipSeconds) + outro.End;

            if (SkipSignalBoundingWindow.ValidateOutro(absoluteStart, absoluteEnd, duration))
            {
                outroResult = (absoluteStart, absoluteEnd, outro.Confidence, secondsBeforeEndStart, secondsBeforeEndEnd);
                foreach (var outlier in outroCandidatesClipLocal.Where(c => !outroCluster.Contains(c)))
                {
                    var epDuration = await _repo.TryGetKnownDurationSecondsAsync(outlier.Ep.FilePath, ct).ConfigureAwait(false)
                        ?? await ChapterDetectorService.GetDurationSecondsAsync(outlier.Ep.FilePath, ct).ConfigureAwait(false);
                    if (epDuration is not { } epDur) continue;

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
            else
            {
                _logger.LogInformation(
                    "Skip fingerprinting: outro rejected — outside bounding window (runtime={Dur:F0}s, start={Start:F1}s)",
                    duration, absoluteStart);
            }
        }
        else if (outroClusterSummary != null)
        {
            _logger.LogInformation(
                "Skip fingerprinting: outro rejected — confidence={Conf:F2}",
                outroClusterSummary.Value.Confidence);
        }

        return new ChromaprintSeasonResult(introResult, outroResult);
    }

    private readonly record struct ChromaprintSeasonResult(
        (double Start, double End, double Confidence)? Intro,
        (double Start, double End, double Confidence, double SecondsBeforeEndStart, double SecondsBeforeEndEnd)? Outro);

    private async Task<int?> FirstKnownDurationAsync(List<Episode> episodes, CancellationToken ct)
    {
        foreach (var ep in episodes)
        {
            var d = await _repo.TryGetKnownDurationSecondsAsync(ep.FilePath, ct).ConfigureAwait(false);
            if (d != null) return d;
        }
        return null;
    }

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

            var mean = envelope.Average();
            var variance = envelope.Sum(v => (v - mean) * (v - mean)) / envelope.Length;
            var std = Math.Sqrt(variance);
            if (std < 1e-9) return null;
            for (var f = 0; f < envelope.Length; f++)
                envelope[f] = (envelope[f] - mean) / std;

            return envelope;
        }
        catch
        {
            return null;
        }
    }

    private readonly record struct MatchAttempt(double BestCorrelation, double BestPositionSeconds, double LongestRunSeconds, double? Start, double? End)
    {
        public bool Matched => Start is not null;
    }

    private const int MaxGapWindows = 3;

    private static MatchAttempt FindMatchingRun(double[] a, double[] b, bool preferEarliestQualifyingRun = false)
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

        var qualifyingRuns = new List<(double Start, double End)>();
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
                TryAddQualifyingRun(qualifyingRuns, positions, curStart, curLen);
                curStart = -1;
                curLen = 0;
                gapWindows = 0;
            }
        }
        TryAddQualifyingRun(qualifyingRuns, positions, curStart, curLen);

        if (qualifyingRuns.Count == 0) return new MatchAttempt(overallBest, overallBestPos, 0, null, null);

        var picked = preferEarliestQualifyingRun
            ? qualifyingRuns.OrderBy(r => r.Start).First()
            : qualifyingRuns.OrderByDescending(r => r.End - r.Start).First();
        var runLen = picked.End - picked.Start;
        return new MatchAttempt(overallBest, overallBestPos, runLen, picked.Start, picked.End);
    }

    private static void TryAddQualifyingRun(
        List<(double Start, double End)> runs, List<double> positions, int curStart, int curLen)
    {
        if (curStart < 0 || curLen <= 0) return;
        var startSec = positions[curStart];
        var endSec = positions[curStart + curLen - 1] + WindowSeconds;
        var runLen = endSec - startSec;
        if (runLen is >= MinMatchSeconds and <= MaxMatchSeconds)
            runs.Add((startSec, endSec));
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

    private const double ClusterToleranceSeconds = 15.0;

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

    /// <summary>Intro clustering: only consider early-window candidates, then prefer the
    /// earliest agreeing cluster — late false positives (e.g. GoT ~3min in) must not beat
    /// the real title sequence near the start.</summary>
    private static List<(Episode Ep, double Start, double End)> FindBestIntroCluster(
        List<(Episode Ep, double Start, double End)> candidates)
    {
        var early = candidates
            .Where(c => c.Start <= SkipSignalBoundingWindow.ForRuntime(3600).MaxIntroStartSeconds)
            .ToList();
        if (early.Count == 0) return [];

        (List<(Episode Ep, double Start, double End)> Cluster, double AvgStart)? best = null;
        foreach (var c in early)
        {
            var cluster = early.Where(o => Math.Abs(o.Start - c.Start) <= ClusterToleranceSeconds).ToList();
            var avgStart = cluster.Average(x => x.Start);
            if (best == null
                || cluster.Count > best.Value.Cluster.Count
                || (cluster.Count == best.Value.Cluster.Count && avgStart < best.Value.AvgStart))
                best = (cluster, avgStart);
        }
        return best?.Cluster ?? [];
    }

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
