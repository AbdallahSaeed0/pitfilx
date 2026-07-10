using System.Collections.Concurrent;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services.Trakt;

/// <summary>Mirrors local playback events to Trakt's scrobble API. Always called fire-and-forget, after the
/// local watch-status/resume-position update has already committed — a Trakt failure here must never affect
/// local state, so every path swallows its own exceptions (same empty-result philosophy as the scrapers).</summary>
public sealed class TraktScrobbleService
{
    private static readonly ConcurrentDictionary<int, DateTime> LastPauseSentUtc = new();
    private static readonly TimeSpan PauseThrottle = TimeSpan.FromSeconds(45);

    private readonly TraktAuthService _auth;
    private readonly TraktIdResolver _resolver;

    public TraktScrobbleService(TraktAuthService auth, TraktIdResolver resolver)
    {
        _auth = auth;
        _resolver = resolver;
    }

    public Task StartAsync(WatchHistory history, LibraryRepository repo, CancellationToken ct) =>
        ScrobbleAsync("/scrobble/start", history, repo, ct);

    public Task PauseAsync(WatchHistory history, LibraryRepository repo, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        if (LastPauseSentUtc.TryGetValue(history.Id, out var last) && now - last < PauseThrottle)
            return Task.CompletedTask;

        LastPauseSentUtc[history.Id] = now;
        return ScrobbleAsync("/scrobble/pause", history, repo, ct);
    }

    public Task StopAsync(WatchHistory history, LibraryRepository repo, CancellationToken ct)
    {
        LastPauseSentUtc.TryRemove(history.Id, out _);
        return ScrobbleAsync("/scrobble/stop", history, repo, ct);
    }

    private async Task ScrobbleAsync(string path, WatchHistory history, LibraryRepository repo, CancellationToken ct)
    {
        try
        {
            var settings = await repo.GetOrCreateTraktSettingsAsync(ct).ConfigureAwait(false);
            if (!settings.IsConnected || !settings.AutoSyncEnabled)
                return;

            if (history.TmdbId is not int tmdbId)
                return;

            var progress = ComputeProgressPercent(history);
            object body;

            if (string.Equals(history.MediaType, "Movie", StringComparison.OrdinalIgnoreCase))
            {
                var traktId = await _resolver.ResolveAsync(tmdbId, "movie", repo, ct).ConfigureAwait(false);
                if (traktId is not int movieTraktId)
                    return;
                body = new { movie = new { ids = new { trakt = movieTraktId } }, progress };
            }
            else if (string.Equals(history.MediaType, "Series", StringComparison.OrdinalIgnoreCase))
            {
                if (history.SeasonNumber is not int season || history.EpisodeNumber is not int episode)
                    return;
                var showTraktId = await _resolver.ResolveAsync(tmdbId, "show", repo, ct).ConfigureAwait(false);
                if (showTraktId is not int sid)
                    return;
                body = new { show = new { ids = new { trakt = sid } }, episode = new { season, number = episode }, progress };
            }
            else
            {
                return;
            }

            using var response = await _auth.SendAuthenticatedAsync(repo, HttpMethod.Post, path, body, ct)
                .ConfigureAwait(false);
        }
        catch
        {
            // Fire-and-forget by design — a Trakt hiccup must never surface during playback.
        }
    }

    private static double ComputeProgressPercent(WatchHistory history)
    {
        if (history.FileDurationSeconds <= 0)
            return 0;

        var position = Math.Max(history.LastExplicitPositionSeconds, history.MaxKnownPositionSeconds);
        var percent = (double)position / history.FileDurationSeconds * 100.0;
        return Math.Clamp(percent, 0, 100);
    }
}
