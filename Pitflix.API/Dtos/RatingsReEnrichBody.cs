namespace Pitflix.API.Dtos;

public sealed class RatingsReEnrichBody
{
    /// <summary>When null, enqueues a stale sweep (same as post-scan).</summary>
    public int? TmdbId { get; set; }

    /// <summary><c>movie</c>, <c>tv</c>, <c>Movie</c>, or <c>Series</c>.</summary>
    public string? MediaType { get; set; }
}
