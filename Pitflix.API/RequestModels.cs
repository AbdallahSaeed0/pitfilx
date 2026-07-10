// Request/body record types shared across Program.cs and Endpoints/*.cs minimal API handlers.
// Deliberately left in the global namespace (no `namespace` declaration) so every endpoint file
// that already referenced these without a `using` keeps working unchanged.

internal sealed record MatchBody(int TmdbId, string? MediaType);
internal sealed record BulkMatchBody(int[]? Ids, int TmdbId, string? MediaType, string? Title);
internal sealed record EpisodeWatchBody(string WatchStatus);
internal sealed record DroppedBody(bool Dropped);
internal sealed record UnmatchedSearchBody(string? Query, string? MediaType, int? Year = null);
internal sealed record ScanStartBody(string[]? Folders);
internal sealed record HistoryAddBody(string? FilePath, string? Title, string? PosterPath, string? MediaType,
    int DurationSeconds, bool? SuppressContinueWatching);
internal sealed record StoppedBody(DateTime StoppedAt, int? PositionSeconds);
internal sealed record HistoryProgressBody(int PositionSeconds, int? DurationSeconds, bool? MarkWatching);
internal sealed record HistoryDismissBody(bool? MarkCompleted);
internal sealed record CreateListBody(string? Name);

internal sealed record RenameListBody(string? Name);
internal sealed record AddListItemBody(int TmdbId, string? MediaType, string? Title = null, string? PosterRemoteUrl = null, string? ImdbId = null);
internal sealed record ImageSelectBody(int TmdbId, string? MediaType, string? PosterPath, string? BackdropPath,
    string? PosterUrl = null, string? BackdropUrl = null);
internal sealed record SettingsBody(string? TmdbApiKey, string? OpenSubtitlesApiKey, string? OpenSubtitlesAppName,
    string? SubDlApiKey, string? SubSourceApiKey, string? MdblistApiKey, string? TvdbApiKey,
    string? LetterboxdUsername,
    List<string>? LibraryPaths, string? MediaPlayerPath, bool? UseBuiltinPlayer, bool? LibraryScanDesktopToasts,
    string? PlayerMode,
    string? QBittorrentBaseUrl, string? QBittorrentUsername, string? QBittorrentPassword,
    bool? SupabaseSyncEnabled = null, string? SupabaseUrl = null, string? SupabaseServiceRoleKey = null,
    // Opt-in embedded-player playback quality features (default "auto" / false — see PlaybackQualitySettings.tsx).
    string? HdrMode = null, bool? AudioPassthrough = null);

internal sealed record WizardProgressBody(int Step, string? StateJson);

internal sealed record CompleteSetupBody(
    string? TmdbApiKey,
    bool TmdbSkipped,
    string? OpenSubtitlesApiKey,
    bool OpenSubtitlesSkipped,
    List<string>? LibraryPaths,
    bool FoldersSkipped);

internal sealed record SubtitleDownloadBody(int FileId, string? VideoFilePath, string? LanguageCode);
internal sealed record SubDlDownloadBody(string? FullLink, string? VideoFilePath, string? Language);
internal sealed record SubSourceDownloadBody(int? SubtitleId, string? VideoFilePath, string? Language);
internal sealed record TorrentDownloadBody(string? MagnetLink, string? SavePath);
internal sealed record TorrentFileSaveBody(string? TorrentFileUrl, string? SavePath, string? Title);
internal sealed record StreamTrailerEntry(string? Name, string Key, string? Type, string YoutubeUrl);

internal sealed record BulkWatchBody(int[]? MovieIds, int[]? ShowIds, string? WatchStatus);

internal sealed record BulkLibraryIdsBody(int[]? MovieIds, int[]? ShowIds);

internal sealed record MatchTmdbBody(int TmdbId);
internal sealed record BulkRescanSeriesRequest(int[] ShowIds);
internal sealed record RecommendationFromBody(int TmdbId, string? MediaType, string? Filter);
internal sealed record PathRequest(string? Path);
internal sealed record DeleteFromDeviceRequest(string? Path, string? MediaType, int? LibraryId);
internal sealed record AutostartRequest(bool Enable);
internal sealed record PlayBody(string? FilePath, int? StartSeconds, string? Title, string? PosterPath,
    string? MediaType, int? DurationSeconds, bool? SkipHistoryAdd);

internal sealed record UnifiedWatchBody(
    int TmdbId, string? ImdbId, string? MediaType, string? Title,
    string? PosterUrl, string? Source, int? SeasonNumber, int? EpisodeNumber, int RuntimeMinutes,
    DateTime? WatchedAt = null);

internal sealed record PinComingSoonBody(
    int TmdbId, string? MediaType, string? Title,
    string? PosterUrl, string? ReleaseDate, string? TrailerUrl, string? Overview);

internal sealed record PlayerPlayBody(
    string? FilePath, int MediaId, int? EpisodeId,
    double? StartPosition, string? SubtitleTrack,
    string? Player = null);

/// <summary>Body for POST /api/player/attach — carries the WPF child HWND.</summary>
internal sealed record PlayerAttachBody(long Hwnd);

internal sealed record PlayerCommandBody(string Command, double? Value);
internal sealed record PlayerMpvCommandBody(string[] Args);
internal sealed record PlayerPlaylistBody(string[] Files, string Current);
