using Microsoft.EntityFrameworkCore;
using Pitflix.API;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services;

public sealed record ExportMovie(
    int TmdbId, string Title, int? Year, string[] Genres, string? PosterPath, string Status,
    DateTime? CompletedAt, int? Runtime);

public sealed record ExportSeries(
    int TmdbId, string Title, int? Year, string[] Genres, string? PosterPath, string? Network, string Status);

public sealed record ExportEpisode(int ShowTmdbId, int Season, int Episode, DateTime? CompletedAt);

public sealed record ExportListItem(int TmdbId, string MediaType, string? Title, string? PosterPath);

public sealed record ExportList(string Name, string Type, List<ExportListItem> Items);

public sealed record LibraryExportPayload(
    List<ExportMovie> Movies, List<ExportSeries> Series, List<ExportEpisode> Episodes, List<ExportList> Lists);

/// <summary>
/// Builds the flat "watched movies/series/episodes/lists" snapshot used both by
/// `GET /api/library/watched-export` (mobile app's own pull, see LibraryExportEndpoints)
/// and by MobileAccountSyncService's push-to-Supabase path — one implementation, two consumers.
/// </summary>
public sealed class LibraryExportBuilder
{
    private readonly LibraryContext _db;
    private readonly ITmdbClientFactory _tmdbClientFactory;

    public LibraryExportBuilder(LibraryContext db, ITmdbClientFactory tmdbClientFactory)
    {
        _db = db;
        _tmdbClientFactory = tmdbClientFactory;
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
            .Select(e => new { e.ShowId, e.Season, e.EpisodeNumber, e.CompletedAt })
            .ToListAsync(ct).ConfigureAwait(false);

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
        await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(toEnrich, tmdb, ct).ConfigureAwait(false);

        string? ResolveListItemPoster(ListItem i)
        {
            var map = i.MediaType == "Series" ? showCards : movieCards;
            if (map.TryGetValue(i.TmdbId, out var known))
                return ResolvePoster(known);
            return listItemCards.TryGetValue((i.TmdbId, i.MediaType), out var synthetic)
                ? ResolvePoster(synthetic)
                : i.PosterRemoteUrl;
        }

        return new LibraryExportPayload(
            Movies: movies.Select(m =>
            {
                var d = movieCards[m.TmdbId];
                return new ExportMovie(
                    d.TmdbId, d.Title, d.Year, SplitGenres(d.GenresCsv), ResolvePoster(d), d.WatchStatus,
                    m.CompletedAt, m.Runtime);
            }).ToList(),
            Series: shows.Select(s =>
            {
                var d = showCards[s.TmdbId];
                return new ExportSeries(
                    d.TmdbId, d.Title, d.Year, SplitGenres(d.GenresCsv), ResolvePoster(d), s.Network, d.WatchStatus);
            }).ToList(),
            Episodes: episodes.Select(e =>
                new ExportEpisode(showTmdbIdsById[e.ShowId], e.Season, e.EpisodeNumber, e.CompletedAt)).ToList(),
            Lists: lists.Select(l => new ExportList(
                l.Name,
                ListType(l),
                l.Items.Select(i => new ExportListItem(i.TmdbId, i.MediaType, i.Title, ResolveListItemPoster(i))).ToList()
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
