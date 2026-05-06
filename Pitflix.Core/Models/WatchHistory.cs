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

    /// <summary>High-water playback position (seconds) from any source (heartbeats, explicit saves).</summary>
    public int MaxKnownPositionSeconds { get; set; }

    /// <summary>Last client-reported playback position (seconds); distinct from inferred session time.</summary>
    public int LastExplicitPositionSeconds { get; set; }

    /// <summary>UTC of last progress/heartbeat write for this row.</summary>
    public DateTime? LastHeartbeatAtUtc { get; set; }

    /// <summary>True once an end-of-session path ran (explicit stop / return) so resume can trust the row.</summary>
    public bool IsStopFinalized { get; set; }

    /// <summary>When true, row is omitted from Continue watching / home history API (e.g. My Device stray files).</summary>
    public bool SuppressContinueWatching { get; set; }

    /// <summary>API-only: merged best resume head (seconds) from MaxKnown / LastExplicit / Estimated, capped by duration.</summary>
    [NotMapped]
    public int TrustedResumeSeconds { get; set; }

    /// <summary>API-only: e.g. "S2 E4 — Next up" for Continue Watching (not stored in DB).</summary>
    [NotMapped]
    public string? NextUpLabel { get; set; }

    /// <summary>API-only: local backdrop path for hero UI (not stored).</summary>
    [NotMapped]
    public string? BackdropLocalPath { get; set; }

    /// <summary>API-only: resolved library movie id for this history file (not stored).</summary>
    [NotMapped]
    public int? LibraryMovieId { get; set; }

    /// <summary>API-only: resolved library show id for this history file (not stored).</summary>
    [NotMapped]
    public int? LibraryShowId { get; set; }

    /// <summary>API-only: resolved library episode id for this history file (not stored).</summary>
    [NotMapped]
    public int? LibraryEpisodeId { get; set; }
}
