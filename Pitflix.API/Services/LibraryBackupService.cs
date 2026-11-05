using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services;

/// <summary>
/// Builds and restores <see cref="LibraryBackupPayload"/> — a portable JSON snapshot of the library
/// (paths, watch state, lists, cast, ratings, settings) that survives a lost/corrupted database or a
/// move to a new machine. Import always merges: it fills in rows missing locally and only advances
/// watch progress forward (Completed never regresses to Watching, rewatch counts only go up), so
/// importing a backup on top of an already-populated library never clobbers or loses local data.
/// </summary>
public sealed class LibraryBackupService
{
    public const int CurrentSchemaVersion = 1;

    private readonly LibraryContext _db;

    public LibraryBackupService(LibraryContext db)
    {
        _db = db;
    }

    public async Task<LibraryBackupPayload> BuildAsync(CancellationToken ct)
    {
        var movies = await _db.Movies.AsNoTracking()
            .Select(m => new BackupMovie(
                m.TmdbId, m.Title, m.TitleAr, m.Year, m.Overview, m.Genres, m.VoteAverage, m.Runtime, m.FilePath,
                m.IsArabic, m.IsMatched, m.DateAdded, m.WatchStatus, m.CompletedAt, m.CompletedFromPlayback,
                m.RewatchCount, m.ContentRating, m.CollectionId, m.CollectionName))
            .ToListAsync(ct).ConfigureAwait(false);

        var shows = await _db.Shows.AsNoTracking()
            .Include(s => s.Episodes)
            .Select(s => new BackupShow(
                s.TmdbId, s.Title, s.TitleAr, s.Year, s.Overview, s.Genres, s.VoteAverage, s.FolderPath,
                s.IsArabic, s.IsMatched, s.DateAdded, s.WatchStatus, s.CompletedAt, s.CompletedFromPlayback,
                s.ContentRating, s.Network, s.MalId, s.IsDropped,
                s.Episodes.Select(e => new BackupEpisode(
                    e.Season, e.EpisodeNumber, e.Title, e.FilePath, e.SubtitlePath, e.WatchStatus, e.CompletedAt,
                    e.CompletedFromPlayback, e.RewatchCount)).ToList()))
            .ToListAsync(ct).ConfigureAwait(false);

        var cast = await _db.CastMembers.AsNoTracking()
            .Select(c => new BackupCastMember(c.MediaId, c.MediaType, c.PersonTmdbId, c.Name, c.Character, c.BillingOrder))
            .ToListAsync(ct).ConfigureAwait(false);

        var folders = await _db.LibraryFolders.AsNoTracking()
            .Select(f => new BackupLibraryFolder(f.Path, f.IsActive))
            .ToListAsync(ct).ConfigureAwait(false);

        var lists = await _db.UserLists.AsNoTracking()
            .Include(l => l.Items)
            .Select(l => new BackupList(
                l.Name, l.CreatedAt, l.IsDefault,
                l.Items.Select(i => new BackupListItem(i.TmdbId, i.MediaType, i.AddedAt, i.Title, i.PosterRemoteUrl, i.ImdbId)).ToList()))
            .ToListAsync(ct).ConfigureAwait(false);

        var history = await _db.WatchHistories.AsNoTracking()
            .Select(h => new BackupWatchHistory(
                h.FilePath, h.Title, h.MediaType, h.OpenedAt, h.StartedAt, h.StoppedAt, h.EstimatedSeconds,
                h.FileDurationSeconds, h.IsCompleted, h.MaxKnownPositionSeconds, h.LastExplicitPositionSeconds,
                h.LastHeartbeatAtUtc, h.IsStopFinalized, h.SuppressContinueWatching, h.TmdbId, h.ImdbId, h.Source,
                h.SeasonNumber, h.EpisodeNumber, h.PosterUrl))
            .ToListAsync(ct).ConfigureAwait(false);

        var ratings = await _db.RatingsSnapshots.AsNoTracking()
            .Select(r => new BackupRatingsSnapshot(
                r.TmdbId, r.MediaType, r.TmdbRating, r.TmdbVoteCount, r.ImdbRating, r.ImdbVotes,
                r.RottenTomatoesCritics, r.RottenTomatoesAudience, r.ImdbId, r.RatingsLastUpdatedAtUtc,
                r.RatingsConfidence, r.SourceMask, r.RefreshTier, r.NextRefreshAtUtc, r.CreatedAtUtc, r.UpdatedAtUtc))
            .ToListAsync(ct).ConfigureAwait(false);

        var settings = await _db.Settings.AsNoTracking()
            .Select(s => new BackupSetting(s.Key, s.Value))
            .ToListAsync(ct).ConfigureAwait(false);

        var trakt = await _db.TraktSettings.AsNoTracking().FirstOrDefaultAsync(ct).ConfigureAwait(false);
        var backupTrakt = trakt == null ? null : new BackupTraktSettings(
            trakt.AccessToken, trakt.RefreshToken, trakt.TokenExpiresAt, trakt.IsConnected, trakt.AutoSyncEnabled,
            trakt.LastSyncedAtUtc);

        return new LibraryBackupPayload(
            CurrentSchemaVersion, DateTime.UtcNow, movies, shows, cast, folders, lists, history, ratings, settings,
            backupTrakt);
    }

    public async Task<LibraryBackupImportResult> ImportAsync(LibraryBackupPayload payload, CancellationToken ct)
    {
        var moviesAdded = 0;
        var moviesUpdated = 0;
        var showsAdded = 0;
        var showsUpdated = 0;
        var episodesAdded = 0;
        var episodesUpdated = 0;
        var castAdded = 0;
        var foldersAdded = 0;
        var listsAdded = 0;
        var listItemsAdded = 0;
        var historyAdded = 0;
        var ratingsAdded = 0;
        var settingsAdded = 0;
        var traktRestored = false;

        await using var tx = await _db.Database.BeginTransactionAsync(ct).ConfigureAwait(false);

        // ── Shows (+ nested episodes) — imported before movies/cast so show ids exist for episode FK ──
        foreach (var bs in payload.Shows)
        {
            var show = await _db.Shows.Include(s => s.Episodes)
                .FirstOrDefaultAsync(s => s.TmdbId == bs.TmdbId, ct).ConfigureAwait(false);
            if (show == null)
            {
                show = new Show
                {
                    TmdbId = bs.TmdbId, Title = bs.Title, TitleAr = bs.TitleAr, Year = bs.Year,
                    Overview = bs.Overview, Genres = bs.Genres, VoteAverage = bs.VoteAverage,
                    FolderPath = bs.FolderPath, IsArabic = bs.IsArabic, IsMatched = bs.IsMatched,
                    DateAdded = bs.DateAdded, WatchStatus = bs.WatchStatus, CompletedAt = bs.CompletedAt,
                    CompletedFromPlayback = bs.CompletedFromPlayback, ContentRating = bs.ContentRating,
                    Network = bs.Network, MalId = bs.MalId, IsDropped = bs.IsDropped,
                };
                _db.Shows.Add(show);
                await _db.SaveChangesAsync(ct).ConfigureAwait(false); // need show.Id for episodes below
                showsAdded++;
            }
            else
            {
                if (MergeWatchStatusForward(show.WatchStatus, bs.WatchStatus, out var mergedStatus))
                {
                    show.WatchStatus = mergedStatus;
                    show.CompletedAt ??= bs.CompletedAt;
                    show.CompletedFromPlayback = show.CompletedFromPlayback || bs.CompletedFromPlayback;
                    showsUpdated++;
                }
                if (!show.IsDropped && bs.IsDropped) { show.IsDropped = true; }
                if (string.IsNullOrWhiteSpace(show.ContentRating)) show.ContentRating = bs.ContentRating;
                if (string.IsNullOrWhiteSpace(show.Network)) show.Network = bs.Network;
                if (show.MalId == null) show.MalId = bs.MalId;
            }

            foreach (var be in bs.Episodes)
            {
                var ep = show.Episodes.FirstOrDefault(e => e.Season == be.Season && e.EpisodeNumber == be.EpisodeNumber);
                if (ep == null)
                {
                    ep = new Episode
                    {
                        ShowId = show.Id, Season = be.Season, EpisodeNumber = be.EpisodeNumber, Title = be.Title,
                        FilePath = be.FilePath, SubtitlePath = be.SubtitlePath, WatchStatus = be.WatchStatus,
                        CompletedAt = be.CompletedAt, CompletedFromPlayback = be.CompletedFromPlayback,
                        RewatchCount = be.RewatchCount,
                    };
                    _db.Episodes.Add(ep);
                    episodesAdded++;
                }
                else if (MergeWatchStatusForward(ep.WatchStatus, be.WatchStatus, out var mergedEpStatus))
                {
                    ep.WatchStatus = mergedEpStatus;
                    ep.CompletedAt ??= be.CompletedAt;
                    ep.CompletedFromPlayback = ep.CompletedFromPlayback || be.CompletedFromPlayback;
                    ep.RewatchCount = Math.Max(ep.RewatchCount, be.RewatchCount);
                    episodesUpdated++;
                }
                else if (ep.RewatchCount < be.RewatchCount)
                {
                    ep.RewatchCount = be.RewatchCount;
                    episodesUpdated++;
                }
            }
        }
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);

        // ── Movies ──
        foreach (var bm in payload.Movies)
        {
            var movie = await _db.Movies.FirstOrDefaultAsync(m => m.TmdbId == bm.TmdbId, ct).ConfigureAwait(false);
            if (movie == null)
            {
                _db.Movies.Add(new Movie
                {
                    TmdbId = bm.TmdbId, Title = bm.Title, TitleAr = bm.TitleAr, Year = bm.Year,
                    Overview = bm.Overview, Genres = bm.Genres, VoteAverage = bm.VoteAverage, Runtime = bm.Runtime,
                    FilePath = bm.FilePath, IsArabic = bm.IsArabic, IsMatched = bm.IsMatched, DateAdded = bm.DateAdded,
                    WatchStatus = bm.WatchStatus, CompletedAt = bm.CompletedAt,
                    CompletedFromPlayback = bm.CompletedFromPlayback, RewatchCount = bm.RewatchCount,
                    ContentRating = bm.ContentRating, CollectionId = bm.CollectionId, CollectionName = bm.CollectionName,
                });
                moviesAdded++;
            }
            else
            {
                var changed = false;
                if (MergeWatchStatusForward(movie.WatchStatus, bm.WatchStatus, out var mergedStatus))
                {
                    movie.WatchStatus = mergedStatus;
                    movie.CompletedAt ??= bm.CompletedAt;
                    movie.CompletedFromPlayback = movie.CompletedFromPlayback || bm.CompletedFromPlayback;
                    changed = true;
                }
                if (movie.RewatchCount < bm.RewatchCount) { movie.RewatchCount = bm.RewatchCount; changed = true; }
                if (string.IsNullOrWhiteSpace(movie.ContentRating) && !string.IsNullOrWhiteSpace(bm.ContentRating))
                { movie.ContentRating = bm.ContentRating; changed = true; }
                if (movie.CollectionId == null && bm.CollectionId != null)
                { movie.CollectionId = bm.CollectionId; movie.CollectionName = bm.CollectionName; changed = true; }
                if (changed) moviesUpdated++;
            }
        }
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);

        // ── Cast / crew ──
        var existingCastKeys = (await _db.CastMembers.AsNoTracking()
            .Select(c => new { c.MediaId, c.MediaType, c.PersonTmdbId })
            .ToListAsync(ct).ConfigureAwait(false))
            .Select(c => (c.MediaId, c.MediaType, c.PersonTmdbId))
            .ToHashSet();
        foreach (var bc in payload.CastMembers)
        {
            var key = (bc.MediaTmdbId, bc.MediaType, bc.PersonTmdbId);
            if (existingCastKeys.Contains(key)) continue;
            _db.CastMembers.Add(new CastMember
            {
                MediaId = bc.MediaTmdbId, MediaType = bc.MediaType, PersonTmdbId = bc.PersonTmdbId, Name = bc.Name,
                Character = bc.Character, BillingOrder = bc.BillingOrder,
            });
            existingCastKeys.Add(key);
            castAdded++;
        }

        // ── Library folders (scanned root paths) ──
        var existingFolderPaths = (await _db.LibraryFolders.AsNoTracking().Select(f => f.Path).ToListAsync(ct).ConfigureAwait(false))
            .Select(p => p.Trim().ToLowerInvariant()).ToHashSet();
        foreach (var bf in payload.LibraryFolders)
        {
            var key = bf.Path.Trim().ToLowerInvariant();
            if (existingFolderPaths.Contains(key)) continue;
            _db.LibraryFolders.Add(new LibraryFolder { Path = bf.Path, IsActive = bf.IsActive });
            existingFolderPaths.Add(key);
            foldersAdded++;
        }

        // ── Lists ──
        var existingLists = await _db.UserLists.Include(l => l.Items).ToListAsync(ct).ConfigureAwait(false);
        foreach (var bl in payload.Lists)
        {
            var list = existingLists.FirstOrDefault(l => l.Name == bl.Name && l.IsDefault == bl.IsDefault);
            if (list == null)
            {
                list = new UserList { Name = bl.Name, CreatedAt = bl.CreatedAt, IsDefault = bl.IsDefault };
                _db.UserLists.Add(list);
                existingLists.Add(list);
                listsAdded++;
            }
            foreach (var bi in bl.Items)
            {
                if (list.Items.Any(i => i.TmdbId == bi.TmdbId && i.MediaType == bi.MediaType)) continue;
                list.Items.Add(new ListItem
                {
                    TmdbId = bi.TmdbId, MediaType = bi.MediaType, AddedAt = bi.AddedAt, Title = bi.Title,
                    PosterRemoteUrl = bi.PosterRemoteUrl, ImdbId = bi.ImdbId,
                });
                listItemsAdded++;
            }
        }
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);

        // ── Watch history ──
        var existingHistoryKeys = (await _db.WatchHistories.AsNoTracking()
            .Select(h => new { h.FilePath, h.TmdbId, h.SeasonNumber, h.EpisodeNumber, h.Source, h.OpenedAt })
            .ToListAsync(ct).ConfigureAwait(false))
            .Select(h => WatchHistoryKey(h.FilePath, h.TmdbId, h.SeasonNumber, h.EpisodeNumber, h.Source, h.OpenedAt))
            .ToHashSet();
        foreach (var bh in payload.WatchHistory)
        {
            var key = WatchHistoryKey(bh.FilePath, bh.TmdbId, bh.SeasonNumber, bh.EpisodeNumber, bh.Source, bh.OpenedAt);
            if (existingHistoryKeys.Contains(key)) continue;
            _db.WatchHistories.Add(new WatchHistory
            {
                FilePath = bh.FilePath, Title = bh.Title, MediaType = bh.MediaType, OpenedAt = bh.OpenedAt,
                StartedAt = bh.StartedAt, StoppedAt = bh.StoppedAt, EstimatedSeconds = bh.EstimatedSeconds,
                FileDurationSeconds = bh.FileDurationSeconds, IsCompleted = bh.IsCompleted,
                MaxKnownPositionSeconds = bh.MaxKnownPositionSeconds,
                LastExplicitPositionSeconds = bh.LastExplicitPositionSeconds, LastHeartbeatAtUtc = bh.LastHeartbeatAtUtc,
                IsStopFinalized = bh.IsStopFinalized, SuppressContinueWatching = bh.SuppressContinueWatching,
                TmdbId = bh.TmdbId, ImdbId = bh.ImdbId, Source = bh.Source, SeasonNumber = bh.SeasonNumber,
                EpisodeNumber = bh.EpisodeNumber, PosterUrl = bh.PosterUrl,
            });
            existingHistoryKeys.Add(key);
            historyAdded++;
        }

        // ── Ratings snapshots (seed only — never overwrite a live snapshot) ──
        var existingRatingKeys = (await _db.RatingsSnapshots.AsNoTracking()
            .Select(r => new { r.TmdbId, r.MediaType }).ToListAsync(ct).ConfigureAwait(false))
            .Select(r => (r.TmdbId, r.MediaType)).ToHashSet();
        foreach (var br in payload.Ratings)
        {
            var key = (br.TmdbId, br.MediaType);
            if (existingRatingKeys.Contains(key)) continue;
            _db.RatingsSnapshots.Add(new RatingsSnapshot
            {
                TmdbId = br.TmdbId, MediaType = br.MediaType, TmdbRating = br.TmdbRating,
                TmdbVoteCount = br.TmdbVoteCount, ImdbRating = br.ImdbRating, ImdbVotes = br.ImdbVotes,
                RottenTomatoesCritics = br.RottenTomatoesCritics, RottenTomatoesAudience = br.RottenTomatoesAudience,
                ImdbId = br.ImdbId, RatingsLastUpdatedAtUtc = br.RatingsLastUpdatedAtUtc,
                RatingsConfidence = br.RatingsConfidence, SourceMask = br.SourceMask, RefreshTier = br.RefreshTier,
                NextRefreshAtUtc = br.NextRefreshAtUtc, CreatedAtUtc = br.CreatedAtUtc, UpdatedAtUtc = br.UpdatedAtUtc,
            });
            existingRatingKeys.Add(key);
            ratingsAdded++;
        }

        // ── Settings (fill missing keys only — never clobber a live configured value) ──
        var existingSettingKeys = (await _db.Settings.AsNoTracking().Select(s => s.Key).ToListAsync(ct).ConfigureAwait(false))
            .ToHashSet();
        foreach (var bs2 in payload.Settings)
        {
            if (existingSettingKeys.Contains(bs2.Key)) continue;
            _db.Settings.Add(new Setting { Key = bs2.Key, Value = bs2.Value });
            existingSettingKeys.Add(bs2.Key);
            settingsAdded++;
        }

        // ── Trakt connection (only if nothing connected locally yet) ──
        if (payload.Trakt != null)
        {
            var localTrakt = await _db.TraktSettings.FirstOrDefaultAsync(ct).ConfigureAwait(false);
            if (localTrakt == null)
            {
                _db.TraktSettings.Add(new TraktSettings
                {
                    AccessToken = payload.Trakt.AccessToken, RefreshToken = payload.Trakt.RefreshToken,
                    TokenExpiresAt = payload.Trakt.TokenExpiresAt, IsConnected = payload.Trakt.IsConnected,
                    AutoSyncEnabled = payload.Trakt.AutoSyncEnabled, LastSyncedAtUtc = payload.Trakt.LastSyncedAtUtc,
                });
                traktRestored = true;
            }
        }

        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
        await tx.CommitAsync(ct).ConfigureAwait(false);

        return new LibraryBackupImportResult(
            moviesAdded, moviesUpdated, showsAdded, showsUpdated, episodesAdded, episodesUpdated, castAdded,
            foldersAdded, listsAdded, listItemsAdded, historyAdded, ratingsAdded, settingsAdded, traktRestored);
    }

    /// <summary>True (with the status to apply) when the incoming status is strictly further along than the
    /// current one — Unwatched &lt; Watching &lt; Completed. Never lets an import regress progress backward.</summary>
    private static bool MergeWatchStatusForward(string current, string incoming, out string merged)
    {
        merged = current;
        if (Rank(incoming) <= Rank(current)) return false;
        merged = incoming;
        return true;

        static int Rank(string s) => s switch
        {
            WatchStatuses.Completed => 2,
            WatchStatuses.Watching => 1,
            _ => 0,
        };
    }

    private static (string FilePath, int? TmdbId, int? SeasonNumber, int? EpisodeNumber, string Source, DateTime OpenedAt) WatchHistoryKey(
        string filePath, int? tmdbId, int? seasonNumber, int? episodeNumber, string source, DateTime openedAt) =>
        tmdbId != null
            ? ("", tmdbId, seasonNumber, episodeNumber, source, default)
            : (filePath, null, null, null, source, openedAt);
}
