namespace Pitflix.Core.Models;

public class IptvChannel
{
    public int Id { get; set; }
    public int ProviderId { get; set; }
    public string Name { get; set; } = "";
    public string StreamUrl { get; set; } = "";
    public string? LogoUrl { get; set; }
    public string? Group { get; set; }
    public string? TvgId { get; set; }
    public string? TvgName { get; set; }

    // Xtream stream id (for building stream URL on-the-fly)
    public string? StreamId { get; set; }

    public int SortOrder { get; set; }
}
