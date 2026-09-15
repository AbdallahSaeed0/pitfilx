using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services.Recommendations;

/// <summary>A title used to seed a recommendation batch. <paramref name="MediaType"/> uses the app convention
/// ("Movie"/"Series"), matching <see cref="LibraryRepository"/> and Awards call sites.</summary>
public record RecommendationSeed(int TmdbId, string MediaType, string? Title = null);

public record RecommendationSeedRef(int TmdbId, string MediaType, string Title);

public class RecommendationCandidate
{
    public int TmdbId { get; set; }
    /// <summary>TMDB convention: "movie" or "tv".</summary>
    public string MediaType { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Year { get; set; }
    public string? Overview { get; set; }
    public string? PosterUrl { get; set; }
    public double VoteAverage { get; set; }
    public int VoteCount { get; set; }
    public double Score { get; set; }
    public bool InLibrary { get; set; }
    public int? LibraryId { get; set; }
    public string? WatchStatus { get; set; }
    public List<RecommendationSeedRef> ContributingSeeds { get; set; } = new();
}

/// <summary>
/// Feature-agnostic candidate scoring engine shared by the detail page's "You may like this" section and
/// the Recommendations page. Takes one or more seed titles, pools TMDB recommendations/similar results,
/// scores candidates additively (source tier, seed-overlap bonus, genre/cast/crew/collection overlap with
/// the contributing seeds), and tags each candidate with an in-library flag.
/// </summary>
public static class RecommendationEngine
{
    private const int MaxSeeds = 24;
    private const int DeepScoreCandidateCap = 60;
    private const int DeepScoreConcurrency = 6;

    private const double RecommendationsTierScore = 500;
    private const double SimilarTierScore = 250;
    private const double AdditionalSeedBonus = 150;
    private const double GenreOverlapWeight = 40;
    private const double CastOverlapWeight = 8;
    private const double DirectorOverlapBonus = 120;
    private const double WriterOverlapBonus = 80;
    private const double CollectionBonus = 400;
    private const int MaxBillingOrderConsidered = 10;

    private sealed record SeedContext(
        RecommendationSeed Seed,
        bool IsMovie,
        List<TmdbDiscoverItem> Recommendations,
        List<TmdbDiscoverItem> Similar,
        HashSet<int> GenreIds,
        List<TmdbCastMember> Cast,
        List<TmdbCrewMember> Crew,
        (int Id, string Name)? Collection);

    private sealed class Aggregate
    {
        public TmdbDiscoverItem Item = null!;
        public double SourceScore;
        public readonly List<SeedContext> ContributingSeeds = new();
    }

    public static async Task<IReadOnlyList<RecommendationCandidate>> BuildAsync(
        TmdbClient tmdb,
        LibraryRepository repo,
        LibraryContext db,
        IReadOnlyList<RecommendationSeed> seeds,
        int limit,
        CancellationToken ct)
    {
        if (seeds.Count == 0)
            return Array.Empty<RecommendationCandidate>();

        var trimmedSeeds = seeds.Take(MaxSeeds).ToList();
        var seedKeys = new HashSet<string>(
            trimmedSeeds.Select(s => SeedKey(s.MediaType, s.TmdbId)), StringComparer.Ordinal);

        var seedContexts = (await Task.WhenAll(trimmedSeeds.Select(s => FetchSeedContextAsync(tmdb, s, ct)))
                .ConfigureAwait(false))
            .Where(c => c != null)
            .Select(c => c!)
            .ToList();

        if (seedContexts.Count == 0)
            return Array.Empty<RecommendationCandidate>();

        var aggregates = new Dictionary<string, Aggregate>(StringComparer.Ordinal);

        void Absorb(SeedContext seedCtx, IEnumerable<TmdbDiscoverItem> items, double tierScore)
        {
            foreach (var item in items)
            {
                if (item.Id <= 0)
                    continue;
                var key = SeedKey(item.MediaType, item.Id);
                if (seedKeys.Contains(key))
                    continue;

                if (!aggregates.TryGetValue(key, out var agg))
                {
                    agg = new Aggregate { Item = item };
                    aggregates[key] = agg;
                }

                var isNewSeed = agg.ContributingSeeds.All(s => s.Seed != seedCtx.Seed);
                if (isNewSeed)
                {
                    agg.SourceScore += tierScore + (agg.ContributingSeeds.Count > 0 ? AdditionalSeedBonus : 0);
                    agg.ContributingSeeds.Add(seedCtx);
                }
            }
        }

        foreach (var seedCtx in seedContexts)
        {
            Absorb(seedCtx, seedCtx.Recommendations, RecommendationsTierScore);
            Absorb(seedCtx, seedCtx.Similar, SimilarTierScore);
        }

        foreach (var agg in aggregates.Values)
        {
            var seedGenres = agg.ContributingSeeds.SelectMany(s => s.GenreIds).ToHashSet();
            var overlap = agg.Item.GenreIds.Count(g => seedGenres.Contains(g));
            agg.SourceScore += overlap * GenreOverlapWeight;
        }

        var deepScorePool = aggregates.Values
            .OrderByDescending(a => a.SourceScore)
            .Take(DeepScoreCandidateCap)
            .ToList();

        using var gate = new SemaphoreSlim(DeepScoreConcurrency);
        await Task.WhenAll(deepScorePool.Select(async agg =>
        {
            await gate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                agg.SourceScore += await ComputeDeepScoreBonusAsync(tmdb, agg, ct).ConfigureAwait(false);
            }
            catch
            {
                // deep-scoring failure for one candidate shouldn't drop it — keep its base score.
            }
            finally
            {
                gate.Release();
            }
        })).ConfigureAwait(false);

        var (movieLibrary, showLibrary) = await LoadLibraryIndexAsync(db, ct).ConfigureAwait(false);

        var results = aggregates.Values
            .OrderByDescending(a => a.SourceScore)
            .Take(Math.Max(1, limit))
            .Select(a => ToCandidate(a, movieLibrary, showLibrary))
            .ToList();

        return results;
    }

    private static async Task<double> ComputeDeepScoreBonusAsync(TmdbClient tmdb, Aggregate agg, CancellationToken ct)
    {
        var item = agg.Item;
        var isMovie = item.MediaType.Equals("movie", StringComparison.OrdinalIgnoreCase);
        var mediaTypeArg = isMovie ? "Movie" : "Series";

        var creditsTask = tmdb.TryGetCreditsAsync(item.Id, mediaTypeArg, ct);
        var collectionTask = GetCollectionOrNullAsync(tmdb, isMovie, item.Id, ct);
        await Task.WhenAll(creditsTask, collectionTask).ConfigureAwait(false);

        var credits = creditsTask.Result;
        var collection = collectionTask.Result;
        double bonus = 0;

        if (credits != null)
        {
            var (cast, crew) = credits.Value;
            var candidateCastByPerson = cast
                .Where(c => c.Id > 0 && c.BillingOrder < MaxBillingOrderConsidered)
                .ToDictionary(c => c.Id, c => c.BillingOrder);
            var candidateDirectors = crew
                .Where(c => c.Id > 0 && c.Job.Equals("Director", StringComparison.OrdinalIgnoreCase))
                .Select(c => c.Id)
                .ToHashSet();
            var candidateWriters = crew
                .Where(c => c.Id > 0 &&
                    (c.Job.Equals("Writer", StringComparison.OrdinalIgnoreCase) ||
                     c.Job.Equals("Screenplay", StringComparison.OrdinalIgnoreCase) ||
                     c.Job.Equals("Story", StringComparison.OrdinalIgnoreCase)))
                .Select(c => c.Id)
                .ToHashSet();

            foreach (var seedCtx in agg.ContributingSeeds)
            {
                foreach (var seedCast in seedCtx.Cast)
                {
                    if (seedCast.Id <= 0 || seedCast.BillingOrder >= MaxBillingOrderConsidered)
                        continue;
                    if (candidateCastByPerson.TryGetValue(seedCast.Id, out var candidateOrder))
                    {
                        var weight = MaxBillingOrderConsidered - Math.Min(seedCast.BillingOrder, candidateOrder);
                        bonus += weight * CastOverlapWeight;
                    }
                }

                var seedDirectors = seedCtx.Crew
                    .Where(c => c.Id > 0 && c.Job.Equals("Director", StringComparison.OrdinalIgnoreCase))
                    .Select(c => c.Id);
                bonus += seedDirectors.Count(candidateDirectors.Contains) * DirectorOverlapBonus;

                var seedWriters = seedCtx.Crew
                    .Where(c => c.Id > 0 &&
                        (c.Job.Equals("Writer", StringComparison.OrdinalIgnoreCase) ||
                         c.Job.Equals("Screenplay", StringComparison.OrdinalIgnoreCase) ||
                         c.Job.Equals("Story", StringComparison.OrdinalIgnoreCase)))
                    .Select(c => c.Id);
                bonus += seedWriters.Count(candidateWriters.Contains) * WriterOverlapBonus;
            }
        }

        if (collection.HasValue &&
            agg.ContributingSeeds.Any(s => s.Collection.HasValue && s.Collection.Value.Id == collection.Value.Id))
        {
            bonus += CollectionBonus;
        }

        return bonus;
    }

    private static async Task<SeedContext?> FetchSeedContextAsync(TmdbClient tmdb, RecommendationSeed seed, CancellationToken ct)
    {
        if (seed.TmdbId <= 0)
            return null;

        try
        {
            var isMovie = seed.MediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase);
            var mediaTypeArg = isMovie ? "Movie" : "Series";

            var recsTask = isMovie
                ? tmdb.GetMovieApiRecommendationsAsync(seed.TmdbId, 1, ct)
                : tmdb.GetTvApiRecommendationsAsync(seed.TmdbId, 1, ct);
            var simTask = isMovie
                ? tmdb.GetMovieSimilarAsync(seed.TmdbId, 1, ct)
                : tmdb.GetTvSimilarAsync(seed.TmdbId, 1, ct);
            var genreTask = tmdb.GetGenreIdsAsync(seed.TmdbId, mediaTypeArg, ct);
            var creditsTask = tmdb.TryGetCreditsAsync(seed.TmdbId, mediaTypeArg, ct);
            var collectionTask = GetCollectionOrNullAsync(tmdb, isMovie, seed.TmdbId, ct);

            await Task.WhenAll(recsTask, simTask, genreTask, creditsTask, collectionTask).ConfigureAwait(false);

            var credits = creditsTask.Result;
            return new SeedContext(
                seed,
                isMovie,
                recsTask.Result,
                simTask.Result,
                genreTask.Result.ToHashSet(),
                credits?.Cast ?? new List<TmdbCastMember>(),
                credits?.Crew ?? new List<TmdbCrewMember>(),
                collectionTask.Result);
        }
        catch
        {
            // Per-seed TMDB failures are skipped silently — the rest of the batch still runs.
            return null;
        }
    }

    private static async Task<(Dictionary<int, (int Id, string? WatchStatus)> Movies,
        Dictionary<int, (int Id, string? WatchStatus)> Shows)> LoadLibraryIndexAsync(
        LibraryContext db, CancellationToken ct)
    {
        var movies = await db.Movies.AsNoTracking()
            .Where(m => m.IsMatched)
            .Select(m => new { m.Id, m.TmdbId, m.WatchStatus })
            .ToListAsync(ct).ConfigureAwait(false);
        var shows = await db.Shows.AsNoTracking()
            .Where(s => s.IsMatched)
            .Select(s => new { s.Id, s.TmdbId, s.WatchStatus })
            .ToListAsync(ct).ConfigureAwait(false);

        return (
            movies.ToDictionary(m => m.TmdbId, m => (m.Id, (string?)m.WatchStatus)),
            shows.ToDictionary(s => s.TmdbId, s => (s.Id, (string?)s.WatchStatus)));
    }

    private static RecommendationCandidate ToCandidate(
        Aggregate agg,
        Dictionary<int, (int Id, string? WatchStatus)> movieLibrary,
        Dictionary<int, (int Id, string? WatchStatus)> showLibrary)
    {
        var item = agg.Item;
        var isMovie = item.MediaType.Equals("movie", StringComparison.OrdinalIgnoreCase);
        var lookup = isMovie ? movieLibrary : showLibrary;
        var inLibrary = lookup.TryGetValue(item.Id, out var libEntry);
        var year = item.ReleaseDate.Length >= 4 ? item.ReleaseDate[..4] : null;

        return new RecommendationCandidate
        {
            TmdbId = item.Id,
            MediaType = item.MediaType,
            Title = item.Title,
            Year = year,
            Overview = string.IsNullOrWhiteSpace(item.Overview) ? null : item.Overview,
            PosterUrl = string.IsNullOrEmpty(item.PosterPath) ? null : $"https://image.tmdb.org/t/p/w342{item.PosterPath}",
            VoteAverage = item.VoteAverage,
            VoteCount = item.VoteCount,
            Score = agg.SourceScore,
            InLibrary = inLibrary,
            LibraryId = inLibrary ? libEntry.Id : null,
            WatchStatus = inLibrary ? libEntry.WatchStatus : null,
            ContributingSeeds = agg.ContributingSeeds
                .Select(s => new RecommendationSeedRef(s.Seed.TmdbId, s.Seed.MediaType, s.Seed.Title ?? ""))
                .ToList(),
        };
    }

    private static async Task<(int Id, string Name)?> GetCollectionOrNullAsync(
        TmdbClient tmdb, bool isMovie, int tmdbId, CancellationToken ct)
    {
        if (!isMovie)
            return null;
        return await tmdb.TryGetMovieCollectionInfoAsync(tmdbId, ct).ConfigureAwait(false);
    }

    private static string SeedKey(string mediaType, int tmdbId)
    {
        var normalized = mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase) ||
                          mediaType.Equals("movie", StringComparison.OrdinalIgnoreCase)
            ? "movie"
            : "tv";
        return $"{normalized}:{tmdbId}";
    }
}
