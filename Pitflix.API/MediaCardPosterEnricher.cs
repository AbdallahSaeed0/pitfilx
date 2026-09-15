using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API;

/// <summary>Fills <see cref="MediaCardDto.PosterRemoteUrl"/> from TMDB when no local/HTTP poster is available,
/// and repairs missing or junk titles using TMDB.</summary>
public static class MediaCardPosterEnricher
{
    /// <summary>
    /// How long a response is allowed to wait on TMDB before giving up and shipping what it has.
    ///
    /// Enrichment costs up to two TMDB round-trips (~150 ms each) per posterless card at a concurrency
    /// of 4, so a first-load page of 40 such cards could hold the response for several seconds — and it
    /// paid that again after every API restart, since the lookups are memoized in-process only. Cards
    /// past the deadline render with their title placeholder and get resolved by the background pass
    /// below, so the very next request finds them cached.
    /// </summary>
    private static readonly TimeSpan ForegroundBudget = TimeSpan.FromMilliseconds(900);

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

    /// <param name="repo">
    /// When supplied, newly-resolved poster URLs (and repaired titles) are cached back onto the
    /// matching local Movie/Show row (see <see cref="LibraryRepository.PersistEnrichedMediaCardsAsync"/>),
    /// so the next call for the same title reads it straight from the DB instead of hitting TMDB
    /// again — previously nothing persisted this, so every request re-enriched from scratch,
    /// forever. Optional and best-effort: pass null (or omit) for callers with no card whose
    /// <see cref="MediaCardDto.Id"/> maps to a real local library row (e.g. list items for titles
    /// never scanned locally), or where a failed cache write shouldn't affect the response.
    /// </param>
    public static async Task EnrichMissingRemotePostersAsync(
        IReadOnlyList<MediaCardDto> mappedCards,
        TmdbClient? tmdb,
        CancellationToken cancellationToken = default,
        LibraryRepository? repo = null)
    {
        if (tmdb == null || mappedCards.Count == 0)
            return;

        var targets = mappedCards
            .Where(c => c.TmdbId > 0 && (string.IsNullOrEmpty(c.PosterRemoteUrl) || NeedsTitleFallback(c.Title)))
            .ToList();
        if (targets.Count == 0)
            return;

        // Deadline applies to the wait, not to the work: cards we run out of time for are handed to a
        // detached pass that keeps going and populates TmdbClient's process-wide lookup caches.
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budget.CancelAfter(ForegroundBudget);

        var deferred = new System.Collections.Concurrent.ConcurrentQueue<MediaCardDto>();
        try
        {
            await Parallel.ForEachAsync(targets, new ParallelOptions
            {
                MaxDegreeOfParallelism = 4,
                CancellationToken = budget.Token
            }, async (card, ct) => await EnrichOneAsync(card, tmdb, ct).ConfigureAwait(false))
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // Budget expired. Everything still missing a poster goes to the background pass.
            foreach (var c in targets.Where(c => string.IsNullOrEmpty(c.PosterRemoteUrl) || NeedsTitleFallback(c.Title)))
                deferred.Enqueue(c);
        }

        if (!deferred.IsEmpty)
        {
            // Detached and repo-free on purpose: the caller's LibraryRepository is scoped to the request
            // and gets disposed the moment we return. This only warms TmdbClient's static caches, so the
            // next request's foreground pass resolves instantly and does the DB write itself. It walks
            // *copies* so it can't mutate DTOs the caller is already serializing into the response.
            var pending = deferred
                .Select(c => new MediaCardDto
                {
                    TmdbId = c.TmdbId,
                    Title = c.Title,
                    TmdbMediaType = c.TmdbMediaType,
                })
                .ToArray();
            _ = Task.Run(async () =>
            {
                try
                {
                    await Parallel.ForEachAsync(pending, new ParallelOptions { MaxDegreeOfParallelism = 4 },
                        async (card, ct) => await EnrichOneAsync(card, tmdb, ct).ConfigureAwait(false))
                        .ConfigureAwait(false);
                }
                catch { /* best-effort cache warm */ }
            }, CancellationToken.None);
        }

        if (repo == null)
            return;

        var toPersist = targets
            .Where(c => c.Id > 0 && !string.IsNullOrEmpty(c.PosterRemoteUrl))
            .Select(c => (c.Id, c.TmdbMediaType ?? "Movie", (string?)c.PosterRemoteUrl, (string?)c.Title))
            .ToList();
        if (toPersist.Count == 0)
            return;

        try
        {
            await repo.PersistEnrichedMediaCardsAsync(toPersist, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            // Best-effort cache warm — a failed write just means the next request re-enriches
            // from TMDB again; never let it break the response we already computed above.
        }
    }

    private static async Task EnrichOneAsync(MediaCardDto card, TmdbClient tmdb, CancellationToken ct)
    {
        var mt = string.Equals(card.TmdbMediaType, "Series", StringComparison.OrdinalIgnoreCase)
            ? "Series"
            : "Movie";

        try
        {
            if (string.IsNullOrEmpty(card.PosterRemoteUrl))
            {
                var art = await tmdb.GetArtworkPathsAsync(card.TmdbId, mt, ct).ConfigureAwait(false);
                if (art != null && !string.IsNullOrEmpty(art.Value.PosterPath))
                {
                    card.PosterRemoteUrl = $"https://image.tmdb.org/t/p/w342{art.Value.PosterPath}";
                }
                else
                {
                    // Primary poster_path is language-filtered (en-US); some titles only have
                    // posters tagged in another language or untagged, so fall back to /images.
                    var altPoster = await tmdb.TryGetAlternatePosterPathAsync(card.TmdbId, mt, ct).ConfigureAwait(false);
                    if (!string.IsNullOrEmpty(altPoster))
                        card.PosterRemoteUrl = $"https://image.tmdb.org/t/p/w342{altPoster}";
                }
            }

            if (NeedsTitleFallback(card.Title))
            {
                var t = await tmdb.TryGetDisplayTitleAsync(card.TmdbId, mt, ct).ConfigureAwait(false);
                if (!string.IsNullOrWhiteSpace(t))
                    card.Title = t.Trim();
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // One unreachable title must not fail the whole page — it keeps its placeholder and gets
            // another chance on the next request.
        }
    }
}
