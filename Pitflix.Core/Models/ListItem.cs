namespace Pitflix.Core.Models;

public class ListItem
{
    public int Id { get; set; }
    public int ListId { get; set; }
    public int TmdbId { get; set; }
    public string MediaType { get; set; } = "";
    public DateTime AddedAt { get; set; }

    public UserList List { get; set; } = null!;
}
