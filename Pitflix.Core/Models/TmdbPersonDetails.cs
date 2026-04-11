using System.Text.Json.Serialization;

namespace Pitflix.Core.Models;

public sealed class TmdbPersonDetails
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Biography { get; set; } = "";
    public string ProfilePath { get; set; } = "";
    [JsonIgnore]
    public string? ProfileLocalPath { get; set; }
    public string? Birthday { get; set; }
    public string? PlaceOfBirth { get; set; }
    public List<TmdbPersonKnownCredit> KnownFor { get; set; } = new();
}

public sealed class TmdbPersonKnownCredit
{
    public int MediaTmdbId { get; set; }
    /// <summary>Movie or TV (TMDB uses movie / tv).</summary>
    public string MediaType { get; set; } = "";
    public string Title { get; set; } = "";
    public string? PosterPath { get; set; }
    public double Popularity { get; set; }
}
