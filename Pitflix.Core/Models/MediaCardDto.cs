namespace Pitflix.Core.Models;

public sealed class MediaCardDto
{
    public int Id { get; set; }
    public int TmdbId { get; set; }
    public string Title { get; set; } = "";
    public int? Year { get; set; }
    public double VoteAverage { get; set; }
    public string? PosterLocalPath { get; set; }
    public string? SelectedPosterPath { get; set; }
    public bool IsArabic { get; set; }
    public string WatchStatus { get; set; } = WatchStatuses.Unwatched;
    public DateTime DateAdded { get; set; }
    public string? GenresCsv { get; set; }
    public string? Overview { get; set; }
    public string? BackdropLocalPath { get; set; }
    public string? SelectedBackdropPath { get; set; }
    public string? MediaFilePath { get; set; }

    /// <summary>"Movie" or "Series" — used when calling TMDB for poster fallback.</summary>
    public string? TmdbMediaType { get; set; }

    /// <summary>HTTPS TMDB poster when nothing is cached locally.</summary>
    public string? PosterRemoteUrl { get; set; }
}
