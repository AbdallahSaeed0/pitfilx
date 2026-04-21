namespace Pitflix.Core.Models;

public sealed class TrailerItem
{
    public int Id { get; set; }
    public string VideoId { get; set; } = "";
    public string YoutubeUrl { get; set; } = "";
    public string Title { get; set; } = "";
    public string ChannelName { get; set; } = "";
    public string? ChannelId { get; set; }
    public string IngestionSource { get; set; } = "yt_channel_search";
    public double MatchConfidence { get; set; }
    public int TrustTier { get; set; } = 2;
    public int TmdbId { get; set; }
    public string MediaType { get; set; } = "Movie";
    public DateTime PublishedAtUtc { get; set; }
    public double QualityScore { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}
