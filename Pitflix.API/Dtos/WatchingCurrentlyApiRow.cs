using Pitflix.Core.Models;

namespace Pitflix.API.Dtos;

public sealed class WatchingCurrentlyApiRow
{
    public int LibraryShowId { get; init; }
    public string ShowTitle { get; init; } = "";
    public int ShowTmdbId { get; init; }
    public string? PosterUrl { get; set; }
    public string LastWatchedLabel { get; init; } = "";
    public string NextLabel { get; init; } = "";
    public int EpisodesRemaining { get; init; }
    public int WatchedEpisodes { get; init; }
    public int TotalEpisodes { get; init; }
    public double ProgressFraction { get; init; }
    public DateTime LastPlayedAtUtc { get; init; }

    public static WatchingCurrentlyApiRow From(CurrentlyWatchingRow r, string? posterUrl) => new()
    {
        LibraryShowId = r.LibraryShowId,
        ShowTitle = r.ShowTitle,
        ShowTmdbId = r.ShowTmdbId,
        PosterUrl = posterUrl,
        LastWatchedLabel = $"S{r.LastWatchedSeason:D2}E{r.LastWatchedEpisode:D2}",
        NextLabel = $"S{r.NextSeason:D2}E{r.NextEpisode:D2}",
        EpisodesRemaining = r.EpisodesRemaining,
        WatchedEpisodes = r.WatchedEpisodes,
        TotalEpisodes = r.TotalEpisodes,
        ProgressFraction = r.ProgressFraction,
        LastPlayedAtUtc = r.LastPlayedAtUtc,
    };
}
