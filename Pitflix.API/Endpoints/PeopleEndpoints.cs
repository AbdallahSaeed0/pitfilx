using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Pitflix.API.Services;
using Pitflix.Core.Config;
using Pitflix.Core.Database;

namespace Pitflix.API.Endpoints;

public static class PeopleEndpoints
{
    public static void MapPeopleEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/people/{tmdbId:int}", async (int tmdbId, LibraryRepository reqRepo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var tmdb = tmdbClientFactory.Create();
            if (tmdb == null)
                return Results.Json(new { person = (object?)null, localAppearances = Array.Empty<object>() });

            var person = await tmdb.GetPersonDetailsAsync(tmdbId, ct).ConfigureAwait(false);
            var local = await reqRepo.GetLibraryMediaForPersonAsync(tmdbId, ct).ConfigureAwait(false);
            object? personOut = null;
            if (person != null)
            {
                personOut = new
                {
                    person.Id,
                    person.Name,
                    person.Biography,
                    person.ProfilePath,
                    profileImageUrl = ImageUrls.ToImageUrl(person.ProfileLocalPath),
                    person.Birthday,
                    person.PlaceOfBirth,
                    person.KnownFor
                };
            }

            return Results.Json(new { person = personOut, localAppearances = local.Select(ImageUrls.MapLocalSimilar).ToList() });
        });

        app.MapGet("/api/people/{tmdbId:int}/stream-credits", async (int tmdbId, HttpContext httpContext, IMemoryCache memoryCache, IResolvedApiKeysAccessor apiKeys, CancellationToken ct) =>
        {
            var apiKey = apiKeys.ResolvedTmdbApiKey;
            if (!AppSettings.IsValidTmdbKey(apiKey) || tmdbId <= 0)
                return Results.Json(new { credits = Array.Empty<object>(), error = "TMDB not configured." }, jsonSerializerOptions);

            var cacheKey = $"people:stream-credits:{tmdbId}";
            if (memoryCache.TryGetValue(cacheKey, out string? cachedJson))
            {
                httpContext.Response.Headers["Cache-Control"] = "public,max-age=86400";
                return Results.Text(cachedJson!, "application/json");
            }

            try
            {
                using var handler = new HttpClientHandler
                {
                    AutomaticDecompression = System.Net.DecompressionMethods.GZip | System.Net.DecompressionMethods.Deflate
                };
                using var http = new HttpClient(handler);
                http.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0");
                var url = $"https://api.themoviedb.org/3/person/{tmdbId}/combined_credits?api_key={Uri.EscapeDataString(apiKey!)}&language=en-US";
                var json = await http.GetStringAsync(new Uri(url), ct).ConfigureAwait(false);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                static string? Str(JsonElement el, string key) =>
                    el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                static int? Int32(JsonElement el, string key) =>
                    el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : null;
                static double Dbl(JsonElement el, string key) =>
                    el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;

                var castCredits  = new List<object>();
                var crewCredits  = new List<object>();
                var seenCast     = new HashSet<int>();
                var seenCrew     = new HashSet<string>();

                foreach (var section in new[] { "cast", "crew" })
                {
                    if (!root.TryGetProperty(section, out var arr) || arr.ValueKind != JsonValueKind.Array)
                        continue;
                    foreach (var item in arr.EnumerateArray())
                    {
                        var id = Int32(item, "id");
                        if (id is null) continue;

                        var mediaType = Str(item, "media_type");
                        var title = Str(item, "title") ?? Str(item, "name");
                        if (string.IsNullOrWhiteSpace(title)) continue;

                        var posterPath = Str(item, "poster_path");
                        var posterUrl = string.IsNullOrWhiteSpace(posterPath)
                            ? null : $"https://image.tmdb.org/t/p/w342{posterPath}";
                        var releaseDate = Str(item, "release_date") ?? Str(item, "first_air_date");
                        var year = releaseDate?.Length >= 4 ? releaseDate[..4] : null;
                        var voteAverage = Dbl(item, "vote_average");
                        var mt = string.Equals(mediaType, "tv", StringComparison.OrdinalIgnoreCase) ? "Series" : "Movie";

                        if (section == "cast")
                        {
                            if (!seenCast.Add(id.Value)) continue;
                            var character = Str(item, "character");
                            castCredits.Add(new { id = id.Value, title, mediaType = mt, posterUrl, year, voteAverage, character, job = (string?)null, creditType = "cast" });
                        }
                        else
                        {
                            var job = Str(item, "job");
                            if (string.IsNullOrWhiteSpace(job)) continue;
                            var crewKey = $"{id.Value}:{job}";
                            if (!seenCrew.Add(crewKey)) continue;
                            crewCredits.Add(new { id = id.Value, title, mediaType = mt, posterUrl, year, voteAverage, character = (string?)null, job, creditType = "crew" });
                        }
                    }
                }

                static List<object> Top(List<object> list, int n) =>
                    list.Cast<dynamic>().OrderByDescending(x => (double)x.voteAverage).Take(n).Cast<object>().ToList();

                var payload = JsonSerializer.Serialize(new
                {
                    cast  = Top(castCredits,  50),
                    crew  = Top(crewCredits,  40),
                    error = (string?)null
                }, jsonSerializerOptions);
                memoryCache.Set(cacheKey, payload, TimeSpan.FromHours(24));
                httpContext.Response.Headers["Cache-Control"] = "public,max-age=86400";
                return Results.Text(payload, "application/json");
            }
            catch (Exception ex)
            {
                app.Logger.LogWarning(ex, "Stream credits lookup failed for person TMDB {TmdbId}", tmdbId);
                return Results.Json(new { credits = Array.Empty<object>(), error = ex.Message }, jsonSerializerOptions);
            }
        });
    }
}
