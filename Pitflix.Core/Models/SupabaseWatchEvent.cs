namespace Pitflix.Core.Models;

/// <summary>
/// Local mirror of a Supabase <c>watch_events</c> row. Deliberately separate from
/// <see cref="WatchHistory"/> (which has no personal-rating concept and is owned by the
/// playback/scan pipeline) — this table is the sync module's own ledger of "what's been
/// synced for this title", one row per (TmdbId, MediaType), merged last-write-wins by
/// <see cref="SyncedAtUtc"/>.
/// </summary>
public class SupabaseWatchEvent
{
    public int Id { get; set; }

    /// <summary>Supabase row id (uuid, stored as text); null until the first successful push.</summary>
    public string? RemoteId { get; set; }

    public int TmdbId { get; set; }
    public string MediaType { get; set; } = "";
    public string? Title { get; set; }
    public string? PosterPath { get; set; }
    public DateTime WatchedAt { get; set; }

    /// <summary>1-5 personal rating; desktop has no local rating concept, so this is only ever
    /// populated by a pulled mobile event.</summary>
    public int? Rating { get; set; }

    /// <summary>Which side last wrote this row: "desktop" or "mobile".</summary>
    public string Source { get; set; } = "desktop";

    public DateTime SyncedAtUtc { get; set; }

    /// <summary>Best-effort link back to the local <see cref="WatchHistory"/> row this was
    /// pushed from, when this event originated on desktop. Null for mobile-originated rows.</summary>
    public int? LocalWatchHistoryId { get; set; }
}
