namespace Pitflix.Core.Models;

/// <summary>Per-title cache of "You may like this" results from <c>RecommendationEngine</c> (24-48h TTL).</summary>
public class DetailRecommendationCache
{
    public int Id { get; set; }
    public int TmdbId { get; set; }
    public string MediaType { get; set; } = "";
    public string ResultJson { get; set; } = "";
    public DateTime ComputedAtUtc { get; set; }
    public DateTime ExpiresAtUtc { get; set; }
}
