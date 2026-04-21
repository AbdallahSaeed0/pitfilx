namespace Pitflix.Core.Models;

/// <summary>Persisted ratings snapshot per catalog title (Phase 2 — single source of truth for API/UI once wired).</summary>
public sealed class RatingsSnapshot
{
    public int Id { get; set; }
    public int TmdbId { get; set; }
    /// <summary><c>Movie</c> or <c>Series</c> (aligned with library / trailers).</summary>
    public string MediaType { get; set; } = "Movie";

    public double? TmdbRating { get; set; }
    public int? TmdbVoteCount { get; set; }
    public string? ImdbRating { get; set; }
    public string? ImdbVotes { get; set; }
    public string? RottenTomatoesCritics { get; set; }
    public string? RottenTomatoesAudience { get; set; }

    public DateTime RatingsLastUpdatedAtUtc { get; set; }
    public double RatingsConfidence { get; set; }
    public string? ImdbId { get; set; }

    /// <summary>Bitmask: see <see cref="RatingsSourceMask"/>.</summary>
    public int SourceMask { get; set; }

    /// <summary><c>hot</c>, <c>normal</c>, or <c>cold</c>.</summary>
    public string RefreshTier { get; set; } = "normal";

    public DateTime NextRefreshAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}

public static class RatingsSourceMask
{
    public const int Tmdb = 1;
    public const int Omdb = 2;
    public const int PhpImdb = 4;
}
