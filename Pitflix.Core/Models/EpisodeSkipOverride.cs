namespace Pitflix.Core.Models;

/// <summary>
/// Per-episode exception to the season-level <see cref="SeasonSkipSegment"/> —
/// cold opens, extended episodes, finales with no outro, recap episodes that
/// fail fingerprint validation, or manual corrections. At most one row per
/// episode; a later write replaces the earlier one rather than accumulating.
/// </summary>
public class EpisodeSkipOverride
{
    public int Id { get; set; }
    public int EpisodeId { get; set; }

    public double? IntroStartSeconds { get; set; }
    public double? IntroEndSeconds { get; set; }
    public double? OutroStartSeconds { get; set; }
    public double? OutroEndSeconds { get; set; }

    /// <summary>True if this episode has no intro even though its season does.</summary>
    public bool SuppressIntro { get; set; }
    /// <summary>True if this episode has no outro even though its season does.</summary>
    public bool SuppressOutro { get; set; }

    /// <summary>"validation_mismatch" | "manual"</summary>
    public string Source { get; set; } = "manual";
}
