using System.Diagnostics;
using System.Globalization;
using Pitflix.API.Services;

namespace Pitflix.API.Services.Browse;

/// <summary>
/// Downloads a single image/video URL surfaced by the Browse tab's download overlay.
/// Isolated from the existing torrent/direct-download infrastructure (WatchSoMuch/YTS/PSA/
/// Pirate Bay/Akwam) — this is a much simpler "grab this one file" path, with its own
/// lightweight progress/cancel job tracking (<see cref="BrowseDownloadJobTracker"/>) and no
/// shared state with the rest of the app.
///
/// Every request — image, direct video, or HLS — runs as a background job and the initial
/// call returns immediately; the frontend polls for progress and can cancel mid-flight.
///
/// <c>type: "hls"</c> requests remux via ffmpeg instead of a plain HTTP GET — see
/// <see cref="StartHlsDownload"/>. This reuses <c>ChapterDetectorService.ResolveFfmpeg()</c> /
/// <c>ResolveFfprobe()</c> to locate the binaries (the one intentional touch-point with existing
/// ffmpeg usage elsewhere in Pitflix.API — intro/outro detection and subtitle generation are
/// otherwise untouched) but owns its own process-invocation and job-tracking code.
/// </summary>
public sealed class BrowseDownloadService
{
    private static readonly HttpClient Http = CreateSharedClient();
    private readonly BrowseSettingsStore _settings;
    private readonly BrowseDownloadJobTracker _jobs;

    public BrowseDownloadService(BrowseSettingsStore settings, BrowseDownloadJobTracker jobs)
    {
        _settings = settings;
        _jobs = jobs;
    }

    private static HttpClient CreateSharedClient()
    {
        var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        http.DefaultRequestHeaders.UserAgent.ParseAdd(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Pitflix/1.0");
        return http;
    }

    public Task<BrowseDownloadResult> DownloadAsync(BrowseDownloadRequest request, CancellationToken ct)
    {
        if (string.Equals(request.Type, "hls", StringComparison.OrdinalIgnoreCase))
            return Task.FromResult(StartHlsDownload(request));

        return Task.FromResult(StartDirectDownload(request));
    }

    // ── direct image/video download ──────────────────────────────────────────

    private BrowseDownloadResult StartDirectDownload(BrowseDownloadRequest request)
    {
        var url = request.Url?.Trim();
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            return new BrowseDownloadResult(false);

        var (jobId, token) = _jobs.CreateJob();
        var mediaType = request.Type;
        var pageUrl = request.PageUrl;

        _ = Task.Run(() => RunDirectDownloadAsync(jobId, uri, mediaType, pageUrl, token));

        return new BrowseDownloadResult(true, Pending: true, JobId: jobId);
    }

    private async Task RunDirectDownloadAsync(string jobId, Uri uri, string? mediaType, string? pageUrl,
        CancellationToken ct)
    {
        string? savedPath = null;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, uri);
            // Many hotlink-protected sites 403 without a Referer matching the page that served the media.
            if (!string.IsNullOrWhiteSpace(pageUrl) && Uri.TryCreate(pageUrl, UriKind.Absolute, out var referer))
                req.Headers.Referrer = referer;

            using var res = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct)
                .ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
            {
                _jobs.Fail(jobId, $"Server returned {(int)res.StatusCode}.");
                return;
            }

            var folder = _settings.GetDownloadPath();
            Directory.CreateDirectory(folder);

            var fileName = ResolveFileName(uri, res.Content.Headers.ContentType?.MediaType, mediaType);
            savedPath = UniquePath(Path.Combine(folder, fileName));

            var totalBytes = res.Content.Headers.ContentLength;
            await using var httpStream = await res.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            await using var fs = new FileStream(savedPath, FileMode.CreateNew, FileAccess.Write, FileShare.None);

            var buffer = new byte[81920];
            long downloaded = 0;
            var lastReport = DateTime.UtcNow;
            int read;
            while ((read = await httpStream.ReadAsync(buffer, ct).ConfigureAwait(false)) > 0)
            {
                await fs.WriteAsync(buffer.AsMemory(0, read), ct).ConfigureAwait(false);
                downloaded += read;

                var now = DateTime.UtcNow;
                if ((now - lastReport).TotalMilliseconds < 250)
                    continue;
                lastReport = now;
                double? percent = totalBytes is > 0
                    ? Math.Clamp(downloaded * 100.0 / totalBytes.Value, 0, 100)
                    : null;
                _jobs.ReportProgress(jobId, percent, downloaded, totalBytes);
            }

            _jobs.Complete(jobId, savedPath);
        }
        catch (OperationCanceledException)
        {
            TryDeletePartial(savedPath);
            _jobs.MarkCancelled(jobId);
        }
        catch (Exception ex)
        {
            TryDeletePartial(savedPath);
            _jobs.Fail(jobId, ex.Message);
        }
    }

    // ── HLS remux via ffmpeg ──────────────────────────────────────────────────

    /// <summary>Kicks off the ffmpeg remux in the background and returns immediately — remuxing
    /// a full stream can take a while and must not block the HTTP request.</summary>
    private BrowseDownloadResult StartHlsDownload(BrowseDownloadRequest request)
    {
        var manifestUrl = request.Url?.Trim();
        if (string.IsNullOrWhiteSpace(manifestUrl) ||
            !Uri.TryCreate(manifestUrl, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            return new BrowseDownloadResult(false);

        var ffmpeg = ChapterDetectorService.ResolveFfmpeg();
        if (string.IsNullOrWhiteSpace(ffmpeg))
            return new BrowseDownloadResult(false);

        var (jobId, token) = _jobs.CreateJob();
        var pageUrl = request.PageUrl;

        _ = Task.Run(() => RunHlsRemuxAsync(jobId, manifestUrl, pageUrl, ffmpeg, token));

        return new BrowseDownloadResult(true, Pending: true, JobId: jobId);
    }

    private async Task RunHlsRemuxAsync(string jobId, string manifestUrl, string? pageUrl, string ffmpeg,
        CancellationToken ct)
    {
        string? outputPath = null;
        try
        {
            var folder = _settings.GetDownloadPath();
            Directory.CreateDirectory(folder);
            var fileName = $"browse-download-{DateTime.Now:yyyyMMdd-HHmmss}.mp4";
            outputPath = UniquePath(Path.Combine(folder, fileName));

            // Many HLS-behind-a-player sites reject requests without a Referer matching the
            // page the manifest was served from. ffmpeg's -headers option wants a literal
            // trailing CRLF per header line. Strip CR/LF from the (page-controlled) referer
            // value first so it can't inject extra header lines into the ffmpeg invocation.
            var refererValue = (pageUrl ?? "").Replace("\r", "").Replace("\n", "");
            var headerArg = string.IsNullOrWhiteSpace(refererValue)
                ? ""
                : $"-headers \"Referer: {refererValue}\r\n\" ";

            // Best-effort — if this fails (protected/live manifest, ffprobe missing) progress
            // just reports as indeterminate instead of a percentage.
            var durationSeconds = await ProbeDurationSecondsAsync(manifestUrl, headerArg, ct).ConfigureAwait(false);

            // -progress pipe:1 -nostats: structured `key=value` lines on stdout instead of the
            // human-readable stats line, so progress can be parsed reliably instead of scraped
            // from ffmpeg's free-form stderr output.
            var args = $"{headerArg}-i \"{manifestUrl}\" -c copy -progress pipe:1 -nostats \"{outputPath}\"";

            var psi = new ProcessStartInfo(ffmpeg, args)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var proc = Process.Start(psi);
            if (proc == null)
            {
                _jobs.Fail(jobId, "Failed to start ffmpeg.");
                return;
            }

            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMinutes(30));
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

            var progressTask = ReadFfmpegProgressAsync(proc, jobId, durationSeconds, linked.Token);

            try
            {
                await proc.WaitForExitAsync(linked.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                TryKill(proc);
                TryDeletePartial(outputPath);
                if (ct.IsCancellationRequested)
                    _jobs.MarkCancelled(jobId);
                else
                    _jobs.Fail(jobId, "ffmpeg timed out.");
                return;
            }
            finally
            {
                await progressTask.ConfigureAwait(false);
            }

            if (proc.ExitCode == 0 && File.Exists(outputPath))
            {
                _jobs.Complete(jobId, outputPath);
            }
            else
            {
                TryDeletePartial(outputPath);
                _jobs.Fail(jobId, $"ffmpeg exited with code {proc.ExitCode}.");
            }
        }
        catch (Exception ex)
        {
            TryDeletePartial(outputPath);
            _jobs.Fail(jobId, ex.Message);
        }
    }

    private static async Task<double?> ProbeDurationSecondsAsync(string manifestUrl, string headerArg,
        CancellationToken ct)
    {
        var ffprobe = ChapterDetectorService.ResolveFfprobe();
        if (string.IsNullOrWhiteSpace(ffprobe))
            return null;

        try
        {
            var args = $"{headerArg}-v error -show_entries format=duration " +
                       $"-of default=noprint_wrappers=1:nokey=1 \"{manifestUrl}\"";
            var psi = new ProcessStartInfo(ffprobe, args)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var proc = Process.Start(psi);
            if (proc == null)
                return null;

            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

            var output = await proc.StandardOutput.ReadToEndAsync(linked.Token).ConfigureAwait(false);
            await proc.WaitForExitAsync(linked.Token).ConfigureAwait(false);

            if (double.TryParse(output.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds) &&
                seconds > 0)
                return seconds;
        }
        catch
        {
            // Best effort — progress just becomes indeterminate.
        }

        return null;
    }

    /// <summary>Reads ffmpeg's <c>-progress pipe:1</c> stdout stream line by line and reports
    /// percent-complete (against the probed duration, if any) as the job's progress. Never
    /// throws — a failure here shouldn't fail the download itself, only the progress display.</summary>
    private async Task ReadFfmpegProgressAsync(Process proc, string jobId, double? durationSeconds,
        CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var line = await proc.StandardOutput.ReadLineAsync(ct).ConfigureAwait(false);
                if (line == null)
                    break; // stdout closed — process has exited

                if (!line.StartsWith("out_time=", StringComparison.Ordinal))
                    continue;

                var value = line["out_time=".Length..];
                if (!TimeSpan.TryParse(value, CultureInfo.InvariantCulture, out var elapsed))
                    continue;

                double? percent = durationSeconds is > 0
                    ? Math.Clamp(elapsed.TotalSeconds * 100.0 / durationSeconds.Value, 0, 100)
                    : null;
                _jobs.ReportProgress(jobId, percent, null, null);
            }
        }
        catch
        {
            // Best effort — see summary above.
        }
    }

    private static void TryKill(Process proc)
    {
        try { proc.Kill(entireProcessTree: true); } catch { /* best effort */ }
    }

    private static void TryDeletePartial(string? path)
    {
        if (string.IsNullOrEmpty(path)) return;
        try { if (File.Exists(path)) File.Delete(path); } catch { /* best effort */ }
    }

    private static string ResolveFileName(Uri uri, string? contentType, string? mediaType)
    {
        var name = Path.GetFileName(uri.LocalPath);
        if (string.IsNullOrWhiteSpace(name))
            name = "download";

        var ext = Path.GetExtension(name);
        if (string.IsNullOrWhiteSpace(ext))
            ext = ExtensionForContentType(contentType, mediaType);

        var stem = string.IsNullOrWhiteSpace(ext) ? name : name[..^ext.Length];
        if (string.IsNullOrWhiteSpace(stem))
            stem = "download";

        return SanitizeFileName(stem) + ext;
    }

    private static string ExtensionForContentType(string? contentType, string? mediaType) =>
        contentType?.ToLowerInvariant() switch
        {
            "image/jpeg" => ".jpg",
            "image/png" => ".png",
            "image/gif" => ".gif",
            "image/webp" => ".webp",
            "image/bmp" => ".bmp",
            "video/mp4" => ".mp4",
            "video/webm" => ".webm",
            "video/quicktime" => ".mov",
            _ => mediaType == "video" ? ".mp4" : ".jpg",
        };

    private static string SanitizeFileName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var chars = name.Select(c => invalid.Contains(c) ? '_' : c).ToArray();
        var cleaned = new string(chars).Trim();
        return string.IsNullOrWhiteSpace(cleaned) ? "download" : cleaned;
    }

    private static string UniquePath(string path)
    {
        if (!File.Exists(path))
            return path;

        var dir = Path.GetDirectoryName(path) ?? "";
        var stem = Path.GetFileNameWithoutExtension(path);
        var ext = Path.GetExtension(path);

        for (var i = 1; i < 10_000; i++)
        {
            var candidate = Path.Combine(dir, $"{stem} ({i}){ext}");
            if (!File.Exists(candidate))
                return candidate;
        }

        return Path.Combine(dir, $"{stem} ({Guid.NewGuid():N}){ext}");
    }
}
