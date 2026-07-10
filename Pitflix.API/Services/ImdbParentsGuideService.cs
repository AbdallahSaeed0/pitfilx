using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;
using Pitflix.Core.Database;

namespace Pitflix.API.Services;

public sealed record ParentsGuideCategory(string Name, string Severity, IReadOnlyList<string> Items);

public sealed record ParentsGuideResult(string ImdbId, string? OverallRating, IReadOnlyList<ParentsGuideCategory> Categories);

/// <summary>
/// Fetches IMDb's Parents Guide page via a readability proxy (r.jina.ai) — IMDb's parental-guide content is
/// rendered client-side and not exposed through any public API, so we go through a text-extraction proxy rather
/// than parsing raw IMDb HTML/JSON (which changes shape frequently and isn't reliably scrapable server-side).
/// r.jina.ai returns Markdown; each category appears as a "## [Category Name](url)" heading, followed by
/// "Add an item", a blank line, the severity word alone on its own line, a vote-tally line, then each
/// specific item as its own paragraph (no bullet markers) until the next heading or a trailing "Spoilers" line.
/// </summary>
public sealed class ImdbParentsGuideService
{
    // IMPORTANT: no User-Agent override here — r.jina.ai (fronted by Cloudflare) 403s requests carrying a
    // spoofed browser UA; a client with no UA header (.NET's HttpClient default) is treated as legitimate.
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };

    private static readonly (string Name, Regex Pattern)[] CategoryPatterns =
    [
        ("Sex & Nudity", new Regex(@"##\s*\[\s*Sex\s*(?:&|and)\s*Nudity\s*\]", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
        ("Violence & Gore", new Regex(@"##\s*\[\s*Violence\s*(?:&|and)\s*Gore\s*\]", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
        ("Profanity", new Regex(@"##\s*\[\s*Profanity\s*\]", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
        ("Alcohol, Drugs & Smoking", new Regex(@"##\s*\[\s*Alcohol[,/]?\s*Drugs\s*(?:&|and|/)?\s*Smoking\s*\]", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
        ("Frightening & Intense Scenes", new Regex(@"##\s*\[\s*Frightening\s*(?:&|and|/)?\s*Intense\s*Scenes\s*\]", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
    ];

    /// <summary>Matches a severity word sitting alone on its own line (the real Markdown layout), not just
    /// anywhere in a sentence — avoids false positives from item text that happens to contain these words.</summary>
    private static readonly Regex SeverityLineRegex =
        new(@"(?m)^\s*(None|Mild|Moderate|Severe)\s*$", RegexOptions.Compiled);

    private static readonly Regex OverallRatingRegex =
        new(@"Rating\s*\([^)]*\)\s*(.+)", RegexOptions.Compiled);

    private static readonly Regex VoteTallyLineRegex =
        new(@"^\d+\s+of\s+\d+\s+found this\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex NextHeadingRegex = new(@"##\s*\[", RegexOptions.Compiled);

    /// <summary>Fixed IMDb taxonomy order — used as a fallback key when the page has no per-category
    /// headings to match against by name (see TV-series fallback in <see cref="Parse"/>).</summary>
    private static readonly string[] CategoryOrder =
    [
        "Sex & Nudity", "Violence & Gore", "Profanity", "Alcohol, Drugs & Smoking", "Frightening & Intense Scenes",
    ];

    private readonly IMemoryCache _cache;
    private readonly LibraryRepository _repo;

    public ImdbParentsGuideService(IMemoryCache cache, LibraryRepository repo)
    {
        _cache = cache;
        _repo = repo;
    }

    private sealed record CachedEnvelope(DateTime CachedAtUtc, ParentsGuideResult Data);

    public async Task<ParentsGuideResult?> TryFetchAsync(string? imdbId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(imdbId) || !imdbId.StartsWith("tt", StringComparison.OrdinalIgnoreCase))
            return null;

        var id = imdbId.Trim();
        var cacheKey = $"parents-guide:{id}";
        if (_cache.TryGetValue(cacheKey, out ParentsGuideResult? cachedMem))
            return cachedMem;

        // In-memory cache is process-lifetime only — back it with the persisted Settings store so a
        // successfully-fetched guide survives API restarts instead of re-hitting the scrape proxy.
        var settingKey = $"ParentsGuideCache:{id}";
        var persistedJson = await _repo.GetSettingAsync(settingKey, ct).ConfigureAwait(false);
        if (!string.IsNullOrEmpty(persistedJson))
        {
            try
            {
                var envelope = JsonSerializer.Deserialize<CachedEnvelope>(persistedJson);
                if (envelope != null && DateTime.UtcNow - envelope.CachedAtUtc < TimeSpan.FromDays(30))
                {
                    _cache.Set(cacheKey, envelope.Data, TimeSpan.FromDays(14));
                    return envelope.Data;
                }
            }
            catch
            {
                /* corrupt/old-shape entry — fall through and refetch */
            }
        }

        try
        {
            var proxyUrl = $"https://r.jina.ai/https://www.imdb.com/title/{Uri.EscapeDataString(id)}/parentalguide/";
            var text = await Http.GetStringAsync(proxyUrl, ct).ConfigureAwait(false);
            var result = Parse(id, text);
            if (result != null)
            {
                _cache.Set(cacheKey, result, TimeSpan.FromDays(14));
                var envelope = new CachedEnvelope(DateTime.UtcNow, result);
                await _repo.SaveSettingAsync(settingKey, JsonSerializer.Serialize(envelope), ct).ConfigureAwait(false);
            }
            else
            {
                // Don't persist negative results — a transient scrape failure shouldn't durably poison
                // this title; only cache it in-memory for the rest of this process's lifetime.
                _cache.Set(cacheKey, (ParentsGuideResult?)null, TimeSpan.FromDays(1));
            }
            return result;
        }
        catch
        {
            return null;
        }
    }

    private static ParentsGuideResult? Parse(string imdbId, string text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;

        var matches = new List<(int Index, string Name)>();
        foreach (var (name, pattern) in CategoryPatterns)
        {
            var m = pattern.Match(text);
            if (m.Success)
                matches.Add((m.Index, name));
        }

        var overallMatch = OverallRatingRegex.Match(text);
        var overall = overallMatch.Success ? overallMatch.Groups[1].Value.Trim() : null;

        if (matches.Count == 0)
        {
            // TV-series pages come back from the proxy with no per-category headings at all (unlike
            // movie pages) — just a flat sequence of "<severity word alone> / <vote tally> / items…"
            // blocks in IMDb's fixed taxonomy order. Fall back to positional matching in that case.
            var positional = ParseByPositionalSeverity(imdbId, text, overall);
            return positional;
        }

        matches.Sort((a, b) => a.Index.CompareTo(b.Index));

        var categories = new List<ParentsGuideCategory>();
        for (var i = 0; i < matches.Count; i++)
        {
            var start = matches[i].Index;
            int end;
            if (i + 1 < matches.Count)
            {
                end = matches[i + 1].Index;
            }
            else
            {
                // Last known category — bound it at the *next* Markdown heading of any kind (e.g.
                // "## [Certifications]"), not end-of-text, or its item list would swallow unrelated sections.
                var nextHeading = NextHeadingRegex.Match(text, start + 2);
                end = nextHeading.Success ? nextHeading.Index : text.Length;
            }

            var slice = text[start..end];
            var severityMatch = SeverityLineRegex.Match(slice);
            var severity = severityMatch.Success ? severityMatch.Groups[1].Value : "Unknown";
            var items = ExtractItems(slice, severity);
            categories.Add(new ParentsGuideCategory(matches[i].Name, severity, items));
        }

        return new ParentsGuideResult(imdbId, overall, categories);
    }

    /// <summary>Fallback for pages with no "## [Category]" headings (observed on TV-series pages): each
    /// category's content block starts with the severity word alone on its own line, in IMDb's fixed
    /// taxonomy order, so we can zip the first 5 such lines to the 5 known category names positionally.</summary>
    private static ParentsGuideResult? ParseByPositionalSeverity(string imdbId, string text, string? overall)
    {
        var severityMatches = SeverityLineRegex.Matches(text).Cast<Match>().ToList();
        if (severityMatches.Count < CategoryOrder.Length)
            return null;

        var categories = new List<ParentsGuideCategory>();
        for (var i = 0; i < CategoryOrder.Length; i++)
        {
            var start = severityMatches[i].Index;
            var end = i + 1 < severityMatches.Count ? severityMatches[i + 1].Index : text.Length;
            var slice = text[start..end];
            var severity = severityMatches[i].Groups[1].Value;
            var items = ExtractItems(slice, severity);
            categories.Add(new ParentsGuideCategory(CategoryOrder[i], severity, items));
        }

        return new ParentsGuideResult(imdbId, overall, categories);
    }

    /// <summary>Items are plain paragraphs (no bullet markers) — split on blank lines and drop everything
    /// that isn't an actual item: any heading, "Add an item", the lone severity word, the vote-tally
    /// line, and the trailing "Spoilers" link.</summary>
    private static List<string> ExtractItems(string slice, string severity) =>
        slice
            .Split(["\r\n\r\n", "\n\n"], StringSplitOptions.None)
            .Select(p => p.Trim())
            .Where(p => p.Length > 0)
            .Where(p => !p.StartsWith("##", StringComparison.Ordinal))
            .Where(p => !p.Equals("Add an item", StringComparison.OrdinalIgnoreCase))
            .Where(p => !p.Equals("Spoilers", StringComparison.OrdinalIgnoreCase))
            .Where(p => !p.Equals(severity, StringComparison.OrdinalIgnoreCase))
            .Where(p => !VoteTallyLineRegex.IsMatch(p))
            .Select(p => p.Trim('"').Trim())
            .Where(p => p.Length > 0)
            .Take(12)
            .ToList();
}
