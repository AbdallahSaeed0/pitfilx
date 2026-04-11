namespace Pitflix.Core.Models;

public sealed class TmdbDiscoverItem
{
    public int Id { get; set; }
    /// <summary>TMDB convention: <c>movie</c> or <c>tv</c>.</summary>
    public string MediaType { get; set; } = "";
    public string Title { get; set; } = "";
    public string PosterPath { get; set; } = "";
    public string Overview { get; set; } = "";
    public string ReleaseDate { get; set; } = "";
    public double VoteAverage { get; set; }
    public int VoteCount { get; set; }
    /// <summary>From discover/recommendations <c>genre_ids</c>; used for similarity ranking.</summary>
    public List<int> GenreIds { get; set; } = new();
}
