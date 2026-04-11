namespace Pitflix.Core.Models;

public class CastMember
{
    public int Id { get; set; }
    /// <summary>TMDB person id; 0 if unknown (legacy rows).</summary>
    public int PersonTmdbId { get; set; }
    public int MediaId { get; set; }
    public string MediaType { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Character { get; set; }
    public string? ProfileLocalPath { get; set; }
}
