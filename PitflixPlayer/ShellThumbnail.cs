using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;

namespace PitflixPlayer;

/// <summary>
/// Video thumbnail extraction.  Tries Win32 Shell's IShellItemImageFactory
/// first (fast, cached) and falls back to running mpv with --vo=image so we
/// never come back empty-handed for formats Windows can't decode natively
/// (most .mkv/.ts content has no Shell thumbnail provider installed).
///
/// All returned BitmapSources are frozen → safe to assign cross-thread
/// without dispatcher marshalling.
/// </summary>
internal static class ShellThumbnail
{
    // ── P/Invoke: SHCreateItemFromParsingName ────────────────────────────────
    //
    // Correct signature: out IShellItem via the IShellItem IID, NOT the
    // factory IID.  We then QueryInterface to IShellItemImageFactory on the
    // returned item.  The previous "direct factory" version returned null
    // for nearly every call because the COM marshaller didn't know how to
    // populate the factory interface from the riid alone — silent failure
    // explains "thumbnails not showing".

    private static readonly Guid IID_IShellItem =
        new("43826d1e-e718-42ee-bc55-a1e261c37bfe");

    [ComImport]
    [Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        // (members unused; we only need to QI to IShellItemImageFactory)
    }

    [ComImport]
    [Guid("BCC18B79-BA16-442F-80C4-8A59C30C463B")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory
    {
        [PreserveSig]
        int GetImage(SIZE size, int flags, out IntPtr phbm);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SIZE { public int cx; public int cy; }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true,
               PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(
        [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
        IntPtr pbc,
        [In] ref Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    private const int SIIGBF_RESIZETOFIT   = 0x00;
    private const int SIIGBF_BIGGERSIZEOK  = 0x01;
    // SIIGBF_THUMBNAILONLY: ask Shell for an ACTUAL thumbnail, never a file
    // icon.  Without it, the Shell helpfully returns the registered handler's
    // icon (e.g. VLC's video-file icon if VLC is the default .mkv handler) —
    // which is what the user was seeing.  With this flag, Shell returns
    // failure when no real thumb exists, and we fall through to the mpv
    // extraction path which produces a frame from the actual video content.
    private const int SIIGBF_THUMBNAILONLY = 0x08;

    public static BitmapSource? Get(string filePath, int pixelSize = 256)
    {
        // Try Shell first.
        var fromShell = TryGetFromShell(filePath, pixelSize);
        if (fromShell is not null) return fromShell;

        // Fallback: spawn mpv to extract one frame.  Caches result on disk
        // so the next call is a single file read.
        return TryGetFromMpv(filePath, pixelSize);
    }

    // NOTE: timeline hover-preview frames are produced by the app-lifetime
    // ThumbWorker (background ffmpeg keyframe scan, see ThumbWorker.cs).
    // ShellThumbnail is still used for STATIC thumbnails (next-episode card,
    // playlist-popup rows) via Get() below.

    private static BitmapSource? TryGetFromShell(string filePath, int pixelSize)
    {
        IntPtr hBitmap = IntPtr.Zero;
        try
        {
            var iidItem = IID_IShellItem;
            SHCreateItemFromParsingName(filePath, IntPtr.Zero, ref iidItem,
                                        out IShellItem item);
            if (item is not IShellItemImageFactory factory) return null;

            var size = new SIZE { cx = pixelSize, cy = pixelSize };
            int hr = factory.GetImage(size, SIIGBF_THUMBNAILONLY, out hBitmap);
            if (hr != 0 || hBitmap == IntPtr.Zero) return null;

            var bs = Imaging.CreateBitmapSourceFromHBitmap(
                hBitmap, IntPtr.Zero, Int32Rect.Empty,
                BitmapSizeOptions.FromEmptyOptions());
            bs.Freeze();
            App.Log($"ShellThumbnail: Shell delivered {bs.PixelWidth}×{bs.PixelHeight} for {System.IO.Path.GetFileName(filePath)}");
            return bs;
        }
        catch (Exception ex)
        {
            App.Log($"ShellThumbnail: Shell failed for '{filePath}': {ex.Message}");
            return null;
        }
        finally
        {
            if (hBitmap != IntPtr.Zero) DeleteObject(hBitmap);
        }
    }

    // ── mpv fallback (works for ANY format mpv can decode) ───────────────────
    //
    // Many video formats (esp. modern x265 .mkv) have no registered Windows
    // thumbnail provider, so the Shell path returns the generic file icon
    // (or nothing).  Asking mpv to render a single frame guarantees we get
    // an actual video frame for anything mpv can play.  Cached on disk under
    // %LOCALAPPDATA%\PitflixPlayer\thumbs\<hash>.jpg keyed by full path so
    // we only pay this cost once per file ever.

    internal static readonly string _cacheDir = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PitflixPlayer", "thumbs");

    /// <summary>Shared cache-key helper so ThumbServer and ShellThumbnail
    /// agree on the on-disk filename for a (file, second-bucket) pair.</summary>
    internal static string FrameCachePath(string filePath, int bucketSeconds) =>
        System.IO.Path.Combine(_cacheDir, HashPath(filePath) + "_" + bucketSeconds + ".jpg");

    internal static BitmapSource? LoadFrozenBitmapPublic(string path) => LoadFrozenBitmap(path);

    internal static string? FindMpvExePublic() => FindMpvExe();

    /// <summary>Marker written once a file's whole-timeline ffmpeg bulk scan
    /// has completed, so later sessions skip the (disk-heavy) scan entirely.</summary>
    internal static string BulkDoneMarkerPath(string filePath) =>
        System.IO.Path.Combine(_cacheDir, HashPath(filePath) + ".done");

    /// <summary>
    /// Path to a tiny Lua script we drop in temp on first call.  mpv runs
    /// it via --script.  The script does the bare minimum: on file-loaded,
    /// snap a screenshot, write it to the path passed via --script-opts,
    /// then quit.  Far more reliable than encoding mode (--o=, --of=, etc.)
    /// across mpv builds because every modern mpv supports the screenshot-
    /// to-file IPC command.
    /// </summary>
    private static readonly Lazy<string?> _thumbScriptPath = new(() =>
    {
        try
        {
            string dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "PitflixPlayer");
            System.IO.Directory.CreateDirectory(dir);
            string path = System.IO.Path.Combine(dir, "pf_thumb.lua");
            // Re-write every startup so a stale broken copy from a previous
            // version is overwritten.  Tiny file (<1 KB).
            // `file-loaded` fires as soon as the header is parsed — at that
            // point mpv usually hasn't decoded a video frame yet, so
            // screenshot-to-file silently produces nothing (the intermittent
            // "script attempt failed" / empty-file results in the log).
            // `playback-restart` fires once the first frame is actually
            // ready for display, so the screenshot has something to grab.
            // `mp.add_timeout` is a safety net in case playback-restart never
            // fires (e.g. audio-only or broken streams).
            System.IO.File.WriteAllText(path,
                "local taken = false\n" +
                "local function take_shot()\n" +
                "    if taken then return end\n" +
                "    taken = true\n" +
                "    local out = mp.get_opt('pf-thumb-path')\n" +
                "    if not out then mp.commandv('quit'); return end\n" +
                "    -- `video` = bare frame (no OSD/subs), which is what we want.\n" +
                "    mp.commandv('screenshot-to-file', out, 'video')\n" +
                "    mp.commandv('quit')\n" +
                "end\n" +
                "mp.register_event('file-loaded', function()\n" +
                "    mp.set_property('pause', 'yes')\n" +
                "end)\n" +
                "mp.register_event('playback-restart', take_shot)\n" +
                "mp.add_timeout(2, take_shot)\n");
            return path;
        }
        catch { return null; }
    });

    private static BitmapSource? TryGetFromMpv(string filePath, int pixelSize)
    {
        try
        {
            System.IO.Directory.CreateDirectory(_cacheDir);
            string cacheKey  = HashPath(filePath);
            string cachePath = System.IO.Path.Combine(_cacheDir, cacheKey + ".jpg");

            // Cache hit — read & return.
            if (System.IO.File.Exists(cachePath))
                return LoadFrozenBitmap(cachePath);

            // Locate mpv.exe — the Tauri target/debug dir is the canonical home;
            // try a couple of common alternatives just in case.
            string? mpvExe = FindMpvExe();
            if (mpvExe is null) { App.Log("ShellThumbnail: mpv.exe not found, skipping fallback"); return null; }

            // Use the screenshot-via-Lua-script approach FIRST — it's the
            // most reliable across mpv builds because `screenshot-to-file`
            // is a core IPC command every modern mpv supports.
            string? scriptPath = _thumbScriptPath.Value;
            if (scriptPath is not null && System.IO.File.Exists(scriptPath))
            {
                var spsi = new System.Diagnostics.ProcessStartInfo(mpvExe)
                {
                    UseShellExecute        = false,
                    CreateNoWindow         = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError  = true,
                };
                spsi.ArgumentList.Add("--no-config");
                spsi.ArgumentList.Add("--no-audio");
                spsi.ArgumentList.Add("--no-sub");
                spsi.ArgumentList.Add("--vo=null");          // headless decode
                spsi.ArgumentList.Add("--start=120");
                spsi.ArgumentList.Add("--keep-open=no");
                spsi.ArgumentList.Add($"--script={scriptPath}");
                spsi.ArgumentList.Add($"--script-opts=pf-thumb-path={cachePath}");
                spsi.ArgumentList.Add(filePath);
                App.Log($"ShellThumbnail: invoking screenshot-script for '{System.IO.Path.GetFileName(filePath)}'");

                using var sp = System.Diagnostics.Process.Start(spsi);
                if (sp is not null)
                {
                    var sErrTask = sp.StandardError.ReadToEndAsync();
                    if (!sp.WaitForExit(10000)) { try { sp.Kill(); } catch { } }

                    if (System.IO.File.Exists(cachePath) &&
                        new System.IO.FileInfo(cachePath).Length > 0)
                    {
                        App.Log($"ShellThumbnail: screenshot-script SUCCESS for {System.IO.Path.GetFileName(filePath)}");
                        return LoadFrozenBitmap(cachePath);
                    }
                    string sErr;
                    try { sErr = sErrTask.Result; } catch { sErr = "(unavailable)"; }
                    App.Log($"ShellThumbnail: script attempt failed (exit={sp.ExitCode}); stderr: {sErr.Substring(0, Math.Min(400, sErr.Length))}");
                    if (System.IO.File.Exists(cachePath))
                    {
                        try { System.IO.File.Delete(cachePath); } catch { }
                    }
                }
            }

            // mpv command — uses mpv's ENCODING mode (--o triggers it),
            // which is the documented way to do "extract one frame to a
            // file" headlessly.  The previous attempt mixed --vo=image with
            // --o=, which mpv treats as conflicting modes — it picked one,
            // ignored the rest, and produced either nothing or a 1×1 black
            // frame (exactly the "thumbnails are just black" symptom).
            //
            //   --no-config         : ignore user mpv.conf so personal
            //                         configs don't break us
            //   --no-audio          : skip audio decode
            //   --no-sub            : skip subtitle overlay
            //   --frames=1          : encode exactly one frame and exit
            //   --start=00:01:30    : ABSOLUTE 90 s in, past most cold opens
            //                         /studio logos / black fades.  Falls
            //                         back to the file's start if the file
            //                         is shorter than 90 s (mpv handles it).
            //   --vf=scale=W:-2     : resize keeping aspect (-2 forces even
            //                         height for the JPEG encoder)
            //   --of=mjpeg          : output container = mjpeg
            //   --ovc=mjpeg         : video codec = mjpeg
            //   --o=<path>          : output file path
            var psi = new System.Diagnostics.ProcessStartInfo(mpvExe)
            {
                UseShellExecute        = false,
                CreateNoWindow         = true,
                RedirectStandardOutput = true,
                RedirectStandardError  = true,
            };
            // ── Multi-attempt strategy ──────────────────────────────────────
            // Different mpv builds support different headless-frame-extract
            // flag combos.  Try the most-reliable first (--vo=image), fall
            // back to encoding mode with explicit container+codec if the
            // first attempt produces nothing.  Log the failure stderr from
            // each so we can see exactly which command line your mpv hated.

            string tempOutDir = System.IO.Path.Combine(System.IO.Path.GetTempPath(),
                "PitflixPlayer-thumb-" + Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(tempOutDir);

            // Attempt 1: encoding mode with explicit --of=image2 --ovc=mjpeg.
            // This is the documented "write a single frame to a file"
            // recipe and works on any mpv build with ffmpeg/MJPEG support.
            psi.ArgumentList.Add("--no-config");
            psi.ArgumentList.Add("--no-audio");
            psi.ArgumentList.Add("--no-sub");
            psi.ArgumentList.Add("--quiet");
            psi.ArgumentList.Add("--no-resume-playback");
            psi.ArgumentList.Add("--frames=1");
            psi.ArgumentList.Add("--start=120");
            psi.ArgumentList.Add($"--vf-add=scale={pixelSize}:-2");
            psi.ArgumentList.Add("--of=image2");
            psi.ArgumentList.Add("--ovc=mjpeg");
            psi.ArgumentList.Add($"--o={cachePath}");
            psi.ArgumentList.Add(filePath);

            // Log the exact mpv command so we can reproduce it manually if
            // something goes wrong.  Strips file paths to base names for
            // log brevity.
            App.Log($"ShellThumbnail: invoking {System.IO.Path.GetFileName(mpvExe)} " +
                    string.Join(" ", psi.ArgumentList));

            using var proc = System.Diagnostics.Process.Start(psi);
            if (proc is null) return null;

            // Read stderr/stdout so we can surface the actual failure in
            // App.Log if mpv doesn't produce output.  Read concurrently
            // with WaitForExit to avoid pipe-full deadlocks on big logs.
            var stderrTask = proc.StandardError.ReadToEndAsync();
            var stdoutTask = proc.StandardOutput.ReadToEndAsync();

            // 10 s timeout — a 1080p .mkv decode + seek can take several
            // seconds on a cold-cache hit; the previous 5 s was hitting
            // close to the cap and the resulting kill produced empty output.
            if (!proc.WaitForExit(10000))
            {
                try { proc.Kill(); } catch { }
                App.Log($"ShellThumbnail: mpv timed out for '{filePath}'");
                return null;
            }

            // Encoding mode writes DIRECTLY to cachePath — no temp-dir lookup
            // needed for attempt 1.  Some mpv builds create the file but
            // write 0 bytes on encoder error, so check size > 0 too.
            bool attempt1Ok = System.IO.File.Exists(cachePath) &&
                              new System.IO.FileInfo(cachePath).Length > 0;
            if (!attempt1Ok && System.IO.File.Exists(cachePath))
            {
                try { System.IO.File.Delete(cachePath); } catch { }
            }
            if (!attempt1Ok)
            {
                string stderr1;
                try { stderr1 = stderrTask.Result; } catch { stderr1 = "(unavailable)"; }
                App.Log($"ShellThumbnail: encoding-mode attempt failed for '{System.IO.Path.GetFileName(filePath)}' " +
                        $"(exit={proc.ExitCode}); stderr: {stderr1.Substring(0, Math.Min(400, stderr1.Length))}");

                // ── Attempt 2: --vo=image ─────────────────────────────────
                // Older mpv builds that don't accept --of=image2/--ovc=mjpeg
                // usually still ship the image VO.  Frame is dumped as
                // <tempOutDir>/THUMB.jpg (or .jpeg).
                var psi2 = new System.Diagnostics.ProcessStartInfo(mpvExe)
                {
                    UseShellExecute        = false,
                    CreateNoWindow         = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError  = true,
                };
                psi2.ArgumentList.Add("--no-config");
                psi2.ArgumentList.Add("--no-audio");
                psi2.ArgumentList.Add("--no-sub");
                psi2.ArgumentList.Add("--quiet");
                psi2.ArgumentList.Add("--vo=image");
                psi2.ArgumentList.Add("--vo-image-format=jpg");
                psi2.ArgumentList.Add($"--vo-image-outdir={tempOutDir}");
                psi2.ArgumentList.Add("--vo-image-template=THUMB");
                psi2.ArgumentList.Add("--vo-image-jpeg-quality=85");
                psi2.ArgumentList.Add("--frames=1");
                psi2.ArgumentList.Add("--start=120");
                psi2.ArgumentList.Add($"--vf-add=scale={pixelSize}:-2");
                psi2.ArgumentList.Add(filePath);
                App.Log($"ShellThumbnail: trying --vo=image fallback for '{System.IO.Path.GetFileName(filePath)}'");

                using var proc2 = System.Diagnostics.Process.Start(psi2);
                if (proc2 is not null)
                {
                    var err2Task = proc2.StandardError.ReadToEndAsync();
                    var out2Task = proc2.StandardOutput.ReadToEndAsync();
                    if (!proc2.WaitForExit(10000))
                    {
                        try { proc2.Kill(); } catch { }
                    }

                    // Take any file mpv emitted in the temp dir.  Lenient
                    // match (StartsWith) handles "THUMB.jpg", "THUMB-0001.jpg",
                    // "THUMB-000001.jpg" — different mpv builds vary.
                    string? produced = null;
                    try
                    {
                        foreach (var f in System.IO.Directory.EnumerateFiles(tempOutDir))
                        {
                            if (System.IO.Path.GetFileName(f).StartsWith("THUMB", StringComparison.OrdinalIgnoreCase))
                            { produced = f; break; }
                        }
                    }
                    catch { }

                    if (produced is not null && System.IO.File.Exists(produced))
                    {
                        try
                        {
                            if (System.IO.File.Exists(cachePath)) System.IO.File.Delete(cachePath);
                            System.IO.File.Move(produced, cachePath);
                        }
                        catch (Exception mvEx) { App.Log($"ShellThumbnail: move failed: {mvEx.Message}"); }
                    }
                    else
                    {
                        string err2;
                        try { err2 = err2Task.Result; } catch { err2 = "(unavailable)"; }
                        App.Log($"ShellThumbnail: --vo=image attempt also failed (exit={proc2.ExitCode}); stderr: {err2.Substring(0, Math.Min(400, err2.Length))}");
                    }
                }
            }

            // Cleanup temp dir regardless of outcome.
            try { System.IO.Directory.Delete(tempOutDir, recursive: true); } catch { }

            // Final validation: file must exist AND be non-empty.
            if (!System.IO.File.Exists(cachePath))
                return null;
            if (new System.IO.FileInfo(cachePath).Length == 0)
            {
                try { System.IO.File.Delete(cachePath); } catch { }
                App.Log($"ShellThumbnail: cache file is empty after both attempts for '{System.IO.Path.GetFileName(filePath)}'");
                return null;
            }

            App.Log($"ShellThumbnail: mpv generated thumbnail for {System.IO.Path.GetFileName(filePath)}");
            return LoadFrozenBitmap(cachePath);
        }
        catch (Exception ex)
        {
            App.Log($"ShellThumbnail: mpv fallback failed: {ex.Message}");
            return null;
        }
    }

    private static BitmapSource? LoadFrozenBitmap(string path)
    {
        try
        {
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.CacheOption  = BitmapCacheOption.OnLoad;       // close file handle now
            bmp.UriSource    = new Uri(path, UriKind.Absolute);
            bmp.EndInit();
            bmp.Freeze();
            return bmp;
        }
        catch { return null; }
    }

    private static string HashPath(string path)
    {
        using var sha = System.Security.Cryptography.SHA1.Create();
        var bytes = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(path.ToLowerInvariant()));
        return Convert.ToHexString(bytes);
    }

    private static string? FindMpvExe()
    {
        // 1. Walk up from this exe a few levels and probe Tauri's mpv sidecar dir.
        try
        {
            var exeDir = System.IO.Path.GetDirectoryName(
                System.Reflection.Assembly.GetExecutingAssembly().Location) ?? "";
            var candidates = new[]
            {
                System.IO.Path.GetFullPath(System.IO.Path.Combine(exeDir, "..", "..", "..", "..",
                    "Pitflix.UI", "src-tauri", "target", "debug", "mpv.exe")),
                System.IO.Path.GetFullPath(System.IO.Path.Combine(exeDir, "..", "..", "..", "..",
                    "Pitflix.UI", "src-tauri", "target", "release", "mpv.exe")),
                System.IO.Path.Combine(exeDir, "mpv.exe"),
            };
            foreach (var c in candidates)
                if (System.IO.File.Exists(c)) return c;
        }
        catch { }
        // 2. PATH lookup.
        try
        {
            var paths = Environment.GetEnvironmentVariable("PATH")?.Split(';') ?? Array.Empty<string>();
            foreach (var p in paths)
            {
                try
                {
                    var c = System.IO.Path.Combine(p, "mpv.exe");
                    if (System.IO.File.Exists(c)) return c;
                }
                catch { }
            }
        }
        catch { }
        return null;
    }
}
