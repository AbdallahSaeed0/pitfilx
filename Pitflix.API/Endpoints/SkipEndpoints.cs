using System.Text.Json;
using Pitflix.API.Services;
using Pitflix.Core.Database;

namespace Pitflix.API.Endpoints;

public static class SkipEndpoints
{
    public static void MapSkipEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/playback/chapters", async (
            string? filePath,
            string? mediaType,
            double? duration,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(filePath))
                return Results.BadRequest(new { error = "filePath is required." });

            if (!File.Exists(filePath))
                return Results.NotFound(new { error = "File not found." });

            var result = await ChapterDetectorService.DetectAsync(
                filePath, mediaType, duration, null, ct).ConfigureAwait(false);

            return Results.Json(new
            {
                chapters = result.Chapters.Select(c => new
                {
                    id = c.Id,
                    title = c.Title,
                    startSec = c.StartSec,
                    endSec = c.EndSec,
                }).ToList(),
                introEnd = result.IntroEnd,
                outroStart = result.OutroStart,
                source = result.Source,
            }, jsonSerializerOptions);
        });

        app.MapGet("/api/skip/season/{showId:int}/{seasonNumber:int}", async (
            int showId, int seasonNumber, SkipSegmentsRepository repo, CancellationToken ct) =>
        {
            var segment = await repo.GetSeasonSegmentAsync(showId, seasonNumber, ct).ConfigureAwait(false);
            return segment is null ? Results.NotFound() : Results.Json(segment, jsonSerializerOptions);
        });

        app.MapGet("/api/skip/episode/{episodeId:int}", async (
            int episodeId, SkipSegmentsRepository repo, SkipSegmentDetectionService detector,
            SkipFingerprintQueue fpQueue, CancellationToken ct) =>
        {
            var episode = await repo.GetEpisodeAsync(episodeId, ct).ConfigureAwait(false);
            if (episode is null)
                return Results.NotFound(new { error = "Episode not found." });

            var segment = await repo.GetSeasonSegmentAsync(episode.ShowId, episode.Season, ct).ConfigureAwait(false);
            if (segment is null)
            {
                segment = await detector.DetectAndStoreForSeasonAsync(episode.ShowId, episode.Season, ct)
                    .ConfigureAwait(false);
            }

            var hasConfirmedIntro = segment.IntroSource is "chapter" or "anilist";
            var hasConfirmedOutro = segment.OutroSource is "chapter" or "anilist";
            if (!hasConfirmedIntro || !hasConfirmedOutro)
            {
                var staleEnough = DateTime.UtcNow - segment.ComputedAt > TimeSpan.FromHours(6);
                if (staleEnough)
                {
                    var episodeCount = await repo.CountSeasonEpisodesAsync(episode.ShowId, episode.Season, ct)
                        .ConfigureAwait(false);
                    if (episodeCount >= 3)
                        fpQueue.TryEnqueue(episode.ShowId, episode.Season);
                }
            }

            var over = await repo.GetEpisodeOverrideAsync(episodeId, ct).ConfigureAwait(false);

            object? intro = null;
            if (over?.SuppressIntro == true)
                intro = null;
            else if (over?.IntroStartSeconds != null && over.IntroEndSeconds != null)
                intro = new { start = over.IntroStartSeconds, end = over.IntroEndSeconds, confidence = 1.0, source = over.Source };
            else if (segment.IntroStartSeconds != null && segment.IntroEndSeconds != null)
                intro = new { start = segment.IntroStartSeconds, end = segment.IntroEndSeconds, confidence = segment.IntroConfidence, source = segment.IntroSource };

            double? outroStart = segment.OutroStartSeconds;
            double? outroEnd = segment.OutroEndSeconds;
            if (segment.OutroSource is "fingerprint" or "blackframe" or "silence" &&
                segment.OutroSecondsBeforeEndStart != null && segment.OutroSecondsBeforeEndEnd != null)
            {
                var episodeDuration = await repo.TryGetKnownDurationSecondsAsync(episode.FilePath, ct).ConfigureAwait(false)
                    ?? await ChapterDetectorService.GetDurationSecondsAsync(episode.FilePath, ct).ConfigureAwait(false);
                if (episodeDuration is { } dur)
                {
                    outroStart = dur - segment.OutroSecondsBeforeEndStart.Value;
                    outroEnd = dur - segment.OutroSecondsBeforeEndEnd.Value;
                }
            }

            object? outro = null;
            if (over?.SuppressOutro == true)
                outro = null;
            else if (over?.OutroStartSeconds != null && over.OutroEndSeconds != null)
                outro = new { start = over.OutroStartSeconds, end = over.OutroEndSeconds, confidence = 1.0, source = over.Source };
            else if (outroStart != null && outroEnd != null)
                outro = new { start = outroStart, end = outroEnd, confidence = segment.OutroConfidence, source = segment.OutroSource };

            return Results.Json(new { intro, outro }, jsonSerializerOptions);
        });

        app.MapPost("/api/skip/season/{showId:int}/{seasonNumber:int}/rescan", async (
            int showId, int seasonNumber, SkipSegmentDetectionService detector, SkipFingerprintQueue fpQueue,
            SkipSegmentsRepository repo, CancellationToken ct) =>
        {
            var segment = await detector.DetectAndStoreForSeasonAsync(showId, seasonNumber, ct).ConfigureAwait(false);

            await repo.ClearTier3DetectionAsync(showId, seasonNumber, ct).ConfigureAwait(false);

            var episodeCount = await repo.CountSeasonEpisodesAsync(showId, seasonNumber, ct).ConfigureAwait(false);
            if (episodeCount >= 3)
                fpQueue.TryEnqueue(showId, seasonNumber);

            return Results.Json(segment, jsonSerializerOptions);
        });
    }
}
