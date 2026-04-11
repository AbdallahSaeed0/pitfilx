namespace Pitflix.Core.Models;

public sealed class TmdbImage
{
    public string FilePath { get; set; } = "";
    public double VoteAverage { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public string? Language { get; set; }
}
