namespace Pitflix.Core.Models;

public class TmdbDetails
{
    public int Id { get; set; }
    /// <summary>TMDB ISO 639-1 code (e.g. ar, en).</summary>
    public string OriginalLanguage { get; set; } = "";
    public string Title { get; set; } = "";
    public string OriginalTitle { get; set; } = "";
    public string Overview { get; set; } = "";
    public string PosterPath { get; set; } = "";
    public string BackdropPath { get; set; } = "";
    public string ReleaseDate { get; set; } = "";
    public double VoteAverage { get; set; }
    public int? Runtime { get; set; }
    public List<string> Genres { get; set; } = new();
    public List<TmdbCastMember> Cast { get; set; } = new();
    public List<TmdbCrewMember> Crew { get; set; } = new();
    public List<TmdbSearchResult> Similar { get; set; } = new();
}
