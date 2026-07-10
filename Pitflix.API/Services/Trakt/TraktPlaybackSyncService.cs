using System.Net.Http.Json;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services.Trakt;

/// <summary>Pulls paused playback progress from Trakt (<c>GET /sync/playback</c>) into local
/// <see cref="WatchHistory"/> rows so Continue Watching can resume cross-device.</summary>
public sealed class TraktPlaybackSyncService
{
    private const int PageSize = 100;
    private const double CompletedProgressThreshold = 80.0;

    private readonly TraktAuthService _auth;

    public TraktPlaybackSyncService(TraktAuthService auth)
    {
        _auth = auth;
    }

    public async Task<(int Applied, int Skipped)> ImportPlaybackAsync(LibraryRepository repo, CancellationToken ct)
    {
        var applied = 0;
        var skipped = 0;

        foreach (var type in new[] { "movies", "episodes" })
        {
            var page = 1;
            while (!ct.IsCancellationRequested)
            {
                using var res = await _auth
                    .SendAuthenticatedAsync(repo, HttpMethod.Get,
                        $"/sync/playback/{type}?page={page}&limit={PageSize}", null, ct)
                    .ConfigureAwait(false);
                if (res == null || !res.IsSuccessStatusCode)
                    break;

                List<TraktPlaybackItem>? items;
                try
                {
                    items = await res.Content
                        .ReadFromJsonAsync<List<TraktPlaybackItem>>(TraktApiClient.JsonOptions, ct)
                        .ConfigureAwait(false);
                }
                catch
                {
                    break;
                }

                if (items == null || items.Count == 0)
                    break;

                foreach (var item in items)
                {
                    if (await ApplyPlaybackItemAsync(item, repo, ct).ConfigureAwait(false))
                        applied++;
                    else
                        skipped++;
                }

                if (items.Count < PageSize)
                    break;
                page++;
            }
        }

        return (applied, skipped);
    }

    private static async Task<bool> ApplyPlaybackItemAsync(TraktPlaybackItem item, LibraryRepository repo,
        CancellationToken ct)
    {
        if (item.Progress >= CompletedProgressThreshold)
            return await ApplyCompletedFromPlaybackAsync(item, repo, ct).ConfigureAwait(false);

        if (item.Movie != null && item.Movie.Ids.Tmdb is int movieTmdbId)
        {
            var movie = await repo.GetMovieByTmdbIdAsync(movieTmdbId, ct).ConfigureAwait(false);
            if (movie == null || string.IsNullOrWhiteSpace(movie.FilePath))
                return false;

            var duration = await ResolveMovieDurationSecondsAsync(repo, movie, item.Progress, ct)
                .ConfigureAwait(false);
            return await repo.ApplyTraktPlaybackProgressAsync(
                movie.FilePath,
                movie.Title,
                movie.PosterLocalPath ?? movie.SelectedPosterPath,
                "Movie",
                item.Progress,
                duration,
                item.PausedAt.ToUniversalTime(),
                movieTmdbId,
                null,
                null,
                ct).ConfigureAwait(false);
        }

        if (item.Show != null && item.Episode != null &&
            item.Show.Ids.Tmdb is int showTmdbId &&
            item.Episode.Season is int season &&
            item.Episode.Number is int number)
        {
            var show = await repo.GetShowByTmdbIdAsync(showTmdbId, ct).ConfigureAwait(false);
            if (show == null)
                return false;

            var episode = await repo.GetEpisodeAsync(show.Id, season, number, ct).ConfigureAwait(false);
            if (episode == null || string.IsNullOrWhiteSpace(episode.FilePath))
                return false;

            var duration = await ResolveEpisodeDurationSecondsAsync(repo, episode.FilePath, item.Progress, ct)
                .ConfigureAwait(false);
            var title = !string.IsNullOrWhiteSpace(episode.Title)
                ? $"{show.Title} S{season:00}E{number:00}"
                : show.Title;

            return await repo.ApplyTraktPlaybackProgressAsync(
                episode.FilePath,
                title,
                show.PosterLocalPath ?? show.SelectedPosterPath,
                "Series",
                item.Progress,
                duration,
                item.PausedAt.ToUniversalTime(),
                showTmdbId,
                season,
                number,
                ct).ConfigureAwait(false);
        }

        return false;
    }

    private static async Task<bool> ApplyCompletedFromPlaybackAsync(TraktPlaybackItem item, LibraryRepository repo,
        CancellationToken ct)
    {
        if (item.Movie?.Ids.Tmdb is int movieTmdbId)
        {
            var movie = await repo.GetMovieByTmdbIdAsync(movieTmdbId, ct).ConfigureAwait(false);
            if (movie == null)
                return false;
            if (movie.WatchStatus != WatchStatuses.Completed)
                await repo.UpdateMovieWatchStatusAsync(movie.Id, WatchStatuses.Completed, ct).ConfigureAwait(false);
            return true;
        }

        if (item.Show?.Ids.Tmdb is int showTmdbId &&
            item.Episode?.Season is int season &&
            item.Episode.Number is int number)
        {
            var show = await repo.GetShowByTmdbIdAsync(showTmdbId, ct).ConfigureAwait(false);
            if (show == null)
                return false;
            var episode = await repo.GetEpisodeAsync(show.Id, season, number, ct).ConfigureAwait(false);
            if (episode == null)
                return false;
            if (episode.WatchStatus != WatchStatuses.Completed)
                await repo.UpdateEpisodeWatchStatusAsync(episode.Id, WatchStatuses.Completed, ct).ConfigureAwait(false);
            return true;
        }

        return false;
    }

    private static async Task<int> ResolveMovieDurationSecondsAsync(LibraryRepository repo, Movie movie,
        double progressPercent, CancellationToken ct)
    {
        if (movie.Runtime is int runtimeMin && runtimeMin > 0)
            return runtimeMin * 60;

        var map = await repo.GetMaxFileDurationSecondsByPathsAsync(new[] { movie.FilePath }, ct)
            .ConfigureAwait(false);
        if (map.TryGetValue(movie.FilePath, out var fromHistory) && fromHistory > 0)
            return fromHistory;

        return 7200;
    }

    private static async Task<int> ResolveEpisodeDurationSecondsAsync(LibraryRepository repo, string filePath,
        double progressPercent, CancellationToken ct)
    {
        var map = await repo.GetMaxFileDurationSecondsByPathsAsync(new[] { filePath }, ct).ConfigureAwait(false);
        if (map.TryGetValue(filePath, out var fromHistory) && fromHistory > 0)
            return fromHistory;

        return 2700;
    }
}
