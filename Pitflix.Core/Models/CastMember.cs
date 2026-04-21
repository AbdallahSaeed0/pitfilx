using System.ComponentModel.DataAnnotations.Schema;

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
    /// <summary>TMDB <c>profile_path</c> (leading slash); not a full URL.</summary>
    public string? ProfilePath { get; set; }
    /// <summary>TMDB cast <c>order</c> for display ordering.</summary>
    public int BillingOrder { get; set; }
    public string? ProfileLocalPath { get; set; }

    /// <summary>Full TMDB CDN URL for API responses only.</summary>
    [NotMapped]
    public string? ProfileRemoteUrl { get; set; }
}
