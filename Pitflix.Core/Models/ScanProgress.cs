namespace Pitflix.Core.Models;

public sealed class ScanProgress
{
    public int Total { get; set; }
    public int Current { get; set; }
    public string CurrentFile { get; set; } = "";
    public string Status { get; set; } = "";
    public int MatchedSoFar { get; set; }
    public int UnmatchedSoFar { get; set; }
    public int SkippedSoFar { get; set; }

    /// <summary>When true (and title/kind set), background scans may broadcast a client toast for this file.</summary>
    public bool EmitLibraryNotification { get; set; }

    public string? LibraryNotificationTitle { get; set; }
    /// <summary>"movie", "episode", or "file" (unknown / non-video classification).</summary>
    public string? LibraryNotificationKind { get; set; }

    public bool LibraryNotificationMatched { get; set; }

    /// <summary>The library Movie/Show row id for a matched notification — lets the client deep-link
    /// to `/movie/{id}` or `/series/{id}` instead of just showing a toast. Null for unmatched files.</summary>
    public int? LibraryNotificationLibraryId { get; set; }

    /// <summary>Season number for a matched episode notification, so the client can deep-link straight
    /// to that season instead of just the show page. Null for movies and specials.</summary>
    public int? LibraryNotificationSeason { get; set; }
}
