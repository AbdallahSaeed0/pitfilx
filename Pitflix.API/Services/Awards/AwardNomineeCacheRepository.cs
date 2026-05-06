using System.Data;
using System.Globalization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;

namespace Pitflix.API.Services.Awards;

/// <summary>SQLite persistence for enriched awards nominee rows (preload / offline-first overlay).</summary>
public sealed class AwardNomineeCacheRepository
{
    private readonly LibraryContext _db;

    public AwardNomineeCacheRepository(LibraryContext db)
    {
        _db = db;
    }

    public async Task EnsureTableAsync(CancellationToken ct = default)
    {
        await _db.Database.ExecuteSqlRawAsync(
                """
                CREATE TABLE IF NOT EXISTS AwardNomineeCache (
                    Id INTEGER NOT NULL CONSTRAINT PK_AwardNomineeCache PRIMARY KEY AUTOINCREMENT,
                    AwardId TEXT NOT NULL,
                    Year INTEGER NOT NULL,
                    CategoryId TEXT NOT NULL,
                    Title TEXT NOT NULL,
                    MediaType TEXT NOT NULL,
                    IsWinner INTEGER NOT NULL,
                    TmdbId INTEGER NULL,
                    ImdbId TEXT NULL,
                    PosterPath TEXT NULL,
                    BackdropPath TEXT NULL,
                    LocalLibraryMatch INTEGER NOT NULL DEFAULT 0,
                    StreamAvailableEstimate INTEGER NOT NULL DEFAULT 0,
                    LastUpdatedAtUtc TEXT NOT NULL
                );
                """, ct)
            .ConfigureAwait(false);

        await _db.Database.ExecuteSqlRawAsync(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS IX_AwardNomineeCache_Key
                ON AwardNomineeCache(AwardId, Year, CategoryId, Title, MediaType);
                """, ct)
            .ConfigureAwait(false);
    }

    public async Task DeleteAllAsync(CancellationToken ct = default)
    {
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM AwardNomineeCache;", ct).ConfigureAwait(false);
    }

    public async Task DeleteEditionAsync(string awardId, int year, CancellationToken ct = default)
    {
        await _db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 DELETE FROM AwardNomineeCache WHERE AwardId = {awardId} AND Year = {year};
                 """, ct)
            .ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<AwardNomineeCacheRow>> GetEditionRowsAsync(string awardId, int year,
        CancellationToken ct = default)
    {
        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct).ConfigureAwait(false);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText =
            """
            SELECT AwardId, Year, CategoryId, Title, MediaType, IsWinner, TmdbId, ImdbId, PosterPath, BackdropPath,
                   LocalLibraryMatch, StreamAvailableEstimate, LastUpdatedAtUtc
            FROM AwardNomineeCache WHERE AwardId = $aid AND Year = $yr
            """;
        cmd.Parameters.Add(new SqliteParameter("$aid", awardId));
        cmd.Parameters.Add(new SqliteParameter("$yr", year));
        var list = new List<AwardNomineeCacheRow>();
        await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await r.ReadAsync(ct).ConfigureAwait(false))
        {
            list.Add(new AwardNomineeCacheRow(
                r.GetString(0),
                r.GetInt32(1),
                r.GetString(2),
                r.GetString(3),
                r.GetString(4),
                r.GetInt32(5) != 0,
                r.IsDBNull(6) ? null : r.GetInt32(6),
                r.IsDBNull(7) ? null : r.GetString(7),
                r.IsDBNull(8) ? null : r.GetString(8),
                r.IsDBNull(9) ? null : r.GetString(9),
                r.GetInt32(10) != 0,
                r.GetInt32(11) != 0,
                DateTime.Parse(r.GetString(12), CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind)));
        }

        return list;
    }

    public async Task UpsertEditionRowsAsync(string awardId, int year, IReadOnlyList<AwardNomineeCacheRow> rows,
        CancellationToken ct = default)
    {
        await DeleteEditionAsync(awardId, year, ct).ConfigureAwait(false);
        if (rows.Count == 0) return;
        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct).ConfigureAwait(false);
        foreach (var row in rows)
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText =
                """
                INSERT INTO AwardNomineeCache (
                    AwardId, Year, CategoryId, Title, MediaType, IsWinner, TmdbId, ImdbId,
                    PosterPath, BackdropPath, LocalLibraryMatch, StreamAvailableEstimate, LastUpdatedAtUtc)
                VALUES ($a,$y,$ci,$t,$mt,$w,$tid,$imdb,$pp,$bp,$lib,$stream,$lu);
                """;
            cmd.Parameters.Add(new SqliteParameter("$a", row.AwardId));
            cmd.Parameters.Add(new SqliteParameter("$y", row.Year));
            cmd.Parameters.Add(new SqliteParameter("$ci", row.CategoryId));
            cmd.Parameters.Add(new SqliteParameter("$t", row.Title));
            cmd.Parameters.Add(new SqliteParameter("$mt", row.MediaType));
            cmd.Parameters.Add(new SqliteParameter("$w", row.IsWinner ? 1 : 0));
            cmd.Parameters.Add(new SqliteParameter("$tid", row.TmdbId.HasValue ? row.TmdbId!.Value : DBNull.Value));
            cmd.Parameters.Add(new SqliteParameter("$imdb", row.ImdbId ?? (object)DBNull.Value));
            cmd.Parameters.Add(new SqliteParameter("$pp", row.PosterPath ?? (object)DBNull.Value));
            cmd.Parameters.Add(new SqliteParameter("$bp", row.BackdropPath ?? (object)DBNull.Value));
            cmd.Parameters.Add(new SqliteParameter("$lib", row.LocalLibraryMatch ? 1 : 0));
            cmd.Parameters.Add(new SqliteParameter("$stream", row.StreamAvailableEstimate ? 1 : 0));
            cmd.Parameters.Add(new SqliteParameter("$lu", row.LastUpdatedAtUtc.ToString("o", CultureInfo.InvariantCulture)));
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
    }

    public async Task<int> CountRowsAsync(CancellationToken ct = default)
    {
        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct).ConfigureAwait(false);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM AwardNomineeCache;";
        var o = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
        return Convert.ToInt32(o ?? 0);
    }
}

public sealed record AwardNomineeCacheRow(
    string AwardId,
    int Year,
    string CategoryId,
    string Title,
    string MediaType,
    bool IsWinner,
    int? TmdbId,
    string? ImdbId,
    string? PosterPath,
    string? BackdropPath,
    bool LocalLibraryMatch,
    bool StreamAvailableEstimate,
    DateTime LastUpdatedAtUtc);
