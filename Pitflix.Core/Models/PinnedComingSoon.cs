namespace Pitflix.Core.Models;

/// <summary>User-pinned upcoming title shown in the "Coming Soon" section on the Home page.</summary>
public sealed class PinnedComingSoon
{
    public int Id { get; set; }
    public int TmdbId { get; set; }
    public string MediaType { get; set; } = "Movie"; // "Movie" or "Series"
    public string Title { get; set; } = "";
    public string? PosterUrl { get; set; }
    public string? ReleaseDate { get; set; }   // e.g. "2025-11-07"
    public string? TrailerUrl { get; set; }    // YouTube watch URL
    public string? Overview { get; set; }
    public DateTime PinnedAt { get; set; } = DateTime.UtcNow;
}
