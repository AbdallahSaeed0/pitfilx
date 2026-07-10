using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using Pitflix.Core.Models;

namespace Pitflix.API.Services;

/// <summary>
/// Tier-3 visual/audio-boundary signals for intro/outro skip detection: FFmpeg black-frame and
/// silence cross-episode correlation for documentary/unscripted content where chromaprint fails.
/// </summary>
public sealed class SkipSignalDetector
{
    private const double BlackFrameGroupGapSeconds = 0.5;
    private const double BlackSectionMinLengthSeconds = 0.3;
    private const double BlackFrameClusterToleranceSeconds = 3.0;
    private const double BlackFrameMinAgreement = 0.60;

    private const double SilenceClusterToleranceSeconds = 4.0;
    private const double SilenceMinAgreement = 0.55;
    private const double SilenceMinDurationSeconds = 1.5;

    private const double FfmpegTimeoutSeconds = 120;

    private static readonly Regex BlackFrameLine = new(
        @"frame:\d+\s+pblack:(\d+(?:\.\d+)?)\s+pts:\d+\s+pts_time:(\d+(?:\.\d+)?)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex SilenceStartLine = new(
        @"silence_start:\s*(\d+(?:\.\d+)?)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex SilenceEndLine = new(
        @"silence_end:\s*(\d+(?:\.\d+)?)\s*\|\s*silence_duration:\s*(\d+(?:\.\d+)?)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly ILogger _logger;

    public SkipSignalDetector(ILogger logger) => _logger = logger;

    public sealed record SignalIntroResult(double IntroStart, double IntroEnd, double Confidence);
    public sealed record SignalOutroResult(double OutroStart, double OutroEnd, double Confidence);

    public sealed record BlackFrameSeasonResult(SignalIntroResult? Intro, SignalOutroResult? Outro);
    public sealed record SilenceSeasonResult(SignalIntroResult? Intro, SignalOutroResult? Outro);

    public async Task<BlackFrameSeasonResult> DetectBlackFramesForSeasonAsync(
        string ffmpeg,
        IReadOnlyList<Episode> episodes,
        Func<Episode, CancellationToken, Task<double?>> resolveDurationAsync,
        CancellationToken ct)
    {
        var perEpisode = new List<(Episode Ep, double Duration, List<TimeSection> Sections)>();
        foreach (var ep in episodes)
        {
            if (!File.Exists(ep.FilePath)) continue;
            var duration = await resolveDurationAsync(ep, ct).ConfigureAwait(false);
            if (duration is not double dur || dur < 60) continue;

            var frames = await RunBlackFrameDetectionAsync(ffmpeg, ep.FilePath, ct).ConfigureAwait(false);
            if (frames == null) continue;

            var bounds = SkipSignalBoundingWindow.ForRuntime(dur);
            var sections = GroupBlackFramesIntoSections(frames)
                .Where(s => s.Length >= BlackSectionMinLengthSeconds)
                .ToList();
            perEpisode.Add((ep, dur, sections));
        }

        if (perEpisode.Count < 3)
            return new BlackFrameSeasonResult(null, null);

        var intro = FindBlackFrameIntro(perEpisode);
        var outro = FindBlackFrameOutro(perEpisode);
        return new BlackFrameSeasonResult(intro, outro);
    }

    public async Task<SilenceSeasonResult> DetectSilenceForSeasonAsync(
        string ffmpeg,
        IReadOnlyList<Episode> episodes,
        Func<Episode, CancellationToken, Task<double?>> resolveDurationAsync,
        CancellationToken ct)
    {
        var perEpisode = new List<(Episode Ep, double Duration, List<TimeSection> Silences)>();
        foreach (var ep in episodes)
        {
            if (!File.Exists(ep.FilePath)) continue;
            var duration = await resolveDurationAsync(ep, ct).ConfigureAwait(false);
            if (duration is not double dur || dur < 60) continue;

            var silences = await RunSilenceDetectionAsync(ffmpeg, ep.FilePath, ct).ConfigureAwait(false);
            if (silences == null) continue;

            perEpisode.Add((ep, dur, silences.Where(s => s.Length >= SilenceMinDurationSeconds).ToList()));
        }

        if (perEpisode.Count < 3)
            return new SilenceSeasonResult(null, null);

        var intro = FindSilenceIntro(perEpisode);
        var outro = FindSilenceOutro(perEpisode);
        return new SilenceSeasonResult(intro, outro);
    }

    private SignalIntroResult? FindBlackFrameIntro(
        List<(Episode Ep, double Duration, List<TimeSection> Sections)> perEpisode)
    {
        var total = perEpisode.Count;
        var cluster = FindBestEpisodeCluster(
            perEpisode,
            (dur, sections) => sections
                .Where(s => s.End <= SkipSignalBoundingWindow.ForRuntime(dur).IntroSearchMax)
                .Select(s => s.End)
                .ToList(),
            BlackFrameClusterToleranceSeconds,
            BlackFrameMinAgreement,
            pickLatest: true);
        if (cluster == null) return null;

        var confidence = BlackFrameConfidence(cluster.Value.AgreementRatio);
        if (confidence < 0.60) return null;

        var introEnd = cluster.Value.Center;
        var avgDur = perEpisode.Average(e => e.Duration);
        if (!SkipSignalBoundingWindow.ValidateIntro(0, introEnd, avgDur))
            return null;

        return new SignalIntroResult(0, introEnd, confidence);
    }

    private SignalOutroResult? FindBlackFrameOutro(
        List<(Episode Ep, double Duration, List<TimeSection> Sections)> perEpisode)
    {
        var total = perEpisode.Count;
        var cluster = FindBestEpisodeCluster(
            perEpisode,
            (dur, sections) => sections
                .Where(s => s.Start >= SkipSignalBoundingWindow.ForRuntime(dur).OutroSearchMin)
                .Select(s => s.Start)
                .ToList(),
            BlackFrameClusterToleranceSeconds,
            BlackFrameMinAgreement,
            pickLatest: false);
        if (cluster == null) return null;

        var confidence = BlackFrameConfidence(cluster.Value.AgreementRatio);
        if (confidence < 0.60) return null;

        var outroStart = cluster.Value.Center;
        var avgDur = perEpisode.Average(e => e.Duration);
        var outroEnd = avgDur;
        if (!SkipSignalBoundingWindow.ValidateOutro(outroStart, outroEnd, avgDur))
            return null;

        return new SignalOutroResult(outroStart, outroEnd, confidence);
    }

    private SignalIntroResult? FindSilenceIntro(
        List<(Episode Ep, double Duration, List<TimeSection> Silences)> perEpisode)
    {
        var cluster = FindBestEpisodeCluster(
            perEpisode,
            (dur, silences) => silences
                .Where(s => s.End <= SkipSignalBoundingWindow.ForRuntime(dur).IntroSearchMax)
                .Select(s => s.End)
                .ToList(),
            SilenceClusterToleranceSeconds,
            SilenceMinAgreement,
            pickLatest: true);
        if (cluster == null) return null;

        var confidence = SilenceConfidence(cluster.Value.AgreementRatio);
        if (confidence < 0.55) return null;

        var introEnd = cluster.Value.Center;
        var avgDur = perEpisode.Average(e => e.Duration);
        if (!SkipSignalBoundingWindow.ValidateIntro(0, introEnd, avgDur))
            return null;

        return new SignalIntroResult(0, introEnd, confidence);
    }

    private SignalOutroResult? FindSilenceOutro(
        List<(Episode Ep, double Duration, List<TimeSection> Silences)> perEpisode)
    {
        var cluster = FindBestEpisodeCluster(
            perEpisode,
            (dur, silences) => silences
                .Where(s => s.Start >= SkipSignalBoundingWindow.ForRuntime(dur).OutroSearchMin)
                .Select(s => s.Start)
                .ToList(),
            SilenceClusterToleranceSeconds,
            SilenceMinAgreement,
            pickLatest: false);
        if (cluster == null) return null;

        var confidence = SilenceConfidence(cluster.Value.AgreementRatio);
        if (confidence < 0.55) return null;

        var outroStart = cluster.Value.Center;
        var avgDur = perEpisode.Average(e => e.Duration);
        var outroEnd = avgDur;
        if (!SkipSignalBoundingWindow.ValidateOutro(outroStart, outroEnd, avgDur))
            return null;

        return new SignalOutroResult(outroStart, outroEnd, confidence);
    }

    /// <summary>Clusters timestamps across episodes; an episode counts if any of its values fall
    /// within tolerance of the anchor. <paramref name="pickLatest"/> selects the last intro
    /// section (max center) or first outro section (min center).</summary>
    private static (double Center, double AgreementRatio)? FindBestEpisodeCluster<T>(
        List<(Episode Ep, double Duration, List<T> Sections)> perEpisode,
        Func<double, List<T>, List<double>> selectTimestamps,
        double tolerance,
        double minAgreement,
        bool pickLatest)
    {
        var total = perEpisode.Count;
        if (total == 0) return null;

        var perEpValues = perEpisode
            .Select(e => selectTimestamps(e.Duration, e.Sections))
            .ToList();

        var anchors = perEpValues.SelectMany(v => v).Distinct().ToList();
        if (anchors.Count == 0) return null;

        (double Center, double AgreementRatio)? best = null;
        foreach (var anchor in anchors)
        {
            var matching = new List<double>();
            foreach (var values in perEpValues)
            {
                if (values.Any(v => Math.Abs(v - anchor) <= tolerance))
                    matching.Add(values.Where(v => Math.Abs(v - anchor) <= tolerance).Average());
            }

            var episodeCount = perEpValues.Count(values => values.Any(v => Math.Abs(v - anchor) <= tolerance));
            var ratio = episodeCount / (double)total;
            if (ratio < minAgreement) continue;

            var center = matching.Average();
            if (best == null)
            {
                best = (center, ratio);
                continue;
            }

            var betterCenter = pickLatest ? center > best.Value.Center : center < best.Value.Center;
            if (ratio > best.Value.AgreementRatio || (Math.Abs(ratio - best.Value.AgreementRatio) < 1e-9 && betterCenter))
                best = (center, ratio);
        }
        return best;
    }

    private static double BlackFrameConfidence(double agreementRatio) => agreementRatio switch
    {
        >= 0.90 => 0.85,
        >= 0.75 => 0.70,
        >= 0.60 => 0.55,
        _ => 0,
    };

    private static double SilenceConfidence(double agreementRatio) => agreementRatio switch
    {
        >= 0.90 => 0.80,
        >= 0.75 => 0.65,
        >= 0.55 => 0.50,
        _ => 0,
    };

    private async Task<List<double>?> RunBlackFrameDetectionAsync(string ffmpeg, string filePath, CancellationToken ct)
    {
        var output = await RunFfmpegFilterAsync(
            ffmpeg,
            $"-i \"{filePath}\" -vf \"blackframe=amount=98:threshold=32\" -an -f null -",
            filePath,
            ct).ConfigureAwait(false);
        if (output == null) return null;

        var timestamps = new List<double>();
        foreach (var line in output.Split('\n'))
        {
            var m = BlackFrameLine.Match(line);
            if (!m.Success) continue;
            if (!double.TryParse(m.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var pblack))
                continue;
            if (pblack < 98) continue;
            if (!double.TryParse(m.Groups[2].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var ptsTime))
                continue;
            timestamps.Add(ptsTime);
        }
        return timestamps.Count == 0 ? null : timestamps;
    }

    private async Task<List<TimeSection>?> RunSilenceDetectionAsync(string ffmpeg, string filePath, CancellationToken ct)
    {
        var output = await RunFfmpegFilterAsync(
            ffmpeg,
            $"-i \"{filePath}\" -af \"silencedetect=noise=-40dB:duration=1.5\" -vn -f null -",
            filePath,
            ct).ConfigureAwait(false);
        if (output == null) return null;

        var silences = new List<TimeSection>();
        double? pendingStart = null;
        foreach (var line in output.Split('\n'))
        {
            var startMatch = SilenceStartLine.Match(line);
            if (startMatch.Success)
            {
                if (double.TryParse(startMatch.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var s))
                    pendingStart = s;
                continue;
            }

            var endMatch = SilenceEndLine.Match(line);
            if (!endMatch.Success || pendingStart is not { } start) continue;
            if (!double.TryParse(endMatch.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var end))
                continue;
            if (!double.TryParse(endMatch.Groups[2].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var dur))
                continue;
            if (dur >= SilenceMinDurationSeconds)
                silences.Add(new TimeSection(start, end));
            pendingStart = null;
        }
        return silences.Count == 0 ? null : silences;
    }

    private async Task<string?> RunFfmpegFilterAsync(string ffmpeg, string args, string filePath, CancellationToken ct)
    {
        try
        {
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
            cts.CancelAfter(TimeSpan.FromSeconds(FfmpegTimeoutSeconds));

            var stderrTask = proc.StandardError.ReadToEndAsync(cts.Token);
            var stdoutTask = proc.StandardOutput.ReadToEndAsync(cts.Token);
            try
            {
                await proc.WaitForExitAsync(cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                try { proc.Kill(entireProcessTree: true); } catch { /* best effort */ }
                _logger.LogWarning(
                    "Skip signal detection: ffmpeg timed out after {Timeout}s for {File}",
                    FfmpegTimeoutSeconds, Path.GetFileName(filePath));
                return null;
            }

            var stderr = await stderrTask.ConfigureAwait(false);
            var stdout = await stdoutTask.ConfigureAwait(false);
            return stderr + stdout;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Skip signal detection: ffmpeg failed for {File}", filePath);
            return null;
        }
    }

    private static List<TimeSection> GroupBlackFramesIntoSections(IReadOnlyList<double> frameTimes)
    {
        if (frameTimes.Count == 0) return [];
        var sorted = frameTimes.OrderBy(t => t).ToList();
        var sections = new List<TimeSection>();
        var sectionStart = sorted[0];
        var sectionEnd = sorted[0];

        for (var i = 1; i < sorted.Count; i++)
        {
            if (sorted[i] - sectionEnd <= BlackFrameGroupGapSeconds)
            {
                sectionEnd = sorted[i];
            }
            else
            {
                sections.Add(new TimeSection(sectionStart, sectionEnd));
                sectionStart = sorted[i];
                sectionEnd = sorted[i];
            }
        }
        sections.Add(new TimeSection(sectionStart, sectionEnd));
        return sections;
    }

    private readonly record struct TimeSection(double Start, double End)
    {
        public double Length => End - Start;
    }
}

/// <summary>Shared search bounds for all Tier-3 skip signals.</summary>
public static class SkipSignalBoundingWindow
{
    public sealed record Window(
        double IntroSearchMax,
        double OutroSearchMin,
        double MinSegmentLength,
        double MaxIntroLength,
        double MaxOutroLength,
        double MaxIntroStartSeconds);

    public static Window ForRuntime(double totalRuntimeSeconds) => new(
        IntroSearchMax: Math.Min(totalRuntimeSeconds * 0.25, 600),
        OutroSearchMin: Math.Max(totalRuntimeSeconds * 0.80, totalRuntimeSeconds - 480),
        MinSegmentLength: 15.0,
        MaxIntroLength: 180.0,
        MaxOutroLength: 300.0,
        MaxIntroStartSeconds: 150.0);

    public static bool ValidateIntro(double start, double end, double totalRuntimeSeconds)
    {
        var bounds = ForRuntime(totalRuntimeSeconds);
        var length = end - start;
        return start <= bounds.MaxIntroStartSeconds
               && end <= bounds.IntroSearchMax
               && length >= bounds.MinSegmentLength
               && length <= bounds.MaxIntroLength;
    }

    public static bool ValidateOutro(double start, double end, double totalRuntimeSeconds)
    {
        var bounds = ForRuntime(totalRuntimeSeconds);
        var length = end - start;
        return start >= bounds.OutroSearchMin
               && length >= bounds.MinSegmentLength
               && length <= bounds.MaxOutroLength;
    }
}
