namespace Pitflix.Core.Models;

public class TmdbCrewMember
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Job { get; set; } = "";
    public string ProfilePath { get; set; } = "";
    public string? ProfileLocalPath { get; set; }
    /// <summary>Full TMDB CDN URL for API responses (not persisted in <c>CrewCacheJson</c> source rows).</summary>
    public string? ProfileRemoteUrl { get; set; }
    /// <summary>TV only — episodes this person did this job on, from TMDB's aggregate_credits
    /// (episode-level directing/writing credits aren't in the plain /credits endpoint). Null for movies.</summary>
    public int? EpisodeCount { get; set; }
}
