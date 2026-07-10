namespace Pitflix.Core.Models;

/// <summary>Caches TMDB → Trakt id resolution so we don't re-query Trakt's search endpoint on every
/// scrobble / import call. MediaType is "movie" or "show" (episodes are addressed via their parent show's
/// Trakt id plus season/episode numbers, so no separate episode mapping is needed).</summary>
public class TraktIdMap
{
    public int Id { get; set; }
    public int TmdbId { get; set; }
    public string MediaType { get; set; } = "movie";
    public int TraktId { get; set; }
}
