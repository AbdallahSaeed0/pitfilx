using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services.Trailers;

/// <summary>Maps <see cref="TrailerItem"/> rows from DB ingestion into the same JSON card shape the React UI expects (compact: no scores in output).</summary>
public static class PersistedTrailerUiFeed
{
    /// <summary>Maps browse <c>filter</c> to <see cref="TrailersRepository.GetLatestTrailersAsync"/> mediaType.</summary>
    public static string? BrowseRepoMediaType(bool wantMovie, bool wantTv)
    {
        if (wantMovie && wantTv)
            return null;
        if (wantMovie)
            return "movie";
        return "tv";
    }

    public static List<TrailerCardUiRow> TakeForBrowse(IReadOnlyList<TrailerCardUiRow> rows, string? searchTrim,
        int take)
    {
        var q = (searchTrim ?? "").Trim();
        IEnumerable<TrailerCardUiRow> seq = rows;
        if (q.Length >= 2)
        {
            seq = rows.Where(r =>
                r.Title.Contains(q, StringComparison.OrdinalIgnoreCase) ||
                r.TrailerTitle.Contains(q, StringComparison.OrdinalIgnoreCase));
        }

        return seq.Take(Math.Clamp(take, 1, 200)).ToList();
    }

    /// <summary>
    /// Returns rows ordered by persisted ingestion (newest YouTube publish first), enriched with minimal TMDB fields for title/poster only.
    /// </summary>
    public static async Task<IReadOnlyList<TrailerCardUiRow>> BuildAsync(
        TrailersRepository repo,
        TmdbClient? tmdb,
        int limit,
        string? mediaType,
        CancellationToken cancellationToken = default)
    {
        var rows = await repo
            .GetLatestTrailersAsync(limit, mediaType, activeOnly: true, publishedAfter: null, distinctCatalog: true,
                cancellationToken)
            .ConfigureAwait(false);

        if (rows.Count == 0 || tmdb == null)
            return rows.Count == 0
                ? Array.Empty<TrailerCardUiRow>()
                : rows.Select(r => ToRowWithoutTmdb(r)).ToList();

        var keys = rows.Select(r => (r.TmdbId, MtKey: NormalizeMtKey(r.MediaType))).Distinct().ToList();
        var cacheEntries = new System.Collections.Concurrent.ConcurrentDictionary<(int, string), TmdbDiscoverItem?>();
        var sem = new SemaphoreSlim(6, 6);
        await Task.WhenAll(keys.Select(async key =>
        {
            await sem.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                var d = await tmdb.TryGetDiscoverItemAsync(key.TmdbId, key.MtKey, cancellationToken).ConfigureAwait(false);
                cacheEntries[key] = d;
            }
            finally { sem.Release(); }
        })).ConfigureAwait(false);
        var cache = new Dictionary<(int TmdbId, string MtKey), TmdbDiscoverItem?>(cacheEntries);

        var list = new List<TrailerCardUiRow>(rows.Count);
        foreach (var r in rows)
        {
            var mk = NormalizeMtKey(r.MediaType);
            cache.TryGetValue((r.TmdbId, mk), out var d);
            list.Add(ToRow(r, d));
        }

        return list;
    }

    private static string NormalizeMtKey(string mediaType) =>
        mediaType.Equals("Series", StringComparison.OrdinalIgnoreCase) ? "tv" : "movie";

    private static TrailerCardUiRow ToRowWithoutTmdb(TrailerItem r)
    {
        var mt = NormalizeMtApiShape(r.MediaType);
        return new TrailerCardUiRow(
            r.TmdbId,
            mt,
            string.IsNullOrWhiteSpace(r.Title) ? $"TMDB {r.TmdbId}" : r.Title,
            null,
            null,
            r.VideoId,
            string.IsNullOrWhiteSpace(r.Title) ? r.VideoId : r.Title,
            null,
            r.PublishedAtUtc);
    }

    private static TrailerCardUiRow ToRow(TrailerItem r, TmdbDiscoverItem? d)
    {
        var mt = d?.MediaType ?? NormalizeMtApiShape(r.MediaType);
        var poster = d != null && !string.IsNullOrEmpty(d.PosterPath)
            ? $"https://image.tmdb.org/t/p/w500{d.PosterPath}"
            : null;
        var title = !string.IsNullOrWhiteSpace(d?.Title) ? d!.Title :
            string.IsNullOrWhiteSpace(r.Title) ? $"TMDB {r.TmdbId}" : r.Title;
        var release = string.IsNullOrWhiteSpace(d?.ReleaseDate) ? null : d!.ReleaseDate;
        return new TrailerCardUiRow(
            r.TmdbId,
            mt,
            title,
            poster,
            null,
            r.VideoId,
            TrailerTitleNormalizer.NormalizeClipTitle(r.Title),
            release,
            r.PublishedAtUtc);
    }

    /// <summary>UI / TMDB browse convention: lower-case <c>movie</c> | <c>tv</c>.</summary>
    private static string NormalizeMtApiShape(string persistedMediaType) =>
        persistedMediaType.Equals("Series", StringComparison.OrdinalIgnoreCase) ? "tv" : "movie";
}

public sealed record TrailerCardUiRow(
    int TmdbId,
    string MediaType,
    string Title,
    string? PosterUrl,
    string? BackdropUrl,
    string YoutubeKey,
    string TrailerTitle,
    string? ReleaseDate,
    DateTime TrailerPublishedAtUtc);
