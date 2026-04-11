namespace Pitflix.Core.Models;

public class ScanLog
{
    public int Id { get; set; }
    public string FilePath { get; set; } = "";
    public string CleanName { get; set; } = "";
    public string Status { get; set; } = "";
    public string? MatchedTitle { get; set; }
    public int? TmdbId { get; set; }
    public string? Confidence { get; set; }
    public string? SuggestionsJson { get; set; }
    public DateTime ScannedAt { get; set; }
}
