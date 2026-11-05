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

    /// <summary>Size of <see cref="FilePath"/> in bytes when last seen — lets a scan recognize the same file
    /// after it was moved/renamed (see <c>MovedFileMatcher</c>). Null until the file has been stat'd.</summary>
    public long? FileSize { get; set; }

    public bool IsArabic { get; set; }
    public bool IsMatched { get; set; }
    public DateTime DateAdded { get; set; }

    public string WatchStatus { get; set; } = WatchStatuses.Unwatched;
    public DateTime? CompletedAt { get; set; }

    /// <summary>True when Completed was reached by actually finishing playback in-app (vs. a manual "mark watched" action).</summary>
    public bool CompletedFromPlayback { get; set; }

    /// <summary>How many times this movie has been watched again after its first completion. Auto-increments
    /// when playback completes on a movie already marked Completed; also manually adjustable.</summary>
    public int RewatchCount { get; set; }

    /// <summary>JSON array of <see cref="TmdbCrewMember"/> from last metadata refresh (speeds detail page).</summary>
    public string? CrewCacheJson { get; set; }

    /// <summary>Timestamp of last successful metadata refresh from TMDB (used to skip re-downloading already prefetched items).</summary>
    public DateTime? MetadataRefreshedAt { get; set; }

    /// <summary>JSON array of {id,name} keyword objects from TMDB (populated lazily on first detail page visit).</summary>
    public string? KeywordsJson { get; set; }

    /// <summary>US content/age rating from TMDB (e.g. "PG-13", "R"). Populated lazily on first detail page visit.</summary>
    public string? ContentRating { get; set; }

    /// <summary>API-only JSON: TMDB poster when cache paths are empty.</summary>
    [NotMapped]
    public string? PosterRemoteUrl { get; set; }

    /// <summary>TMDB <c>belongs_to_collection</c> id, cached lazily on first detail page visit.</summary>
    public int? CollectionId { get; set; }
    public string? CollectionName { get; set; }

    /// <summary>JSON array of production companies/networks from TMDB (the detail page's Studio row),
    /// cached lazily on first detail page visit — fetched together with <see cref="CollectionId"/> in
    /// the same TMDB call, so this field's non-null-ness is also the "have we already fetched the
    /// collection?" sentinel (CollectionId alone can't tell "not yet checked" from "genuinely none").</summary>
    public string? CompaniesJson { get; set; }
}
