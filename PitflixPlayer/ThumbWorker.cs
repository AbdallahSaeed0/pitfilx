using System.Windows.Media.Imaging;

namespace PitflixPlayer;

/// <summary>
/// App-lifetime background thumbnail generator.
///
/// Replaces the old per-file <c>ThumbServer</c>, which spawned and killed a
/// warm mpv + ffmpeg for every file and tore them down on every navigation.
/// On HDD media that process churn (and the synchronous Process.Kill it did on
/// the WPF UI thread) kept wedging the player — frozen controls, dead playlist
/// switches.  This worker is deliberately decoupled from the playback session:
///
///   • ONE ffmpeg keyframe scan at a time, on a background thread.
///   • Never killed or restarted by navigation — navigation does ZERO
///     thumbnail work, so it can never block the UI thread or the player.
///   • Only scans the file the user has SETTLED on (~3 s), so rapidly skipping
///     through a folder spawns nothing.
///   • Each file is scanned at most once ever (a <c>.done</c> marker); after
///     that, hover previews are instant from the on-disk cache, forever.
///   • No warm mpv.  Hover reads the shared cache only; a never-seen file simply
///     shows no preview until its one-time scan finishes (a few seconds).
/// </summary>
internal static class ThumbWorker
{
    private const int Step      = 5;       // cache bucket granularity (seconds)
    private const int PixelSize = 160;     // matches the hover tooltip width

    private static readonly object _gate = new();
    private static string? _target;        // the file we want scanned next
    private static int     _gen;           // bumped whenever the target changes
    private static bool    _running;

    public static int BucketFor(double seconds)
    {
        int b = (int)Math.Round(seconds / Step) * Step;
        return b < 0 ? 0 : b;
    }

    /// <summary>Note the currently-playing file as the scan target.  Cheap and
    /// non-blocking — safe to call on the UI thread for every file change /
    /// navigation.  No-op if the file was already fully scanned.</summary>
    public static void NoteCurrentFile(string? filePath, double durationSeconds)
    {
        if (string.IsNullOrEmpty(filePath)) return;
        try { if (System.IO.File.Exists(ShellThumbnail.BulkDoneMarkerPath(filePath))) return; }
        catch { }

        lock (_gate)
        {
            _target = filePath;
            _gen++;
            if (_running) return;
            _running = true;
        }
        _ = System.Threading.Tasks.Task.Run(LoopAsync);
    }

    private static async System.Threading.Tasks.Task LoopAsync()
    {
        while (true)
        {
            string path;
            int gen;
            lock (_gate)
            {
                if (_target is null) { _running = false; return; }
                path = _target;
                gen  = _gen;
            }

            // Settle delay: don't touch the disk until the user has stayed on
            // this file a moment.  If they navigate again the target changes
            // (gen bumps) and we restart with the new file — so rapid folder
            // browsing never triggers a scan and never competes with the
            // player's file loads.
            await System.Threading.Tasks.Task.Delay(3000).ConfigureAwait(false);

            bool stillCurrent;
            lock (_gate) stillCurrent = (gen == _gen);
            if (!stillCurrent) continue;     // superseded — loop for the new target

            try { ScanFile(path, gen); }
            catch (Exception ex) { App.Log($"ThumbWorker: scan failed: {ex.Message}"); }

            lock (_gate)
            {
                if (gen == _gen) { _target = null; _running = false; return; }
                // else: target changed during the scan → loop for the new one
            }
        }
    }

    /// <summary>Nearest cached frame to <paramref name="seconds"/> (within
    /// <paramref name="radiusBuckets"/>), else null.  Pure disk read.</summary>
    public static BitmapSource? TryGetFrameNear(string? filePath, double seconds, int radiusBuckets = 8)
    {
        if (string.IsNullOrEmpty(filePath)) return null;
        int center = BucketFor(seconds);
        for (int r = 0; r <= radiusBuckets; r++)
        {
            for (int sign = 1; sign >= -1; sign -= 2)
            {
                int b = center + sign * r * Step;
                if (b >= 0)
                {
                    try
                    {
                        string p = ShellThumbnail.FrameCachePath(filePath, b);
                        if (System.IO.File.Exists(p) && new System.IO.FileInfo(p).Length > 0)
                            return ShellThumbnail.LoadFrozenBitmapPublic(p);
                    }
                    catch { }
                }
                if (r == 0) break;
            }
        }
        return null;
    }

    // ── ffmpeg keyframe scan (one pass, whole file) ──────────────────────────
    private static void ScanFile(string filePath, int gen)
    {
        string doneMarker = ShellThumbnail.BulkDoneMarkerPath(filePath);
        if (System.IO.File.Exists(doneMarker)) return;

        string? ffmpeg = FindFfmpegExe();
        if (ffmpeg is null) { App.Log("ThumbWorker: ffmpeg not found — no previews"); return; }

        System.IO.Directory.CreateDirectory(ShellThumbnail._cacheDir);
        string tmp = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "pf-thumbgen-" + Guid.NewGuid().ToString("N"));
        try
        {
            System.IO.Directory.CreateDirectory(tmp);

            var psi = new System.Diagnostics.ProcessStartInfo(ffmpeg)
            {
                UseShellExecute        = false,
                CreateNoWindow         = true,
                RedirectStandardOutput = true,
                RedirectStandardError  = true,
            };
            psi.ArgumentList.Add("-hide_banner");
            psi.ArgumentList.Add("-skip_frame"); psi.ArgumentList.Add("nokey");  // keyframes only → fast
            psi.ArgumentList.Add("-i");          psi.ArgumentList.Add(filePath);
            psi.ArgumentList.Add("-an");         psi.ArgumentList.Add("-sn");
            psi.ArgumentList.Add("-vsync");      psi.ArgumentList.Add("0");
            psi.ArgumentList.Add("-vf");         psi.ArgumentList.Add($"scale={PixelSize}:-2,showinfo");
            psi.ArgumentList.Add("-qscale:v");   psi.ArgumentList.Add("5");
            psi.ArgumentList.Add(System.IO.Path.Combine(tmp, "kf_%05d.jpg"));

            using var p = System.Diagnostics.Process.Start(psi);
            if (p is null) return;
            try { p.PriorityClass = System.Diagnostics.ProcessPriorityClass.BelowNormal; } catch { }

            var errTask = p.StandardError.ReadToEndAsync();
            _ = p.StandardOutput.ReadToEndAsync();

            // Wait for ffmpeg, but bail (kill it) the moment the user navigates
            // away from this file — frees the disk for the new file's load.
            // This runs on the worker's BACKGROUND thread, so the kill never
            // touches the UI thread.  An aborted scan writes no marker, so the
            // file is simply re-scanned next time it's settled on.
            bool completed = false;
            var deadline = DateTime.UtcNow.AddMilliseconds(180000);
            while (true)
            {
                if (p.WaitForExit(250)) { completed = true; break; }
                bool superseded;
                lock (_gate) superseded = (gen != _gen);
                if (superseded || DateTime.UtcNow > deadline)
                {
                    try { p.Kill(entireProcessTree: true); } catch { }
                    App.Log($"ThumbWorker: scan of '{System.IO.Path.GetFileName(filePath)}' aborted (navigated away)");
                    return;   // no marker → re-scan next visit
                }
            }
            string stderr;
            try { stderr = errTask.GetAwaiter().GetResult(); } catch { stderr = ""; }

            int moved = 0;
            foreach (var raw in stderr.Split('\n'))
            {
                if (raw.IndexOf("pts_time:", StringComparison.Ordinal) < 0) continue;
                var mN = System.Text.RegularExpressions.Regex.Match(raw, @"\bn:\s*(\d+)");
                var mT = System.Text.RegularExpressions.Regex.Match(raw, @"pts_time:\s*([0-9.]+)");
                if (!mN.Success || !mT.Success) continue;
                if (!int.TryParse(mN.Groups[1].Value, out int n)) continue;
                if (!double.TryParse(mT.Groups[1].Value,
                        System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture, out double t)) continue;

                string src = System.IO.Path.Combine(tmp, $"kf_{(n + 1):00000}.jpg");
                if (!System.IO.File.Exists(src)) continue;

                string dst = ShellThumbnail.FrameCachePath(filePath, BucketFor(t));
                try
                {
                    if (System.IO.File.Exists(dst)) System.IO.File.Delete(src);
                    else { System.IO.File.Move(src, dst); moved++; }
                }
                catch { }
            }

            App.Log($"ThumbWorker: scanned '{System.IO.Path.GetFileName(filePath)}' → {moved} new frames");
            if (completed)
            {
                try { System.IO.File.WriteAllText(doneMarker, DateTime.UtcNow.ToString("o")); } catch { }
            }
        }
        finally
        {
            try { System.IO.Directory.Delete(tmp, recursive: true); } catch { }
        }
    }

    private static string? FindFfmpegExe()
    {
        try
        {
            var paths = Environment.GetEnvironmentVariable("PATH")?.Split(';') ?? Array.Empty<string>();
            foreach (var dir in paths)
            {
                if (string.IsNullOrWhiteSpace(dir)) continue;
                try
                {
                    var c = System.IO.Path.Combine(dir, "ffmpeg.exe");
                    if (System.IO.File.Exists(c)) return c;
                }
                catch { }
            }
        }
        catch { }
        try
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var c = System.IO.Path.Combine(local, "Microsoft", "WinGet", "Links", "ffmpeg.exe");
            if (System.IO.File.Exists(c)) return c;
        }
        catch { }
        return null;
    }
}
