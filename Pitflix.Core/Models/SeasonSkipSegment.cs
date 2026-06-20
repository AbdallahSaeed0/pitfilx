namespace Pitflix.Core.Models;

/// <summary>
/// One row per (Show, Season). There is no first-class Season entity in this
/// codebase — seasons are denormalized as an int on Episode — so this table
/// is keyed by the same (ShowId, SeasonNumber) pair Episode already uses.
/// Intro and outro are independently nullable: a season can have an intro
/// with no outro, an outro with no intro, or neither. A null value is a
/// normal "not detected" outcome, not an error.
/// </summary>
public class SeasonSkipSegment
{
    public int Id { get; set; }
    public int ShowId { get; set; }
    public int SeasonNumber { get; set; }

    public double? IntroStartSeconds { get; set; }
    public double? IntroEndSeconds { get; set; }
    public double? IntroConfidence { get; set; }
    /// <summary>"chapter" | "anilist" | "fingerprint" | "heuristic"</summary>
    public string? IntroSource { get; set; }

    /// <summary>For OutroSource == "fingerprint" these are computed from the episode that
    /// happened to be sampled during the fingerprint job — wrong for any other episode whose
    /// runtime differs (real TV seasons vary episode to episode). Kept as the display fallback
    /// when an episode's own duration isn't known yet; prefer OutroSecondsBeforeEnd* below,
    /// which is duration-independent. For OutroSource == "chapter" these ARE already correct
    /// per-episode (chapter detection probes each file's own duration individually) and
    /// OutroSecondsBeforeEnd* is left null.</summary>
    public double? OutroStartSeconds { get; set; }
    public double? OutroEndSeconds { get; set; }
    public double? OutroConfidence { get; set; }
    /// <summary>"chapter" | "anilist" | "fingerprint" | "heuristic"</summary>
    public string? OutroSource { get; set; }

    /// <summary>Outro window expressed as seconds-before-file-end instead of an absolute
    /// timestamp — the representation that's actually consistent across episodes of varying
    /// runtime. Null unless OutroSource == "fingerprint". Resolved to an absolute timestamp
    /// per-episode at serve time using that specific episode's own duration.</summary>
    public double? OutroSecondsBeforeEndStart { get; set; }
    public double? OutroSecondsBeforeEndEnd { get; set; }

    /// <summary>How many episodes contributed to a fingerprint result. 0 for chapter/anilist/heuristic sources.</summary>
    public int SampleEpisodeCount { get; set; }
    public DateTime ComputedAt { get; set; }
}
