namespace Pitflix.Core.Models;

/// <summary>Single-row table (Id is always 1) holding the user's Trakt.tv connection state.</summary>
public class TraktSettings
{
    public int Id { get; set; }
    public string? AccessToken { get; set; }
    public string? RefreshToken { get; set; }
    public DateTime? TokenExpiresAt { get; set; }
    public bool IsConnected { get; set; }
    public bool AutoSyncEnabled { get; set; }
}
