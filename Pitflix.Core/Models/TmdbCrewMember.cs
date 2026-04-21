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
}
