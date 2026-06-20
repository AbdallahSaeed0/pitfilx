namespace Pitflix.Core.Models;

public sealed record RatingsCoverageStats(
    int Total,
    int WithImdb,
    int WithRottenTomatoes,
    int TmdbOnly,
    int HasImdbIdButNoImdbScore);
