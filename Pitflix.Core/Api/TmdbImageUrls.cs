namespace Pitflix.Core.Api;

public static class TmdbImageUrls
{
    public const string ImageCdnBase = "https://image.tmdb.org/t/p/";

    /// <summary>Single size for person avatars (cast + featured crew) — keep UI + cache aligned.</summary>
    public const string PersonProfileAvatarSize = "w185";

    public static string? ProfileUrl(string? profilePath, string? size = null)
    {
        if (string.IsNullOrWhiteSpace(profilePath))
            return null;
        var p = profilePath.Trim();
        if (!p.StartsWith('/'))
            p = "/" + p;
        var sz = string.IsNullOrWhiteSpace(size) ? PersonProfileAvatarSize : size.Trim();
        return $"{ImageCdnBase}{sz}{p}";
    }
}
