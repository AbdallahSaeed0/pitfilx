using System.Text.Json;
using System.Text.Json.Nodes;

namespace Pitflix.API.Endpoints;

/// <summary>
/// TEMPORARY, one-off tool: lets you manually fix the TV Time shows/movies the tools/tvtime_import
/// auto-matcher couldn't confidently resolve to a TMDB id (or flagged as low-confidence). Reads/writes
/// that script's on-disk cache directly (tmdb_show_map.json / tmdb_movie_map.json) so a re-run of the
/// relevant importer picks up the fix. Delete this file + its Program.cs registration once the TV Time
/// import review is done.
/// </summary>
public static class TvTimeReviewEndpoints
{
    private static readonly string CacheDir =
        @"C:\Users\Abd Allah\Downloads\Telegram Desktop\gdpr-data\_import_cache";

    public static void MapTvTimeReviewEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/tvtime-review/unmatched", (string? mediaType) =>
        {
            if (string.Equals(mediaType, "movie", StringComparison.OrdinalIgnoreCase))
                return GetUnmatchedMovies(jsonSerializerOptions);
            return GetUnmatchedShows(jsonSerializerOptions);
        });

        app.MapPost("/api/tvtime-review/match", (TvTimeMatchBody body) =>
        {
            var mapPath = Path.Combine(CacheDir,
                string.Equals(body.MediaType, "movie", StringComparison.OrdinalIgnoreCase)
                    ? "tmdb_movie_map.json"
                    : "tmdb_show_map.json");
            if (!File.Exists(mapPath))
                return Results.Json(new { success = false, error = "cache not found" }, jsonSerializerOptions, statusCode: 404);

            var map = JsonNode.Parse(File.ReadAllText(mapPath))!.AsObject();

            if (body.TmdbId is null)
            {
                // `false` (not `null`!) marks a deliberate, permanent skip. `null` is what the
                // matcher itself writes when TMDB search found nothing -- that case should keep
                // showing up for review (the title may just need a manual search), but a skip the
                // user explicitly clicked must never come back. Conflating the two was the bug
                // that made "Skip permanently" not actually stick.
                map[body.Name] = false;
            }
            else
            {
                map[body.Name] = new JsonObject
                {
                    ["id"] = body.TmdbId,
                    ["title"] = body.Title,
                    ["year"] = body.Year,
                    ["confidence"] = "manual",
                };
            }

            File.WriteAllText(mapPath, map.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            return Results.Json(new { success = true }, jsonSerializerOptions);
        });
    }

    private static IResult GetUnmatchedShows(JsonSerializerOptions jsonSerializerOptions)
    {
        var showsPath = Path.Combine(CacheDir, "show_watch_history.json");
        var mapPath = Path.Combine(CacheDir, "tmdb_show_map.json");
        if (!File.Exists(showsPath) || !File.Exists(mapPath))
            return Results.Json(Array.Empty<object>(), jsonSerializerOptions);

        using var showsDoc = JsonDocument.Parse(File.ReadAllText(showsPath));
        using var mapDoc = JsonDocument.Parse(File.ReadAllText(mapPath));

        var items = new List<(string Name, string Status, SortedDictionary<int, int> Seasons, int Total)>();
        foreach (var prop in mapDoc.RootElement.EnumerateObject())
        {
            var status = ReviewStatusOf(prop.Value);
            if (status == null)
                continue; // confidently matched, nothing to review

            var name = prop.Name;
            var seasonCounts = new SortedDictionary<int, int>();
            if (showsDoc.RootElement.TryGetProperty(name, out var showEl) &&
                showEl.TryGetProperty("episodes", out var epsEl))
            {
                foreach (var ep in epsEl.EnumerateObject())
                {
                    var season = int.Parse(ep.Name.Split('x')[0]);
                    seasonCounts[season] = seasonCounts.GetValueOrDefault(season) + 1;
                }
            }

            items.Add((name, status, seasonCounts, seasonCounts.Values.Sum()));
        }

        var payload = items
            .OrderByDescending(u => u.Total)
            .Select(u => new
            {
                name = u.Name,
                status = u.Status,
                seasons = u.Seasons.Select(kv => new { season = kv.Key, episodeCount = kv.Value }),
                totalEpisodes = u.Total,
            });

        return Results.Json(payload, jsonSerializerOptions);
    }

    private static IResult GetUnmatchedMovies(JsonSerializerOptions jsonSerializerOptions)
    {
        var moviesPath = Path.Combine(CacheDir, "movie_watch_history.json");
        var mapPath = Path.Combine(CacheDir, "tmdb_movie_map.json");
        if (!File.Exists(moviesPath) || !File.Exists(mapPath))
            return Results.Json(Array.Empty<object>(), jsonSerializerOptions);

        using var moviesDoc = JsonDocument.Parse(File.ReadAllText(moviesPath));
        using var mapDoc = JsonDocument.Parse(File.ReadAllText(mapPath));

        var watchCounts = new Dictionary<string, int>();
        foreach (var evt in moviesDoc.RootElement.EnumerateArray())
        {
            var name = evt.GetProperty("name").GetString() ?? "";
            if (name.Length == 0) continue;
            watchCounts[name] = watchCounts.GetValueOrDefault(name) + 1;
        }

        var items = new List<(string Name, string Status, int WatchCount)>();
        foreach (var prop in mapDoc.RootElement.EnumerateObject())
        {
            var status = ReviewStatusOf(prop.Value);
            if (status == null)
                continue;

            items.Add((prop.Name, status, watchCounts.GetValueOrDefault(prop.Name)));
        }

        var payload = items
            .OrderByDescending(u => u.WatchCount)
            .Select(u => new { name = u.Name, status = u.Status, watchCount = u.WatchCount });

        return Results.Json(payload, jsonSerializerOptions);
    }

    /// <summary>Returns "unmatched" (cache value is null -- the auto-matcher found nothing),
    /// "low" (matched but flagged low-confidence), or null (confidently matched, or a deliberate
    /// `false` skip -- either way, nothing left to review).</summary>
    private static string? ReviewStatusOf(JsonElement cacheValue)
    {
        if (cacheValue.ValueKind == JsonValueKind.False)
            return null; // permanently skipped by the user -- never show again
        if (cacheValue.ValueKind == JsonValueKind.Null)
            return "unmatched";
        if (cacheValue.ValueKind == JsonValueKind.Object &&
            cacheValue.TryGetProperty("confidence", out var conf) &&
            string.Equals(conf.GetString(), "low", StringComparison.OrdinalIgnoreCase))
            return "low";
        return null;
    }
}

internal sealed record TvTimeMatchBody(string Name, int? TmdbId, string? Title, string? Year, string? MediaType);
