using Microsoft.EntityFrameworkCore;
using Pitflix.API;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services;

public sealed record ExportMovie(
    int TmdbId, string Title, int? Year, string[] Genres, string? PosterPath, string Status,
    DateTime? CompletedAt, int? Runtime, string? RemotePosterPath, int RewatchCount = 0);

/// <summary>Desktop doesn't store a per-series rewatch count (only movies/episodes do) — this is
/// always 0 from here. MobileAccountSyncService.PushAsync still max-merges it against whatever
/// value is already on Supabase, so a series-level count set on mobile is never clobbered by
/// this export's lack of one.</summary>
public sealed record ExportSeries(
    int TmdbId, string Title, int? Year, string[] Genres, string? PosterPath, string? Network, string Status,
    string? RemotePosterPath, int RewatchCount = 0);

public sealed record ExportEpisode(int ShowTmdbId, int Season, int Episode, DateTime? CompletedAt, int RewatchCount = 0);

public sealed record ExportListItem(
    int TmdbId, string MediaType, string? Title, string? PosterPath, string? RemotePosterPath);

public sealed record ExportList(string Name, string Type, List<ExportListItem> Items);

public sealed record LibraryExportPayload(
    List<ExportMovie> Movies, List<ExportSeries> Series, List<ExportEpisode> Episodes, List<ExportList> Lists);

/// <summary>
/// Builds the flat "watched movies/series/episodes/lists" snapshot used both by
/// `GET /api/library/watched-export` (mobile app's own pull, see LibraryExportEndpoints)
/// and by MobileAccountSyncService's push-to-Supabase path — one implementation, two consumers.
///
/// Each title carries two poster fields: `PosterPath` prefers the desktop's own local image
/// server (`http://&lt;PublicBase&gt;/images/...`) — fine for the direct-pull endpoint, since
/// the caller is on the same machine/LAN by construction. `RemotePosterPath` is *always* the
/// TMDB-hosted HTTPS URL, never a local one — required for anything pushed to Supabase, since
/// a `127.0.0.1`/LAN-IP URL baked into a Supabase row is meaningless to a phone reading it from
/// anywhere else later (the local server isn't reachable off-LAN, or even on-LAN once the
/// desktop is closed).
/// </summary>
public sealed class LibraryExportBuilder
{
    private readonly LibraryContext _db;
    private readonly ITmdbClientFactory _tmdbClientFactory;
    private readonly LibraryRepository _repo;

    public LibraryExportBuilder(LibraryContext db, ITmdbClientFactory tmdbClientFactory, LibraryRepository repo)
    {
        _db = db;
        _tmdbClientFactory = tmdbClientFactory;
        _repo = repo;
    }

    public async Task<LibraryExportPayload> BuildAsync(CancellationToken ct)
    {
        // Loaded unfiltered (not just Completed/Watching) so list items — which can
        // reference unwatched titles — can still resolve a real poster below, instead
        // of falling back to ListItem's often-null PosterRemoteUrl.
        var allMovies = await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched)
            .ToListAsync(ct).ConfigureAwait(false);
        var allShows = await _db.Shows.AsNoTracking()
            .Where(s => s.IsMatched)
            .ToListAsync(ct).ConfigureAwait(false);

        var movieCards = allMovies.ToDictionary(
            m => m.TmdbId,
            m => ImageUrls.MapMediaCard(MediaCardMappers.ToCardFromMovie(m)));
        var showCards = allShows.ToDictionary(
            s => s.TmdbId,
            s => ImageUrls.MapMediaCard(MediaCardMappers.ToCardFromShow(s)));

        var movies = allMovies.Where(m => m.WatchStatus == WatchStatuses.Completed).ToList();
        var shows = allShows
            .Where(s => s.WatchStatus == WatchStatuses.Watching || s.WatchStatus == WatchStatuses.Completed)
            .ToList();

        var showTmdbIdsById = shows.ToDictionary(s => s.Id, s => s.TmdbId);

        var episodes = await _db.Episodes.AsNoTracking()
            .Where(e => e.WatchStatus == WatchStatuses.Completed && showTmdbIdsById.Keys.Contains(e.ShowId))
            .Select(e => new { e.ShowId, e.Season, e.EpisodeNumber, e.CompletedAt, e.RewatchCount })
            .ToListAsync(ct).ConfigureAwait(false);

        // Watched via streaming/manual entries (WatchHistory.Source != "local") rather than the
        // scanned local library — the desktop's own Stats page already adds these on top of the
        // library-only counts above (see LibraryRepository.GetWatchStatisticsBundleAsync's
        // "extraMovies"/"streamingEpWatches"), so without doing the same here, this export is
        // permanently short of what Stats reports — e.g. 390 exported vs 919 "movies completed"
        // for an account that watches a lot outside the local scanned library.
        var libraryMovieTmdbSet = movies.Select(m => m.TmdbId).ToHashSet();
        var streamingMovieHistories = await _db.WatchHistories.AsNoTracking()
            .Where(h => h.Source != "local" && h.IsCompleted && h.TmdbId != null &&
                        (h.MediaType == "Movie" || h.MediaType == "movie") &&
                        h.SeasonNumber == null && h.EpisodeNumber == null)
            .ToListAsync(ct).ConfigureAwait(false);
        var extraMovies = streamingMovieHistories
            .Where(h => !libraryMovieTmdbSet.Contains(h.TmdbId!.Value))
            .GroupBy(h => h.TmdbId!.Value)
            .Select(g => g.OrderByDescending(h => h.StoppedAt ?? h.OpenedAt).First())
            .ToList();

        var libraryCompletedEpisodeSet = episodes
            .Select(e => (ShowTmdbId: showTmdbIdsById[e.ShowId], e.Season, e.EpisodeNumber))
            .ToHashSet();
        var streamingEpisodeHistories = await _db.WatchHistories.AsNoTracking()
            .Where(h => h.Source != "local" && h.IsCompleted && h.TmdbId != null &&
                        h.SeasonNumber != null && h.EpisodeNumber != null)
            .ToListAsync(ct).ConfigureAwait(false);
        var extraEpisodes = streamingEpisodeHistories
            .Where(h => !libraryCompletedEpisodeSet.Contains((h.TmdbId!.Value, h.SeasonNumber!.Value, h.EpisodeNumber!.Value)))
            .GroupBy(h => (h.TmdbId!.Value, h.SeasonNumber!.Value, h.EpisodeNumber!.Value))
            .Select(g => g.OrderByDescending(h => h.StoppedAt ?? h.OpenedAt).First())
            .ToList();

        // Deliberately NOT synthesizing a watch_records "series" entry for shows only ever seen
        // via streaming episode history: the desktop's own Stats page (seriesCompleted/
        // TotalSeries in GetWatchStatisticsBundleAsync) never adds a "streaming extras" count for
        // series the way it does for movies/episodes above — only local-library shows count
        // toward those numbers. Adding synthetic series rows here would make mobile's series
        // count exceed what desktop itself reports, trading one mismatch for another. The
        // episode_watch_status rows below still get pushed regardless — that table has no FK on
        // watch_records (see 003_pitflix_user_library_schema.sql), so Currently Watching still
        // works via its existing TMDB-summary fallback for a title/poster.

        var lists = await _db.UserLists.AsNoTracking()
            .Include(l => l.Items)
            .ToListAsync(ct).ConfigureAwait(false);

        // List items with no local library match (e.g. added to Watch Later
        // straight from search, never scanned in) get a synthetic card so the
        // TMDB poster fallback below can fill them in too.
        var listItemCards = new Dictionary<(int TmdbId, string MediaType), MediaCardDto>();
        foreach (var item in lists.SelectMany(l => l.Items))
        {
            var key = (item.TmdbId, item.MediaType);
            var known = item.MediaType == "Series" ? showCards.ContainsKey(item.TmdbId) : movieCards.ContainsKey(item.TmdbId);
            if (known || listItemCards.ContainsKey(key))
                continue;
            listItemCards[key] = new MediaCardDto
            {
                TmdbId = item.TmdbId,
                Title = item.Title ?? "",
                PosterRemoteUrl = item.PosterRemoteUrl,
                TmdbMediaType = item.MediaType,
            };
        }

        var tmdb = _tmdbClientFactory.Create();
        var toEnrich = movieCards.Values.Concat(showCards.Values).Concat(listItemCards.Values).ToList();
        await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(toEnrich, tmdb, ct, _repo).ConfigureAwait(false);

        string? ResolveListItemPoster(ListItem i)
        {
            var map = i.MediaType == "Series" ? showCards : movieCards;
            if (map.TryGetValue(i.TmdbId, out var known))
                return ResolvePoster(known);
            return listItemCards.TryGetValue((i.TmdbId, i.MediaType), out var synthetic)
                ? ResolvePoster(synthetic)
                : i.PosterRemoteUrl;
        }

        string? ResolveListItemRemotePoster(ListItem i)
        {
            var map = i.MediaType == "Series" ? showCards : movieCards;
            if (map.TryGetValue(i.TmdbId, out var known))
                return known.PosterRemoteUrl;
            return listItemCards.TryGetValue((i.TmdbId, i.MediaType), out var synthetic)
                ? synthetic.PosterRemoteUrl
                : i.PosterRemoteUrl;
        }

        return new LibraryExportPayload(
            Movies: movies.Select(m =>
            {
                var d = movieCards[m.TmdbId];
                return new ExportMovie(
                    d.TmdbId, d.Title, d.Year, SplitGenres(d.GenresCsv), ResolvePoster(d), d.WatchStatus,
                    m.CompletedAt, m.Runtime, d.PosterRemoteUrl, m.RewatchCount);
            }).Concat(extraMovies.Select(h => new ExportMovie(
                h.TmdbId!.Value, h.Title, null, [], null, WatchStatuses.Completed,
                h.StoppedAt ?? h.OpenedAt, null, h.PosterUrl))).ToList(),
            Series: shows.Select(s =>
            {
                var d = showCards[s.TmdbId];
                return new ExportSeries(
                    d.TmdbId, d.Title, d.Year, SplitGenres(d.GenresCsv), ResolvePoster(d), s.Network, d.WatchStatus,
                    d.PosterRemoteUrl);
            }).ToList(),
            Episodes: episodes.Select(e =>
                new ExportEpisode(showTmdbIdsById[e.ShowId], e.Season, e.EpisodeNumber, e.CompletedAt, e.RewatchCount))
                .Concat(extraEpisodes.Select(h =>
                    new ExportEpisode(h.TmdbId!.Value, h.SeasonNumber!.Value, h.EpisodeNumber!.Value, h.StoppedAt ?? h.OpenedAt)))
                .ToList(),
            Lists: lists.Select(l => new ExportList(
                l.Name,
                ListType(l),
                l.Items.Select(i => new ExportListItem(
                    i.TmdbId, i.MediaType, i.Title, ResolveListItemPoster(i), ResolveListItemRemotePoster(i)
                )).ToList()
            )).ToList()
        );
    }

    private static string? ResolvePoster(MediaCardDto d) =>
        d.SelectedPosterPath ?? d.PosterLocalPath ?? d.PosterRemoteUrl;

    private static string ListType(UserList l) =>
        l.IsDefault && l.Name == BuiltinLists.WatchLaterName ? "watchlist" :
        l.IsDefault && l.Name == BuiltinLists.FavoritesName ? "favorites" :
        "custom";

    private static string[] SplitGenres(string? genresCsv) =>
        string.IsNullOrWhiteSpace(genresCsv)
            ? []
            : genresCsv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
