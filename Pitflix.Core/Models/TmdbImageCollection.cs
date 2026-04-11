namespace Pitflix.Core.Models;

public sealed class TmdbImageCollection
{
    public List<TmdbImage> Posters { get; set; } = new();
    public List<TmdbImage> Backdrops { get; set; } = new();
}
