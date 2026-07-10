using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services.Trakt;

/// <summary>Fetches personalized movie/show recommendations from Trakt. Library titles are returned
/// with full local metadata; everything else becomes a TMDB discovery card for Online Streaming.</summary>
public sealed class TraktRecommendationsService
{
    private readonly TraktAuthService _auth;

    public TraktRecommendationsService(TraktAuthService auth)
    {
        _auth = auth;
    }

    public async Task<List<MediaCardDto>> GetHomeCardsAsync(LibraryRepository repo, int limit, string mediaType,
        CancellationToken ct)
    {
        var settings = await repo.GetOrCreateTraktSettingsAsync(ct).ConfigureAwait(false);
        if (!settings.IsConnected)
            return new List<MediaCardDto>();

        var cap = Math.Clamp(limit, 1, 40);
        var wantMovies = mediaType is not ("series" or "tv");
        var wantShows = mediaType is not ("movie" or "movies");
        var perType = wantMovies && wantShows ? Math.Max(cap, cap / 2 + 1) : cap;

        var cards = new List<MediaCardDto>();
        var seenTmdb = new HashSet<int>();

        if (wantMovies)
            await AppendMoviesAsync(repo,
                $"/recommendations/movies?limit={perType}&ignore_collected=true&ignore_watchlisted=true",
                cards, seenTmdb, ct).ConfigureAwait(false);

        if (wantShows)
            await AppendShowsAsync(repo,
                $"/recommendations/shows?limit={perType}&ignore_collected=true&ignore_watchlisted=true",
                cards, seenTmdb, ct).ConfigureAwait(false);

        return cards
            .OrderBy(c => c.Id > 0 && c.WatchStatus == WatchStatuses.Unwatched ? 0 :
                c.Id > 0 && c.WatchStatus == WatchStatuses.Watching ? 1 :
                c.Id > 0 ? 2 : 3)
            .ThenByDescending(c => c.VoteAverage)
            .Take(cap)
            .ToList();
    }

    private async Task AppendMoviesAsync(LibraryRepository repo, string path, List<MediaCardDto> cards,
        HashSet<int> seenTmdb, CancellationToken ct)
    {
        // Trakt returns a flat array of movie objects (not { movie: {...} } wrappers).
        var results = await _auth
            .SendAndReadListAsync<TraktMovieRef>(repo, HttpMethod.Get, path, null, ct)
            .ConfigureAwait(false);
        if (results == null)
            return;

        foreach (var movie in results)
        {
            if (movie.Ids.Tmdb is not int tmdbId || tmdbId <= 0 || !seenTmdb.Add(tmdbId))
                continue;

            var local = await repo.GetMovieByTmdbIdAsync(tmdbId, ct).ConfigureAwait(false);
            cards.Add(local != null ? ToMovieCard(local) : ToDiscoveryCard(movie, true));
        }
    }

    private async Task AppendShowsAsync(LibraryRepository repo, string path, List<MediaCardDto> cards,
        HashSet<int> seenTmdb, CancellationToken ct)
    {
        var results = await _auth
            .SendAndReadListAsync<TraktShowRef>(repo, HttpMethod.Get, path, null, ct)
            .ConfigureAwait(false);
        if (results == null)
            return;

        foreach (var show in results)
        {
            if (show.Ids.Tmdb is not int tmdbId || tmdbId <= 0 || !seenTmdb.Add(tmdbId))
                continue;

            var local = await repo.GetShowByTmdbIdAsync(tmdbId, ct).ConfigureAwait(false);
            cards.Add(local != null ? ToShowCard(local) : ToDiscoveryCard(show, false));
        }
    }

    private static MediaCardDto ToDiscoveryCard(TraktMovieRef m, bool isMovie) => ToDiscoveryCard(
        m.Title, m.Year, m.Ids.Tmdb ?? 0, m.Rating, isMovie);

    private static MediaCardDto ToDiscoveryCard(TraktShowRef s, bool isMovie) => ToDiscoveryCard(
        s.Title, s.Year, s.Ids.Tmdb ?? 0, s.Rating, isMovie);

    private static MediaCardDto ToDiscoveryCard(string? title, int? year, int tmdbId, double? rating, bool isMovie) =>
        new()
        {
            Id = 0,
            TmdbId = tmdbId,
            Title = string.IsNullOrWhiteSpace(title) ? "Unknown" : title.Trim(),
            Year = year,
            VoteAverage = rating ?? 0,
            TmdbMediaType = isMovie ? "Movie" : "Series",
            WatchStatus = WatchStatuses.Unwatched,
            DateAdded = DateTime.UtcNow,
        };

    private static MediaCardDto ToMovieCard(Movie m) => new()
    {
        Id = m.Id,
        TmdbId = m.TmdbId,
        Title = !string.IsNullOrWhiteSpace(m.Title) ? m.Title.Trim() : (m.TitleAr ?? ""),
        Year = m.Year,
        VoteAverage = m.VoteAverage,
        PosterLocalPath = m.PosterLocalPath,
        SelectedPosterPath = m.SelectedPosterPath,
        IsArabic = m.IsArabic,
        WatchStatus = m.WatchStatus,
        DateAdded = m.DateAdded,
        GenresCsv = m.Genres,
        Overview = m.Overview?.Length > 200 ? m.Overview[..200] : m.Overview,
        BackdropLocalPath = m.BackdropLocalPath,
        SelectedBackdropPath = m.SelectedBackdropPath,
        MediaFilePath = m.FilePath,
        TmdbMediaType = "Movie",
    };

    private static MediaCardDto ToShowCard(Show s) => new()
    {
        Id = s.Id,
        TmdbId = s.TmdbId,
        Title = s.Title,
        Year = s.Year,
        VoteAverage = s.VoteAverage,
        PosterLocalPath = s.PosterLocalPath,
        SelectedPosterPath = s.SelectedPosterPath,
        IsArabic = s.IsArabic,
        WatchStatus = s.WatchStatus,
        DateAdded = s.DateAdded,
        GenresCsv = s.Genres,
        Overview = s.Overview?.Length > 200 ? s.Overview[..200] : s.Overview,
        BackdropLocalPath = s.BackdropLocalPath,
        SelectedBackdropPath = s.SelectedBackdropPath,
        TmdbMediaType = "Series",
    };
}
