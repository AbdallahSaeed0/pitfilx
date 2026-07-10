using Newtonsoft.Json;

namespace Pitflix.Core.Models;

public class TmdbSearchResult
{
    [JsonProperty("id")]
    public int Id { get; set; }

    [JsonProperty("title")]
    public string? TitleMovie { get; set; }

    [JsonProperty("name")]
    public string? TitleTv { get; set; }

    [JsonIgnore]
    public string Title => TitleMovie ?? TitleTv ?? "";

    [JsonProperty("original_title")]
    public string? OriginalTitleMovie { get; set; }

    [JsonProperty("original_name")]
    public string? OriginalNameTv { get; set; }

    [JsonIgnore]
    public string OriginalTitle => OriginalTitleMovie ?? OriginalNameTv ?? "";

    [JsonProperty("overview")]
    public string Overview { get; set; } = "";

    [JsonProperty("poster_path")]
    public string PosterPath { get; set; } = "";

    [JsonProperty("release_date")]
    public string? ReleaseDateMovie { get; set; }

    [JsonProperty("first_air_date")]
    public string? FirstAirDate { get; set; }

    [JsonIgnore]
    public string ReleaseDate => ReleaseDateMovie ?? FirstAirDate ?? "";

    [JsonProperty("popularity")]
    public double Popularity { get; set; }

    [JsonProperty("vote_average")]
    public double VoteAverage { get; set; }

    [JsonProperty("original_language")]
    public string? OriginalLanguage { get; set; }
}
