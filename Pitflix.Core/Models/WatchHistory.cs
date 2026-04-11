using System.ComponentModel.DataAnnotations.Schema;

namespace Pitflix.Core.Models;

public class WatchHistory
{
    public int Id { get; set; }
    public string FilePath { get; set; } = "";
    public string Title { get; set; } = "";
    public string? PosterLocalPath { get; set; }

    /// <summary>API-only: TMDB CDN when no usable local/cache URL (not stored in DB).</summary>
    [NotMapped]
    public string? PosterRemoteUrl { get; set; }

    public string MediaType { get; set; } = "";
    public DateTime OpenedAt { get; set; }

    /// <summary>When VLC was launched for this row (UTC).</summary>
    public DateTime? StartedAt { get; set; }

    /// <summary>When focus returned to Pitflix after a play session (UTC).</summary>
    public DateTime? StoppedAt { get; set; }

    /// <summary>Last observed watch time in seconds (session or accumulated).</summary>
    public int EstimatedSeconds { get; set; }

    public int FileDurationSeconds { get; set; }
    public bool IsCompleted { get; set; }

    /// <summary>API-only: e.g. "S2 E4 — Next up" for Continue Watching (not stored in DB).</summary>
    [NotMapped]
    public string? NextUpLabel { get; set; }

    /// <summary>API-only: local backdrop path for hero UI (not stored).</summary>
    [NotMapped]
    public string? BackdropLocalPath { get; set; }
}
