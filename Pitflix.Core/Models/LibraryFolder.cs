namespace Pitflix.Core.Models;

public class LibraryFolder
{
    public int Id { get; set; }
    public string Path { get; set; } = "";
    public bool IsActive { get; set; } = true;
}
