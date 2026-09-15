namespace Pitflix.API.Services;

/// <summary>TV counterpart to <see cref="ImdbTop100Store"/> — see that type for the rationale
/// (precomputed, disk-persisted real-IMDb ranking, written by
/// <see cref="ImdbTop100RefreshHostedService"/>). Kept as a distinct singleton type (rather than a
/// second instance of <see cref="ImdbTop100Store"/>) so plain constructor DI can resolve movie vs.
/// TV without keyed services.</summary>
public sealed class ImdbTop100TvStore
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
