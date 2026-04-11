namespace Pitflix.Core.Models;

public class Episode
{
    public int Id { get; set; }
    public int ShowId { get; set; }
    public int Season { get; set; }
    public int EpisodeNumber { get; set; }
    public string? Title { get; set; }
    /// <summary>Locally cached TMDB episode still (<c>still_path</c>).</summary>
    public string? StillLocalPath { get; set; }
    public string FilePath { get; set; } = "";
    public string? SubtitlePath { get; set; }

    public string WatchStatus { get; set; } = WatchStatuses.Unwatched;
    public DateTime? CompletedAt { get; set; }

    public Show Show { get; set; } = null!;
}
