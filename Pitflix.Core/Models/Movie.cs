using System.ComponentModel.DataAnnotations.Schema;

namespace Pitflix.Core.Models;

public class Movie
{
    public int Id { get; set; }
    public int TmdbId { get; set; }
    public string Title { get; set; } = "";
    public string? TitleAr { get; set; }
    public int? Year { get; set; }
    public string? Overview { get; set; }
    public string? PosterLocalPath { get; set; }
    public string? BackdropLocalPath { get; set; }
    public string? SelectedPosterPath { get; set; }
    public string? SelectedBackdropPath { get; set; }
    public string? Genres { get; set; }
    public double VoteAverage { get; set; }
    public int? Runtime { get; set; }
    public string FilePath { get; set; } = "";
    public bool IsArabic { get; set; }
    public bool IsMatched { get; set; }
    public DateTime DateAdded { get; set; }

    public string WatchStatus { get; set; } = WatchStatuses.Unwatched;
    public DateTime? CompletedAt { get; set; }

    /// <summary>JSON array of <see cref="TmdbCrewMember"/> from last metadata refresh (speeds detail page).</summary>
    public string? CrewCacheJson { get; set; }

    /// <summary>Timestamp of last successful metadata refresh from TMDB (used to skip re-downloading already prefetched items).</summary>
    public DateTime? MetadataRefreshedAt { get; set; }

    /// <summary>API-only JSON: TMDB poster when cache paths are empty.</summary>
    [NotMapped]
    public string? PosterRemoteUrl { get; set; }
}
