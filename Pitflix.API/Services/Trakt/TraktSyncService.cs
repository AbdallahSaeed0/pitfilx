using System.Net.Http.Json;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services.Trakt;

/// <summary>One-time import of the user's Trakt watch history and playback progress into the local library.
/// History matches purely by TMDB id; playback progress is written into <see cref="WatchHistory"/> for
/// Continue Watching resume.</summary>
public sealed class TraktSyncService
{
    private readonly TraktAuthService _auth;
    private readonly TraktPlaybackSyncService _playback;

    public TraktSyncService(TraktAuthService auth, TraktPlaybackSyncService playback)
    {
        _auth = auth;
        _playback = playback;
    }

    public async Task<(int HistoryMatched, int HistoryUnmatched, int PlaybackApplied, int PlaybackSkipped)>
        ImportAllAsync(LibraryRepository repo, CancellationToken ct)
    {
        var (matched, unmatched) = await ImportHistoryAsync(repo, ct).ConfigureAwait(false);
        var (playbackApplied, playbackSkipped) = await _playback.ImportPlaybackAsync(repo, ct).ConfigureAwait(false);
        return (matched, unmatched, playbackApplied, playbackSkipped);
    }

    public async Task<(int Matched, int Unmatched)> ImportHistoryAsync(LibraryRepository repo, CancellationToken ct)
    {
        var matched = 0;
        var unmatched = 0;
        const int pageSize = 100;
        var page = 1;

        while (!ct.IsCancellationRequested)
        {
            using var res = await _auth
                .SendAuthenticatedAsync(repo, HttpMethod.Get, $"/sync/history?page={page}&limit={pageSize}", null, ct)
                .ConfigureAwait(false);
            if (res == null || !res.IsSuccessStatusCode)
                break;

            List<TraktHistoryItem>? items;
            try
            {
                items = await res.Content.ReadFromJsonAsync<List<TraktHistoryItem>>(TraktApiClient.JsonOptions, ct)
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
                if (await ApplyHistoryItemAsync(item, repo, ct).ConfigureAwait(false))
                    matched++;
                else
                    unmatched++;
            }

            if (items.Count < pageSize)
                break;
            page++;
        }

        return (matched, unmatched);
    }

    private static async Task<bool> ApplyHistoryItemAsync(TraktHistoryItem item, LibraryRepository repo,
        CancellationToken ct)
    {
        if (string.Equals(item.Type, "movie", StringComparison.OrdinalIgnoreCase) && item.Movie != null)
        {
            if (item.Movie.Ids.Tmdb is not int tmdbId)
                return false;

            await CacheIdIfMissingAsync(tmdbId, "movie", item.Movie.Ids.Trakt, repo, ct).ConfigureAwait(false);

            var movie = await repo.GetMovieByTmdbIdAsync(tmdbId, ct).ConfigureAwait(false);
            if (movie == null)
                return false;

            // Never downgrade: only push Unwatched/Watching up to Completed.
            if (movie.WatchStatus != WatchStatuses.Completed)
                await repo.UpdateMovieWatchStatusAsync(movie.Id, WatchStatuses.Completed, ct).ConfigureAwait(false);
            return true;
        }

        if (string.Equals(item.Type, "episode", StringComparison.OrdinalIgnoreCase) &&
            item.Show != null && item.Episode != null)
        {
            if (item.Show.Ids.Tmdb is not int showTmdbId ||
                item.Episode.Season is not int season ||
                item.Episode.Number is not int number)
                return false;

            await CacheIdIfMissingAsync(showTmdbId, "show", item.Show.Ids.Trakt, repo, ct).ConfigureAwait(false);

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

    private static async Task CacheIdIfMissingAsync(int tmdbId, string mediaType, int traktId, LibraryRepository repo,
        CancellationToken ct)
    {
        var existing = await repo.GetTraktIdAsync(tmdbId, mediaType, ct).ConfigureAwait(false);
        if (existing == null)
            await repo.SaveTraktIdAsync(tmdbId, mediaType, traktId, ct).ConfigureAwait(false);
    }
}
