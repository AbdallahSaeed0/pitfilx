using Pitflix.Core.Models;

namespace Pitflix.Core.Playback;

/// <summary>
/// Single-title resume head: prefer the strongest position signal, not the newest row alone.
/// Collapse merges sibling rows; this computes the displayed resume seconds from merged fields.
/// </summary>
public static class TrustedResumePolicy
{
    public static int ComputeSeconds(int maxKnown, int lastExplicit, int estimated, int fileDurationSeconds)
    {
        var raw = Math.Max(0, Math.Max(maxKnown, Math.Max(lastExplicit, estimated)));
        if (fileDurationSeconds > 0)
            raw = Math.Min(raw, fileDurationSeconds);
        return raw;
    }

    public static void ApplyTo(WatchHistory h) =>
        h.TrustedResumeSeconds = ComputeSeconds(
            h.MaxKnownPositionSeconds,
            h.LastExplicitPositionSeconds,
            h.EstimatedSeconds,
            h.FileDurationSeconds);
}
