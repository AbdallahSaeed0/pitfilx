using System.Diagnostics;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Pitflix.API.Services;

/// <summary>
/// Reads embedded chapters from a media file via ffprobe and applies heuristic
/// intro/outro windows when chapter titles are absent or ambiguous.
/// </summary>
public static class ChapterDetectorService
{
    private static readonly object FfprobeLock = new();
    private static string? _ffprobePath;
    private static string? _ffmpegPath;

    // ── ffprobe resolver ─────────────────────────────────────────────────────

    public static string? ResolveFfprobe()
    {
        lock (FfprobeLock)
        {
            if (_ffprobePath != null)
                return _ffprobePath;

            // 1) Bundled next to the API executable (same folder as ffmpeg).
            var baseDir = AppContext.BaseDirectory;
            var bundled = Path.Combine(baseDir, "ffprobe.exe");
            if (File.Exists(bundled)) { _ffprobePath = bundled; return _ffprobePath; }

            // 2) PATH lookup on Windows.
            var where = RunWhere("ffprobe");
            if (where != null && File.Exists(where)) { _ffprobePath = where; return _ffprobePath; }

            // 3) ffprobe lives beside ffmpeg — check same folder.
            var ffmpegDir = Path.GetDirectoryName(TryWhich("ffmpeg"));
            if (ffmpegDir != null)
            {
                var beside = Path.Combine(ffmpegDir, "ffprobe.exe");
                if (File.Exists(beside)) { _ffprobePath = beside; return _ffprobePath; }
            }

            return null;
        }
    }

    /// <summary>
    /// Resolves ffmpeg.exe itself — used by <c>AudioFingerprintService</c> (Group 2c) to extract raw
    /// PCM for cross-episode correlation. Unlike ffprobe, nothing in this codebase shelled out to
    /// ffmpeg before this feature, so on a machine where it's missing this returns null and the
    /// fingerprint job logs a one-time warning and backs off — it does not bundle a binary.
    /// </summary>
    public static string? ResolveFfmpeg()
    {
        lock (FfprobeLock)
        {
            if (_ffmpegPath != null)
                return _ffmpegPath;

            var baseDir = AppContext.BaseDirectory;
            var bundled = Path.Combine(baseDir, "ffmpeg.exe");
            if (File.Exists(bundled)) { _ffmpegPath = bundled; return _ffmpegPath; }

            var where = RunWhere("ffmpeg");
            if (where != null && File.Exists(where)) { _ffmpegPath = where; return _ffmpegPath; }

            return null;
        }
    }

    /// <summary>Quick ffprobe duration lookup for a single file — used to resolve a
    /// fingerprint-sourced outro window (stored as seconds-before-end) to an absolute
    /// timestamp for a specific episode whose duration isn't in WatchHistory yet (i.e. it's
    /// never been played). Returns null on any failure; never throws.</summary>
    public static async Task<double?> GetDurationSecondsAsync(string filePath, CancellationToken ct = default)
    {
        var ffprobe = ResolveFfprobe();
        if (ffprobe == null || !File.Exists(filePath))
            return null;

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(10));

            var psi = new ProcessStartInfo(ffprobe,
                $"-v quiet -show_entries format=duration -of csv=p=0 \"{filePath}\"")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var proc = new Process { StartInfo = psi };
            proc.Start();
            var output = await proc.StandardOutput.ReadToEndAsync(cts.Token).ConfigureAwait(false);
            await proc.WaitForExitAsync(cts.Token).ConfigureAwait(false);

            return double.TryParse(output.Trim(), System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out var seconds) && seconds > 0
                ? seconds
                : null;
        }
        catch
        {
            return null;
        }
    }

    private static string? RunWhere(string name)
    {
        try
        {
            using var proc = Process.Start(new ProcessStartInfo("where", name)
            {
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            });
            var line = proc?.StandardOutput.ReadLine()?.Trim();
            proc?.WaitForExit(3000);
            return string.IsNullOrEmpty(line) ? null : line;
        }
        catch { return null; }
    }

    private static string? TryWhich(string name)
    {
        try
        {
            using var proc = Process.Start(new ProcessStartInfo("where", name)
            {
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            });
            var line = proc?.StandardOutput.ReadLine()?.Trim();
            proc?.WaitForExit(3000);
            return string.IsNullOrEmpty(line) ? null : line;
        }
        catch { return null; }
    }

    // ── Embedded-chapter reading ─────────────────────────────────────────────

    public record ChapterInfo(int Id, string? Title, double StartSec, double EndSec);

    public record ChapterResult(
        IReadOnlyList<ChapterInfo> Chapters,
        double? IntroEnd,    // seconds from start where intro ends
        double? OutroStart,  // seconds from start where credits begin
        string Source        // "ffprobe_chapters" | "heuristic" | "none"
    );

    /// <summary>
    /// Reads chapters from <paramref name="filePath"/> and derives intro/outro windows.
    /// Never throws — returns an empty result on any error.
    /// </summary>
    public static async Task<ChapterResult> DetectAsync(
        string filePath,
        string? mediaType,   // "Movie" | "Series" | null
        double? durationHint,
        ILogger? log = null,
        CancellationToken ct = default)
    {
        List<ChapterInfo> chapters = [];
        string source = "none";

        var ffprobe = ResolveFfprobe();
        if (ffprobe != null && File.Exists(filePath))
        {
            chapters = await ReadFfprobeChaptersAsync(ffprobe, filePath, log, ct).ConfigureAwait(false);
            if (chapters.Count > 0)
                source = "ffprobe_chapters";
        }

        var dur = durationHint ?? (chapters.Count > 0 ? chapters[^1].EndSec : 0.0);

        // ── Derive intro/outro from chapter titles ─────────────────────────
        double? introEnd = null;
        double? outroStart = null;

        if (chapters.Count > 0)
        {
            // Look for chapter named "intro", "opening", "op", "cold open", "recap"
            var introCh = chapters.FirstOrDefault(c =>
                IsIntroChapter(c.Title));
            if (introCh != null)
                introEnd = introCh.EndSec;

            // Look for chapter named "credits", "outro", "ed", "ending", "preview"
            var outroCh = chapters.FirstOrDefault(c =>
                IsOutroChapter(c.Title));
            if (outroCh != null)
                outroStart = outroCh.StartSec;
        }

        // ── Heuristic fallback ────────────────────────────────────────────
        bool isSeries = string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase)
                     || string.Equals(mediaType, "TV", StringComparison.OrdinalIgnoreCase);

        if (dur > 180)
        {
            // Intro: only for series/short episodes, not for movies
            if (introEnd == null && isSeries && dur < 3600)
            {
                // Standard anime/TV episode intro runs 60-90s
                introEnd = Math.Min(90.0, dur * 0.18);
                source = chapters.Count > 0 ? "ffprobe_chapters+heuristic" : "heuristic";
            }

            // Outro: all content with credits
            if (outroStart == null && dur > 300)
            {
                var creditsSec = isSeries ? 90.0 : 180.0;
                outroStart = Math.Max(dur - creditsSec, dur * 0.85);
                if (source == "none") source = "heuristic";
                else if (!source.EndsWith("heuristic")) source += "+heuristic";
            }
        }

        return new ChapterResult(chapters, introEnd, outroStart, source);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    public static bool IsIntroChapter(string? title)
    {
        if (string.IsNullOrWhiteSpace(title)) return false;
        var t = title.Trim().ToLowerInvariant();
        return t is "intro" or "opening" or "op" or "cold open" or "teaser"
            or "recap" or "previously" or "cold_open";
    }

    public static bool IsOutroChapter(string? title)
    {
        if (string.IsNullOrWhiteSpace(title)) return false;
        var t = title.Trim().ToLowerInvariant();
        return t is "credits" or "end credits" or "outro" or "ed" or "ending"
            or "preview" or "next episode" or "next ep" or "post-credits";
    }

    private static async Task<List<ChapterInfo>> ReadFfprobeChaptersAsync(
        string ffprobe,
        string filePath,
        ILogger? log,
        CancellationToken ct)
    {
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(15));

            var psi = new ProcessStartInfo(ffprobe,
                $"-v quiet -print_format json -show_chapters \"{filePath}\"")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var proc = new Process { StartInfo = psi };
            proc.Start();

            var json = await proc.StandardOutput.ReadToEndAsync(cts.Token).ConfigureAwait(false);
            await proc.WaitForExitAsync(cts.Token).ConfigureAwait(false);

            if (string.IsNullOrWhiteSpace(json))
                return [];

            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("chapters", out var arr))
                return [];

            var result = new List<ChapterInfo>();
            int idx = 0;
            foreach (var ch in arr.EnumerateArray())
            {
                var id = ch.TryGetProperty("id", out var idP) ? idP.GetInt32() : idx;
                var startSec = ch.TryGetProperty("start_time", out var st)
                    ? double.TryParse(st.GetString(), System.Globalization.NumberStyles.Any,
                        System.Globalization.CultureInfo.InvariantCulture, out var sv) ? sv : 0.0
                    : 0.0;
                var endSec = ch.TryGetProperty("end_time", out var et)
                    ? double.TryParse(et.GetString(), System.Globalization.NumberStyles.Any,
                        System.Globalization.CultureInfo.InvariantCulture, out var ev) ? ev : 0.0
                    : 0.0;
                string? title = null;
                if (ch.TryGetProperty("tags", out var tags) &&
                    tags.TryGetProperty("title", out var titleP))
                    title = titleP.GetString();

                result.Add(new ChapterInfo(id, title, startSec, endSec));
                idx++;
            }

            return result;
        }
        catch (Exception ex)
        {
            log?.LogDebug(ex, "ffprobe chapter read failed for {File}", filePath);
            return [];
        }
    }
}
