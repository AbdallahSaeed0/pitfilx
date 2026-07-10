using System.Text.Json;
using Pitflix.Core.Models;
using Pitflix.Core.Scanner;

namespace Pitflix.API;

public static class ScanLogMapper
{
    public static ScanLogDto ToScanLogDto(ScanLog s)
    {
        object? suggestions = null;
        if (!string.IsNullOrWhiteSpace(s.SuggestionsJson))
        {
            try
            {
                suggestions = JsonSerializer.Deserialize<object>(s.SuggestionsJson);
            }
            catch
            {
                suggestions = null;
            }
        }

        var mediaType = FileScanner.InferMediaType(s.FilePath);
        if (string.IsNullOrEmpty(mediaType))
            mediaType = "Movie";

        return new ScanLogDto(s.Id, s.FilePath, s.CleanName, s.Status, s.MatchedTitle, s.TmdbId, s.Confidence,
            suggestions, mediaType, s.ScannedAt);
    }
}

public sealed record ScanLogDto(
    int Id,
    string FilePath,
    string CleanName,
    string Status,
    string? MatchedTitle,
    int? TmdbId,
    string? Confidence,
    object? Suggestions,
    string MediaType,
    DateTime ScannedAt);
