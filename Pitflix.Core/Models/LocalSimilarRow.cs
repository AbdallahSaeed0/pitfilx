namespace Pitflix.Core.Models;

public sealed class LocalSimilarRow
{
    public string MediaKind { get; init; } = "";
    public int DatabaseId { get; init; }
    public int TmdbId { get; init; }
    public string Title { get; init; } = "";
    public int? Year { get; init; }
    public string? PosterLocalPath { get; init; }
    /// <summary>Persisted watch status ("Unwatched", "Watching", "Completed").</summary>
    public string? WatchStatus { get; init; }

    /// <summary>Short label for UI (movie vs series).</summary>
    public string MediaKindLabel =>
        string.Equals(MediaKind, "Series", StringComparison.OrdinalIgnoreCase) ? "📺 Series" : "🎬 Movie";
}
