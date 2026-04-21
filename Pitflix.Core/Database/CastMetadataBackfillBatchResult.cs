namespace Pitflix.Core.Database;

public sealed record CastMetadataBackfillBatchResult(
    int MoviesProcessed,
    int ShowsProcessed,
    int CastRowsWritten,
    int CastCreditsMissingProfileImage,
    int FailedTitles,
    int NextAfterMovieLibraryIdExclusive,
    int NextAfterShowLibraryIdExclusive,
    bool HasMore);
