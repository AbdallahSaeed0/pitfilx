namespace Pitflix.API.Models;

public sealed class PlayerSession
{
    public Guid SessionId { get; set; }
    public int MediaId { get; set; }
    public int? EpisodeId { get; set; }
    public string FilePath { get; set; } = "";
    public double Position { get; set; }
    public double Duration { get; set; }
    public bool IsPaused { get; set; }
    public bool IsStopped { get; set; }
    public string? SubtitleTrack { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime LastUpdatedAt { get; set; }
    public string PipeName { get; set; } = "";
}
