namespace Pitflix.Core.Models;

public enum IptvProviderType
{
    M3uUrl = 0,
    XtreamCodes = 1,
    EpgOnly = 2,
}

public class IptvProvider
{
    public int Id { get; set; }
    public string DisplayName { get; set; } = "";
    public IptvProviderType Type { get; set; }

    // M3U URL provider
    public string? M3uUrl { get; set; }

    // Xtream Codes provider
    public string? ServerUrl { get; set; }
    public string? Username { get; set; }
    public string? Password { get; set; }

    // EPG / XMLTV
    public string? EpgUrl { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastRefreshedAt { get; set; }
    public int ChannelCount { get; set; }
}
