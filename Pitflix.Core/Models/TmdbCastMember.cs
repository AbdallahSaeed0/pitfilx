namespace Pitflix.Core.Models;

public class TmdbCastMember
{
    /// <summary>TMDB person id (cast credit).</summary>
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Character { get; set; } = "";
    public string ProfilePath { get; set; } = "";
    /// <summary>Local file path after download to AppData\...\Images\Cast\</summary>
    public string? ProfileLocalPath { get; set; }
}
