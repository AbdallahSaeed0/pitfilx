namespace Pitflix.Core.Models;

/// <summary>One row of the cached, background-computed Recommendations-page feed, seeded from top library titles.</summary>
public class LibraryRecommendation
{
    public int Id { get; set; }
    public int TmdbId { get; set; }
    public string MediaType { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Year { get; set; }
    public string? Overview { get; set; }
    public string? PosterUrl { get; set; }
    public double VoteAverage { get; set; }
    public int VoteCount { get; set; }
    public double Score { get; set; }
    /// <summary>JSON array of contributing seed titles, e.g. [{"tmdbId":123,"mediaType":"movie","title":"..."}].</summary>
    public string ContributingSeedsJson { get; set; } = "[]";
    public int SortOrder { get; set; }
    public DateTime ComputedAtUtc { get; set; }
}
