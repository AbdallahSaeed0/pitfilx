using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Security.Cryptography;
using System.Text;

namespace Pitflix.API.Services;

/// <summary>
/// Serves downscaled variants of the cached artwork under %LocalAppData%\Pitflix\Images.
///
/// The cache stores TMDB's <c>w500</c> posters (500x750, ~65 KB each) and <c>w1280</c> backdrops, but the
/// library grid draws posters into ~145 px cells and carousels into ~136 px ones. Handing the WebView the
/// full-size file means it downloads ~4x more bytes than it needs and — the part that actually causes the
/// jank — decodes a 500x750 bitmap (~1.5 MB of RGBA) per card just to scale it down for painting. Forty
/// cards on screen is ~60 MB of decode work per page.
///
/// So: resize once, write the variant to <c>Images\thumbs\w{width}\</c>, and let the normal static-file
/// path serve it from then on. Generation is per-(source, width) serialized so a burst of forty parallel
/// card requests for the same poster does the work once.
/// </summary>
public static class ImageThumbnailService
{
    /// <summary>Widths the UI may ask for. Bounded so a crafted query string can't make us generate
    /// (and cache on disk) arbitrarily many variants of every image in the library.</summary>
    private static readonly int[] AllowedWidths = { 120, 160, 200, 300, 400, 640 };

    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Locks = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Extensions we can decode and re-encode. Anything else is served as-is.</summary>
    private static bool IsResizable(string path)
    {
        var ext = Path.GetExtension(path);
        return ext.Equals(".jpg", StringComparison.OrdinalIgnoreCase)
            || ext.Equals(".jpeg", StringComparison.OrdinalIgnoreCase)
            || ext.Equals(".png", StringComparison.OrdinalIgnoreCase)
            || ext.Equals(".webp", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Snaps a requested width up to the nearest allowed bucket, or null when the value is
    /// missing/garbage or wider than we bother downscaling for.</summary>
    public static int? NormalizeWidth(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw) || !int.TryParse(raw, out var requested) || requested <= 0)
            return null;
        foreach (var w in AllowedWidths)
        {
            if (requested <= w)
                return w;
        }
        return null;
    }

    /// <summary>
    /// Returns the path of a cached variant of <paramref name="sourcePath"/> no wider than
    /// <paramref name="width"/>, generating it on first request. Returns <paramref name="sourcePath"/>
    /// unchanged whenever a smaller variant would not help (already small enough, unsupported format) or
    /// when resizing fails for any reason — a slow-but-correct full-size image always beats a broken one.
    /// </summary>
    public static async Task<string> GetOrCreateAsync(string sourcePath, int width, string imagesRoot,
        CancellationToken ct = default)
    {
        if (!IsResizable(sourcePath))
            return sourcePath;

        string variantPath;
        try
        {
            variantPath = VariantPath(sourcePath, width, imagesRoot);
        }
        catch
        {
            return sourcePath;
        }

        // Regenerate when the source has been replaced since the variant was written (e.g. the user
        // picked a different poster and the scanner overwrote the cached file under the same name).
        if (IsFresh(variantPath, sourcePath))
            return variantPath;

        var gate = Locks.GetOrAdd(variantPath, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (IsFresh(variantPath, sourcePath))
                return variantPath;
            return Resize(sourcePath, variantPath, width) ? variantPath : sourcePath;
        }
        finally
        {
            gate.Release();
        }
    }

    private static bool IsFresh(string variantPath, string sourcePath)
    {
        try
        {
            var variant = new FileInfo(variantPath);
            if (!variant.Exists || variant.Length == 0)
                return false;
            var source = new FileInfo(sourcePath);
            return source.Exists && variant.LastWriteTimeUtc >= source.LastWriteTimeUtc;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// <c>Images\thumbs\w200\&lt;name&gt;__&lt;hash&gt;.jpg</c>. The hash of the source's path relative to the
    /// cache root keeps same-named files in different subfolders (Posters\x.jpg vs Cast\x.jpg) apart
    /// without recreating the folder tree.
    /// </summary>
    private static string VariantPath(string sourcePath, int width, string imagesRoot)
    {
        var root = Path.GetFullPath(imagesRoot);
        var full = Path.GetFullPath(sourcePath);
        var relative = full.StartsWith(root, StringComparison.OrdinalIgnoreCase)
            ? Path.GetRelativePath(root, full)
            : Path.GetFileName(full);

        var hash = Convert.ToHexString(
            MD5.HashData(Encoding.UTF8.GetBytes(relative.Replace('\\', '/').ToLowerInvariant())))[..8];
        var stem = Path.GetFileNameWithoutExtension(full);
        if (stem.Length > 80)
            stem = stem[..80];

        var dir = Path.Combine(root, "thumbs", $"w{width}");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, $"{stem}__{hash}.jpg");
    }

    private static bool Resize(string sourcePath, string variantPath, int width)
    {
        try
        {
            using var source = Image.FromFile(sourcePath);
            if (source.Width <= width)
                return false; // Already at or below the target — no point in a second copy on disk.

            var height = Math.Max(1, (int)Math.Round(source.Height * (width / (double)source.Width)));
            using var target = new Bitmap(width, height, PixelFormat.Format24bppRgb);
            using (var g = Graphics.FromImage(target))
            {
                g.CompositingMode = CompositingMode.SourceCopy;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.SmoothingMode = SmoothingMode.HighQuality;
                g.DrawImage(source, 0, 0, width, height);
            }

            var encoder = ImageCodecInfo.GetImageEncoders()
                .FirstOrDefault(c => c.FormatID == ImageFormat.Jpeg.Guid);
            using var parameters = new EncoderParameters(1);
            using var quality = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 82L);
            parameters.Param[0] = quality;

            // Write to a temp file first so a crash mid-encode can't leave a truncated image that
            // IsFresh would then happily serve forever.
            var temp = variantPath + ".tmp";
            if (encoder != null)
                target.Save(temp, encoder, parameters);
            else
                target.Save(temp, ImageFormat.Jpeg);
            File.Move(temp, variantPath, overwrite: true);
            return true;
        }
        catch
        {
            try { File.Delete(variantPath + ".tmp"); } catch { /* best effort */ }
            return false;
        }
    }
}
