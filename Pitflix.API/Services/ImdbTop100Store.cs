namespace Pitflix.API.Services;

/// <summary>One title in the precomputed "Top 100 Movies on IMDb" ranking — built from real IMDb
/// scores (via <see cref="MdbListService"/>), not TMDB's own vote_average.</summary>
public sealed record ImdbTop100Item(
    int Id,
    string Title,
    string? Overview,
    string? PosterUrl,
    string? BackdropUrl,
    double ImdbRating,
    string? Year,
    string MediaType);

/// <summary>
/// Thread-safe holder for the current "Top 100 Movies on IMDb" ranking. Written by
/// <see cref="ImdbTop100RefreshHostedService"/> on a periodic background cycle (MDBList's 1
/// request/sec limit makes ranking ~150 candidates a multi-minute job — far too slow to do inline
/// per HTTP request), read directly by the discover endpoint.
/// </summary>
public sealed class ImdbTop100Store
{
    private volatile IReadOnlyList<ImdbTop100Item> _items = Array.Empty<ImdbTop100Item>();

    public IReadOnlyList<ImdbTop100Item> Items => _items;

    public DateTime? LastBuiltUtc { get; private set; }

    public void Set(IReadOnlyList<ImdbTop100Item> items)
    {
        _items = items;
        LastBuiltUtc = DateTime.UtcNow;
    }
}
