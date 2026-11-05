using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;
using Pitflix.API.Services;
using Pitflix.Core.Models;

namespace Pitflix.API.Endpoints;

/// <summary>
/// Matches the desktop Cinemas Schedule's scraped movies (VOX / Premiere titles) to TMDB films,
/// so the page can link them into Pitflix, show ratings, and know which are on the watchlist.
/// The scraping itself happens in the Tauri shell; this only does the TMDB side.
/// </summary>
public static class CinemasEndpoints
{
    private static readonly TimeSpan HitTtl = TimeSpan.FromDays(7);
    /// <summary>Misses retry sooner: TMDB often adds a local release a few days after it's announced.</summary>
    private static readonly TimeSpan MissTtl = TimeSpan.FromHours(12);
    private const int MaxItems = 80;
    private const int Parallel = 4;
    /// <summary>Below this the best candidate is more likely a different film than the right one.</summary>
    private const double AcceptScore = 70;

    public sealed record MatchItem(string Key, string Title, int? Year);
    public sealed record MatchBody(List<MatchItem>? Items);

    private sealed record Match(int TmdbId, string Title, string? Year, string? PosterUrl, double VoteAverage);

    // Event / format noise the chains put in titles: "(Infinity Vision)", "(Arabic)", ": Encore", "IMAX"…
    private static readonly Regex NoiseParens = new(
        @"\s*[\(\[][^\)\]]*(arabic|english|dubbed|subtitled|imax|3d|4dx|screenx|vision|re-?release|encore|anniversary|version)[^\)\]]*[\)\]]",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex NoiseSuffix = new(
        @"\s*(:|-|–)\s*(encore|re-?release|arabic|english|imax|3d|4dx)\b.*$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static void MapCinemasEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapPost("/api/cinemas/match", async (
            MatchBody body, ITmdbClientFactory tmdbClientFactory, IMemoryCache cache, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            var items = (body.Items ?? new()).Where(i => !string.IsNullOrWhiteSpace(i.Key) && !string.IsNullOrWhiteSpace(i.Title))
                .Take(MaxItems).ToList();
            var results = new Dictionary<string, Match?>();
            if (tmdb == null || items.Count == 0)
                return Results.Json(new { matches = results }, jsonSerializerOptions);

            using var gate = new SemaphoreSlim(Parallel);
            var tasks = items.Select(async item =>
            {
                var cleaned = CleanTitle(item.Title);
                var cacheKey = $"cinemas:match:{Normalize(cleaned)}:{item.Year}";
                if (cache.TryGetValue(cacheKey, out Match? cached))
                    return (item.Key, cached);

                await gate.WaitAsync(ct).ConfigureAwait(false);
                try
                {
                    var match = await FindAsync(tmdb, cleaned, item.Year, ct).ConfigureAwait(false);
                    cache.Set(cacheKey, match, match != null ? HitTtl : MissTtl);
                    return (item.Key, match);
                }
                catch (Exception) when (!ct.IsCancellationRequested)
                {
                    return (item.Key, (Match?)null); // not cached: a TMDB hiccup shouldn't stick
                }
                finally
                {
                    gate.Release();
                }
            });

            foreach (var (key, match) in await Task.WhenAll(tasks).ConfigureAwait(false))
                results[key] = match;
            return Results.Json(new { matches = results }, jsonSerializerOptions);
        });
    }

    private static async Task<Match?> FindAsync(Pitflix.Core.Api.TmdbClient tmdb, string title, int? year, CancellationToken ct)
    {
        if (title.Length < 2)
            return null;
        var hasArabic = title.Any(c => c >= '؀' && c <= 'ۿ');
        // With the year first (fewer wrong hits), then without — re-releases (Avengers: Endgame
        // in 2026) and films TMDB dates differently still need to be found.
        var candidates = year is > 0
            ? await tmdb.SearchAsync(title, "Movie", hasArabic, ct, 8, year).ConfigureAwait(false)
            : new List<TmdbSearchResult>();
        candidates = candidates
            .Concat(await tmdb.SearchAsync(title, "Movie", hasArabic, ct, 8).ConfigureAwait(false))
            .GroupBy(c => c.Id).Select(g => g.First()).ToList();

        var target = Normalize(title);
        var best = Best(candidates, target, year);

        // Egyptian films are transliterated differently by each chain and by TMDB ("Matloub
        // 3a2eleyain" / "Matloub Aelyan" / TMDB "Matloub Aaeleyan"), so a full-title search finds
        // nothing. Search the title's main word instead and let the consonant-skeleton rule decide.
        if (best.score < AcceptScore && MainWord(target) is { } word && word != target)
        {
            var more = year is > 0
                ? await tmdb.SearchAsync(word, "Movie", hasArabic, ct, 10, year).ConfigureAwait(false)
                : await tmdb.SearchAsync(word, "Movie", hasArabic, ct, 10).ConfigureAwait(false);
            var retry = Best(more, target, year);
            if (retry.score > best.score)
                best = retry;
        }
        if (best.c == null || best.score < AcceptScore)
            return null;

        var c = best.c;
        return new Match(
            c.Id,
            c.Title,
            c.ReleaseDate.Length >= 4 ? c.ReleaseDate[..4] : null,
            string.IsNullOrEmpty(c.PosterPath) ? null : $"https://image.tmdb.org/t/p/w342{c.PosterPath}",
            Math.Round(c.VoteAverage, 1));
    }

    private static (TmdbSearchResult? c, double score) Best(IEnumerable<TmdbSearchResult> candidates, string target, int? year) =>
        candidates
            .Select(c => ((TmdbSearchResult?)c, Score(c, target, year)))
            .OrderByDescending(x => x.Item2)
            .ThenByDescending(x => x.Item1!.Popularity)
            .FirstOrDefault();

    private static readonly HashSet<string> StopWords = new(StringComparer.Ordinal)
    {
        "the", "a", "an", "el", "al", "w", "wa", "and", "of", "ya",
    };

    /// <summary>The longest meaningful word of a normalized title (e.g. "matloub").</summary>
    private static string? MainWord(string normalized) =>
        normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(w => w.Length >= 4 && !StopWords.Contains(w) && !w.All(char.IsDigit))
            .OrderByDescending(w => w.Length)
            .FirstOrDefault();

    /// <summary>
    /// Consonant skeleton of a transliterated title: Franco-Arabic digits (3 = ع, 2 = ء, 7 = ح…),
    /// vowels and y dropped, q read as k, repeats collapsed. "matloub aelyan", "matloub aaeleyan"
    /// and "matloub 3a2eleyain" all become "mtlbln"; "el tany" and "el tani" both "ltn".
    /// </summary>
    internal static string Skeleton(string normalized)
    {
        var sb = new StringBuilder(normalized.Length);
        foreach (var ch in normalized)
        {
            if (ch == ' ' || char.IsDigit(ch) || "aeiouy".Contains(ch))
                continue;
            var c = ch == 'q' ? 'k' : ch;
            if (sb.Length > 0 && sb[^1] == c)
                continue;
            sb.Append(c);
        }
        return sb.ToString();
    }

    /// <summary>Title agreement dominates; the release year only breaks ties between similar titles.</summary>
    private static double Score(TmdbSearchResult c, string target, int? year)
    {
        var a = Normalize(c.Title);
        var b = Normalize(c.OriginalTitle);
        double score;
        if (a == target || b == target)
            score = 100;
        else if (a.Length > 0 && (a.StartsWith(target) || target.StartsWith(a)) && Math.Min(a.Length, target.Length) >= 6)
            score = 75; // "Dune Part Three" vs "Dune: Part Three — …"
        else if (Skeleton(target).Length >= 5 && (Skeleton(a) == Skeleton(target) || Skeleton(b) == Skeleton(target)))
            score = 72; // same transliterated title, different spelling; a wrong year drops it below the bar
        else
            score = Math.Max(TokenSimilarity(c.Title, target), TokenSimilarity(c.OriginalTitle, target)) * 70;

        if (int.TryParse(c.ReleaseDate.Length >= 4 ? c.ReleaseDate[..4] : "", out var y) && year is > 0)
            score += Math.Abs(y - year.Value) <= 1 ? 15 : -10;
        return score;
    }

    private static double TokenSimilarity(string candidate, string normalizedTarget)
    {
        var x = Tokens(candidate);
        var y = normalizedTarget.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        if (x.Count == 0 || y.Count == 0)
            return 0;
        return (double)x.Intersect(y).Count() / x.Union(y).Count();
    }

    private static HashSet<string> Tokens(string s) =>
        Normalize(s).Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet();

    internal static string CleanTitle(string title)
    {
        var t = NoiseParens.Replace(title, "");
        t = NoiseSuffix.Replace(t, "");
        return t.Trim();
    }

    /// <summary>Lower-case, accents and punctuation stripped, single spaces.</summary>
    internal static string Normalize(string s)
    {
        var decomposed = s.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
        {
            var cat = CharUnicodeInfo.GetUnicodeCategory(ch);
            if (cat == UnicodeCategory.NonSpacingMark)
                continue;
            sb.Append(char.IsLetterOrDigit(ch) ? char.ToLowerInvariant(ch) : ' ');
        }
        return Regex.Replace(sb.ToString(), @"\s+", " ").Trim();
    }
}
