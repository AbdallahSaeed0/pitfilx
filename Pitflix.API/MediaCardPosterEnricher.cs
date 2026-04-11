using Pitflix.Core.Api;
using Pitflix.Core.Models;

namespace Pitflix.API;

/// <summary>Fills <see cref="MediaCardDto.PosterRemoteUrl"/> from TMDB when no local/HTTP poster is available,
/// and repairs missing or junk titles using TMDB.</summary>
public static class MediaCardPosterEnricher
{
    private static bool NeedsTitleFallback(string? title)
    {
        if (string.IsNullOrWhiteSpace(title))
            return true;
        var t = title.Trim();
        if (t.Length < 2)
            return true;
        var lettersOrDigits = t.Count(char.IsLetterOrDigit);
        // Ripped filenames / punctuation-only “titles”
        return lettersOrDigits < Math.Max(1, t.Length / 4);
    }

    public static async Task EnrichMissingRemotePostersAsync(
        IReadOnlyList<MediaCardDto> mappedCards,
        TmdbClient? tmdb,
        CancellationToken cancellationToken = default)
    {
        if (tmdb == null || mappedCards.Count == 0)
            return;

        var targets = mappedCards
            .Where(c => c.TmdbId > 0 && (string.IsNullOrEmpty(c.PosterRemoteUrl) || NeedsTitleFallback(c.Title)))
            .ToList();
        if (targets.Count == 0)
            return;

        await Parallel.ForEachAsync(targets, new ParallelOptions
        {
            MaxDegreeOfParallelism = 4,
            CancellationToken = cancellationToken
        }, async (card, ct) =>
        {
            var mt = string.Equals(card.TmdbMediaType, "Series", StringComparison.OrdinalIgnoreCase)
                ? "Series"
                : "Movie";

            if (string.IsNullOrEmpty(card.PosterRemoteUrl))
            {
                var art = await tmdb.GetArtworkPathsAsync(card.TmdbId, mt, ct).ConfigureAwait(false);
                if (art != null && !string.IsNullOrEmpty(art.Value.PosterPath))
                    card.PosterRemoteUrl = $"https://image.tmdb.org/t/p/w342{art.Value.PosterPath}";
            }

            if (NeedsTitleFallback(card.Title))
            {
                var t = await tmdb.TryGetDisplayTitleAsync(card.TmdbId, mt, ct).ConfigureAwait(false);
                if (!string.IsNullOrWhiteSpace(t))
                    card.Title = t.Trim();
            }
        }).ConfigureAwait(false);
    }
}
