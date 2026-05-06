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
}
