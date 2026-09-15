using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Pitflix.API.Services;
using Pitflix.Core.Config;

namespace Pitflix.API.Endpoints;

public static class StreamEndpoints
{
    public static void MapStreamEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        // —— Online stream (TMDB helpers; search uses POST /api/unmatched/search) ——
        app.MapGet("/api/stream/imdb-id/{tmdbId:int}", async (int tmdbId, string? mediaType, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(new { imdbId = (string?)null }, jsonSerializerOptions);
            var mt = string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase) ? "Series" : "Movie";
            var imdb = await tmdb.TryGetImdbIdAsync(tmdbId, mt, ct).ConfigureAwait(false);
            return Results.Json(new { imdbId = imdb }, jsonSerializerOptions);
        });

        app.MapGet("/api/stream/parents-guide/{imdbId}", async (string imdbId, ImdbParentsGuideService parentsGuide, CancellationToken ct) =>
        {
            var result = await parentsGuide.TryFetchAsync(imdbId, ct).ConfigureAwait(false);
            if (result == null)
                return Results.Json(new { error = "Parents Guide unavailable." }, jsonSerializerOptions);
            return Results.Json(result, jsonSerializerOptions);
        });

        app.MapGet("/api/stream/tv/{tmdbId:int}/seasons", async (int tmdbId, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(Array.Empty<object>(), jsonSerializerOptions);
            if (tmdbId <= 0)
                return Results.Json(Array.Empty<object>(), jsonSerializerOptions);

            var n = await tmdb.TryGetTvNumberOfSeasonsAsync(tmdbId, ct).ConfigureAwait(false);
            if (n is null or <= 0)
                return Results.Json(Array.Empty<object>(), jsonSerializerOptions);

            var rows = new List<object>();
            for (var season = 1; season <= n.Value; season++)
            {
                var header = await tmdb.TryGetTvSeasonHeaderAsync(tmdbId, season, ct).ConfigureAwait(false);
                int episodeCount;
                string name;
                if (!header.HasValue)
                {
                    episodeCount = 0;
                    name = $"Season {season}";
                }
                else
                {
                    episodeCount = header.Value.EpisodeCount;
                    name = string.IsNullOrWhiteSpace(header.Value.Name)
                        ? $"Season {season}"
                        : header.Value.Name.Trim();
                }

                rows.Add(new { seasonNumber = season, episodeCount, name });
            }

            return Results.Json(rows, jsonSerializerOptions);
        });

        app.MapGet("/api/stream/tv/{tmdbId:int}/season/{seasonNumber:int}/episodes", async (int tmdbId, int seasonNumber, HttpContext httpContext, IMemoryCache memoryCache, IHttpClientFactory httpFactory, IResolvedApiKeysAccessor apiKeys, CancellationToken ct) =>
        {
            var apiKey = apiKeys.ResolvedTmdbApiKey;
            if (!AppSettings.IsValidTmdbKey(apiKey) || tmdbId <= 0 || seasonNumber <= 0)
                return Results.Json(new { episodes = Array.Empty<object>(), error = "Invalid request." }, jsonSerializerOptions);

            var cacheKey = $"stream:episodes:{tmdbId}:{seasonNumber}";
            if (memoryCache.TryGetValue(cacheKey, out string? cachedJson))
            {
                httpContext.Response.Headers["Cache-Control"] = "public,max-age=21600";
                return Results.Text(cachedJson!, "application/json");
            }

            try
            {
                var http = httpFactory.CreateClient();
                http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0");
                var url = $"https://api.themoviedb.org/3/tv/{tmdbId}/season/{seasonNumber}?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                var json = await http.GetStringAsync(new Uri(url), ct).ConfigureAwait(false);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                static string? Str(JsonElement el, string key) =>
                    el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                static int Int32(JsonElement el, string key) =>
                    el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : 0;
                static double Dbl(JsonElement el, string key) =>
                    el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;

                var seasonName = Str(root, "name") ?? $"Season {seasonNumber}";
                var seasonOverview = Str(root, "overview");
                var seasonPosterPath = Str(root, "poster_path");
                var seasonPosterUrl = string.IsNullOrWhiteSpace(seasonPosterPath)
                    ? null : $"https://image.tmdb.org/t/p/w342{seasonPosterPath}";

                var episodes = new List<object>();
                if (root.TryGetProperty("episodes", out var epsArr) && epsArr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var ep in epsArr.EnumerateArray())
                    {
                        var epNum = Int32(ep, "episode_number");
                        var epTitle = Str(ep, "name") ?? $"Episode {epNum}";
                        var epOverview = Str(ep, "overview");
                        var airDate = Str(ep, "air_date");
                        var runtime = Int32(ep, "runtime");
                        var vote = Dbl(ep, "vote_average");
                        var stillPath = Str(ep, "still_path");
                        var stillUrl = string.IsNullOrWhiteSpace(stillPath)
                            ? null : $"https://image.tmdb.org/t/p/w300{stillPath}";

                        episodes.Add(new
                        {
                            episodeNumber = epNum,
                            title = epTitle,
                            overview = epOverview,
                            airDate,
                            runtime,
                            voteAverage = vote,
                            stillUrl,
                        });
                    }
                }

                var payload = JsonSerializer.Serialize(
                    new { seasonName, seasonOverview, seasonPosterUrl, episodes, error = (string?)null }, jsonSerializerOptions);
                memoryCache.Set(cacheKey, payload, TimeSpan.FromHours(6));
                httpContext.Response.Headers["Cache-Control"] = "public,max-age=21600";
                return Results.Text(payload, "application/json");
            }
            catch (Exception ex)
            {
                app.Logger.LogWarning(ex, "Stream episodes lookup failed for TMDB {TmdbId} season {Season}", tmdbId, seasonNumber);
                return Results.Json(new { episodes = Array.Empty<object>(), error = ex.Message }, jsonSerializerOptions);
            }
        });

        // —— Stream TMDB details (for StreamingDetailsPage) ——
        app.MapGet("/api/stream/details/{tmdbId:int}", async (int tmdbId, string? mediaType, HttpContext httpContext, IMemoryCache memoryCache, IHttpClientFactory httpFactory, IResolvedApiKeysAccessor apiKeys, CancellationToken ct) =>
        {
            var apiKey = apiKeys.ResolvedTmdbApiKey;
            if (!AppSettings.IsValidTmdbKey(apiKey) || tmdbId <= 0)
                return Results.Json(new { error = "TMDB not configured." }, jsonSerializerOptions);

            var isMovie = !string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase);

            var cacheKey = $"stream:details:{tmdbId}:{(isMovie ? "movie" : "tv")}";
            if (memoryCache.TryGetValue(cacheKey, out string? cachedJson))
            {
                httpContext.Response.Headers["Cache-Control"] = "public,max-age=3600";
                return Results.Text(cachedJson!, "application/json");
            }

            var endpoint = isMovie ? $"movie/{tmdbId}" : $"tv/{tmdbId}";
            // TV's plain `credits` only carries show-level crew TMDB tagged manually (creators,
            // exec producers) — directing/writing on TV is an episode-level credit, so a series'
            // actual directors never show up there. `aggregate_credits` rolls crew up across every
            // episode/season instead, with a per-job episode_count — that's the one used below for
            // TV crew (see the aggregate_credits parsing block).
            var appendTo = isMovie
                ? "videos,recommendations,external_ids,credits"
                : "videos,recommendations,external_ids,credits,aggregate_credits";
            var url = $"https://api.themoviedb.org/3/{endpoint}?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US&append_to_response={appendTo}";

            try
            {
                var http = httpFactory.CreateClient();
                http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0");
                var json = await http.GetStringAsync(new Uri(url), ct).ConfigureAwait(false);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                var title = root.TryGetProperty("title", out var t) ? t.GetString()
                    : root.TryGetProperty("name", out var n) ? n.GetString() : null;
                var overview = root.TryGetProperty("overview", out var ov) ? ov.GetString() : null;
                var posterPath = root.TryGetProperty("poster_path", out var pp) ? pp.GetString() : null;
                var backdropPath = root.TryGetProperty("backdrop_path", out var bp) ? bp.GetString() : null;
                var voteAverage = root.TryGetProperty("vote_average", out var va) && va.TryGetDouble(out var vd) ? vd : 0;
                var voteCount = root.TryGetProperty("vote_count", out var vc) && vc.TryGetInt32(out var vci) ? vci : 0;
                var releaseDate = root.TryGetProperty("release_date", out var rd) ? rd.GetString()
                    : root.TryGetProperty("first_air_date", out var fa) ? fa.GetString() : null;
                var imdbId = root.TryGetProperty("external_ids", out var ext) && ext.TryGetProperty("imdb_id", out var im)
                    ? im.GetString() : null;
                var numberOfSeasons = root.TryGetProperty("number_of_seasons", out var ns) && ns.TryGetInt32(out var nsi) ? nsi : 0;
                int? runtimeMinutes = null;
                if (isMovie)
                {
                    if (root.TryGetProperty("runtime", out var rt) && rt.ValueKind == JsonValueKind.Number && rt.TryGetInt32(out var rti) && rti > 0)
                        runtimeMinutes = rti;
                }
                else if (root.TryGetProperty("episode_run_time", out var ert) && ert.ValueKind == JsonValueKind.Array)
                {
                    var first = ert.EnumerateArray().FirstOrDefault();
                    if (first.ValueKind == JsonValueKind.Number && first.TryGetInt32(out var erti) && erti > 0)
                        runtimeMinutes = erti;
                }

                var genres = new List<string>();
                if (root.TryGetProperty("genres", out var genresEl) && genresEl.ValueKind == JsonValueKind.Array)
                    foreach (var g in genresEl.EnumerateArray())
                        if (g.TryGetProperty("name", out var gn)) genres.Add(gn.GetString() ?? "");

                // Seasons (TV only)
                var seasons = new List<object>();
                if (!isMovie && root.TryGetProperty("seasons", out var seasonsEl) && seasonsEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var s in seasonsEl.EnumerateArray())
                    {
                        var sNum = s.TryGetProperty("season_number", out var sn) && sn.TryGetInt32(out var sni) ? sni : -1;
                        if (sNum < 1) continue; // skip specials (season 0)
                        var sName = s.TryGetProperty("name", out var snm) ? snm.GetString() : null;
                        var sEps = s.TryGetProperty("episode_count", out var se) && se.TryGetInt32(out var sei) ? sei : 0;
                        var sAir = s.TryGetProperty("air_date", out var sa) ? sa.GetString() : null;
                        var sPoster = s.TryGetProperty("poster_path", out var sp) ? sp.GetString() : null;
                        seasons.Add(new
                        {
                            seasonNumber = sNum,
                            name = sName ?? $"Season {sNum}",
                            episodeCount = sEps,
                            airDate = sAir,
                            posterUrl = string.IsNullOrEmpty(sPoster) ? null : $"https://image.tmdb.org/t/p/w185{sPoster}",
                        });
                    }
                }

                // Cast (top 12)
                var cast = new List<object>();
                if (root.TryGetProperty("credits", out var creditsEl) && creditsEl.TryGetProperty("cast", out var castArr)
                    && castArr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var p in castArr.EnumerateArray().Take(12))
                    {
                        var pName = p.TryGetProperty("name", out var pn) ? pn.GetString() : null;
                        var pChar = p.TryGetProperty("character", out var pc) ? pc.GetString() : null;
                        var pProfile = p.TryGetProperty("profile_path", out var pp2) ? pp2.GetString() : null;
                        var pId = p.TryGetProperty("id", out var pi) && pi.TryGetInt32(out var pii) ? pii : 0;
                        if (!string.IsNullOrEmpty(pName))
                            cast.Add(new
                            {
                                id = pId,
                                name = pName,
                                character = pChar,
                                profileUrl = string.IsNullOrEmpty(pProfile) ? null : $"https://image.tmdb.org/t/p/w185{pProfile}",
                            });
                    }
                }

                // Crew (directors, writers, and other key crew — top 15).
                // TV uses aggregate_credits instead of plain credits (see appendTo above) — each
                // person there carries a `jobs` array (one entry per distinct job across all
                // episodes, with its own episode_count), so a person doing two jobs becomes two
                // rows, each with the episode count for that specific job.
                var crew = new List<object>();
                if (isMovie)
                {
                    if (root.TryGetProperty("credits", out var creditsEl2) && creditsEl2.TryGetProperty("crew", out var crewArr)
                        && crewArr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var p in crewArr.EnumerateArray().Take(40))
                        {
                            var pName = p.TryGetProperty("name", out var pn) ? pn.GetString() : null;
                            var pJob = p.TryGetProperty("job", out var pj) ? pj.GetString() : null;
                            var pProfile = p.TryGetProperty("profile_path", out var pp3) ? pp3.GetString() : null;
                            var pId = p.TryGetProperty("id", out var pi2) && pi2.TryGetInt32(out var pii2) ? pii2 : 0;
                            if (!string.IsNullOrEmpty(pName) && !string.IsNullOrEmpty(pJob))
                                crew.Add(new
                                {
                                    id = pId,
                                    name = pName,
                                    job = pJob,
                                    profileUrl = string.IsNullOrEmpty(pProfile) ? null : $"https://image.tmdb.org/t/p/w185{pProfile}",
                                    episodeCount = (int?)null,
                                });
                        }
                    }
                }
                else if (root.TryGetProperty("aggregate_credits", out var aggCreditsEl) &&
                         aggCreditsEl.TryGetProperty("crew", out var aggCrewArr) && aggCrewArr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var p in aggCrewArr.EnumerateArray().Take(40))
                    {
                        var pName = p.TryGetProperty("name", out var pn) ? pn.GetString() : null;
                        var pProfile = p.TryGetProperty("profile_path", out var pp3) ? pp3.GetString() : null;
                        var pId = p.TryGetProperty("id", out var pi2) && pi2.TryGetInt32(out var pii2) ? pii2 : 0;
                        if (string.IsNullOrEmpty(pName)) continue;
                        if (!p.TryGetProperty("jobs", out var jobsEl) || jobsEl.ValueKind != JsonValueKind.Array) continue;

                        foreach (var jobEntry in jobsEl.EnumerateArray())
                        {
                            var pJob = jobEntry.TryGetProperty("job", out var jj) ? jj.GetString() : null;
                            var epCount = jobEntry.TryGetProperty("episode_count", out var ec) && ec.TryGetInt32(out var eci) ? eci : (int?)null;
                            if (string.IsNullOrEmpty(pJob)) continue;
                            crew.Add(new
                            {
                                id = pId,
                                name = pName,
                                job = pJob,
                                profileUrl = string.IsNullOrEmpty(pProfile) ? null : $"https://image.tmdb.org/t/p/w185{pProfile}",
                                episodeCount = epCount,
                            });
                        }
                    }
                }

                // Trailers: pick YouTube trailers, Official Trailer first
                var trailers = new List<StreamTrailerEntry>();
                if (root.TryGetProperty("videos", out var vids) && vids.TryGetProperty("results", out var vidArr)
                    && vidArr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var v in vidArr.EnumerateArray())
                    {
                        var site = v.TryGetProperty("site", out var si) ? si.GetString() : null;
                        var vtype = v.TryGetProperty("type", out var vt) ? vt.GetString() : null;
                        var vkey = v.TryGetProperty("key", out var vk) ? vk.GetString() : null;
                        var vname = v.TryGetProperty("name", out var vn) ? vn.GetString() : null;
                        if (site == "YouTube" && !string.IsNullOrEmpty(vkey))
                            trailers.Add(new StreamTrailerEntry(vname, vkey!, vtype, $"https://www.youtube.com/watch?v={vkey}"));
                    }
                }
                var officialTrailer = trailers.FirstOrDefault(x => x.Type == "Trailer");
                var featuredTrailer = officialTrailer ?? trailers.FirstOrDefault();
                var featuredTrailerObj = featuredTrailer == null ? null : new
                {
                    name = featuredTrailer.Name, key = featuredTrailer.Key,
                    type = featuredTrailer.Type, youtubeUrl = featuredTrailer.YoutubeUrl
                };

                // Recommendations
                var recs = new List<object>();
                if (root.TryGetProperty("recommendations", out var recsEl) && recsEl.TryGetProperty("results", out var recArr)
                    && recArr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var r in recArr.EnumerateArray().Take(16))
                    {
                        var recTitle = r.TryGetProperty("title", out var rt) ? rt.GetString()
                            : r.TryGetProperty("name", out var rn) ? rn.GetString() : null;
                        var recId = r.TryGetProperty("id", out var ri) && ri.TryGetInt32(out var rid) ? rid : 0;
                        var recPoster = r.TryGetProperty("poster_path", out var rp) ? rp.GetString() : null;
                        var recDate = r.TryGetProperty("release_date", out var rrd) ? rrd.GetString()
                            : r.TryGetProperty("first_air_date", out var rfa) ? rfa.GetString() : null;
                        var recMt = r.TryGetProperty("media_type", out var rmt) ? rmt.GetString() : (isMovie ? "movie" : "tv");
                        if (recId > 0 && !string.IsNullOrEmpty(recTitle))
                            recs.Add(new
                            {
                                id = recId, title = recTitle,
                                posterUrl = string.IsNullOrEmpty(recPoster) ? null : $"https://image.tmdb.org/t/p/w185{recPoster}",
                                year = recDate?.Length >= 4 ? recDate[..4] : null,
                                mediaType = recMt == "tv" ? "Series" : "Movie",
                            });
                    }
                }

                // Production companies / TV networks (Netflix, Apple TV+, HBO, etc.). TV shows carry
                // both "networks" (who airs it — this is where streaming originals show up) and
                // "production_companies" (the studio that made it); movies only have the latter. TMDB
                // tracks companies and networks as separate id spaces, so each entry keeps its own
                // "kind" — the "See everything they produced" lookup needs it to pick the right
                // discover endpoint (with_networks vs with_companies).
                var companies = new List<object>();
                var seenCompanyIds = new HashSet<int>();
                var seenCompanyNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                void AddCompany(int id, string? name, string? logoPath, string kind)
                {
                    if (id <= 0 || string.IsNullOrWhiteSpace(name) || companies.Count >= 6) return;
                    var trimmedName = name.Trim();
                    // Minor production companies with no logo are usually in-house shell entities
                    // (e.g. "Man, Woman & Child Productions") that just add clutter — drop those, but
                    // keep networks regardless since they're the primary "who airs this" signal.
                    if (kind == "company" && string.IsNullOrEmpty(logoPath)) return;
                    if (!seenCompanyIds.Add(id) || !seenCompanyNames.Add(trimmedName)) return;

                    companies.Add(new
                    {
                        id,
                        name = trimmedName,
                        logoUrl = string.IsNullOrEmpty(logoPath) ? null : $"https://image.tmdb.org/t/p/w300{logoPath}",
                        kind,
                    });
                }

                if (!isMovie && root.TryGetProperty("networks", out var networksEl) && networksEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var netEl in networksEl.EnumerateArray())
                    {
                        var nId = netEl.TryGetProperty("id", out var ni) && ni.TryGetInt32(out var niv) ? niv : 0;
                        var nName = netEl.TryGetProperty("name", out var nn) ? nn.GetString() : null;
                        var nLogo = netEl.TryGetProperty("logo_path", out var nl) ? nl.GetString() : null;
                        AddCompany(nId, nName, nLogo, "network");
                    }
                }
                if (root.TryGetProperty("production_companies", out var compEl) && compEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var c in compEl.EnumerateArray())
                    {
                        var cId = c.TryGetProperty("id", out var ci) && ci.TryGetInt32(out var civ) ? civ : 0;
                        var cName = c.TryGetProperty("name", out var cn) ? cn.GetString() : null;
                        var cLogo = c.TryGetProperty("logo_path", out var cl) ? cl.GetString() : null;
                        AddCompany(cId, cName, cLogo, "company");
                    }
                }

                // Collection (movies only)
                object? belongsToCollection = null;
                if (isMovie && root.TryGetProperty("belongs_to_collection", out var colEl)
                    && colEl.ValueKind == JsonValueKind.Object)
                {
                    var colId = colEl.TryGetProperty("id", out var ci) && ci.TryGetInt32(out var civ) ? civ : 0;
                    var colName = colEl.TryGetProperty("name", out var cn) ? cn.GetString() : null;
                    var colPoster = colEl.TryGetProperty("poster_path", out var cp) ? cp.GetString() : null;
                    if (colId > 0)
                        belongsToCollection = new
                        {
                            id = colId,
                            name = colName,
                            posterUrl = string.IsNullOrEmpty(colPoster) ? null : $"https://image.tmdb.org/t/p/w342{colPoster}",
                        };
                }

                var payload = JsonSerializer.Serialize(new
                {
                    tmdbId, title, overview,
                    posterUrl = string.IsNullOrEmpty(posterPath) ? null : $"https://image.tmdb.org/t/p/w500{posterPath}",
                    backdropUrl = string.IsNullOrEmpty(backdropPath) ? null : $"https://image.tmdb.org/t/p/w1280{backdropPath}",
                    voteAverage, voteCount, releaseDate, year = releaseDate?.Length >= 4 ? releaseDate[..4] : null,
                    genres, imdbId, mediaType = isMovie ? "Movie" : "Series",
                    numberOfSeasons, runtimeMinutes, seasons, cast, crew, trailer = featuredTrailerObj, recommendations = recs,
                    collection = belongsToCollection, companies,
                }, jsonSerializerOptions);
                memoryCache.Set(cacheKey, payload, TimeSpan.FromHours(1));
                httpContext.Response.Headers["Cache-Control"] = "public,max-age=3600";
                return Results.Text(payload, "application/json");
            }
            catch (Exception ex)
            {
                app.Logger.LogWarning(ex, "Stream details lookup failed for TMDB {TmdbId} ({MediaType})", tmdbId, mediaType);
                return Results.Json(new { error = ex.Message }, jsonSerializerOptions);
            }
        });

        // —— Stream TMDB Discover (trending / popular / top-rated / upcoming) ——
        app.MapGet("/api/stream/discover", async (string? category, int? page, string? sort, HttpContext httpContext, IMemoryCache memoryCache, IHttpClientFactory httpFactory, IResolvedApiKeysAccessor apiKeys, ImdbTop100Store imdbTop100Store, ImdbTop100TvStore imdbTop100TvStore, CancellationToken ct) =>
        {
            var apiKey = apiKeys.ResolvedTmdbApiKey;
            if (!AppSettings.IsValidTmdbKey(apiKey))
                return Results.Json(new { items = Array.Empty<object>(), hasMore = false }, jsonSerializerOptions);

            var cat = (category ?? "trending-movie").Trim().ToLowerInvariant();
            var pageNum = Math.Clamp(page ?? 1, 1, 500);
            var sortMode = (sort ?? "popularity").Trim().ToLowerInvariant();

            // Real-IMDb-ranked list, precomputed in the background by ImdbTop100RefreshHostedService
            // (MDBList's 1 req/sec limit makes ranking a ~150-title pool too slow to do inline here).
            // Falls through to the TMDB-vote_average approximation below only until the first
            // background rebuild finishes (or if MDBList isn't configured at all).
            var imdbTop100Source = cat switch
            {
                "top-imdb-movie" => imdbTop100Store.Items,
                "top-imdb-tv" => imdbTop100TvStore.Items,
                _ => null,
            };
            if (imdbTop100Source is { Count: > 0 })
            {
                var all = imdbTop100Source;
                var startIdx = (pageNum - 1) * 20;
                var pageItems = all.Skip(startIdx).Take(20)
                    .Select(x => new
                    {
                        id = x.Id,
                        title = x.Title,
                        overview = x.Overview,
                        posterUrl = x.PosterUrl,
                        backdropUrl = x.BackdropUrl,
                        voteAverage = x.ImdbRating,
                        year = x.Year,
                        mediaType = x.MediaType,
                        ratingSource = "imdb",
                    })
                    .ToList();
                var hasMoreFromStore = startIdx + pageItems.Count < all.Count;
                var storePayload = JsonSerializer.Serialize(new { items = pageItems, hasMore = hasMoreFromStore }, jsonSerializerOptions);
                httpContext.Response.Headers["Cache-Control"] = "public,max-age=300";
                return Results.Text(storePayload, "application/json");
            }

            var cacheKey = $"stream:discover:{cat}:{pageNum}:{sortMode}";
            if (memoryCache.TryGetValue(cacheKey, out string? cachedJson))
            {
                httpContext.Response.Headers["Cache-Control"] = "public,max-age=1800";
                return Results.Text(cachedJson!, "application/json");
            }

            string tmdbUrl;
            bool defaultIsMovie;

            // Genre browsing: "genre-movie-{id}" / "genre-tv-{id}" — id is a raw TMDB genre id.
            var todayStr = DateTime.UtcNow.ToString("yyyy-MM-dd");
            if (cat.StartsWith("genre-movie-", StringComparison.Ordinal) &&
                int.TryParse(cat.AsSpan("genre-movie-".Length), out var movieGenreId) && movieGenreId > 0)
            {
                // "rating": vote_count.gte is raised well past TMDB's default floor — a low threshold
                // lets a niche title with a handful of enthusiastic voters (small sample, easily
                // skewed) outrank genuinely well-known titles on raw average.
                // "newest": primary_release_date.lte=today is required, not just nice-to-have — TMDB's
                // "newest first" sort with no such bound front-loads far-future/placeholder dates, and
                // the future-date filter further down would then strip almost the entire result set.
                var movieSortBy = sortMode switch
                {
                    "rating" => "vote_average.desc&vote_count.gte=2000",
                    "newest" => $"primary_release_date.desc&primary_release_date.lte={todayStr}",
                    _ => "popularity.desc",
                };
                tmdbUrl = $"https://api.themoviedb.org/3/discover/movie?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US&sort_by={movieSortBy}&with_genres={movieGenreId}";
                defaultIsMovie = true;
            }
            else if (cat.StartsWith("genre-tv-", StringComparison.Ordinal) &&
                int.TryParse(cat.AsSpan("genre-tv-".Length), out var tvGenreId) && tvGenreId > 0)
            {
                var tvSortBy = sortMode switch
                {
                    "rating" => "vote_average.desc&vote_count.gte=2000",
                    "newest" => $"first_air_date.desc&first_air_date.lte={todayStr}",
                    _ => "popularity.desc",
                };
                tmdbUrl = $"https://api.themoviedb.org/3/discover/tv?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US&sort_by={tvSortBy}&with_genres={tvGenreId}";
                defaultIsMovie = false;
            }
            else switch (cat)
            {
                case "trending-movie":
                    tmdbUrl = $"https://api.themoviedb.org/3/trending/movie/week?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                    defaultIsMovie = true;
                    break;
                case "trending-tv":
                    tmdbUrl = $"https://api.themoviedb.org/3/trending/tv/week?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                    defaultIsMovie = false;
                    break;
                case "popular-movie":
                    tmdbUrl = $"https://api.themoviedb.org/3/movie/popular?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                    defaultIsMovie = true;
                    break;
                case "popular-tv":
                    tmdbUrl = $"https://api.themoviedb.org/3/tv/popular?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                    defaultIsMovie = false;
                    break;
                case "top-rated-movie":
                    tmdbUrl = $"https://api.themoviedb.org/3/movie/top_rated?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                    defaultIsMovie = true;
                    break;
                case "top-rated-tv":
                    tmdbUrl = $"https://api.themoviedb.org/3/tv/top_rated?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                    defaultIsMovie = false;
                    break;
                case "upcoming":
                    tmdbUrl = $"https://api.themoviedb.org/3/movie/upcoming?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                    defaultIsMovie = true;
                    break;
                case "now-playing-movie":
                    tmdbUrl = $"https://api.themoviedb.org/3/movie/now_playing?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                    defaultIsMovie = true;
                    break;
                case "airing-today-tv":
                    tmdbUrl = $"https://api.themoviedb.org/3/tv/airing_today?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                    defaultIsMovie = false;
                    break;
                case "on-the-air-tv":
                    tmdbUrl = $"https://api.themoviedb.org/3/tv/on_the_air?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                    defaultIsMovie = false;
                    break;
                case "top-imdb-movie":
                    // TMDB has no literal "IMDb Top 250" endpoint. movie/top_rated applies TMDB's own
                    // vote-weighted (Bayesian) ranking rather than a raw average, which is what keeps
                    // brand-new releases with a handful of hype votes from outranking the actual
                    // classics — a plain "sort by vote_average" discover query let exactly that happen.
                    // This is only ever used before ImdbTop100RefreshHostedService's first rebuild
                    // finishes (see the early-return above) — the real ranking uses actual IMDb scores.
                    tmdbUrl = $"https://api.themoviedb.org/3/movie/top_rated?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                    defaultIsMovie = true;
                    break;
                case "top-imdb-tv":
                    // Same fallback reasoning as "top-imdb-movie" above, for TV.
                    tmdbUrl = $"https://api.themoviedb.org/3/tv/top_rated?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                    defaultIsMovie = false;
                    break;
                default:
                    tmdbUrl = $"https://api.themoviedb.org/3/trending/movie/week?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                    defaultIsMovie = true;
                    break;
            }

            tmdbUrl += $"&page={pageNum}";

            try
            {
                var http = httpFactory.CreateClient();
                http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0");
                var json = await http.GetStringAsync(new Uri(tmdbUrl), ct).ConfigureAwait(false);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                var items = new List<object>();
                var now = DateTime.UtcNow;
                if (root.TryGetProperty("results", out var results) && results.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in results.EnumerateArray().Take(20))
                    {
                        var id = item.TryGetProperty("id", out var idEl) && idEl.TryGetInt32(out var idVal) ? idVal : 0;
                        if (id <= 0) continue;

                        var title = item.TryGetProperty("title", out var tt) ? tt.GetString()
                            : item.TryGetProperty("name", out var nn) ? nn.GetString() : null;
                        if (string.IsNullOrEmpty(title)) continue;

                        var overview = item.TryGetProperty("overview", out var ov) ? ov.GetString() : null;
                        var posterPath = item.TryGetProperty("poster_path", out var pp) ? pp.GetString() : null;
                        var backdropPath = item.TryGetProperty("backdrop_path", out var bp) ? bp.GetString() : null;
                        var voteAvg = item.TryGetProperty("vote_average", out var va) && va.TryGetDouble(out var vd) ? vd : 0;
                        var voteCnt = item.TryGetProperty("vote_count", out var vc) && vc.TryGetInt32(out var vci) ? vci : 0;
                        var relDate = item.TryGetProperty("release_date", out var rd) ? rd.GetString()
                            : item.TryGetProperty("first_air_date", out var fa) ? fa.GetString() : null;
                        var mediaTypeField = item.TryGetProperty("media_type", out var mt) ? mt.GetString() : null;
                        var isMovie = mediaTypeField == null ? defaultIsMovie : mediaTypeField != "tv";

                        // Belt-and-suspenders for the "Top 100 on IMDb" rows: top_rated is already
                        // vote-weighted, but this drops any stray title that slipped in near the bottom
                        // of that ranking without the mass of votes a genuine classic has.
                        if ((cat == "top-imdb-movie" || cat == "top-imdb-tv") && (voteAvg < 7.0 || voteCnt < 1000))
                            continue;

                        var hasRelDate = DateTime.TryParse(relDate, out var relDt);

                        // "trending"/"popular" routinely surface titles that aren't out yet (still in
                        // theaters, or with a hype-driven future release date). Skip anything dated in
                        // the future so the catalog only shows things actually available — except the
                        // "upcoming" category, which exists specifically to show future releases.
                        if (cat != "upcoming" && hasRelDate && relDt.Date > now.Date)
                            continue;

                        // A movie can have a past theatrical release date but still be cinema-only —
                        // only check digital/physical/TV availability for movies released within the
                        // last ~60 days (the window where this actually matters); older titles are
                        // essentially guaranteed to be off the theatrical-only window by now, so skip
                        // the extra TMDB call for them.
                        if (isMovie && cat != "upcoming" && hasRelDate && relDt.Date > now.AddDays(-60).Date)
                        {
                            var digitallyAvailable = await IsMovieDigitallyAvailableAsync(id, apiKey!, httpFactory, memoryCache, ct).ConfigureAwait(false);
                            if (!digitallyAvailable) continue;
                        }

                        items.Add(new
                        {
                            id,
                            title,
                            overview,
                            posterUrl = string.IsNullOrEmpty(posterPath) ? null : $"https://image.tmdb.org/t/p/w342{posterPath}",
                            backdropUrl = string.IsNullOrEmpty(backdropPath) ? null : $"https://image.tmdb.org/t/p/w1280{backdropPath}",
                            voteAverage = voteAvg,
                            year = relDate?.Length >= 4 ? relDate[..4] : null,
                            mediaType = isMovie ? "Movie" : "Series",
                            ratingSource = "tmdb",
                        });
                    }
                }

                // "hasMore" is driven by TMDB's own total_pages, not by how many items survived the
                // filtering above — a page that TMDB says has more after it can still end up with
                // fewer than 20 items here once future-dated/theatrical-only titles are dropped, and
                // checking the post-filter count would cut pagination short right when a category
                // needs it most (a heavily-filtered genre would stop offering "Load more" after one
                // thin page even though TMDB has hundreds left).
                var totalPages = root.TryGetProperty("total_pages", out var tp) && tp.TryGetInt32(out var tpv) ? tpv : pageNum;
                var hasMore = pageNum < totalPages && pageNum < 500;

                var payload = JsonSerializer.Serialize(new { items, hasMore }, jsonSerializerOptions);
                memoryCache.Set(cacheKey, payload, TimeSpan.FromMinutes(30));
                httpContext.Response.Headers["Cache-Control"] = "public,max-age=1800";
                return Results.Text(payload, "application/json");
            }
            catch (Exception ex)
            {
                app.Logger.LogWarning(ex, "Stream discover lookup failed for category {Category}", cat);
                return Results.Json(new { items = Array.Empty<object>(), hasMore = false, error = ex.Message }, jsonSerializerOptions);
            }
        });

        // —— Studio/network browse: "everything Netflix/Apple/etc. produced" ——
        app.MapGet("/api/stream/studio/{id:int}", async (int id, string? kind, int? page, HttpContext httpContext, IMemoryCache memoryCache, IHttpClientFactory httpFactory, IResolvedApiKeysAccessor apiKeys, CancellationToken ct) =>
        {
            var apiKey = apiKeys.ResolvedTmdbApiKey;
            if (!AppSettings.IsValidTmdbKey(apiKey) || id <= 0)
                return Results.Json(new { name = (string?)null, logoUrl = (string?)null, items = Array.Empty<object>(), hasMore = false }, jsonSerializerOptions);

            var isNetwork = string.Equals(kind, "network", StringComparison.OrdinalIgnoreCase);
            var pageNum = Math.Clamp(page ?? 1, 1, 500);
            var cacheKey = $"stream:studio:{(isNetwork ? "network" : "company")}:{id}:{pageNum}";
            if (memoryCache.TryGetValue(cacheKey, out string? cachedJson))
            {
                httpContext.Response.Headers["Cache-Control"] = "public,max-age=21600";
                return Results.Text(cachedJson!, "application/json");
            }

            try
            {
                var http = httpFactory.CreateClient();
                http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0");

                // Name/logo don't change per page — cache them separately so "Load more" doesn't
                // re-fetch the studio's own info on every page.
                var infoCacheKey = $"stream:studio-info:{(isNetwork ? "network" : "company")}:{id}";
                string? name;
                string? logoUrl;
                if (memoryCache.TryGetValue(infoCacheKey, out (string? Name, string? LogoUrl) cachedInfo))
                {
                    (name, logoUrl) = cachedInfo;
                }
                else
                {
                    var infoUrl = isNetwork
                        ? $"https://api.themoviedb.org/3/network/{id}?api_key={Uri.EscapeDataString(apiKey!)}"
                        : $"https://api.themoviedb.org/3/company/{id}?api_key={Uri.EscapeDataString(apiKey!)}";
                    var infoJson = await http.GetStringAsync(new Uri(infoUrl), ct).ConfigureAwait(false);
                    using var infoDoc = JsonDocument.Parse(infoJson);
                    name = infoDoc.RootElement.TryGetProperty("name", out var nEl) ? nEl.GetString() : null;
                    var logoPath = infoDoc.RootElement.TryGetProperty("logo_path", out var lEl) ? lEl.GetString() : null;
                    logoUrl = string.IsNullOrEmpty(logoPath) ? null : $"https://image.tmdb.org/t/p/w300{logoPath}";
                    memoryCache.Set(infoCacheKey, (name, logoUrl), TimeSpan.FromHours(24));
                }

                // Networks only exist in TMDB's TV discover; companies (movie studios) only in the
                // movie discover — the two id spaces aren't interchangeable, so this only ever
                // returns the media type that "kind" actually covers.
                var discoverUrl = isNetwork
                    ? $"https://api.themoviedb.org/3/discover/tv?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US&sort_by=popularity.desc&with_networks={id}&page={pageNum}"
                    : $"https://api.themoviedb.org/3/discover/movie?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US&sort_by=popularity.desc&with_companies={id}&page={pageNum}";
                var discJson = await http.GetStringAsync(new Uri(discoverUrl), ct).ConfigureAwait(false);
                using var discDoc = JsonDocument.Parse(discJson);

                var items = new List<object>();
                if (discDoc.RootElement.TryGetProperty("results", out var results) && results.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in results.EnumerateArray())
                    {
                        var itemId = item.TryGetProperty("id", out var idEl) && idEl.TryGetInt32(out var idVal) ? idVal : 0;
                        if (itemId <= 0) continue;
                        var itemTitle = item.TryGetProperty("title", out var tt) ? tt.GetString()
                            : item.TryGetProperty("name", out var nn) ? nn.GetString() : null;
                        if (string.IsNullOrEmpty(itemTitle)) continue;
                        var posterPath = item.TryGetProperty("poster_path", out var pp) ? pp.GetString() : null;
                        var voteAvg = item.TryGetProperty("vote_average", out var va) && va.TryGetDouble(out var vd) ? vd : 0;
                        var relDate = item.TryGetProperty("release_date", out var rd) ? rd.GetString()
                            : item.TryGetProperty("first_air_date", out var fa) ? fa.GetString() : null;

                        items.Add(new
                        {
                            id = itemId,
                            title = itemTitle,
                            posterUrl = string.IsNullOrEmpty(posterPath) ? null : $"https://image.tmdb.org/t/p/w342{posterPath}",
                            voteAverage = voteAvg,
                            year = relDate?.Length >= 4 ? relDate[..4] : null,
                            mediaType = isNetwork ? "Series" : "Movie",
                        });
                    }
                }

                var totalPages = discDoc.RootElement.TryGetProperty("total_pages", out var tp) && tp.TryGetInt32(out var tpv) ? tpv : pageNum;
                var hasMore = pageNum < totalPages && pageNum < 500;

                var payload = JsonSerializer.Serialize(new { name, logoUrl, items, hasMore }, jsonSerializerOptions);
                memoryCache.Set(cacheKey, payload, TimeSpan.FromHours(6));
                httpContext.Response.Headers["Cache-Control"] = "public,max-age=21600";
                return Results.Text(payload, "application/json");
            }
            catch (Exception ex)
            {
                app.Logger.LogWarning(ex, "Studio lookup failed for {Kind} {Id}", isNetwork ? "network" : "company", id);
                return Results.Json(new { name = (string?)null, logoUrl = (string?)null, items = Array.Empty<object>(), hasMore = false, error = ex.Message }, jsonSerializerOptions);
            }
        });

        // —— Category tile posters for the online-stream "Browse by Category" row ——
        // Returns one representative (most popular) poster per requested TMDB genre id, so the
        // frontend can render genre tiles without issuing one round-trip per genre itself.
        app.MapGet("/api/stream/genre-previews", async (string? ids, HttpContext httpContext, IMemoryCache memoryCache, IHttpClientFactory httpFactory, IResolvedApiKeysAccessor apiKeys, CancellationToken ct) =>
        {
            var apiKey = apiKeys.ResolvedTmdbApiKey;
            if (!AppSettings.IsValidTmdbKey(apiKey) || string.IsNullOrWhiteSpace(ids))
                return Results.Json(Array.Empty<object>(), jsonSerializerOptions);

            var genreIds = ids.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(s => int.TryParse(s, out var v) ? v : 0)
                .Where(v => v > 0)
                .Distinct()
                .Take(30)
                .ToList();

            async Task<(int Id, string? PosterUrl)> FetchOneAsync(int genreId)
            {
                var cacheKey = $"stream:genre-preview:{genreId}";
                if (memoryCache.TryGetValue(cacheKey, out string? cachedPoster))
                    return (genreId, string.IsNullOrEmpty(cachedPoster) ? null : cachedPoster);

                try
                {
                    var http = httpFactory.CreateClient();
                    http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0");
                    var url = $"https://api.themoviedb.org/3/discover/movie?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US&sort_by=popularity.desc&with_genres={genreId}";
                    var json = await http.GetStringAsync(new Uri(url), ct).ConfigureAwait(false);
                    using var doc = JsonDocument.Parse(json);

                    string? posterUrl = null;
                    if (doc.RootElement.TryGetProperty("results", out var results) && results.ValueKind == JsonValueKind.Array)
                    {
                        var first = results.EnumerateArray().FirstOrDefault();
                        if (first.ValueKind == JsonValueKind.Object &&
                            first.TryGetProperty("poster_path", out var pp) && pp.ValueKind == JsonValueKind.String)
                        {
                            var path = pp.GetString();
                            posterUrl = string.IsNullOrEmpty(path) ? null : $"https://image.tmdb.org/t/p/w342{path}";
                        }
                    }

                    memoryCache.Set(cacheKey, posterUrl ?? "", TimeSpan.FromHours(24));
                    return (genreId, posterUrl);
                }
                catch
                {
                    return (genreId, null);
                }
            }

            var fetched = await Task.WhenAll(genreIds.Select(FetchOneAsync)).ConfigureAwait(false);
            var payload = JsonSerializer.Serialize(
                fetched.Select(r => new { id = r.Id, posterUrl = r.PosterUrl }), jsonSerializerOptions);
            httpContext.Response.Headers["Cache-Control"] = "public,max-age=86400";
            return Results.Text(payload, "application/json");
        });

        // TMDB collection details — used by streaming page to show all collection parts
        app.MapGet("/api/stream/collection/{collectionId:int}", async (int collectionId, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(new { error = "TMDB API key not configured." }, jsonSerializerOptions);

            var col = await tmdb.TryGetCollectionAsync(collectionId, ct).ConfigureAwait(false);
            if (col == null)
                return Results.NotFound();

            return Results.Json(new
            {
                id = col.Id,
                name = col.Name,
                overview = col.Overview,
                posterUrl = string.IsNullOrEmpty(col.PosterPath) ? null : $"https://image.tmdb.org/t/p/w500{col.PosterPath}",
                backdropUrl = string.IsNullOrEmpty(col.BackdropPath) ? null : $"https://image.tmdb.org/t/p/w1280{col.BackdropPath}",
                parts = col.Parts.Select(p => new
                {
                    tmdbId = p.Id,
                    title = p.Title,
                    posterUrl = string.IsNullOrEmpty(p.PosterPath) ? null : $"https://image.tmdb.org/t/p/w342{p.PosterPath}",
                    releaseDate = p.ReleaseDate,
                    year = p.ReleaseDate?.Length >= 4 ? p.ReleaseDate[..4] : null,
                    voteAverage = p.VoteAverage,
                }).ToList(),
            }, jsonSerializerOptions);
        });
    }

    /// <summary>
    /// Checks TMDB's per-country release_dates for a movie to see whether it has a
    /// digital, physical, or TV release (type 4/5/6) dated today or earlier — i.e. it's
    /// actually available to stream/own, not just playing in theaters. Used to keep
    /// theatrical-only titles out of the "trending"/"popular" catalog rows.
    ///
    /// Only called for movies whose theatrical release was within the last ~60 days
    /// (see caller), so absence of digital/physical/TV data here means "not yet on
    /// digital" far more often than "TMDB simply never tracked it" — a brand-new
    /// theatrical release usually has zero release_dates entries of those types for the
    /// first several weeks. So the default for that window is "not available" rather
    /// than "available". Lookup failures (network/API errors) still fail open to "available"
    /// so a transient hiccup never hides legitimate content.
    /// </summary>
    private static async Task<bool> IsMovieDigitallyAvailableAsync(
        int movieId,
        string apiKey,
        IHttpClientFactory httpFactory,
        IMemoryCache memoryCache,
        CancellationToken ct)
    {
        var cacheKey = $"stream:digital-avail:{movieId}";
        if (memoryCache.TryGetValue(cacheKey, out bool cached))
            return cached;

        var available = false;
        try
        {
            var http = httpFactory.CreateClient();
            http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0");
            var url = $"https://api.themoviedb.org/3/movie/{movieId}/release_dates?api_key={Uri.EscapeDataString(apiKey)}";
            var json = await http.GetStringAsync(new Uri(url), ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);

            if (doc.RootElement.TryGetProperty("results", out var countries) && countries.ValueKind == JsonValueKind.Array)
            {
                var now = DateTime.UtcNow;
                var hasPastDigitalRelease = false;

                foreach (var country in countries.EnumerateArray())
                {
                    if (!country.TryGetProperty("release_dates", out var dates) || dates.ValueKind != JsonValueKind.Array)
                        continue;

                    foreach (var d in dates.EnumerateArray())
                    {
                        // TMDB release "type": 1=Premiere, 2=Theatrical (limited), 3=Theatrical,
                        // 4=Digital, 5=Physical, 6=TV. 4/5/6 are the ones that mean "available
                        // to stream or own" rather than "in cinemas only".
                        var type = d.TryGetProperty("type", out var t) && t.TryGetInt32(out var tv) ? tv : 0;
                        if (type is not (4 or 5 or 6))
                            continue;

                        var dateStr = d.TryGetProperty("release_date", out var rd) ? rd.GetString() : null;
                        if (DateTime.TryParse(dateStr, out var dt) && dt.Date <= now.Date)
                        {
                            hasPastDigitalRelease = true;
                            break;
                        }
                    }
                    if (hasPastDigitalRelease) break;
                }

                available = hasPastDigitalRelease;
            }
        }
        catch
        {
            available = true;
        }

        memoryCache.Set(cacheKey, available, TimeSpan.FromHours(6));
        return available;
    }
}
