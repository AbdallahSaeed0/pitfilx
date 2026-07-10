using Pitflix.API.Dtos;
using Pitflix.Core.Models;

namespace Pitflix.API;

public static class MediaCardMappers
{
    public static MediaCardDto ToCardFromMovie(Movie m) =>
        new()
        {
            Id = m.Id,
            TmdbId = m.TmdbId,
            Title = m.Title,
            Year = m.Year,
            VoteAverage = m.VoteAverage,
            PosterLocalPath = m.PosterLocalPath,
            SelectedPosterPath = m.SelectedPosterPath,
            IsArabic = m.IsArabic,
            WatchStatus = m.WatchStatus,
            DateAdded = m.DateAdded,
            GenresCsv = m.Genres,
            Overview = m.Overview != null && m.Overview.Length > 200 ? m.Overview[..200] : m.Overview,
            BackdropLocalPath = m.BackdropLocalPath,
            SelectedBackdropPath = m.SelectedBackdropPath,
            MediaFilePath = m.FilePath,
            TmdbMediaType = "Movie"
        };

    public static MediaCardDto ToCardFromShow(Show s) =>
        new()
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
            Overview = s.Overview != null && s.Overview.Length > 200 ? s.Overview[..200] : s.Overview,
            BackdropLocalPath = s.BackdropLocalPath,
            SelectedBackdropPath = s.SelectedBackdropPath,
            TmdbMediaType = "Series"
        };
}
