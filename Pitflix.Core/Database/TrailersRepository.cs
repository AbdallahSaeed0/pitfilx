using System.Data;
using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Models;

namespace Pitflix.Core.Database;

public sealed class TrailersRepository
{
    private readonly LibraryContext _db;

    public TrailersRepository(LibraryContext db)
    {
        _db = db;
    }

    public async Task EnsureTrailersTableAsync(CancellationToken cancellationToken = default)
    {
        await _db.Database.ExecuteSqlRawAsync(
                """
                CREATE TABLE IF NOT EXISTS TrailerItems (
                    Id INTEGER NOT NULL CONSTRAINT PK_TrailerItems PRIMARY KEY AUTOINCREMENT,
                    VideoId TEXT NOT NULL,
                    YoutubeUrl TEXT NOT NULL,
                    Title TEXT NOT NULL,
                    ChannelName TEXT NOT NULL,
                    ChannelId TEXT NULL,
                    IngestionSource TEXT NOT NULL DEFAULT 'yt_channel_search',
                    MatchConfidence REAL NOT NULL DEFAULT 0,
                    TrustTier INTEGER NOT NULL DEFAULT 2,
                    TmdbId INTEGER NOT NULL,
                    MediaType TEXT NOT NULL,
                    PublishedAtUtc TEXT NOT NULL,
                    QualityScore REAL NOT NULL,
                    IsActive INTEGER NOT NULL DEFAULT 1,
                    CreatedAtUtc TEXT NOT NULL,
                    UpdatedAtUtc TEXT NOT NULL
                );
                """, cancellationToken)
            .ConfigureAwait(false);

        await _db.Database.ExecuteSqlRawAsync(
                "CREATE UNIQUE INDEX IF NOT EXISTS IX_TrailerItems_VideoId ON TrailerItems(VideoId);", cancellationToken)
            .ConfigureAwait(false);
        await _db.Database.ExecuteSqlRawAsync(
                "CREATE INDEX IF NOT EXISTS IX_TrailerItems_PublishedAtUtc ON TrailerItems(PublishedAtUtc DESC);",
                cancellationToken)
            .ConfigureAwait(false);
        await _db.Database.ExecuteSqlRawAsync(
                "CREATE INDEX IF NOT EXISTS IX_TrailerItems_TmdbId_MediaType_PublishedAtUtc ON TrailerItems(TmdbId, MediaType, PublishedAtUtc DESC);",
                cancellationToken)
            .ConfigureAwait(false);
        await _db.Database.ExecuteSqlRawAsync(
                "CREATE INDEX IF NOT EXISTS IX_TrailerItems_IsActive_PublishedAtUtc ON TrailerItems(IsActive, PublishedAtUtc DESC);",
                cancellationToken)
            .ConfigureAwait(false);
        await _db.Database.ExecuteSqlRawAsync(
                "CREATE INDEX IF NOT EXISTS IX_TrailerItems_MediaType ON TrailerItems(MediaType);", cancellationToken)
            .ConfigureAwait(false);

        await EnsureTrailerItemMetadataColumnsAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task EnsureTrailerChannelSyncStatesTableAsync(CancellationToken cancellationToken = default)
    {
        await _db.Database.ExecuteSqlRawAsync(
                """
                CREATE TABLE IF NOT EXISTS TrailerChannelSyncStates (
                    ChannelId TEXT NOT NULL CONSTRAINT PK_TrailerChannelSyncStates PRIMARY KEY,
                    ChannelName TEXT NOT NULL,
                    UploadsPlaylistId TEXT NULL,
                    LastCheckedAtUtc TEXT NOT NULL,
                    LastSeenVideoId TEXT NULL,
                    LastSeenPublishedAtUtc TEXT NULL
                );
                """, cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<TrailerChannelSyncState?> GetTrailerChannelSyncStateAsync(string channelId,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(channelId))
            return null;
        return await _db.TrailerChannelSyncStates.AsNoTracking()
            .FirstOrDefaultAsync(x => x.ChannelId == channelId, cancellationToken).ConfigureAwait(false);
    }

    public async Task UpsertTrailerChannelSyncStateAsync(TrailerChannelSyncState row,
        CancellationToken cancellationToken = default)
    {
        var existing = await _db.TrailerChannelSyncStates.FirstOrDefaultAsync(x => x.ChannelId == row.ChannelId, cancellationToken)
            .ConfigureAwait(false);
        if (existing == null)
        {
            _db.TrailerChannelSyncStates.Add(row);
        }
        else
        {
            existing.ChannelName = row.ChannelName;
            existing.UploadsPlaylistId = row.UploadsPlaylistId;
            existing.LastCheckedAtUtc = row.LastCheckedAtUtc;
            existing.LastSeenVideoId = row.LastSeenVideoId;
            existing.LastSeenPublishedAtUtc = row.LastSeenPublishedAtUtc;
        }

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task EnsureTrailerItemMetadataColumnsAsync(CancellationToken cancellationToken = default)
    {
        async Task AddIfMissingAsync(string column, string sql)
        {
            if (await SqliteColumnExistsAsync("TrailerItems", column, cancellationToken).ConfigureAwait(false))
                return;
            await _db.Database.ExecuteSqlRawAsync(sql, cancellationToken).ConfigureAwait(false);
        }

        await AddIfMissingAsync("ChannelId", "ALTER TABLE TrailerItems ADD COLUMN ChannelId TEXT NULL")
            .ConfigureAwait(false);
        await AddIfMissingAsync("IngestionSource",
                "ALTER TABLE TrailerItems ADD COLUMN IngestionSource TEXT NOT NULL DEFAULT 'yt_channel_search'")
            .ConfigureAwait(false);
        await AddIfMissingAsync("MatchConfidence",
                "ALTER TABLE TrailerItems ADD COLUMN MatchConfidence REAL NOT NULL DEFAULT 0")
            .ConfigureAwait(false);
        await AddIfMissingAsync("TrustTier", "ALTER TABLE TrailerItems ADD COLUMN TrustTier INTEGER NOT NULL DEFAULT 2")
            .ConfigureAwait(false);
    }

    private async Task<bool> SqliteColumnExistsAsync(string table, string column,
        CancellationToken cancellationToken = default)
    {
        var conn = _db.Database.GetDbConnection();
        var shouldClose = conn.State != ConnectionState.Open;
        if (shouldClose)
            await conn.OpenAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"PRAGMA table_info(\"{table}\")";
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var name = reader.GetString(1);
                if (string.Equals(name, column, StringComparison.OrdinalIgnoreCase))
                    return true;
            }

            return false;
        }
        finally
        {
            if (shouldClose)
                await conn.CloseAsync().ConfigureAwait(false);
        }
    }

    public async Task<TrailerItem> AddOrUpdateTrailerAsync(TrailerItem trailer,
        CancellationToken cancellationToken = default)
    {
        await using var transaction =
            await _db.Database.BeginTransactionAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var now = DateTime.UtcNow;
            var existing = await _db.TrailerItems.FirstOrDefaultAsync(x => x.VideoId == trailer.VideoId, cancellationToken)
                .ConfigureAwait(false);

            TrailerItem working;
            int? oldTmdbId = null;
            string? oldMediaType = null;
            if (existing == null)
            {
                trailer.CreatedAtUtc = now;
                trailer.UpdatedAtUtc = now;
                _db.TrailerItems.Add(trailer);
                working = trailer;
            }
            else
            {
                oldTmdbId = existing.TmdbId;
                oldMediaType = existing.MediaType;
                existing.YoutubeUrl = trailer.YoutubeUrl;
                existing.Title = trailer.Title;
                existing.ChannelName = trailer.ChannelName;
                existing.ChannelId = trailer.ChannelId;
                existing.IngestionSource = trailer.IngestionSource;
                existing.MatchConfidence = trailer.MatchConfidence;
                existing.TrustTier = trailer.TrustTier;
                existing.TmdbId = trailer.TmdbId;
                existing.MediaType = trailer.MediaType;
                existing.PublishedAtUtc = trailer.PublishedAtUtc;
                existing.QualityScore = trailer.QualityScore;
                existing.IsActive = trailer.IsActive;
                existing.UpdatedAtUtc = now;
                working = existing;
            }

            await ReconcileActiveWinnerAsync(working.TmdbId, working.MediaType, working.VideoId, excludeVideoId: null,
                cancellationToken).ConfigureAwait(false);
            if (oldTmdbId is { } ot && oldMediaType is { } om &&
                (ot != working.TmdbId || !string.Equals(om, working.MediaType, StringComparison.Ordinal)))
            {
                await ReconcileActiveWinnerAsync(ot, om, preferVideoId: null, excludeVideoId: working.VideoId,
                    cancellationToken).ConfigureAwait(false);
            }

            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
            return working;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken).ConfigureAwait(false);
            throw;
        }
    }

    private async Task ReconcileActiveWinnerAsync(int tmdbId, string mediaType, string? preferVideoId,
        string? excludeVideoId, CancellationToken cancellationToken = default)
    {
        var dbRows = await _db.TrailerItems
            .Where(x => x.TmdbId == tmdbId && x.MediaType == mediaType)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var byVideoId = new Dictionary<string, TrailerItem>(StringComparer.Ordinal);
        foreach (var r in dbRows)
        {
            if (excludeVideoId != null &&
                string.Equals(r.VideoId, excludeVideoId, StringComparison.Ordinal))
                continue;
            byVideoId[r.VideoId] = r;
        }

        foreach (var r in _db.TrailerItems.Local.Where(x => x.TmdbId == tmdbId && x.MediaType == mediaType))
        {
            if (excludeVideoId != null &&
                string.Equals(r.VideoId, excludeVideoId, StringComparison.Ordinal))
                continue;
            byVideoId[r.VideoId] = r;
        }

        var nowUtc = DateTime.UtcNow;
        var rows = byVideoId.Values
            // Keep latest official trailer/teaser picks sticky without blindly replacing with low-signal uploads.
            .OrderByDescending(x => ComputeActivationScore(x, nowUtc))
            .ThenByDescending(x => x.PublishedAtUtc)
            .ThenByDescending(x => x.QualityScore)
            .ThenByDescending(x => x.MatchConfidence)
            .ToList();
        if (rows.Count == 0)
            return;

        var winner = !string.IsNullOrEmpty(preferVideoId)
            ? rows.FirstOrDefault(x => x.VideoId == preferVideoId) ?? rows[0]
            : rows[0];
        foreach (var row in rows)
            row.IsActive = string.Equals(row.VideoId, winner.VideoId, StringComparison.Ordinal);
    }

    private static double ComputeActivationScore(TrailerItem row, DateTime nowUtc)
    {
        var ageDays = Math.Max(0.0, (nowUtc - row.PublishedAtUtc).TotalDays);
        var recencyBoost = ageDays <= 21 ? 0.90
            : ageDays <= 60 ? 0.55
            : ageDays <= 120 ? 0.25
            : 0.0;

        var t = row.Title.Trim().ToLowerInvariant();
        var hasOfficial = t.Contains("official", StringComparison.Ordinal);
        var hasTrailer = t.Contains("trailer", StringComparison.Ordinal);
        var hasTeaser = t.Contains("teaser", StringComparison.Ordinal);
        var likelyLowSignal = t.Contains("clip", StringComparison.Ordinal) ||
                              t.Contains("featurette", StringComparison.Ordinal) ||
                              t.Contains("tv spot", StringComparison.Ordinal) ||
                              t.Contains("reaction", StringComparison.Ordinal);

        var intentBoost = 0.0;
        if (hasOfficial && hasTrailer)
            intentBoost += 0.42;
        else if (hasOfficial && hasTeaser)
            intentBoost += 0.34;
        else if (hasTrailer)
            intentBoost += 0.26;
        else if (hasTeaser)
            intentBoost += 0.20;

        if (likelyLowSignal)
            intentBoost -= 0.45;

        var trustBoost = row.TrustTier <= 1 ? 0.22 : row.TrustTier == 2 ? 0.12 : 0.0;

        return row.QualityScore + (row.MatchConfidence * 0.70) + recencyBoost + intentBoost + trustBoost;
    }

    public async Task<IReadOnlyList<TrailerItem>> GetLatestTrailersAsync(
        int limit = 20,
        string? mediaType = null,
        bool? activeOnly = true,
        DateTime? publishedAfter = null,
        bool distinctCatalog = true,
        CancellationToken cancellationToken = default)
    {
        var take = Math.Clamp(limit, 1, 200);
        var mt = NormalizeMediaTypeFilter(mediaType);
        var q = _db.TrailerItems.AsNoTracking();
        if (activeOnly == true)
            q = q.Where(x => x.IsActive);
        else if (activeOnly == false)
            q = q.Where(x => !x.IsActive);
        if (mt != null)
            q = q.Where(x => x.MediaType == mt);
        if (publishedAfter is { } pa)
            q = q.Where(x => x.PublishedAtUtc >= pa);

        var overfetch = Math.Clamp(take * 14, 56, 400);
        var raw = await q
            .OrderByDescending(x => x.PublishedAtUtc)
            .Take(overfetch)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        if (!distinctCatalog)
            return raw.Take(take).ToList();

        var deduped = raw
            .GroupBy(x => (x.TmdbId, x.MediaType))
            .Select(g => g
                .OrderByDescending(x => x.IsActive)
                .ThenByDescending(x => x.QualityScore)
                .ThenByDescending(x => x.PublishedAtUtc)
                .First())
            .OrderByDescending(x => x.PublishedAtUtc)
            .Take(take)
            .ToList();
        return deduped;
    }

    public async Task<TrailerItem?> GetTrailerByVideoIdAsync(string videoId,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(videoId))
            return null;
        return await _db.TrailerItems.AsNoTracking()
            .FirstOrDefaultAsync(x => x.VideoId == videoId, cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<TrailerItem>> GetTrailersByTmdbIdAsync(int tmdbId,
        string? mediaType = null,
        bool? activeOnly = null,
        DateTime? publishedAfter = null,
        int? limit = null,
        CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
            return Array.Empty<TrailerItem>();

        var mt = NormalizeMediaTypeFilter(mediaType);
        var q = _db.TrailerItems.AsNoTracking().Where(x => x.TmdbId == tmdbId);
        if (mt != null)
            q = q.Where(x => x.MediaType == mt);
        if (activeOnly == true)
            q = q.Where(x => x.IsActive);
        else if (activeOnly == false)
            q = q.Where(x => !x.IsActive);
        if (publishedAfter is { } pa)
            q = q.Where(x => x.PublishedAtUtc >= pa);

        q = q.OrderByDescending(x => x.IsActive)
            .ThenByDescending(x => x.QualityScore)
            .ThenByDescending(x => x.PublishedAtUtc);

        if (limit is int lim)
            q = q.Take(Math.Clamp(lim, 1, 200));

        return await q.ToListAsync(cancellationToken).ConfigureAwait(false);
    }

    private static string? NormalizeMediaTypeFilter(string? mediaType)
    {
        if (string.IsNullOrWhiteSpace(mediaType))
            return null;
        var s = mediaType.Trim().ToLowerInvariant();
        if (s is "movie" or "movies")
            return "Movie";
        if (s is "tv" or "series" or "show")
            return "Series";
        return null;
    }

    /// <summary>Deletes inactive rows older than <paramref name="retentionDays"/> (inactive = not the active pick per TMDB scope).</summary>
    public async Task<int> PurgeInactiveTrailersOlderThanAsync(int retentionDays = 90,
        CancellationToken cancellationToken = default)
    {
        retentionDays = Math.Clamp(retentionDays, 30, 730);
        var cutoff = DateTime.UtcNow.AddDays(-retentionDays);
        return await _db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 DELETE FROM TrailerItems
                 WHERE IsActive = 0 AND PublishedAtUtc < {cutoff:o}
                 """, cancellationToken)
            .ConfigureAwait(false);
    }
}
