using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using AngleSharp.Html.Parser;
using Microsoft.EntityFrameworkCore;
using Pitflix.API.Services;
using Pitflix.Core.Database;

namespace Pitflix.API.Services.Letterboxd;

public sealed record LetterboxdDiaryEntry(string? Date, double? Rating, string? ReviewText, string? LogEntryUrl);

public sealed record LetterboxdFriendReview(
    string ReviewerUsername,
    string? ReviewerDisplayName,
    string? ReviewerAvatarUrl,
    double? Rating,
    string? ReviewText,
    string? WatchedDate,
    string? LogEntryUrl);

public sealed record LetterboxdFilmData(
    bool Configured,
    double? CommunityRating,
    int? RatingCount,
    double? UserRating,
    List<LetterboxdDiaryEntry> UserDiaryEntries,
    List<LetterboxdFriendReview> FriendReviews);

public sealed record LetterboxdAuthStatus(bool Configured, string? Username, bool SessionActive);

public sealed record LetterboxdSyncedMovie(int TmdbId, string Title, bool RatingFound, double? UserRating);

public sealed record LetterboxdSyncStatus(
    bool IsRunning, int Processed, int Total, bool RateLimited, string? Message,
    IReadOnlyList<LetterboxdSyncedMovie>? RecentlyProcessed = null);

/// <summary>
/// Additive Letterboxd integration: no login, no API key — scrapes Letterboxd's public pages for the
/// configured username's own rating/review and the ratings of people they follow, plus the public
/// community rating. Every public method fails closed (never throws) so the rest of the app is
/// unaffected if Letterboxd is unreachable, blocks the request, or changes its markup.
/// </summary>
public sealed class LetterboxdService
{
    private const string BaseUrl = "https://letterboxd.com";
    private const int MaxFollowedAccountsPerFilm = 50;

    private static readonly TimeSpan FilmCacheTtl = TimeSpan.FromDays(7);
    private static readonly TimeSpan ReviewCacheTtl = TimeSpan.FromHours(6);
    private static readonly TimeSpan FollowingCacheTtl = TimeSpan.FromDays(3);
    private static readonly TimeSpan RatedFilmsCacheTtl = TimeSpan.FromHours(12);
    private static readonly HtmlParser Parser = new();

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<LetterboxdService> _log;
    private readonly HttpClient _http;
    private readonly ITmdbClientFactory _tmdbClientFactory;

    // Global rate gate across every outbound request this service makes (slug resolution, ratings,
    // diary checks, grid pages, friend lookups — all of it). A short burst of unthrottled requests
    // (even just 4-5 in a couple seconds) reliably trips Cloudflare's rate-limit on this site, even
    // though a single isolated request succeeds. One shared gate, one minimum interval, everywhere.
    private readonly SemaphoreSlim _rateSemaphore = new(1, 1);
    private DateTime _lastRequestAt = DateTime.MinValue;
    private static readonly TimeSpan MinRequestInterval = TimeSpan.FromMilliseconds(1500);

    // Set whenever any request comes back 403/429 — checked by the library sync loop so it can stop
    // early and tell the user, instead of grinding through the rest of the library against a block.
    private volatile bool _rateLimitHit;

    private readonly SemaphoreSlim _syncLock = new(1, 1);
    private LetterboxdSyncStatus _syncStatus = new(false, 0, 0, false, null);
    private CancellationTokenSource? _syncCts;

    public LetterboxdService(IServiceScopeFactory scopeFactory, ILogger<LetterboxdService> log,
        IHttpClientFactory httpClientFactory, ITmdbClientFactory tmdbClientFactory)
    {
        _scopeFactory = scopeFactory;
        _log = log;
        _http = httpClientFactory.CreateClient("Letterboxd");
        _tmdbClientFactory = tmdbClientFactory;
        _http.Timeout = TimeSpan.FromSeconds(15);
    }

    private const string DefaultUserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

    // ── Status ───────────────────────────────────────────────────────────────

    public async Task<LetterboxdAuthStatus> GetStatusAsync(CancellationToken ct)
    {
        var username = await GetSettingAsync("LetterboxdUsername", ct).ConfigureAwait(false);
        var sessionCookie = await GetSettingAsync("LetterboxdSessionCookie", ct).ConfigureAwait(false);
        return new LetterboxdAuthStatus(!string.IsNullOrWhiteSpace(username), username,
            !string.IsNullOrWhiteSpace(sessionCookie));
    }

    /// <summary>Checks whether a Letterboxd profile page exists for the given username — Letterboxd
    /// returns 404 for a username that isn't registered, distinguishing a typo from a real profile
    /// that simply hasn't logged the specific films we'll later probe for.</summary>
    public async Task<bool> UsernameExistsAsync(string username, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(username))
            return false;
        var html = await GetHtmlAsync($"{BaseUrl}/{Uri.EscapeDataString(username.Trim())}/", ct).ConfigureAwait(false);
        return html != null;
    }

    public async Task SaveSessionCookieAsync(string cookieHeader, string? userAgent, CancellationToken ct)
    {
        await SaveSettingAsync("LetterboxdSessionCookie", cookieHeader, ct).ConfigureAwait(false);
        // Cloudflare's cf_clearance cookie is bound to the (IP, User-Agent) pair that solved the
        // challenge — sending a mismatched User-Agent silently invalidates the whole session.
        if (!string.IsNullOrWhiteSpace(userAgent))
            await SaveSettingAsync("LetterboxdUserAgent", userAgent, ct).ConfigureAwait(false);
    }

    // ── Manual library sync ─────────────────────────────────────────────────

    public LetterboxdSyncStatus GetSyncStatus() => _syncStatus;

    /// <summary>Starts a background walk over every matched movie in the library, pre-fetching and
    /// caching its Letterboxd data one at a time. No-ops if a sync is already running. Stops early
    /// and reports it if Letterboxd starts rate-limiting us partway through.</summary>
    public async Task<LetterboxdSyncStatus> StartLibrarySyncAsync(CancellationToken requestCt)
    {
        await _syncLock.WaitAsync(requestCt).ConfigureAwait(false);
        try
        {
            if (_syncStatus.IsRunning)
                return _syncStatus;

            List<int> movieTmdbIds;
            Dictionary<int, string> titlesByTmdbId;
            await using (var scope = _scopeFactory.CreateAsyncScope())
            {
                var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
                var (movies, _) = await repo.GetDistinctMatchedTmdbIdsForRatingsAsync(5000, 0, requestCt)
                    .ConfigureAwait(false);
                movieTmdbIds = movies.ToList();

                var db = scope.ServiceProvider.GetRequiredService<LibraryContext>();
                titlesByTmdbId = await db.Movies
                    .Where(m => movieTmdbIds.Contains(m.TmdbId))
                    .Select(m => new { m.TmdbId, m.Title })
                    .ToDictionaryAsync(m => m.TmdbId, m => m.Title, requestCt)
                    .ConfigureAwait(false);
            }

            _rateLimitHit = false;
            _syncCts = CancellationTokenSource.CreateLinkedTokenSource(requestCt);
            _syncStatus = new LetterboxdSyncStatus(true, 0, movieTmdbIds.Count, false,
                $"Starting — {movieTmdbIds.Count} movies to check.");

            var runCt = _syncCts.Token;
            _ = Task.Run(() => RunLibrarySyncAsync(movieTmdbIds, titlesByTmdbId, runCt), CancellationToken.None);
            return _syncStatus;
        }
        finally
        {
            _syncLock.Release();
        }
    }

    public void CancelLibrarySync()
    {
        _syncCts?.Cancel();
    }

    private const int MaxRecentlyProcessed = 30;

    private async Task RunLibrarySyncAsync(List<int> movieTmdbIds, Dictionary<int, string> titlesByTmdbId, CancellationToken ct)
    {
        var processed = 0;
        var recent = new List<LetterboxdSyncedMovie>();
        try
        {
            foreach (var tmdbId in movieTmdbIds)
            {
                var title = titlesByTmdbId.GetValueOrDefault(tmdbId, $"TMDB #{tmdbId}");

                if (ct.IsCancellationRequested)
                {
                    _syncStatus = _syncStatus with { IsRunning = false, Message = $"Stopped — checked {processed} of {movieTmdbIds.Count} movies." };
                    return;
                }

                LetterboxdFilmData? data = null;
                try
                {
                    data = await GetFilmDataAsync(tmdbId, ct).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _log.LogDebug(ex, "Letterboxd: library sync failed for TMDB {Id}", tmdbId);
                }

                processed++;
                recent.Insert(0, new LetterboxdSyncedMovie(tmdbId, title, data?.UserRating != null, data?.UserRating));
                if (recent.Count > MaxRecentlyProcessed)
                    recent.RemoveAt(recent.Count - 1);

                if (_rateLimitHit)
                {
                    _syncStatus = new LetterboxdSyncStatus(false, processed, movieTmdbIds.Count, true,
                        $"Stopped — Letterboxd rate-limited us after {processed} of {movieTmdbIds.Count} movies. Try again later.",
                        recent);
                    return;
                }

                _syncStatus = _syncStatus with { Processed = processed, Message = $"Checking… {processed} of {movieTmdbIds.Count}", RecentlyProcessed = recent };

                // Extra gap between movies on top of the per-request rate gate — each movie is already
                // several requests (slug, rating, diary check, friend lookups), so this keeps the
                // overall pace gentle across the whole library walk.
                await Task.Delay(TimeSpan.FromSeconds(5), ct).ConfigureAwait(false);
            }

            _syncStatus = new LetterboxdSyncStatus(false, processed, movieTmdbIds.Count, false,
                $"Done — checked {processed} of {movieTmdbIds.Count} movies.", recent);
        }
        catch (OperationCanceledException)
        {
            _syncStatus = _syncStatus with { IsRunning = false, Message = $"Stopped — checked {processed} of {movieTmdbIds.Count} movies." };
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Letterboxd: library sync crashed after {Count} movies", processed);
            _syncStatus = new LetterboxdSyncStatus(false, processed, movieTmdbIds.Count, false,
                $"Stopped unexpectedly after {processed} movies.", recent);
        }
    }

    // ── Orchestration ────────────────────────────────────────────────────────

    public async Task<LetterboxdFilmData> GetFilmDataAsync(int tmdbId, CancellationToken ct)
    {
        var status = await GetStatusAsync(ct).ConfigureAwait(false);

        string? imdbId = null;
        try
        {
            var tmdb = _tmdbClientFactory.Create();
            if (tmdb != null && tmdbId > 0)
                imdbId = await tmdb.TryGetImdbIdAsync(tmdbId, "Movie", ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Letterboxd: imdbId resolution failed for TMDB {Id}", tmdbId);
        }

        var slug = await ResolveFilmSlugAsync(tmdbId, imdbId, ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(slug))
            return new LetterboxdFilmData(status.Configured, null, null, null, new(), new());

        double? communityRating;
        int? ratingCount;
        var cachedFilm = !string.IsNullOrWhiteSpace(imdbId) ? await ReadFilmCacheAsync(imdbId, ct).ConfigureAwait(false) : null;
        if (cachedFilm?.CommunityRating != null)
        {
            communityRating = cachedFilm.CommunityRating;
            ratingCount = cachedFilm.RatingCount;
        }
        else
        {
            (communityRating, ratingCount) = await FetchCommunityRatingAsync(slug, ct).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(imdbId))
                await WriteFilmCacheAsync(imdbId, slug, communityRating, ratingCount, ct).ConfigureAwait(false);
        }

        double? userRating = null;
        var diaryEntries = new List<LetterboxdDiaryEntry>();
        var friendReviews = new List<LetterboxdFriendReview>();

        if (status.Configured && !string.IsNullOrWhiteSpace(status.Username))
        {
            var mine = await FetchUserFilmDataAsync(status.Username, slug, ct).ConfigureAwait(false);
            if (mine != null)
            {
                userRating = mine.Rating;
                diaryEntries.Add(new LetterboxdDiaryEntry(mine.WatchedDate, mine.Rating, mine.ReviewText,
                    $"{BaseUrl}/{status.Username}/film/{slug}/"));
            }
            else
            {
                // Films rated via the quick Watched+Rate toggle (never opened the diary/log flow) have no
                // diary-entry page at all, but still show a rating badge on the public films grid.
                var gridRating = await GetRatingFromFilmsGridAsync(status.Username, slug, ct).ConfigureAwait(false);
                if (gridRating != null)
                {
                    userRating = gridRating;
                    diaryEntries.Add(new LetterboxdDiaryEntry(null, gridRating, null,
                        $"{BaseUrl}/film/{slug}/"));
                }
            }

            // Keyed per-viewer so switching the configured account never serves another account's friend reviews.
            var reviewCacheKey = $"{status.Username.ToLowerInvariant()}:{slug}";
            var cachedReviews = await ReadReviewCacheAsync(reviewCacheKey, ct).ConfigureAwait(false);
            if (cachedReviews != null)
            {
                friendReviews = cachedReviews;
            }
            else
            {
                var following = await FetchFollowingAsync(status.Username, ct).ConfigureAwait(false);
                friendReviews = await FetchFriendReviewsAsync(
                    following.Take(MaxFollowedAccountsPerFilm).ToList(), slug, ct).ConfigureAwait(false);
                await WriteReviewCacheAsync(reviewCacheKey, friendReviews, ct).ConfigureAwait(false);
            }
        }

        return new LetterboxdFilmData(status.Configured, communityRating, ratingCount, userRating, diaryEntries, friendReviews);
    }

    // ── Scraping ─────────────────────────────────────────────────────────────

    public async Task<string?> ResolveFilmSlugAsync(int tmdbId, string? imdbId, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(imdbId))
        {
            var cached = await ReadFilmCacheAsync(imdbId, ct).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(cached?.Slug)) return cached!.Slug;
        }

        string? slug = null;
        if (tmdbId > 0)
            slug = await ResolveSlugViaRedirectAsync($"{BaseUrl}/tmdb/{tmdbId}/", ct).ConfigureAwait(false);
        if (slug == null && !string.IsNullOrWhiteSpace(imdbId))
            slug = await ResolveSlugViaRedirectAsync($"{BaseUrl}/imdb/{Uri.EscapeDataString(imdbId)}/", ct).ConfigureAwait(false);

        if (slug != null && !string.IsNullOrWhiteSpace(imdbId))
            await WriteFilmCacheAsync(imdbId, slug, null, null, ct).ConfigureAwait(false);

        return slug;
    }

    private async Task<string?> ResolveSlugViaRedirectAsync(string url, CancellationToken ct)
    {
        try
        {
            using var resp = await SendGetAsync(url, ct).ConfigureAwait(false);
            var finalPath = resp.RequestMessage?.RequestUri?.AbsolutePath;
            if (string.IsNullOrEmpty(finalPath)) return null;
            var match = Regex.Match(finalPath, "^/film/([^/]+)/?$");
            return match.Success ? match.Groups[1].Value : null;
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Letterboxd: slug redirect failed for {Url}", url);
            return null;
        }
    }

    private async Task<(double? rating, int? count)> FetchCommunityRatingAsync(string slug, CancellationToken ct)
    {
        try
        {
            var html = await GetHtmlAsync($"{BaseUrl}/film/{Uri.EscapeDataString(slug)}/", ct).ConfigureAwait(false);
            if (html == null) return (null, null);

            using var doc = await Parser.ParseDocumentAsync(html, ct).ConfigureAwait(false);
            double? rating = null;
            for (var i = 1; i <= 4; i++)
            {
                var label = doc.QuerySelector($"meta[name='twitter:label{i}']")?.GetAttribute("content");
                if (!string.Equals(label, "Average rating", StringComparison.OrdinalIgnoreCase)) continue;

                var data = doc.QuerySelector($"meta[name='twitter:data{i}']")?.GetAttribute("content");
                var m = Regex.Match(data ?? "", @"[\d.]+");
                if (m.Success && double.TryParse(m.Value, NumberStyles.Any, CultureInfo.InvariantCulture, out var r))
                    rating = r;
                break;
            }

            // Total rating count isn't reliably scrapable (the /ratings/ page is bot-protected) — best effort only.
            return (rating, null);
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Letterboxd: community rating fetch failed for {Slug}", slug);
            return (null, null);
        }
    }

    private sealed record UserFilmEntry(double? Rating, string? ReviewText, string? WatchedDate);

    private async Task<UserFilmEntry?> FetchUserFilmDataAsync(string username, string slug, CancellationToken ct)
    {
        try
        {
            var html = await GetHtmlAsync($"{BaseUrl}/{Uri.EscapeDataString(username)}/film/{Uri.EscapeDataString(slug)}/", ct)
                .ConfigureAwait(false);
            if (html == null) return null;

            using var doc = await Parser.ParseDocumentAsync(html, ct).ConfigureAwait(false);

            // Precise rating (handles half-stars) only renders inside a review card. A rating given
            // without a written review only shows up in the meta description, rounded to whole stars.
            double? rating = null;
            var ratingSpan = doc.QuerySelectorAll("span[class*='rated-']").FirstOrDefault();
            var ratedClass = ratingSpan?.ClassList.FirstOrDefault(c => c.StartsWith("rated-", StringComparison.Ordinal));
            if (ratedClass != null && int.TryParse(ratedClass.AsSpan(6), out var n))
                rating = n / 2.0;

            if (rating == null)
            {
                for (var i = 1; i <= 4; i++)
                {
                    var label = doc.QuerySelector($"meta[name='twitter:label{i}']")?.GetAttribute("content");
                    if (!string.Equals(label, "Rating", StringComparison.OrdinalIgnoreCase)) continue;

                    var stars = doc.QuerySelector($"meta[name='twitter:data{i}']")?.GetAttribute("content");
                    if (!string.IsNullOrEmpty(stars))
                    {
                        var starCount = stars.Count(c => c == '★');
                        if (starCount > 0) rating = starCount;
                    }
                    break;
                }
            }

            string? review = null;
            var reviewP = doc.QuerySelector("div.review.body-text p");
            if (reviewP != null)
            {
                var text = reviewP.TextContent.Trim();
                if (!string.IsNullOrWhiteSpace(text) &&
                    !text.StartsWith("There is no review", StringComparison.OrdinalIgnoreCase))
                    review = text;
            }

            string? watchedDate = null;
            var dateLink = doc.QuerySelectorAll("a[href*='/diary/for/']").FirstOrDefault();
            var href = dateLink?.GetAttribute("href");
            if (!string.IsNullOrEmpty(href))
            {
                var m = Regex.Match(href, @"/diary/for/(\d{4})/(\d{2})/(\d{2})/");
                if (m.Success)
                    watchedDate = $"{m.Groups[1].Value}-{m.Groups[2].Value}-{m.Groups[3].Value}";
            }

            if (rating == null && watchedDate == null && review == null)
                return null; // hasn't logged this film

            return new UserFilmEntry(rating, review, watchedDate);
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Letterboxd: user film fetch failed for {User}/{Slug}", username, slug);
            return null;
        }
    }

    /// <summary>
    /// Public, paginated poster grid at /{username}/films/ — shows a rating badge per poster even for
    /// films rated via the quick Watched+Rate toggle that never got a full diary/log entry. No login needed.
    /// </summary>
    private async Task<double?> GetRatingFromFilmsGridAsync(string username, string slug, CancellationToken ct)
    {
        var map = await FetchRatedFilmsMapAsync(username, ct).ConfigureAwait(false);
        return map.TryGetValue(slug, out var rating) ? rating : null;
    }

    private async Task<Dictionary<string, double>> FetchRatedFilmsMapAsync(string username, CancellationToken ct)
    {
        var cacheKeySuffix = ":" + username.ToLowerInvariant();
        var cacheJson = await GetSettingAsync("LetterboxdRatedFilmsJson" + cacheKeySuffix, ct).ConfigureAwait(false);
        var cacheFetchedStr = await GetSettingAsync("LetterboxdRatedFilmsFetchedAt" + cacheKeySuffix, ct).ConfigureAwait(false);
        if (cacheJson != null && cacheFetchedStr != null &&
            DateTime.TryParse(cacheFetchedStr, out var fetchedAt) &&
            DateTime.UtcNow - fetchedAt < RatedFilmsCacheTtl)
        {
            try
            {
                var cached = JsonSerializer.Deserialize<Dictionary<string, double>>(cacheJson);
                if (cached != null) return cached;
            }
            catch { /* fall through and re-scrape */ }
        }

        var map = new Dictionary<string, double>();
        // Only a scrape that walked every page (either exhausting real pagination or hitting the page
        // cap) is trustworthy enough to persist for the full TTL. A scrape that breaks off early — a
        // transient fetch/parse failure, a rate limit — must never be cached as if it were the complete
        // picture, or every later "does this user have a rating for film X" check silently and
        // permanently (until TTL) reports false negatives for every film past the point it broke off.
        var completedFully = false;
        try
        {
            string? nextUrl = $"{BaseUrl}/{Uri.EscapeDataString(username)}/films/";
            var pages = 0;
            while (nextUrl != null && pages < 15)
            {
                // Cloudflare's bot-protection can transiently block a request mid-walk even though the
                // exact same URL loads fine in a real browser (or on a retry moments later) — a couple of
                // backed-off retries recovers most of these instead of abandoning the whole scrape after
                // just one page.
                string? html = null;
                for (var attempt = 0; attempt < 3 && html == null; attempt++)
                {
                    if (attempt > 0)
                        await Task.Delay(TimeSpan.FromSeconds(4 * attempt), ct).ConfigureAwait(false);

                    try
                    {
                        html = await GetHtmlAsync(nextUrl, ct).ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        _log.LogWarning(ex, "Letterboxd: rated-films page fetch failed for {User} at {Url} (page {Page}, attempt {Attempt})",
                            username, nextUrl, pages + 1, attempt + 1);
                    }
                }

                if (html == null)
                {
                    _log.LogWarning("Letterboxd: rated-films page returned no content for {User} at {Url} (page {Page}) after retries",
                        username, nextUrl, pages + 1);
                    break;
                }

                string? nextHref;
                try
                {
                    using var doc = await Parser.ParseDocumentAsync(html, ct).ConfigureAwait(false);
                    var griditems = doc.QuerySelectorAll("li.griditem");
                    foreach (var item in griditems)
                    {
                        var itemSlug = item.QuerySelector("[data-item-slug]")?.GetAttribute("data-item-slug");
                        if (string.IsNullOrWhiteSpace(itemSlug)) continue;

                        var ratedClass = item.QuerySelector(".rating[class*='rated-']")?.ClassList
                            .FirstOrDefault(c => c.StartsWith("rated-", StringComparison.Ordinal));
                        if (ratedClass != null && int.TryParse(ratedClass.AsSpan(6), out var n))
                            map[itemSlug] = n / 2.0;
                    }

                    // A 200 response with no grid items at all (e.g. a login/interstitial page served
                    // instead of the real listing) must be treated the same as a hard failure — it looks
                    // like a legitimate empty response but silently truncates the scrape past page 1.
                    if (griditems.Length == 0 && pages == 0)
                    {
                        _log.LogWarning("Letterboxd: rated-films page had no grid items for {User} at {Url} — likely blocked/interstitial response",
                            username, nextUrl);
                        break;
                    }

                    nextHref = doc.QuerySelector("a.next")?.GetAttribute("href");
                }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "Letterboxd: rated-films page parse failed for {User} at {Url} (page {Page})",
                        username, nextUrl, pages + 1);
                    break;
                }

                pages++;
                if (string.IsNullOrWhiteSpace(nextHref))
                {
                    completedFully = true;
                    nextUrl = null;
                }
                else
                {
                    nextUrl = new Uri(new Uri(BaseUrl), nextHref).ToString();
                }
            }

            if (nextUrl != null && pages >= 15)
                completedFully = true; // hit the page cap on a genuinely huge library — good enough to trust
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Letterboxd: rated-films grid fetch failed for {User}", username);
        }

        _log.LogInformation("Letterboxd: rated-films grid scrape for {User} collected {Count} entries (completeFully={Complete})",
            username, map.Count, completedFully);

        if (map.Count > 0 && completedFully)
        {
            try
            {
                await SaveSettingAsync("LetterboxdRatedFilmsJson" + cacheKeySuffix, JsonSerializer.Serialize(map), ct).ConfigureAwait(false);
                await SaveSettingAsync("LetterboxdRatedFilmsFetchedAt" + cacheKeySuffix, DateTime.UtcNow.ToString("O"), ct).ConfigureAwait(false);
            }
            catch { /* best-effort cache write */ }
        }

        return map;
    }

    private sealed record FollowedPerson(string Username, string? DisplayName, string? AvatarUrl);

    private async Task<List<LetterboxdFriendReview>> FetchFriendReviewsAsync(List<FollowedPerson> people, string slug,
        CancellationToken ct)
    {
        if (people.Count == 0) return new();

        // Concurrency here doesn't bypass the rate limit — every actual HTTP call still serializes
        // through SendGetAsync's shared gate — this just lets several lookups queue up at once.
        using var semaphore = new SemaphoreSlim(3);
        var tasks = people.Select(async person =>
        {
            await semaphore.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                var entry = await FetchUserFilmDataAsync(person.Username, slug, ct).ConfigureAwait(false);
                return entry == null
                    ? null
                    : new LetterboxdFriendReview(person.Username, person.DisplayName, person.AvatarUrl, entry.Rating,
                        entry.ReviewText, entry.WatchedDate, $"{BaseUrl}/{person.Username}/film/{slug}/");
            }
            finally
            {
                semaphore.Release();
            }
        }).ToList();

        var completed = await Task.WhenAll(tasks).ConfigureAwait(false);
        return completed.Where(r => r != null).Select(r => r!).ToList();
    }

    private async Task<List<FollowedPerson>> FetchFollowingAsync(string username, CancellationToken ct)
    {
        // Keyed per-username so switching the configured account never serves a stale list scraped for someone else.
        var cacheKeySuffix = ":" + username.ToLowerInvariant();
        var cacheJson = await GetSettingAsync("LetterboxdFollowingJson" + cacheKeySuffix, ct).ConfigureAwait(false);
        var cacheFetchedStr = await GetSettingAsync("LetterboxdFollowingFetchedAt" + cacheKeySuffix, ct).ConfigureAwait(false);
        if (cacheJson != null && cacheFetchedStr != null &&
            DateTime.TryParse(cacheFetchedStr, out var fetchedAt) &&
            DateTime.UtcNow - fetchedAt < FollowingCacheTtl)
        {
            try
            {
                var cached = JsonSerializer.Deserialize<List<FollowedPerson>>(cacheJson);
                if (cached != null) return cached;
            }
            catch { /* fall through and re-scrape */ }
        }

        var people = new List<FollowedPerson>();
        try
        {
            string? nextUrl = $"{BaseUrl}/{Uri.EscapeDataString(username)}/following/";
            var pages = 0;
            while (nextUrl != null && pages < 3 && people.Count < 100)
            {
                var html = await GetHtmlAsync(nextUrl, ct).ConfigureAwait(false);
                if (html == null) break;

                using var doc = await Parser.ParseDocumentAsync(html, ct).ConfigureAwait(false);
                foreach (var summary in doc.QuerySelectorAll(".person-summary"))
                {
                    var href = summary.QuerySelector("a.avatar")?.GetAttribute("href")?.Trim('/');
                    if (string.IsNullOrWhiteSpace(href) || href.Contains('/')) continue;
                    if (people.Any(p => string.Equals(p.Username, href, StringComparison.OrdinalIgnoreCase))) continue;

                    var avatarUrl = summary.QuerySelector("a.avatar img")?.GetAttribute("src");
                    var displayName = summary.QuerySelector("a.name")?.TextContent.Trim();
                    people.Add(new FollowedPerson(href, string.IsNullOrWhiteSpace(displayName) ? null : displayName,
                        string.IsNullOrWhiteSpace(avatarUrl) ? null : avatarUrl));
                }

                var nextHref = doc.QuerySelector("a.next")?.GetAttribute("href");
                nextUrl = !string.IsNullOrWhiteSpace(nextHref) ? new Uri(new Uri(BaseUrl), nextHref).ToString() : null;
                pages++;
            }
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Letterboxd: following list fetch failed for {User}", username);
        }

        if (people.Count > 0)
        {
            try
            {
                await SaveSettingAsync("LetterboxdFollowingJson" + cacheKeySuffix, JsonSerializer.Serialize(people), ct).ConfigureAwait(false);
                await SaveSettingAsync("LetterboxdFollowingFetchedAt" + cacheKeySuffix, DateTime.UtcNow.ToString("O"), ct).ConfigureAwait(false);
            }
            catch { /* best-effort cache write */ }
        }

        return people;
    }

    private async Task<string?> GetHtmlAsync(string url, CancellationToken ct)
    {
        try
        {
            using var resp = await SendGetAsync(url, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                // 404 here is routine (e.g. a user simply hasn't logged/rated a given film) — logging it as a
                // warning made completely expected outcomes look like errors. Real failures (403/429/5xx) still warn.
                if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
                    _log.LogDebug("Letterboxd: GET {Url} returned 404", url);
                else
                    _log.LogWarning("Letterboxd: GET {Url} returned {Status}", url, (int)resp.StatusCode);
                if (resp.StatusCode is System.Net.HttpStatusCode.Forbidden or System.Net.HttpStatusCode.TooManyRequests)
                    _rateLimitHit = true;
                return null;
            }
            return await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Letterboxd: GET failed for {Url}", url);
            return null;
        }
    }

    /// <summary>GET with the saved Letterboxd session cookie attached, if any — authenticates the
    /// request as the logged-in user so private entries and otherwise-blocked pages can resolve.</summary>
    private async Task<HttpResponseMessage> SendGetAsync(string url, CancellationToken ct)
    {
        var cookie = await GetSettingAsync("LetterboxdSessionCookie", ct).ConfigureAwait(false);
        var userAgent = await GetSettingAsync("LetterboxdUserAgent", ct).ConfigureAwait(false) ?? DefaultUserAgent;

        await _rateSemaphore.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var elapsed = DateTime.UtcNow - _lastRequestAt;
            if (elapsed < MinRequestInterval)
                await Task.Delay(MinRequestInterval - elapsed, ct).ConfigureAwait(false);
            _lastRequestAt = DateTime.UtcNow;

            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.TryAddWithoutValidation("User-Agent", userAgent);
            if (!string.IsNullOrWhiteSpace(cookie))
                req.Headers.TryAddWithoutValidation("Cookie", cookie);
            return await _http.SendAsync(req, ct).ConfigureAwait(false);
        }
        finally
        {
            _rateSemaphore.Release();
        }
    }

    // ── Settings helpers ─────────────────────────────────────────────────────

    private async Task<string?> GetSettingAsync(string key, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        var value = await repo.GetSettingAsync(key, ct).ConfigureAwait(false);
        return string.IsNullOrEmpty(value) ? null : value;
    }

    private async Task SaveSettingAsync(string key, string value, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var repo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        await repo.SaveSettingAsync(key, value, ct).ConfigureAwait(false);
    }

    // ── Cache helpers (raw SQL against LetterboxdFilmCache / LetterboxdReviewCache) ────────────

    private sealed record FilmCacheRow(string? Slug, double? CommunityRating, int? RatingCount);

    private static async Task<FilmCacheRow?> ReadFilmCacheAsync(string imdbId, CancellationToken ct)
    {
        try
        {
            using var db = LibraryContext.Create();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT LetterboxdFilmLid, CommunityRating, RatingCount, CachedAt
                FROM LetterboxdFilmCache WHERE ImdbId = @id LIMIT 1
                """;
            var p = cmd.CreateParameter();
            p.ParameterName = "@id";
            p.Value = imdbId;
            cmd.Parameters.Add(p);
            using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;

            var slug = reader.IsDBNull(0) ? null : reader.GetString(0);
            double? rating = reader.IsDBNull(1) ? null : reader.GetDouble(1);
            int? count = reader.IsDBNull(2) ? null : reader.GetInt32(2);
            var fetchedStr = reader.IsDBNull(3) ? null : reader.GetString(3);

            if (fetchedStr is not null && DateTime.TryParse(fetchedStr, out var fetched) &&
                DateTime.UtcNow - fetched > FilmCacheTtl)
                return string.IsNullOrWhiteSpace(slug) ? null : new FilmCacheRow(slug, null, null); // slug stays valid past TTL; only ratings go stale

            return new FilmCacheRow(slug, rating, count);
        }
        catch
        {
            return null;
        }
    }

    private static async Task WriteFilmCacheAsync(string imdbId, string? slug, double? rating, int? count,
        CancellationToken ct)
    {
        try
        {
            using var db = LibraryContext.Create();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO LetterboxdFilmCache (ImdbId, LetterboxdFilmLid, CommunityRating, RatingCount, CachedAt)
                VALUES (@id, @slug, @rating, @count, @fetched)
                ON CONFLICT(ImdbId) DO UPDATE SET
                    LetterboxdFilmLid = COALESCE(excluded.LetterboxdFilmLid, LetterboxdFilmCache.LetterboxdFilmLid),
                    CommunityRating = COALESCE(excluded.CommunityRating, LetterboxdFilmCache.CommunityRating),
                    RatingCount = COALESCE(excluded.RatingCount, LetterboxdFilmCache.RatingCount),
                    CachedAt = excluded.CachedAt;
                """;
            void AddParam(string name, object? val)
            {
                var pr = cmd.CreateParameter();
                pr.ParameterName = name;
                pr.Value = val ?? DBNull.Value;
                cmd.Parameters.Add(pr);
            }
            AddParam("@id", imdbId);
            AddParam("@slug", slug);
            AddParam("@rating", rating);
            AddParam("@count", count);
            AddParam("@fetched", DateTime.UtcNow.ToString("O"));
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
        catch { /* best-effort cache write */ }
    }

    private static async Task<List<LetterboxdFriendReview>?> ReadReviewCacheAsync(string slug, CancellationToken ct)
    {
        try
        {
            using var db = LibraryContext.Create();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT ReviewerUsername, ReviewerDisplayName, ReviewerAvatarUrl, Rating, ReviewText,
                       WatchedDate, LogEntryUrl, CachedAt
                FROM LetterboxdReviewCache WHERE LetterboxdFilmLid = @slug
                """;
            var p = cmd.CreateParameter();
            p.ParameterName = "@slug";
            p.Value = slug;
            cmd.Parameters.Add(p);
            using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);

            var rows = new List<LetterboxdFriendReview>();
            DateTime? oldestFetch = null;
            while (await reader.ReadAsync(ct).ConfigureAwait(false))
            {
                var fetchedStr = reader.IsDBNull(7) ? null : reader.GetString(7);
                if (fetchedStr is not null && DateTime.TryParse(fetchedStr, out var fetched))
                    oldestFetch = oldestFetch is null || fetched < oldestFetch ? fetched : oldestFetch;

                rows.Add(new LetterboxdFriendReview(
                    reader.IsDBNull(0) ? "" : reader.GetString(0),
                    reader.IsDBNull(1) ? null : reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetDouble(3),
                    reader.IsDBNull(4) ? null : reader.GetString(4),
                    reader.IsDBNull(5) ? null : reader.GetString(5),
                    reader.IsDBNull(6) ? null : reader.GetString(6)));
            }

            if (rows.Count == 0) return null;
            if (oldestFetch is null || DateTime.UtcNow - oldestFetch > ReviewCacheTtl) return null;
            return rows;
        }
        catch
        {
            return null;
        }
    }

    private static async Task WriteReviewCacheAsync(string slug, List<LetterboxdFriendReview> reviews, CancellationToken ct)
    {
        try
        {
            using var db = LibraryContext.Create();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync(ct).ConfigureAwait(false);

            using (var del = conn.CreateCommand())
            {
                del.CommandText = "DELETE FROM LetterboxdReviewCache WHERE LetterboxdFilmLid = @slug";
                var dp = del.CreateParameter();
                dp.ParameterName = "@slug";
                dp.Value = slug;
                del.Parameters.Add(dp);
                await del.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            var now = DateTime.UtcNow.ToString("O");
            foreach (var r in reviews)
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = """
                    INSERT INTO LetterboxdReviewCache
                        (LetterboxdFilmLid, ReviewerUsername, ReviewerDisplayName, ReviewerAvatarUrl,
                         Rating, ReviewText, WatchedDate, LogEntryUrl, IsFollowing, CachedAt)
                    VALUES (@slug, @uname, @dname, @avatar, @rating, @review, @watched, @url, 1, @fetched)
                    """;
                void AddParam(string name, object? val)
                {
                    var pr = cmd.CreateParameter();
                    pr.ParameterName = name;
                    pr.Value = val ?? DBNull.Value;
                    cmd.Parameters.Add(pr);
                }
                AddParam("@slug", slug);
                AddParam("@uname", r.ReviewerUsername);
                AddParam("@dname", r.ReviewerDisplayName);
                AddParam("@avatar", r.ReviewerAvatarUrl);
                AddParam("@rating", r.Rating);
                AddParam("@review", r.ReviewText);
                AddParam("@watched", r.WatchedDate);
                AddParam("@url", r.LogEntryUrl);
                AddParam("@fetched", now);
                await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }
        }
        catch { /* best-effort cache write */ }
    }
}
