namespace Pitflix.Core.Scanner;

public sealed class ScanPipelineResult
{
    public int TotalFiles { get; set; }
    public int Matched { get; set; }
    public int Unmatched { get; set; }
    public int SkippedAlreadyMatched { get; set; }

    /// <summary>Saved TMDB calls: path still Unmatched but clean title unchanged vs last scan.</summary>
    public int SkippedUnchangedUnmatched { get; set; }
}
