namespace Pitflix.Core.Models;

/// <summary>
/// Serializable home row query (API + SQLite-backed layout).
/// </summary>
public sealed class HomeSectionQuery
{
    public string SourceType { get; set; } = "custom";

    /// <summary>all | movie | series</summary>
    public string MediaType { get; set; } = "all";

    public int Limit { get; set; } = 20;

    /// <summary>dateadded | rating | year | title | random</summary>
    public string SortBy { get; set; } = "dateadded";

    /// <summary>Optional seed for deterministic shuffles (e.g. Movie Night refresh).</summary>
    public int? ShuffleSeed { get; set; }

    public List<string> Genres { get; set; } = new();

    /// <summary>all | en | ar — maps to IsArabic when not "all".</summary>
    public string LanguageCategory { get; set; } = "all";

    /// <summary>all | unwatched | watched | watching | completed</summary>
    public string WatchFilter { get; set; } = "all";

    public double? MinRating { get; set; }

    public int? MinRuntimeMinutes { get; set; }

    public int? MaxRuntimeMinutes { get; set; }

    public int? YearFrom { get; set; }

    public int? YearTo { get; set; }

    /// <summary>Matched as substrings in title or overview (any match).</summary>
    public List<string> Tags { get; set; } = new();

    public int? ListId { get; set; }

    /// <summary>When set, genre spotlight uses this TMDB-style genre name substring.</summary>
    public string? SpotlightGenre { get; set; }
}
