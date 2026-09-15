namespace Pitflix.Core.Models;

/// <summary>A production company or TV network from TMDB (Netflix, Apple TV+, HBO, Warner Bros., etc.).</summary>
public class TmdbCompanyInfo
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? LogoPath { get; set; }
    /// <summary>"network" (TMDB TV networks — where streaming originals live) or "company" (production studio).</summary>
    public string Kind { get; set; } = "company";
}
