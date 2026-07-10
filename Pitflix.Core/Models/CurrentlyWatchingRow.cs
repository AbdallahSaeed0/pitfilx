namespace Pitflix.Core.Models;

/// <summary>Home "Watching currently" — series with recent episode plays and remaining unwatched episodes.</summary>
public sealed class CurrentlyWatchingRow
{
    public int LibraryShowId { get; init; }
    public string ShowTitle { get; init; } = "";
    public int ShowTmdbId { get; init; }
    public string? PosterLocalPath { get; init; }
    public string? SelectedPosterPath { get; init; }

    public int LastWatchedSeason { get; init; }
    public int LastWatchedEpisode { get; init; }
    public int NextSeason { get; init; }
    public int NextEpisode { get; init; }
    public int EpisodesRemaining { get; init; }
    public int WatchedEpisodes { get; init; }
    public int TotalEpisodes { get; init; }
    /// <summary>0..1 based on completed / total library episodes.</summary>
    public double ProgressFraction { get; init; }
    public DateTime LastPlayedAtUtc { get; init; }

    /// <summary>False when the "next" episode above is aired on TMDB but not yet in the local library
    /// (i.e. released, not downloaded) — the library-only next episode is exhausted, so this show would
    /// otherwise have dropped out of Up Next entirely. True for the normal library-episode case.</summary>
    public bool NextEpisodeDownloaded { get; init; } = true;
}
