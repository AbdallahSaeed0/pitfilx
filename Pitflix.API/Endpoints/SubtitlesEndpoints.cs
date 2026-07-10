using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitflix.API.Services;
using Pitflix.Core.Database;
using Pitflix.Core.Services;

namespace Pitflix.API.Endpoints;

public static class SubtitlesEndpoints
{
    public static void MapSubtitlesEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/subtitles/movie/{id:int}", async (int id, LibraryRepository repo, IConfiguration cfg,
            IResolvedApiKeysAccessor apiKeys, CancellationToken ct) =>
        {
            using var os = CreateOpenSubtitlesClient(apiKeys, cfg);
            if (os == null || !os.IsConfigured)
                return Results.Json(new { items = Array.Empty<object>(), error = (string?)null }, jsonSerializerOptions);

            var m = await repo.GetMovieByIdAsync(id, ct).ConfigureAwait(false);
            if (m == null)
                return Results.NotFound();

            var outcome = await os.SearchAsync(m.Title, null, null, "movie", m.TmdbId, ct).ConfigureAwait(false);
            return Results.Json(new
            {
                items = outcome.Items.Select(SubtitleRowJson).ToList(),
                error = outcome.Error
            }, jsonSerializerOptions);
        });

        app.MapGet("/api/subtitles/episode/{id:int}", async (int id, LibraryContext db, IConfiguration cfg, IResolvedApiKeysAccessor apiKeys, CancellationToken ct) =>
        {
            using var os = CreateOpenSubtitlesClient(apiKeys, cfg);
            if (os == null || !os.IsConfigured)
                return Results.Json(new { items = Array.Empty<object>(), error = (string?)null }, jsonSerializerOptions);

            var ep = await db.Episodes.AsNoTracking()
                .Include(e => e.Show)
                .FirstOrDefaultAsync(e => e.Id == id, ct)
                .ConfigureAwait(false);
            if (ep?.Show == null)
                return Results.NotFound();

            var outcome = await os
                .SearchAsync(ep.Show.Title, ep.Season, ep.EpisodeNumber, "episode", ep.Show.TmdbId, ct)
                .ConfigureAwait(false);
            return Results.Json(new
            {
                items = outcome.Items.Select(SubtitleRowJson).ToList(),
                error = outcome.Error
            }, jsonSerializerOptions);
        });

        app.MapGet("/api/subtitles/search", async (string? query, string? type, int? season, int? episode, int? parentTmdbId,
            int? tmdbId, IConfiguration cfg, IResolvedApiKeysAccessor apiKeys, CancellationToken ct) =>
        {
            using var os = CreateOpenSubtitlesClient(apiKeys, cfg);
            if (os == null || !os.IsConfigured)
                return Results.Json(new { items = Array.Empty<object>(), error = (string?)null }, jsonSerializerOptions);

            var q = query?.Trim() ?? "";
            if (string.IsNullOrEmpty(q))
                return Results.Json(new { items = Array.Empty<object>(), error = "Enter a search query." }, jsonSerializerOptions);

            var mediaType = string.Equals(type, "episode", StringComparison.OrdinalIgnoreCase) ? "episode" : "movie";
            int? tmdb = null;
            if (mediaType == "episode")
            {
                if (parentTmdbId is > 0)
                    tmdb = parentTmdbId;
            }
            else if (tmdbId is > 0)
                tmdb = tmdbId;

            var outcome = await os.SearchAsync(q, season, episode, mediaType, tmdb, ct).ConfigureAwait(false);
            return Results.Json(new
            {
                items = outcome.Items.Select(SubtitleRowJson).ToList(),
                error = outcome.Error
            }, jsonSerializerOptions);
        });

        app.MapPost("/api/subtitles/download", async (SubtitleDownloadBody body, IConfiguration cfg, IResolvedApiKeysAccessor apiKeys, CancellationToken ct) =>
        {
            using var os = CreateOpenSubtitlesClient(apiKeys, cfg);
            if (os == null || !os.IsConfigured)
                return Results.Json(new { success = false, savedPath = (string?)null, error = "OpenSubtitles API key not configured." }, jsonSerializerOptions);

            var path = body.VideoFilePath ?? "";
            var lang = string.IsNullOrWhiteSpace(body.LanguageCode) ? "en" : body.LanguageCode!;
            var (ok, saved, err) = await os.DownloadAsync(body.FileId, path, lang, ct).ConfigureAwait(false);
            return ok
                ? Results.Json(new { success = true, savedPath = saved, error = (string?)null }, jsonSerializerOptions)
                : Results.Json(new { success = false, savedPath = (string?)null, error = err }, jsonSerializerOptions);
        });

        app.MapGet("/api/subtitles/subdl/search", async (
            string? imdbId, int? tmdbId, string? title,
            string? mediaType, int? season, int? episode,
            LibraryRepository repo, CancellationToken ct) =>
        {
            var sdlKey = await repo.GetSettingAsync("SubDlApiKey", ct).ConfigureAwait(false);
            using var sdl = new SubDlClient(sdlKey);
            var mt = string.IsNullOrWhiteSpace(mediaType) ? "Movie" : mediaType!;
            var outcome = await sdl.SearchAsync(title, imdbId, tmdbId, mt, season, episode, ct).ConfigureAwait(false);
            var items = outcome.Items.Select(s => new
            {
                releaseName = s.ReleaseName, language = s.Language,
                fullLink = s.FullLink, isHearingImpaired = s.IsHearingImpaired, format = s.Type,
            }).ToList();
            return Results.Json(new { items, error = outcome.Error }, jsonSerializerOptions);
        });

        app.MapPost("/api/subtitles/subdl/download", async (SubDlDownloadBody body, LibraryRepository repo, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.FullLink) || string.IsNullOrWhiteSpace(body.VideoFilePath))
                return Results.Json(new { success = false, savedPath = (string?)null, error = "Missing link or path." }, jsonSerializerOptions);

            var sdlKey = await repo.GetSettingAsync("SubDlApiKey", ct).ConfigureAwait(false);
            using var sdl = new SubDlClient(sdlKey);
            var (ok, saved, err) = await sdl.DownloadAsync(body.FullLink, body.VideoFilePath, body.Language ?? "", ct).ConfigureAwait(false);
            return ok
                ? Results.Json(new { success = true, savedPath = saved, error = (string?)null }, jsonSerializerOptions)
                : Results.Json(new { success = false, savedPath = (string?)null, error = err }, jsonSerializerOptions);
        });

        app.MapGet("/api/subtitles/subsource/search", async (
            string? title, string? imdbId, string? mediaType, int? season,
            LibraryRepository repo, CancellationToken ct) =>
        {
            var ssKey = await repo.GetSettingAsync("SubSourceApiKey", ct).ConfigureAwait(false);
            using var ss = new SubSourceClient(ssKey);
            var mt = string.IsNullOrWhiteSpace(mediaType) ? "Movie" : mediaType!;
            var outcome = await ss.SearchAsync(title, imdbId, mt, season, ct).ConfigureAwait(false);

            // SubSource's own `language` field is inconsistent (short code like "ar"/"en" or a full
            // name like "Arabic"/"English") — normalize before filtering/sorting. Only this endpoint's
            // response is filtered; SubSourceClient itself keeps returning its full raw result set.
            static bool IsArabic(string l) =>
                l.StartsWith("ar", StringComparison.OrdinalIgnoreCase) || l.Contains("arabic", StringComparison.OrdinalIgnoreCase);
            static bool IsEnglish(string l) =>
                l.StartsWith("en", StringComparison.OrdinalIgnoreCase) || l.Contains("english", StringComparison.OrdinalIgnoreCase);

            var items = outcome.Items
                .Where(s => IsArabic(s.Language) || IsEnglish(s.Language))
                .OrderByDescending(s => IsArabic(s.Language)) // stable sort: Arabic first, English after, original order preserved within each
                .Select(s => new
                {
                    releaseName = s.ReleaseName, language = s.Language,
                    subtitleId = s.SubtitleId, isHearingImpaired = s.IsHearingImpaired,
                }).ToList();
            return Results.Json(new { items, error = outcome.Error }, jsonSerializerOptions);
        });

        app.MapPost("/api/subtitles/subsource/download", async (SubSourceDownloadBody body, LibraryRepository repo, CancellationToken ct) =>
        {
            if (body.SubtitleId is not > 0 || string.IsNullOrWhiteSpace(body.VideoFilePath))
                return Results.Json(new { success = false, savedPath = (string?)null, error = "Missing subtitle reference or path." }, jsonSerializerOptions);

            var ssKey = await repo.GetSettingAsync("SubSourceApiKey", ct).ConfigureAwait(false);
            using var ss = new SubSourceClient(ssKey);
            var (ok, saved, err) = await ss
                .DownloadAsync(body.SubtitleId.Value, body.Language ?? "", body.VideoFilePath, ct)
                .ConfigureAwait(false);
            return ok
                ? Results.Json(new { success = true, savedPath = saved, error = (string?)null }, jsonSerializerOptions)
                : Results.Json(new { success = false, savedPath = (string?)null, error = err }, jsonSerializerOptions);
        });
    }

    private static OpenSubtitlesClient? CreateOpenSubtitlesClient(IResolvedApiKeysAccessor apiKeys, IConfiguration cfg)
    {
        var key = apiKeys.ResolvedOpenSubtitlesApiKey?.Trim();
        if (string.IsNullOrEmpty(key))
            key = cfg["OpenSubtitlesApiKey"]?.Trim();
        if (string.IsNullOrEmpty(key))
            return null;
        var appName = apiKeys.ResolvedOpenSubtitlesAppName?.Trim()
            ?? cfg["OpenSubtitlesAppName"]?.Trim();
        return new OpenSubtitlesClient(key, string.IsNullOrEmpty(appName) ? "Pitflix" : appName);
    }

    private static object SubtitleRowJson(SubtitleResult s) => new
    {
        subtitleId = s.SubtitleId,
        language = s.Language,
        releaseName = s.ReleaseName,
        downloadCount = s.DownloadCount,
        ratings = s.Ratings,
        isHearingImpaired = s.IsHearingImpaired,
        isMachineTranslated = s.IsMachineTranslated,
        format = s.Format,
        fileId = s.FileId,
        fileName = s.FileName
    };
}
