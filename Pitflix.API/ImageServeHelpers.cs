namespace Pitflix.API;

internal static class ImageServeHelpers
{
    public static string ImageContentTypeForExtension(string path) =>
        Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            ".bmp" => "image/bmp",
            ".svg" => "image/svg+xml",
            _ => "image/jpeg",
        };

    public static IResult BuildImageFolderDiagnostics(string cacheRoot)
    {
        var exists = Directory.Exists(cacheRoot);
        string[] sample = Array.Empty<string>();
        var rootFiles = exists ? Directory.GetFiles(cacheRoot).Length : 0;
        var subfolders = new List<object>();

        if (exists)
        {
            try
            {
                sample = Directory.GetFiles(cacheRoot)
                    .Select(Path.GetFileName)
                    .Where(n => n != null)
                    .Take(8)
                    .ToArray()!;

                subfolders = Directory.GetDirectories(cacheRoot)
                    .Select(d => new
                    {
                        folder = Path.GetFileName(d),
                        count = Directory.GetFiles(d).Length
                    })
                    .Where(x => x.folder is not null)
                    .Cast<object>()
                    .ToList();
            }
            catch
            {
                subfolders = new List<object>();
                sample = Array.Empty<string>();
            }
        }

        return Results.Json(new
        {
            path = cacheRoot,
            exists,
            rootFiles,
            rootFileCount = rootFiles,
            fileCount = rootFiles,
            subfolders,
            sampleFiles = sample
        });
    }

    public static string ExtensionForUrl(string url)
    {
        try
        {
            var ext = Path.GetExtension(new Uri(url).AbsolutePath).ToLowerInvariant();
            return ext is ".png" or ".webp" or ".gif" or ".bmp" ? ext : ".jpg";
        }
        catch
        {
            return ".jpg";
        }
    }

    public static async Task<string?> DownloadRemoteImageAsync(HttpClient http, string imageUrl, string localFileName,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(imageUrl) || string.IsNullOrWhiteSpace(localFileName))
            return null;

        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Pitflix",
            "Images");
        Directory.CreateDirectory(root);

        var safeName = Path.GetFileName(localFileName);
        var fullPath = Path.Combine(root, safeName);
        if (File.Exists(fullPath))
            return fullPath;

        using var resp = await http.GetAsync(imageUrl, HttpCompletionOption.ResponseHeadersRead, ct)
            .ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
            return null;

        await using var fs = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None);
        await resp.Content.CopyToAsync(fs, ct).ConfigureAwait(false);
        return fullPath;
    }
}
