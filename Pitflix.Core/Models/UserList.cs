namespace Pitflix.Core.Models;

public class UserList
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public bool IsDefault { get; set; }

    public ICollection<ListItem> Items { get; set; } = new List<ListItem>();
}
