namespace Pitflix.Core.Models;

/// <summary>User-followed TMDB TV show for Next Episodes (not in local library).</summary>
public sealed class FollowedExternalShow
{
    public int TmdbId { get; set; }
    public string Title { get; set; } = "";
    public string? PosterPath { get; set; }
    public DateTime AddedAtUtc { get; set; }
}
