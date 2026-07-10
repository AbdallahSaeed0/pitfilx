using System.ComponentModel.DataAnnotations.Schema;

namespace Pitflix.Core.Models;

public class Show
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
    public string FolderPath { get; set; } = "";
    public bool IsArabic { get; set; }
    public bool IsMatched { get; set; }
    public DateTime DateAdded { get; set; }

    public string WatchStatus { get; set; } = WatchStatuses.Unwatched;
    public DateTime? CompletedAt { get; set; }

    /// <summary>True when Completed was reached because every episode finished via in-app playback (vs. a manual "mark watched" action).</summary>
    public bool CompletedFromPlayback { get; set; }

    /// <summary>JSON array of <see cref="TmdbCrewMember"/> from last metadata refresh (speeds detail page).</summary>
    public string? CrewCacheJson { get; set; }

    /// <summary>Timestamp of last successful metadata refresh from TMDB (used to skip re-downloading already prefetched items).</summary>
    public DateTime? MetadataRefreshedAt { get; set; }

    /// <summary>JSON array of {id,name} keyword objects from TMDB (populated lazily on first detail page visit).</summary>
    public string? KeywordsJson { get; set; }

    /// <summary>US content/age rating from TMDB (e.g. "TV-14", "TV-MA"). Populated lazily on first detail page visit.</summary>
    public string? ContentRating { get; set; }

    /// <summary>Originating TV network/streaming service from TMDB (e.g. "Netflix", "HBO"). Populated lazily by Statistics.</summary>
    public string? Network { get; set; }

    /// <summary>MyAnimeList id, used by AniSkip for op/ed timestamp lookup. Nullable and never
    /// auto-resolved today — populating this mapping is a separate future task.</summary>
    public int? MalId { get; set; }

    /// <summary>User explicitly said they won't continue this series — distinct from <see cref="WatchStatus"/>
    /// (which tracks actual episode completion). Only excludes it from "Up Next"; it still surfaces in
    /// "New episodes available" and other suggestion sections. Doesn't touch per-episode watch state or history.</summary>
    public bool IsDropped { get; set; }

    public ICollection<Episode> Episodes { get; set; } = new List<Episode>();

    /// <summary>API-only JSON: TMDB poster when cache paths are empty.</summary>
    [NotMapped]
    public string? PosterRemoteUrl { get; set; }
}
