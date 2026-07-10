using Pitflix.Core.Database;

namespace Pitflix.API.Services.Trakt;

/// <summary>Resolves a local TMDB id to a Trakt id, caching the result in TraktIdMap so repeat lookups
/// (scrobbling the same title again, or re-running an import) never hit the network. MediaType is
/// "movie" or "show" — episodes are addressed via their parent show's Trakt id plus season/episode numbers.</summary>
public sealed class TraktIdResolver
{
    private readonly TraktApiClient _client;

    public TraktIdResolver(TraktApiClient client)
    {
        _client = client;
    }

    public async Task<int?> ResolveAsync(int tmdbId, string mediaType, LibraryRepository repo, CancellationToken ct)
    {
        var normalized = string.Equals(mediaType, "show", StringComparison.OrdinalIgnoreCase) ? "show" : "movie";

        var cached = await repo.GetTraktIdAsync(tmdbId, normalized, ct).ConfigureAwait(false);
        if (cached.HasValue)
            return cached;

        var results = await _client.SendAndReadAsync<List<TraktSearchResult>>(HttpMethod.Get,
            $"/search/tmdb/{tmdbId}?type={normalized}", null, null, ct).ConfigureAwait(false);
        if (results == null)
            return null;

        var traktId = normalized == "movie"
            ? results.FirstOrDefault(r => r.Movie != null)?.Movie?.Ids.Trakt
            : results.FirstOrDefault(r => r.Show != null)?.Show?.Ids.Trakt;

        if (traktId is not int id)
            return null;

        await repo.SaveTraktIdAsync(tmdbId, normalized, id, ct).ConfigureAwait(false);
        return id;
    }
}
