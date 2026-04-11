using System.Net.Http;

namespace Pitflix.Core.Services;

/// <summary>Local TMDB image cache under %LocalAppData%\Pitflix\Images.</summary>
public static class ImageCacheService
{
    private static readonly Lazy<HttpClient> FallbackHttp = new(() => new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(60)
    });

    public static string CacheRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Pitflix", "Images");

    /// <summary>Return existing local file or download from TMDB (e.g. size <c>w185</c>, <c>w500</c>).</summary>
    public static async Task<string?> GetOrDownloadAsync(HttpClient? http, string? tmdbRelativePath, string subfolder,
        string tmdbSize, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(tmdbRelativePath))
            return null;

        var name = Path.GetFileName(tmdbRelativePath.Replace('\\', '/').TrimStart('/'));
        if (string.IsNullOrEmpty(name))
            return null;
        name = string.Join("_", name.Split(Path.GetInvalidFileNameChars()));

        var dir = Path.Combine(CacheRoot, subfolder);
        Directory.CreateDirectory(dir);
        var localPath = Path.Combine(dir, name);
        if (File.Exists(localPath))
            return localPath;

        var path = tmdbRelativePath.StartsWith('/') ? tmdbRelativePath : "/" + tmdbRelativePath;
        var size = string.IsNullOrWhiteSpace(tmdbSize) ? "w500" : tmdbSize.Trim();
        var url = $"https://image.tmdb.org/t/p/{size}{path}";

        var client = http ?? FallbackHttp.Value;
        try
        {
            var bytes = await client.GetByteArrayAsync(url, cancellationToken).ConfigureAwait(false);
            await File.WriteAllBytesAsync(localPath, bytes, cancellationToken).ConfigureAwait(false);
            return localPath;
        }
        catch
        {
            return null;
        }
    }
}
