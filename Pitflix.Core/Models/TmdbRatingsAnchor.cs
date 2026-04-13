namespace Pitflix.Core.Models;

public sealed record TmdbRatingsAnchor(
    string? ImdbId,
    string Title,
    int? Year,
    double? VoteAverage,
    int? VoteCount);
