using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services.Recommendations;

/// <summary>Computes the Recommendations page's auto-generated feed: seeds are the library's most recently
/// completed titles (no personal rating field exists, so recency-of-completion is the ranking signal), run
/// through the shared <see cref="RecommendationEngine"/>, and persisted to the LibraryRecommendations table.
/// On any failure the previously cached rows are left untouched.</summary>
public sealed class LibraryRecommendationsService
{
    private const int MaxSeeds = 20;
    private const int ResultLimit = 60;
    public const string ComputedAtSettingKey = "LibraryRecommendationsComputedAtUtc";

    private readonly LibraryContext _db;
    private readonly LibraryRepository _repo;
    private readonly ITmdbClientFactory _tmdbClientFactory;
    private readonly ILogger<LibraryRecommendationsService> _log;

    public LibraryRecommendationsService(
        LibraryContext db, LibraryRepository repo, ITmdbClientFactory tmdbClientFactory,
        ILogger<LibraryRecommendationsService> log)
    {
        _db = db;
        _repo = repo;
        _tmdbClientFactory = tmdbClientFactory;
        _log = log;
    }

    /// <summary>Returns true if the cache was refreshed; false means the previous cache was left in place
    /// (no watch history yet, no TMDB key configured, or the TMDB batch failed/came back empty).</summary>
    public async Task<bool> RefreshAsync(CancellationToken ct)
    {
        var tmdb = _tmdbClientFactory.Create();
        if (tmdb == null)
            return false;

        var seeds = await BuildSeedsAsync(ct).ConfigureAwait(false);
        if (seeds.Count == 0)
            return false;

        IReadOnlyList<RecommendationCandidate> candidates;
        try
        {
            candidates = await RecommendationEngine.BuildAsync(tmdb, _repo, _db, seeds, ResultLimit, ct)
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Library recommendations refresh failed; keeping previous cache");
            return false;
        }

        if (candidates.Count == 0)
            return false;

        var nowUtc = DateTime.UtcNow;
        var rows = candidates.Select((c, idx) => new LibraryRecommendation
        {
            TmdbId = c.TmdbId,
            MediaType = c.MediaType,
            Title = c.Title,
            Year = c.Year,
            Overview = c.Overview,
            PosterUrl = c.PosterUrl,
            VoteAverage = c.VoteAverage,
            VoteCount = c.VoteCount,
            Score = c.Score,
            ContributingSeedsJson = JsonSerializer.Serialize(c.ContributingSeeds),
            SortOrder = idx,
            ComputedAtUtc = nowUtc,
        }).ToList();

        await using var tx = await _db.Database.BeginTransactionAsync(ct).ConfigureAwait(false);
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM LibraryRecommendations", ct).ConfigureAwait(false);
        _db.LibraryRecommendations.AddRange(rows);
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
        await tx.CommitAsync(ct).ConfigureAwait(false);

        await _repo.SaveSettingAsync(ComputedAtSettingKey, nowUtc.ToString("O"), ct).ConfigureAwait(false);
        return true;
    }

    private async Task<List<RecommendationSeed>> BuildSeedsAsync(CancellationToken ct)
    {
        var completedMovies = await _db.Movies.AsNoTracking()
            .Where(m => m.IsMatched && m.TmdbId > 0 && m.WatchStatus == WatchStatuses.Completed)
            .OrderByDescending(m => m.CompletedAt)
            .Take(MaxSeeds)
            .Select(m => new { m.TmdbId, m.Title, m.CompletedAt })
            .ToListAsync(ct).ConfigureAwait(false);

        var completedShows = await _db.Shows.AsNoTracking()
            .Where(s => s.IsMatched && s.TmdbId > 0 && s.WatchStatus == WatchStatuses.Completed)
            .OrderByDescending(s => s.CompletedAt)
            .Take(MaxSeeds)
            .Select(s => new { s.TmdbId, s.Title, s.CompletedAt })
            .ToListAsync(ct).ConfigureAwait(false);

        return completedMovies
            .Select(m => (Seed: new RecommendationSeed(m.TmdbId, "Movie", m.Title), At: m.CompletedAt))
            .Concat(completedShows.Select(s => (Seed: new RecommendationSeed(s.TmdbId, "Series", s.Title), At: s.CompletedAt)))
            .OrderByDescending(x => x.At)
            .Take(MaxSeeds)
            .Select(x => x.Seed)
            .ToList();
    }
}
