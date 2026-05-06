using System.Collections.Concurrent;
using System.Net.Http;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Pitflix.API;
using Pitflix.Core.Api;
using Pitflix.Core.Database;

namespace Pitflix.API.Services.Awards;

public sealed class AwardsService
{
    private static readonly HttpClient AwardImageHttp = new() { Timeout = TimeSpan.FromSeconds(60) };

    /// <summary>
    /// When false (default), edition responses do not TMDB-search nominees missing <c>tmdbId</c> on read — first load stays fast.
    /// Set env <c>PITFLIX_AWARDS_RESOLVE_MISSING_TMDB=true</c> to restore live backfill (slow for large rosters).
    /// </summary>
    private static bool AwardsResolveMissingTmdbOnRead =>
        string.Equals(Environment.GetEnvironmentVariable("PITFLIX_AWARDS_RESOLVE_MISSING_TMDB"), "true",
            StringComparison.OrdinalIgnoreCase);

    /// <summary>Optional live IMDb lookup on edition read (extra TMDB calls). Cache/preload usually fills <see cref="AwardNomineeResponseDto.ImdbId"/>.</summary>
    private static bool AwardsFetchImdbOnRead =>
        string.Equals(Environment.GetEnvironmentVariable("PITFLIX_AWARDS_FETCH_IMDB_ON_READ"), "true",
            StringComparison.OrdinalIgnoreCase);

    private readonly IAwardsDataProvider _provider;
    private readonly IWebHostEnvironment _env;
    private readonly IServiceScopeFactory _scopeFactory;

    public AwardsService(IAwardsDataProvider provider, IWebHostEnvironment env, IServiceScopeFactory scopeFactory)
    {
        _provider = provider;
        _env = env;
        _scopeFactory = scopeFactory;
    }

    private static string NomineeLookupKey(string categoryId, string title, string mediaType) =>
        $"{categoryId.Trim()}\u001f{title.Trim()}\u001f{mediaType.Trim().ToLowerInvariant()}";

    private static bool CategoryHasQaWarning(AwardEditionFileDto file, string categoryId)
    {
        if (file.Qa?.Warnings == null || file.Qa.Warnings.Count == 0)
            return false;
        foreach (var w in file.Qa.Warnings)
        {
            if (w.Contains($":{categoryId}:", StringComparison.Ordinal))
                return true;
        }

        return false;
    }

    /// <summary>Per-category slate quality for badges (winner-only slates vs QA-flagged rows).</summary>
    private static string ComputeCategoryCompleteness(AwardCategoryFileDto c, AwardEditionFileDto file)
    {
        var count = c.Nominees.Count;
        if (count == 0)
            return "empty";

        if (CategoryHasQaWarning(file, c.Id))
            return "incomplete";

        if (count == 1 && c.Nominees[0].Winner)
            return "winner_only";

        return "full";
    }

    /// <summary>Build enriched rows for SQLite awards cache (preload / offline).</summary>
    public async Task<IReadOnlyList<AwardNomineeCacheRow>> BuildCacheRowsForEditionAsync(string awardId, int year,
        AwardEditionFileDto file, LibraryRepository lib, CancellationToken ct)
    {
        var tmdb = TmdbClientFactory.Create() ?? throw new InvalidOperationException("TMDB client unavailable.");
        var now = DateTime.UtcNow;
        var rows = new List<AwardNomineeCacheRow>();
        foreach (var cat in file.Categories)
        foreach (var n in cat.Nominees)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var explicitTmdb = n.TmdbId is int te && te > 0 ? te : (int?)null;
                int? searched = null;
                if (explicitTmdb == null)
                    searched = await TryResolveNomineeTmdbIdAsync(tmdb, n, year, ct).ConfigureAwait(false);
                var tid = explicitTmdb ?? searched;

                string? imdb = null;
                string? pp = null;
                string? bp = null;
                var streamEst = false;
                if (tid is int id && id > 0)
                {
                    var mt = n.MediaType.Equals("tv", StringComparison.OrdinalIgnoreCase) ? "Series" : "Movie";
                    imdb = await tmdb.TryGetImdbIdAsync(id, mt, ct).ConfigureAwait(false);
                    var art = await tmdb.GetArtworkPathsAsync(id, mt, ct).ConfigureAwait(false);
                    if (art.HasValue)
                    {
                        var av = art.Value;
                        pp = string.IsNullOrWhiteSpace(av.PosterPath) ? null : av.PosterPath;
                        bp = string.IsNullOrWhiteSpace(av.BackdropPath) ? null : av.BackdropPath;
                    }

                    streamEst = !string.IsNullOrWhiteSpace(imdb);
                }

                var inLib = false;
                if (tid is int id2 && id2 > 0)
                {
                    if (n.MediaType.Equals("tv", StringComparison.OrdinalIgnoreCase))
                        inLib = await lib.GetShowByTmdbIdAsync(id2, ct).ConfigureAwait(false) != null;
                    else
                        inLib = await lib.GetMovieByTmdbIdAsync(id2, ct).ConfigureAwait(false) != null;
                }

                rows.Add(new AwardNomineeCacheRow(awardId, year, cat.Id, n.Title, n.MediaType, n.Winner, tid, imdb, pp,
                    bp, inLib, streamEst, now));
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch
            {
                rows.Add(new AwardNomineeCacheRow(awardId, year, cat.Id, n.Title, n.MediaType, n.Winner, n.TmdbId, null,
                    null, null, false, false, now));
            }
        }

        return rows;
    }

    private static async Task ApplyLibraryOverlayAsync(LibraryRepository lib, AwardNomineeResponseDto dto,
        AwardNomineeFileDto src, CancellationToken ct)
    {
        if (dto.InLibrary || dto.TmdbId is not int tid || tid <= 0)
            return;
        var isTv = src.MediaType.Equals("tv", StringComparison.OrdinalIgnoreCase);
        dto.InLibrary = isTv
            ? await lib.GetShowByTmdbIdAsync(tid, ct).ConfigureAwait(false) != null
            : await lib.GetMovieByTmdbIdAsync(tid, ct).ConfigureAwait(false) != null;
    }

    /// <summary>Save a TMDB still to disk so the UI can load same-origin <c>/images/...</c> (Tauri WebView often blocks image.tmdb.org).</summary>
    private static async Task DownloadTmdbImageToPathAsync(string absolutePath, string tmdbPathFragment, string tmdbSize,
        CancellationToken ct)
    {
        if (File.Exists(absolutePath) || string.IsNullOrWhiteSpace(tmdbPathFragment))
            return;
        var dir = Path.GetDirectoryName(absolutePath);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);
        var frag = tmdbPathFragment.Trim().TrimStart('/');
        var uri = $"https://image.tmdb.org/t/p/{tmdbSize.Trim()}/{frag}";
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, uri);
            req.Headers.TryAddWithoutValidation("User-Agent", "PitflixAwardArt/1.0");
            using var resp = await AwardImageHttp.SendAsync(req, ct).ConfigureAwait(false);
            resp.EnsureSuccessStatusCode();
            var bytes = await resp.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
            await File.WriteAllBytesAsync(absolutePath, bytes, ct).ConfigureAwait(false);
        }
        catch
        {
            /* TMDB / network — caller falls back to proxied URL */
        }
    }

    private static async Task<string?> ResolveCachedImageUrlAsync(string absolutePath, string? tmdbFragment, string tmdbSize,
        CancellationToken ct)
    {
        var existing = ImageUrls.ToImageUrl(absolutePath);
        if (existing != null)
            return existing;
        if (string.IsNullOrWhiteSpace(tmdbFragment))
            return null;
        await DownloadTmdbImageToPathAsync(absolutePath, tmdbFragment, tmdbSize, ct).ConfigureAwait(false);
        return ImageUrls.ToImageUrl(absolutePath);
    }

    /// <summary>Same-origin URL via <c>/api/img/tmdb</c> — Tauri WebView often blocks direct <c>image.tmdb.org</c>.</summary>
    private static string? ToTmdbUrl(string? pathFragment, string sizeToken)
    {
        if (string.IsNullOrWhiteSpace(pathFragment))
            return null;
        var p = pathFragment.Trim().TrimStart('/');
        if (p.Contains("..", StringComparison.Ordinal) || p.Contains('\\', StringComparison.Ordinal) ||
            p.Contains('/', StringComparison.Ordinal))
            return null;
        var size = sizeToken.Trim();
        if (size.Length is < 2 or > 12)
            return null;
        var b = ImageUrls.PublicBase.TrimEnd('/');
        return $"{b}/api/img/tmdb?size={Uri.EscapeDataString(size)}&file={Uri.EscapeDataString(p)}";
    }

    /// <summary>Same-origin SVG ceremony placeholder — never nominee/movie art.</summary>
    private static string AwardsPlaceholderPosterUrl(string awardId, int? year, string title, string? accent)
    {
        var b = ImageUrls.PublicBase.TrimEnd('/');
        var qs =
            $"awardId={Uri.EscapeDataString(awardId.Trim())}&title={Uri.EscapeDataString(title.Trim())}";
        if (year is >= 1800 and <= 2200)
            qs += $"&year={year.Value}";
        if (!string.IsNullOrWhiteSpace(accent))
            qs += $"&accent={Uri.EscapeDataString(accent.Trim())}";
        return $"{b}/api/awards/placeholder/poster?{qs}";
    }

    private static string AwardTitleForSearch(string? title)
    {
        if (string.IsNullOrWhiteSpace(title))
            return "";
        var t = title.Trim();
        foreach (var sep in new[] { "\u2014", "\u2013", " – ", " — ", " - " })
        {
            var i = t.IndexOf(sep, StringComparison.Ordinal);
            if (i >= 0 && i + sep.Length < t.Length)
            {
                var right = t[(i + sep.Length)..].Trim();
                if (!string.IsNullOrEmpty(right))
                    return right;
            }
        }

        return t;
    }

    private static List<int> MovieYearsForSearch(int ceremonyYear, int? releaseYear)
    {
        var list = new List<int>();
        if (releaseYear is >= 1870 and <= 2100)
        {
            list.Add(releaseYear.Value);
            list.Add(releaseYear.Value - 1);
            list.Add(releaseYear.Value + 1);
            return list.Distinct().ToList();
        }

        for (var d = 0; d <= 2; d++)
        {
            var y = ceremonyYear - d;
            if (y >= 1870)
                list.Add(y);
        }

        return list;
    }

    private static List<int> TvYearsForSearch(int ceremonyYear, int? releaseYear)
    {
        if (releaseYear is >= 1870 and <= 2100)
            return new[] { releaseYear.Value, releaseYear.Value - 1, releaseYear.Value + 1 }.Distinct().ToList();
        return new[] { ceremonyYear, ceremonyYear - 1 }.Where(static y => y >= 1870).Distinct().ToList();
    }

    private static async Task<int?> TryResolveNomineeTmdbIdAsync(TmdbClient tmdb, AwardNomineeFileDto n, int ceremonyYear,
        CancellationToken ct)
    {
        var q = AwardTitleForSearch(n.Title);
        if (string.IsNullOrWhiteSpace(q))
            return null;
        var scoringTitle = n.Title.Trim();
        var isTv = n.MediaType.Equals("tv", StringComparison.OrdinalIgnoreCase);
        if (isTv)
        {
            var years = TvYearsForSearch(ceremonyYear, n.ReleaseYear);
            return years.Count == 0
                ? null
                : await tmdb.TryFindAwardsTvMatchAsync(q, years, scoringTitle, ct).ConfigureAwait(false);
        }

        var my = MovieYearsForSearch(ceremonyYear, n.ReleaseYear);
        return my.Count == 0
            ? null
            : await tmdb.TryFindAwardsMovieMatchAsync(q, my, scoringTitle, ct).ConfigureAwait(false);
    }

    private async Task<AwardNomineeResponseDto> BuildNomineeResponseDtoAsync(
        TmdbClient? tmdb,
        AwardNomineeCacheRow? cache,
        string awardId,
        int year,
        string categoryId,
        AwardNomineeFileDto n,
        string? accent,
        CancellationToken ct)
    {
        var explicitTmdb = n.TmdbId is int te0 && te0 > 0 ? te0 : (int?)null;
        var cacheTmdb = cache?.TmdbId is int ctm && ctm > 0 ? ctm : (int?)null;
        int? searchedTmdb = null;
        if (explicitTmdb == null && cacheTmdb == null && tmdb != null && AwardsResolveMissingTmdbOnRead)
            searchedTmdb = await TryResolveNomineeTmdbIdAsync(tmdb, n, year, ct).ConfigureAwait(false);
        var effectiveTmdb = explicitTmdb ?? cacheTmdb ?? searchedTmdb;

        var nomineePosterPath = AwardsImageCache.NomineePosterPath(awardId, year, categoryId, n.Title, effectiveTmdb);
        var nomineeBackdropPath = AwardsImageCache.NomineeBackdropPath(awardId, year, categoryId, n.Title, effectiveTmdb);
        string? posterUrl = ImageUrls.ToImageUrl(nomineePosterPath);
        string? backdropUrl = ImageUrls.ToImageUrl(nomineeBackdropPath);
        string? fragP = string.IsNullOrWhiteSpace(cache?.PosterPath) ? null : cache!.PosterPath;
        string? fragB = string.IsNullOrWhiteSpace(cache?.BackdropPath) ? null : cache!.BackdropPath;
        if ((posterUrl == null || backdropUrl == null || fragP == null || fragB == null) && tmdb != null &&
            effectiveTmdb is int ntmdb && ntmdb > 0)
        {
            var mt = n.MediaType.Equals("tv", StringComparison.OrdinalIgnoreCase) ? "Series" : "Movie";
            try
            {
                var art = await tmdb.GetArtworkPathsAsync(ntmdb, mt, ct).ConfigureAwait(false);
                if (art.HasValue)
                {
                    fragP ??= string.IsNullOrWhiteSpace(art.Value.PosterPath) ? null : art.Value.PosterPath;
                    fragB ??= string.IsNullOrWhiteSpace(art.Value.BackdropPath) ? null : art.Value.BackdropPath;
                }
            }
            catch
            {
                /* ignore */
            }
        }

        if (posterUrl == null && !string.IsNullOrEmpty(fragP))
        {
            await DownloadTmdbImageToPathAsync(nomineePosterPath, fragP!, "w500", ct).ConfigureAwait(false);
            posterUrl = ImageUrls.ToImageUrl(nomineePosterPath) ?? ToTmdbUrl(fragP, "w342");
        }

        if (backdropUrl == null && !string.IsNullOrEmpty(fragB))
        {
            await DownloadTmdbImageToPathAsync(nomineeBackdropPath, fragB!, "w780", ct).ConfigureAwait(false);
            backdropUrl = ImageUrls.ToImageUrl(nomineeBackdropPath) ?? ToTmdbUrl(fragB, "w780");
        }

        if (string.IsNullOrWhiteSpace(posterUrl))
            posterUrl = AwardsPlaceholderPosterUrl(awardId, year, n.Title, accent);
        // Backdrop is optional for nominee rows; avoid proxying unrelated art.
        backdropUrl ??= ImageUrls.ToImageUrl(nomineeBackdropPath);

        string? imdbId = cache?.ImdbId;
        if (string.IsNullOrWhiteSpace(imdbId) && AwardsFetchImdbOnRead && tmdb != null && effectiveTmdb is int idv &&
            idv > 0)
        {
            var mt = n.MediaType.Equals("tv", StringComparison.OrdinalIgnoreCase) ? "Series" : "Movie";
            imdbId = await tmdb.TryGetImdbIdAsync(idv, mt, ct).ConfigureAwait(false);
        }

        var inLib = cache?.LocalLibraryMatch == true;
        var streamEligible = cache?.StreamAvailableEstimate == true ||
                             (!string.IsNullOrWhiteSpace(imdbId) && effectiveTmdb is int et && et > 0);

        return new AwardNomineeResponseDto
        {
            Title = n.Title,
            MediaType = n.MediaType,
            TmdbId = effectiveTmdb,
            Winner = n.Winner,
            PosterUrl = posterUrl,
            BackdropUrl = backdropUrl,
            ImdbId = string.IsNullOrWhiteSpace(imdbId) ? null : imdbId,
            InLibrary = inLib,
            StreamEligible = streamEligible
        };
    }

    public async Task<IReadOnlyList<AwardCatalogEntryDto>> GetCatalogAsync(CancellationToken ct)
    {
        var path = Path.Combine(_env.ContentRootPath, "Data", "Awards", "catalog.json");
        if (!File.Exists(path))
            return Array.Empty<AwardCatalogEntryDto>();

        await using var fs = File.OpenRead(path);
        var dto = await JsonSerializer.DeserializeAsync<AwardCatalogFileDto>(fs,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }, ct).ConfigureAwait(false);
        return dto?.Awards ?? new List<AwardCatalogEntryDto>();
    }

    /// <summary>Catalog cards: curated ceremony assets only — never TMDB title posters for hub branding.</summary>
    public async Task<IReadOnlyList<AwardCatalogCardDto>> GetCatalogCardsAsync(CancellationToken ct)
    {
        var raw = await GetCatalogAsync(ct).ConfigureAwait(false);
        if (raw.Count == 0)
            return Array.Empty<AwardCatalogCardDto>();

        var list = new List<AwardCatalogCardDto>();
        foreach (var a in raw)
        {
            string? eventPosterUrl = null;
            if (!string.IsNullOrWhiteSpace(a.EventPosterPath))
            {
                eventPosterUrl = await ResolveCachedImageUrlAsync(
                    AwardsImageCache.EventPosterPath(a.Id), a.EventPosterPath, "w342", ct).ConfigureAwait(false);
                eventPosterUrl ??= ToTmdbUrl(a.EventPosterPath, "w342");
            }

            string? eventBackdropUrl = null;
            if (!string.IsNullOrWhiteSpace(a.EventBackdropPath))
            {
                eventBackdropUrl = await ResolveCachedImageUrlAsync(
                    AwardsImageCache.EventBackdropPath(a.Id), a.EventBackdropPath, "w1280", ct).ConfigureAwait(false);
                eventBackdropUrl ??= ToTmdbUrl(a.EventBackdropPath, "w1280");
            }

            var neutralPoster = AwardsPlaceholderPosterUrl(a.Id, null, a.Name, a.Accent);
            list.Add(new AwardCatalogCardDto
            {
                Id = a.Id,
                Name = a.Name,
                Subtitle = a.Subtitle,
                Accent = a.Accent,
                HeroBackdropUrl = null,
                EventBackdropUrl = eventBackdropUrl,
                EventPosterUrl = eventPosterUrl ?? neutralPoster,
                CardPosterUrl = null,
                SpotlightPosterUrl = eventPosterUrl ?? neutralPoster
            });
        }

        return list;
    }

    public async Task<IReadOnlyList<AwardYearTileDto>> GetYearTilesAsync(string awardId, CancellationToken ct)
    {
        var years = (await _provider.ListYearsAsync(awardId, ct).ConfigureAwait(false)).OrderByDescending(y => y).ToList();
        if (years.Count == 0)
            return Array.Empty<AwardYearTileDto>();

        // IMPORTANT (product): year tiles must not reuse award-level art or nominee/movie art as a fallback.
        // If we don't have ceremony poster art for the specific year, return null so the UI shows a branded placeholder.

        var meta = (await GetCatalogAsync(ct).ConfigureAwait(false)).FirstOrDefault(x => x.Id == awardId);
        var awardTitle = meta?.Name ?? awardId;
        var accent = meta?.Accent;

        var bag = new ConcurrentBag<AwardYearTileDto>();
        var po = new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct };
        await Parallel.ForEachAsync(years, po, async (y, token) =>
        {
            var edition = await _provider.TryLoadEditionBannerAsync(awardId, y, token).ConfigureAwait(false);

            // Priority (year tiles):
            // 1) edition-level posterPath (ceremony poster for that year)
            // 2) cached <year>-event-poster.jpg (pre-cached ceremony art)
            // 3) neutral branded fallback (UI)
            string? yearPosterUrl = null;
            if (edition != null && !string.IsNullOrWhiteSpace(edition.PosterPath))
            {
                yearPosterUrl = await ResolveCachedImageUrlAsync(
                    AwardsImageCache.YearEventPosterPath(awardId, y), edition.PosterPath, "w780", token).ConfigureAwait(false);
                yearPosterUrl ??= ToTmdbUrl(edition.PosterPath, "w780");
            }

            yearPosterUrl ??= ImageUrls.ToImageUrl(AwardsImageCache.YearEventPosterPath(awardId, y));

            bag.Add(new AwardYearTileDto
            {
                Year = y,
                Label = edition?.Label,
                PosterUrl = yearPosterUrl ??
                            AwardsPlaceholderPosterUrl(awardId, y, awardTitle, accent)
            });
        }).ConfigureAwait(false);

        return bag.OrderByDescending(t => t.Year).ToList();
    }

    public Task<IReadOnlyList<int>> GetYearsAsync(string awardId, CancellationToken ct) =>
        _provider.ListYearsAsync(awardId, ct);

    public async Task<AwardEditionResponseDto?> BuildEditionAsync(string awardId, int year, CancellationToken ct)
    {
        var file = await _provider.TryLoadEditionAsync(awardId, year, ct).ConfigureAwait(false);
        if (file == null)
            return null;

        var catalogList = await GetCatalogAsync(ct).ConfigureAwait(false);
        var catEntryEarly = catalogList.FirstOrDefault(x => x.Id == awardId);
        var nomineeAccent = catEntryEarly?.Accent;

        await using var scope = _scopeFactory.CreateAsyncScope();
        var cacheRepo = scope.ServiceProvider.GetRequiredService<AwardNomineeCacheRepository>();
        var libRepo = scope.ServiceProvider.GetRequiredService<LibraryRepository>();
        var cacheRows = await cacheRepo.GetEditionRowsAsync(awardId, year, ct).ConfigureAwait(false);
        var cacheByKey = new Dictionary<string, AwardNomineeCacheRow>(StringComparer.Ordinal);
        foreach (var row in cacheRows)
            cacheByKey[NomineeLookupKey(row.CategoryId, row.Title, row.MediaType)] = row;

        var tmdb = TmdbClientFactory.Create();
        var res = new AwardEditionResponseDto
        {
            AwardId = file.AwardId,
            Year = file.Year,
            Label = file.Label,
            DataSource = file.DataSource,
            Notes = file.Notes,
            Qa = file.Qa,
            Categories = new List<AwardCategoryResponseDto>()
        };

        // Edition hero art: ceremony only (edition JSON + year event cache). Never nominee/movie TMDB art.
        if (!string.IsNullOrWhiteSpace(file.PosterPath))
        {
            var abs = AwardsImageCache.YearEventPosterPath(awardId, year);
            res.HeroPosterUrl = await ResolveCachedImageUrlAsync(abs, file.PosterPath, "w780", ct).ConfigureAwait(false)
                               ?? ToTmdbUrl(file.PosterPath, "w780");
        }

        if (!string.IsNullOrWhiteSpace(file.BackdropPath))
        {
            var abs = AwardsImageCache.YearEventBackdropPath(awardId, year);
            res.HeroBackdropUrl = await ResolveCachedImageUrlAsync(abs, file.BackdropPath, "w1280", ct).ConfigureAwait(false)
                                 ?? ToTmdbUrl(file.BackdropPath, "w1280");
        }

        foreach (var c in file.Categories)
        {
            var ordered = c.Nominees;
            if (ordered.Count == 0)
            {
                res.Categories.Add(new AwardCategoryResponseDto
                {
                    Id = c.Id,
                    Name = c.Name,
                    Completeness = ComputeCategoryCompleteness(c, file),
                    Nominees = new List<AwardNomineeResponseDto>()
                });
                continue;
            }

            var nomineesArr = new AwardNomineeResponseDto[ordered.Count];
            var po = new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct };
            await Parallel.ForEachAsync(
                Enumerable.Range(0, ordered.Count),
                po,
                async (i, token) =>
                {
                    cacheByKey.TryGetValue(NomineeLookupKey(c.Id, ordered[i].Title, ordered[i].MediaType),
                        out var crow);
                    nomineesArr[i] = await BuildNomineeResponseDtoAsync(tmdb, crow, awardId, year, c.Id, ordered[i],
                            nomineeAccent, token)
                        .ConfigureAwait(false);
                }).ConfigureAwait(false);

            for (var i = 0; i < nomineesArr.Length; i++)
                await ApplyLibraryOverlayAsync(libRepo, nomineesArr[i], ordered[i], ct).ConfigureAwait(false);

            res.Categories.Add(new AwardCategoryResponseDto
            {
                Id = c.Id,
                Name = c.Name,
                Completeness = ComputeCategoryCompleteness(c, file),
                Nominees = nomineesArr.ToList()
            });
        }

        var catEntry = catEntryEarly;
        var awardDisplayName = catEntry?.Name ?? awardId;
        var accent = catEntry?.Accent;

        res.HeroPosterUrl ??= ImageUrls.ToImageUrl(AwardsImageCache.YearEventPosterPath(awardId, year));
        if (string.IsNullOrEmpty(res.HeroPosterUrl))
        {
            res.HeroPosterUrl = AwardsPlaceholderPosterUrl(awardId, year,
                res.Label ?? $"{awardDisplayName} · {year}",
                accent);
        }

        res.HeroBackdropUrl ??= ImageUrls.ToImageUrl(AwardsImageCache.YearEventBackdropPath(awardId, year));

        if (catEntry != null && !string.IsNullOrWhiteSpace(catEntry.EventPosterPath))
        {
            res.EventPosterUrl = await ResolveCachedImageUrlAsync(
                    AwardsImageCache.EventPosterPath(awardId), catEntry.EventPosterPath, "w342", ct).ConfigureAwait(false)
                ?? ToTmdbUrl(catEntry.EventPosterPath, "w342");
        }

        return res;
    }
}
