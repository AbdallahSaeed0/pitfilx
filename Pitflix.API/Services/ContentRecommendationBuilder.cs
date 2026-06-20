using Pitflix.Core.Api;
using Pitflix.Core.Models;

namespace Pitflix.API.Services;

/// <summary>
/// Content-based recommendations: TMDB /recommendations first, then discover with OR’d genres/keywords (not AND).
/// Ranks by genre overlap with the seed title so results stay in the same ballpark (e.g. live-action fantasy drama vs random top anime).
/// </summary>
public static class ContentRecommendationBuilder
{
    private const int AnimationGenreId = 16;

    /// <param name="filter">movie, tv, or both</param>
    public static async Task<IReadOnlyList<object>> BuildAsync(
        TmdbClient tmdb,
        int seedTmdbId,
        string seedMediaType,
        string filter,
        CancellationToken ct)
    {
        if (seedTmdbId <= 0)
            return Array.Empty<object>();

        var isMovieSeed = seedMediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase) ||
                          seedMediaType.Equals("movie", StringComparison.OrdinalIgnoreCase);

        var genreIds = await tmdb.GetGenreIdsAsync(seedTmdbId, isMovieSeed ? "Movie" : "Series", ct)
            .ConfigureAwait(false);
        var keywordIds = await tmdb.GetKeywordIdsAsync(seedTmdbId, isMovieSeed ? "Movie" : "Series", ct, 12)
            .ConfigureAwait(false);
        var seedGenres = genreIds.ToHashSet();
        var seedHasAnimation = seedGenres.Contains(AnimationGenreId);

        const double minVote = 5.4;
        const int minCount = 40;
        var wantMovie = !filter.Equals("tv", StringComparison.OrdinalIgnoreCase);
        var wantTv = !filter.Equals("movie", StringComparison.OrdinalIgnoreCase);

        var merged = new List<(TmdbDiscoverItem Item, int Tier)>();
        // Lower tier = higher priority. 0 = TMDB “similar”, 1 = keyword discover, 2 = genre discover.
        var seenKeys = new HashSet<string>(StringComparer.Ordinal);

        void TryAdd(TmdbDiscoverItem x, int tier)
        {
            if (x.Id <= 0) return;
            if (!wantMovie && x.MediaType == "movie") return;
            if (!wantTv && x.MediaType == "tv") return;
            var key = $"{x.MediaType}:{x.Id}";
            if (!seenKeys.Add(key))
                return;
            if (x.Id == seedTmdbId && x.MediaType == (isMovieSeed ? "movie" : "tv"))
                return;
            merged.Add((x, tier));
        }

        async Task DiscoverMoviesPassAsync(IReadOnlyList<int> genres, IReadOnlyList<int> keywords, int tier, int? exclude)
        {
            for (var page = 1; page <= 3; page++)
            {
                var chunk = await tmdb
                    .DiscoverMoviesBySignalsAsync(genres, keywords, exclude, minVote, minCount, page, ct)
                    .ConfigureAwait(false);
                foreach (var x in chunk)
                    TryAdd(x, tier);
            }
        }

        async Task DiscoverTvPassAsync(IReadOnlyList<int> genres, IReadOnlyList<int> keywords, int tier, int? exclude)
        {
            for (var page = 1; page <= 3; page++)
            {
                var chunk = await tmdb
                    .DiscoverTvBySignalsAsync(genres, keywords, exclude, minVote, minCount, page, ct)
                    .ConfigureAwait(false);
                foreach (var x in chunk)
                    TryAdd(x, tier);
            }
        }

        // 1) TMDB “because you watched X” (recommendations) + /similar — both are directly content-tied.
        if (wantMovie && isMovieSeed)
        {
            for (var p = 1; p <= 3; p++)
            {
                var rec = await tmdb.GetMovieApiRecommendationsAsync(seedTmdbId, p, ct).ConfigureAwait(false);
                foreach (var x in rec)
                    TryAdd(x, 0);
            }
            for (var p = 1; p <= 2; p++)
            {
                var sim = await tmdb.GetMovieSimilarAsync(seedTmdbId, p, ct).ConfigureAwait(false);
                foreach (var x in sim)
                    TryAdd(x, 0);
            }
        }

        if (wantTv && !isMovieSeed)
        {
            for (var p = 1; p <= 3; p++)
            {
                var rec = await tmdb.GetTvApiRecommendationsAsync(seedTmdbId, p, ct).ConfigureAwait(false);
                foreach (var x in rec)
                    TryAdd(x, 0);
            }
            for (var p = 1; p <= 2; p++)
            {
                var sim = await tmdb.GetTvSimilarAsync(seedTmdbId, p, ct).ConfigureAwait(false);
                foreach (var x in sim)
                    TryAdd(x, 0);
            }
        }

        // 2) Keyword discover (still content-tied).
        if (wantMovie)
        {
            var ex = isMovieSeed ? seedTmdbId : (int?)null;
            if (keywordIds.Count > 0)
                await DiscoverMoviesPassAsync(Array.Empty<int>(), keywordIds, 1, ex).ConfigureAwait(false);
        }

        if (wantTv)
        {
            var ex = !isMovieSeed ? seedTmdbId : (int?)null;
            if (keywordIds.Count > 0)
                await DiscoverTvPassAsync(Array.Empty<int>(), keywordIds, 1, ex).ConfigureAwait(false);
        }

        // 3) Genre discover — broader but still anchored to seed genres via overlap ranking below.
        if (wantMovie)
        {
            var ex = isMovieSeed ? seedTmdbId : (int?)null;
            if (genreIds.Count > 0)
                await DiscoverMoviesPassAsync(genreIds, Array.Empty<int>(), 2, ex).ConfigureAwait(false);
        }

        if (wantTv)
        {
            var ex = !isMovieSeed ? seedTmdbId : (int?)null;
            if (genreIds.Count > 0)
                await DiscoverTvPassAsync(genreIds, Array.Empty<int>(), 2, ex).ConfigureAwait(false);
        }

        int GenreOverlap(TmdbDiscoverItem x) =>
            x.GenreIds.Count(g => seedGenres.Contains(g));

        bool KeepPair(TmdbDiscoverItem x, int tier)
        {
            if (tier <= 0)
                return true;

            var overlap = GenreOverlap(x);

            if (!seedHasAnimation && tier > 0 && x.GenreIds.Contains(AnimationGenreId) && overlap == 0)
                return false;

            // Genre discover: must overlap (OR with_genres guarantees it when TMDB sends genre_ids).
            if (tier >= 2 && (overlap == 0 || x.GenreIds.Count == 0))
                return false;

            // Keyword discover: overlap required only if genres are present on the result.
            if (tier == 1 && x.GenreIds.Count > 0 && overlap == 0)
                return false;

            return true;
        }

        var scored = merged
            .Where(p => KeepPair(p.Item, p.Tier))
            .Select(p =>
            {
                var x = p.Item;
                var overlapNum = GenreOverlap(x);
                var tier = p.Tier;

                // Score formula (higher = better rank):
                //   1. Tier (TMDB recs > keyword discover > genre discover) — hard separation
                //   2. Rating  — primary quality signal within a tier
                //   3. Vote count (log-scaled) — credibility / avoids obscure low-count spikes
                //   4. Genre overlap — content similarity
                //   5. Recency bonus — prefer newer titles when all else is equal
                var releaseYear = x.ReleaseDate.Length >= 4 &&
                                  int.TryParse(x.ReleaseDate[..4], out var yr) ? yr : 1990;
                var logVotes  = x.VoteCount > 0 ? Math.Log10(x.VoteCount) : 0;
                var score = tier           * -10_000_000.0
                            + x.VoteAverage * 1_000_000.0  // 0-10 → 0-10M
                            + logVotes      *   100_000.0  // log10(50 000)≈4.7 → ~470K
                            + overlapNum    *    80_000.0  // 3 shared genres → 240K (up from 20K for stronger content relevance)
                            + releaseYear   *        10.0; // 2025 → 20 250, recency tie-break
                return (x, score);
            })
            .OrderByDescending(s => s.score)
            .ToList();

        var dtos = new List<object>();
        var outSeen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var s in scored)
        {
            var x = s.x;
            var key = $"{x.MediaType}:{x.Id}";
            if (!outSeen.Add(key))
                continue;
            var year = x.ReleaseDate.Length >= 4 ? x.ReleaseDate[..4] : "";
            dtos.Add(new
            {
                tmdbId = x.Id,
                mediaType = x.MediaType,
                title = x.Title,
                year = string.IsNullOrEmpty(year) ? null : year,
                overview = string.IsNullOrWhiteSpace(x.Overview)
                    ? null
                    : FixOverview(x.Overview),
                posterUrl = string.IsNullOrEmpty(x.PosterPath)
                    ? null
                    : $"https://image.tmdb.org/t/p/w342{x.PosterPath}",
                voteAverage = x.VoteAverage,
                voteCount = x.VoteCount
            });
            if (dtos.Count >= 48)
                break;
        }

        return dtos;
    }

    private static string FixOverview(string overview) =>
        overview.Length > 220 ? overview[..220] + "…" : overview;
}
