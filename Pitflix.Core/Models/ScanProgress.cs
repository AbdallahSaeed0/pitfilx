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
}
