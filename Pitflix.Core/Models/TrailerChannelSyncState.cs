namespace Pitflix.Core.Models;

/// <summary>Per–YouTube channel cursor for uploads-playlist monitoring.</summary>
public sealed class TrailerChannelSyncState
{
    public string ChannelId { get; set; } = "";
    public string ChannelName { get; set; } = "";
    public string? UploadsPlaylistId { get; set; }
    public DateTime LastCheckedAtUtc { get; set; }
    public string? LastSeenVideoId { get; set; }
    public DateTime? LastSeenPublishedAtUtc { get; set; }
}
