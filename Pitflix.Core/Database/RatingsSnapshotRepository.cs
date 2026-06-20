using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Models;

namespace Pitflix.Core.Database;

public sealed class RatingsSnapshotRepository
{
    private readonly LibraryContext _db;

    public RatingsSnapshotRepository(LibraryContext db)
    {
        _db = db;
    }

    public async Task EnsureRatingsSnapshotsTableAsync(CancellationToken cancellationToken = default)
    {
        await _db.Database.ExecuteSqlRawAsync(
                """
                CREATE TABLE IF NOT EXISTS RatingsSnapshots (
                    Id INTEGER NOT NULL CONSTRAINT PK_RatingsSnapshots PRIMARY KEY AUTOINCREMENT,
                    TmdbId INTEGER NOT NULL,
                    MediaType TEXT NOT NULL,
                    TmdbRating REAL NULL,
                    TmdbVoteCount INTEGER NULL,
                    ImdbRating TEXT NULL,
                    ImdbVotes TEXT NULL,
                    RottenTomatoesCritics TEXT NULL,
                    RottenTomatoesAudience TEXT NULL,
                    RatingsLastUpdatedAtUtc TEXT NOT NULL,
                    RatingsConfidence REAL NOT NULL,
                    ImdbId TEXT NULL,
                    SourceMask INTEGER NOT NULL DEFAULT 0,
                    RefreshTier TEXT NOT NULL DEFAULT 'normal',
                    NextRefreshAtUtc TEXT NOT NULL,
                    CreatedAtUtc TEXT NOT NULL,
                    UpdatedAtUtc TEXT NOT NULL
                );
                """, cancellationToken)
            .ConfigureAwait(false);

        await _db.Database.ExecuteSqlRawAsync(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS IX_RatingsSnapshots_TmdbId_MediaType
                ON RatingsSnapshots(TmdbId, MediaType);
                """, cancellationToken)
            .ConfigureAwait(false);
        await _db.Database.ExecuteSqlRawAsync(
                """
                CREATE INDEX IF NOT EXISTS IX_RatingsSnapshots_NextRefreshAtUtc
                ON RatingsSnapshots(NextRefreshAtUtc);
                """, cancellationToken)
            .ConfigureAwait(false);
        await _db.Database.ExecuteSqlRawAsync(
                """
                CREATE INDEX IF NOT EXISTS IX_RatingsSnapshots_RatingsLastUpdatedAtUtc
                ON RatingsSnapshots(RatingsLastUpdatedAtUtc DESC);
                """, cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<RatingsCoverageStats> GetCoverageStatsAsync(CancellationToken cancellationToken = default)
    {
        var total = await _db.RatingsSnapshots.AsNoTracking().CountAsync(cancellationToken).ConfigureAwait(false);
        if (total == 0)
            return new RatingsCoverageStats(0, 0, 0, 0, 0);

        var withImdb = await _db.RatingsSnapshots.AsNoTracking()
            .CountAsync(x => x.ImdbRating != null && x.ImdbRating != "", cancellationToken)
            .ConfigureAwait(false);
        var withRt = await _db.RatingsSnapshots.AsNoTracking()
            .CountAsync(x => x.RottenTomatoesCritics != null && x.RottenTomatoesCritics != "" &&
                             x.RottenTomatoesCritics != "N/A" && x.RottenTomatoesCritics != "N/A%",
                cancellationToken)
            .ConfigureAwait(false);
        var tmdbOnly = await _db.RatingsSnapshots.AsNoTracking()
            .CountAsync(x => x.SourceMask == RatingsSourceMask.Tmdb, cancellationToken)
            .ConfigureAwait(false);
        var missingScore = await _db.RatingsSnapshots.AsNoTracking()
            .CountAsync(x => (x.ImdbRating == null || x.ImdbRating == "") &&
                             x.ImdbId != null && x.ImdbId != "", cancellationToken)
            .ConfigureAwait(false);

        return new RatingsCoverageStats(total, withImdb, withRt, tmdbOnly, missingScore);
    }

    public async Task<IReadOnlyList<(int TmdbId, string MediaType)>> GetStaleSnapshotKeysAsync(DateTime nowUtc,
        int limit, CancellationToken cancellationToken = default)
    {
        var take = Math.Clamp(limit, 1, 500);
        var rows = await _db.RatingsSnapshots.AsNoTracking()
            .Where(x => x.NextRefreshAtUtc <= nowUtc)
            .OrderBy(x => x.NextRefreshAtUtc)
            .Take(take)
            .Select(x => new { x.TmdbId, x.MediaType })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        return rows.ConvertAll(x => (x.TmdbId, x.MediaType));
    }

    public async Task<RatingsSnapshot?> GetSnapshotAsync(int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        var mt = NormalizeMediaType(mediaType);
        if (mt == null || tmdbId <= 0)
            return null;
        return await _db.RatingsSnapshots.AsNoTracking()
            .FirstOrDefaultAsync(x => x.TmdbId == tmdbId && x.MediaType == mt, cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>Insert or replace row keyed by <c>(TmdbId, MediaType)</c>.</summary>
    public async Task<RatingsSnapshot> AddOrUpdateSnapshotAsync(RatingsSnapshot snapshot,
        CancellationToken cancellationToken = default)
    {
        var mt = NormalizeMediaType(snapshot.MediaType);
        if (mt == null || snapshot.TmdbId <= 0)
            throw new ArgumentException("TmdbId and MediaType (Movie|Series) are required.", nameof(snapshot));

        snapshot.MediaType = mt;
        var now = DateTime.UtcNow;
        var existing = await _db.RatingsSnapshots
            .FirstOrDefaultAsync(x => x.TmdbId == snapshot.TmdbId && x.MediaType == mt, cancellationToken)
            .ConfigureAwait(false);

        if (existing == null)
        {
            snapshot.CreatedAtUtc = now;
            snapshot.UpdatedAtUtc = now;
            _db.RatingsSnapshots.Add(snapshot);
        }
        else
        {
            existing.TmdbRating = snapshot.TmdbRating;
            existing.TmdbVoteCount = snapshot.TmdbVoteCount;
            existing.ImdbRating = snapshot.ImdbRating;
            existing.ImdbVotes = snapshot.ImdbVotes;
            existing.RottenTomatoesCritics = snapshot.RottenTomatoesCritics;
            existing.RottenTomatoesAudience = snapshot.RottenTomatoesAudience;
            existing.RatingsLastUpdatedAtUtc = snapshot.RatingsLastUpdatedAtUtc;
            existing.RatingsConfidence = snapshot.RatingsConfidence;
            existing.ImdbId = snapshot.ImdbId;
            existing.SourceMask = snapshot.SourceMask;
            existing.RefreshTier = string.IsNullOrWhiteSpace(snapshot.RefreshTier) ? "normal" : snapshot.RefreshTier;
            existing.NextRefreshAtUtc = snapshot.NextRefreshAtUtc;
            existing.UpdatedAtUtc = now;
            snapshot = existing;
        }

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return snapshot;
    }

    private static string? NormalizeMediaType(string? mediaType)
    {
        if (string.IsNullOrWhiteSpace(mediaType))
            return null;
        var s = mediaType.Trim();
        if (s.Equals("Movie", StringComparison.OrdinalIgnoreCase) || s.Equals("movie", StringComparison.OrdinalIgnoreCase))
            return "Movie";
        if (s.Equals("Series", StringComparison.OrdinalIgnoreCase) || s.Equals("tv", StringComparison.OrdinalIgnoreCase))
            return "Series";
        return null;
    }
}
