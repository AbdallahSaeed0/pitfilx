namespace Pitflix.API.Services;

public sealed record BackupEpisode(
    int Season, int EpisodeNumber, string? Title, string FilePath, string? SubtitlePath,
    string WatchStatus, DateTime? CompletedAt, bool CompletedFromPlayback, int RewatchCount);

public sealed record BackupShow(
    int TmdbId, string Title, string? TitleAr, int? Year, string? Overview, string? Genres, double VoteAverage,
    string FolderPath, bool IsArabic, bool IsMatched, DateTime DateAdded, string WatchStatus, DateTime? CompletedAt,
    bool CompletedFromPlayback, string? ContentRating, string? Network, int? MalId, bool IsDropped,
    List<BackupEpisode> Episodes);

public sealed record BackupMovie(
    int TmdbId, string Title, string? TitleAr, int? Year, string? Overview, string? Genres, double VoteAverage,
    int? Runtime, string FilePath, bool IsArabic, bool IsMatched, DateTime DateAdded, string WatchStatus,
    DateTime? CompletedAt, bool CompletedFromPlayback, int RewatchCount, string? ContentRating,
    int? CollectionId, string? CollectionName);

public sealed record BackupCastMember(
    int MediaTmdbId, string MediaType, int PersonTmdbId, string Name, string? Character, int BillingOrder);

public sealed record BackupLibraryFolder(string Path, bool IsActive);

public sealed record BackupListItem(
    int TmdbId, string MediaType, DateTime AddedAt, string? Title, string? PosterRemoteUrl, string? ImdbId);

public sealed record BackupList(string Name, DateTime CreatedAt, bool IsDefault, List<BackupListItem> Items);

public sealed record BackupWatchHistory(
    string FilePath, string Title, string MediaType, DateTime OpenedAt, DateTime? StartedAt, DateTime? StoppedAt,
    int EstimatedSeconds, int FileDurationSeconds, bool IsCompleted, int MaxKnownPositionSeconds,
    int LastExplicitPositionSeconds, DateTime? LastHeartbeatAtUtc, bool IsStopFinalized,
    bool SuppressContinueWatching, int? TmdbId, string? ImdbId, string Source, int? SeasonNumber,
    int? EpisodeNumber, string? PosterUrl);

public sealed record BackupRatingsSnapshot(
    int TmdbId, string MediaType, double? TmdbRating, int? TmdbVoteCount, string? ImdbRating, string? ImdbVotes,
    string? RottenTomatoesCritics, string? RottenTomatoesAudience, string? ImdbId, DateTime RatingsLastUpdatedAtUtc,
    double RatingsConfidence, int SourceMask, string RefreshTier, DateTime NextRefreshAtUtc, DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc);

public sealed record BackupSetting(string Key, string? Value);

public sealed record BackupTraktSettings(
    string? AccessToken, string? RefreshToken, DateTime? TokenExpiresAt, bool IsConnected, bool AutoSyncEnabled,
    DateTime? LastSyncedAtUtc);

/// <summary>
/// Full backup of a Pitflix desktop library: paths, watch state, lists, cast/crew, ratings and settings —
/// everything needed to restore your library without re-scanning from scratch. Deliberately excludes cached
/// images/thumbnails (re-fetched from TMDB on demand) and derived/re-computable caches (intro/outro skip
/// segments, trailers cache, recommendation cache, Trakt id-resolution cache) to keep the file small and avoid
/// shipping stale data that would just get overwritten anyway.
/// </summary>
public sealed record LibraryBackupPayload(
    int SchemaVersion,
    DateTime ExportedAtUtc,
    List<BackupMovie> Movies,
    List<BackupShow> Shows,
    List<BackupCastMember> CastMembers,
    List<BackupLibraryFolder> LibraryFolders,
    List<BackupList> Lists,
    List<BackupWatchHistory> WatchHistory,
    List<BackupRatingsSnapshot> Ratings,
    List<BackupSetting> Settings,
    BackupTraktSettings? Trakt);

public sealed record LibraryBackupImportResult(
    int MoviesAdded, int MoviesUpdated,
    int ShowsAdded, int ShowsUpdated,
    int EpisodesAdded, int EpisodesUpdated,
    int CastMembersAdded,
    int LibraryFoldersAdded,
    int ListsAdded, int ListItemsAdded,
    int WatchHistoryAdded,
    int RatingsAdded,
    int SettingsAdded,
    bool TraktRestored);
