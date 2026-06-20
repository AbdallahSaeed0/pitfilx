namespace Pitflix.Core.Models;

public class ListItem
{
    public int Id { get; set; }
    public int ListId { get; set; }
    public int TmdbId { get; set; }
    public string MediaType { get; set; } = "";
    public DateTime AddedAt { get; set; }

    /// <summary>Display title stored at add-time so streaming/awards items show correctly without a library match.</summary>
    public string? Title { get; set; }
    /// <summary>Remote poster URL stored at add-time.</summary>
    public string? PosterRemoteUrl { get; set; }
    /// <summary>IMDb ID stored at add-time for streaming items.</summary>
    public string? ImdbId { get; set; }

    public UserList List { get; set; } = null!;
}
