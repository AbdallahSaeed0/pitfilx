using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;
using Pitflix.Core.Parser;
using Pitflix.Core;

namespace Pitflix.Core.Scanner;

public sealed class ScanPipeline
{
    private readonly FileScanner _scanner;
    private readonly TmdbClient _tmdb;
    private readonly LibraryRepository _repo;

    public ScanPipeline(FileScanner scanner, TmdbClient tmdb, LibraryRepository repo)
    {
        _scanner = scanner;
        _tmdb = tmdb;
        _repo = repo;
    }

    public async Task<ScanPipelineResult> RunFullScanAsync(IReadOnlyList<string> libraryPaths,
        IProgress<ScanProgress>? progress = null, CancellationToken cancellationToken = default)
    {
        var files = new List<string>();
        foreach (var root in libraryPaths)
        {
            if (string.IsNullOrWhiteSpace(root))
                continue;
            foreach (var f in _scanner.ScanDirectory(root))
                files.Add(f);
        }

        var distinct = files.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        return await RunScanOnFilesAsync(distinct, progress, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Re-runs matching for every file currently logged as Unmatched (e.g. after parser improvements).</summary>
    public async Task<ScanPipelineResult> RunRescanUnmatchedAsync(IProgress<ScanProgress>? progress = null,
        CancellationToken cancellationToken = default)
    {
        var logs = await _repo.GetUnmatchedFilesAsync(cancellationToken).ConfigureAwait(false);
        var paths = logs.Select(l => l.FilePath).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        return await RunScanOnFilesAsync(paths, progress, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Processes an explicit list of media file paths (e.g. demo paths that are not on disk as a folder scan).</summary>
    public async Task<ScanPipelineResult> RunScanOnFilesAsync(IReadOnlyList<string> filePaths,
        IProgress<ScanProgress>? progress = null, CancellationToken cancellationToken = default)
    {
        var distinct = filePaths.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var result = new ScanPipelineResult { TotalFiles = distinct.Count };
        var total = distinct.Count;
        var index = 0;

        foreach (var filePath in distinct)
        {
            cancellationToken.ThrowIfCancellationRequested();
            index++;

            void Report(string status) =>
                progress?.Report(new ScanProgress
                {
                    Total = total,
                    Current = index,
                    CurrentFile = filePath,
                    Status = status,
                    MatchedSoFar = result.Matched,
                    UnmatchedSoFar = result.Unmatched,
                    SkippedSoFar = result.SkippedAlreadyMatched
                });

            Report("Starting");

            if (await _repo.IsFileAlreadyMatchedAsync(filePath, cancellationToken).ConfigureAwait(false))
            {
                result.SkippedAlreadyMatched++;
                Report("Skipped (already matched)");
                continue;
            }

            var parsed = NameParser.Parse(filePath);
            var mediaType = string.IsNullOrEmpty(parsed.MediaType)
                ? FileScanner.InferMediaType(filePath)
                : parsed.MediaType;

            if (mediaType != "Movie" && mediaType != "Series")
            {
                await SaveUnmatchedAsync(filePath, parsed, Array.Empty<TmdbSearchResult>(), cancellationToken)
                    .ConfigureAwait(false);
                result.Unmatched++;
                Report("Unmatched (unknown media type)");
                continue;
            }

            Report("Searching TMDB");

            List<TmdbSearchResult> searchResults;
            try
            {
                searchResults = await _tmdb
                    .SearchAsync(parsed.CleanName, mediaType, parsed.IsArabic, cancellationToken)
                    .ConfigureAwait(false);

                // Fallback: some libraries prefix files with an index ("10.Title...") or have garbage file names
                // ("04cmme") while the folder contains the real title. If the first query yields nothing,
                // retry a few alternative candidates and merge results.
                if (searchResults.Count == 0)
                {
                    var candidates = NameParser.BuildSearchCandidates(filePath);
                    if (candidates.Count > 1)
                    {
                        var merged = new List<TmdbSearchResult>();
                        var seen = new HashSet<int>();

                        void AddRange(IEnumerable<TmdbSearchResult> items)
                        {
                            foreach (var x in items)
                            {
                                if (seen.Add(x.Id))
                                    merged.Add(x);
                                if (merged.Count >= 5)
                                    return;
                            }
                        }

                        foreach (var c in candidates)
                        {
                            if (string.Equals(c, parsed.CleanName, StringComparison.OrdinalIgnoreCase))
                                continue;
                            var res = await _tmdb.SearchAsync(c, mediaType, parsed.IsArabic, cancellationToken)
                                .ConfigureAwait(false);
                            AddRange(res);
                            if (merged.Count >= 3) // enough to drive auto-match / suggestions
                                break;
                        }

                        if (merged.Count > 0)
                            searchResults = merged;
                    }
                }
            }
            catch
            {
                await SaveUnmatchedAsync(filePath, parsed, Array.Empty<TmdbSearchResult>(), cancellationToken)
                    .ConfigureAwait(false);
                result.Unmatched++;
                Report("Unmatched (search error)");
                continue;
            }

            if (!TryPickAutoMatch(parsed, searchResults, mediaType, out var topPick))
            {
                var expanded = await MergeAlternateCandidateSearchesAsync(filePath, parsed, mediaType, searchResults,
                    cancellationToken).ConfigureAwait(false);
                if (!TryPickAutoMatch(parsed, expanded, mediaType, out topPick))
                {
                    await SaveUnmatchedAsync(filePath, parsed, expanded, cancellationToken).ConfigureAwait(false);
                    result.Unmatched++;
                    Report("Unmatched (needs review)");
                    continue;
                }

                searchResults = expanded;
            }

            var top = topPick;

            Report("Matching");
            TmdbDetails details;
            try
            {
                details = await _tmdb.GetDetailsAsync(top.Id, mediaType, cancellationToken).ConfigureAwait(false);
            }
            catch
            {
                await SaveUnmatchedAsync(filePath, parsed, searchResults, cancellationToken).ConfigureAwait(false);
                result.Unmatched++;
                Report("Unmatched (details error)");
                continue;
            }

            await ApplyMatchFromDetailsAsync(filePath, parsed, details, mediaType, cancellationToken)
                .ConfigureAwait(false);

            result.Matched++;
            Report("Matched");
        }

        return result;
    }

    /// <summary>Manual match (e.g. from Unmatched UI): applies TMDB id to a file path.</summary>
    public async Task<bool> MatchFileWithTmdbAsync(string filePath, int tmdbId, string mediaType,
        CancellationToken cancellationToken = default)
    {
        var parsed = NameParser.Parse(filePath);
        if (string.IsNullOrEmpty(mediaType))
            mediaType = string.IsNullOrEmpty(parsed.MediaType)
                ? FileScanner.InferMediaType(filePath)
                : parsed.MediaType;
        if (mediaType != "Movie" && mediaType != "Series")
            return false;

        TmdbDetails details;
        try
        {
            details = await _tmdb.GetDetailsAsync(tmdbId, mediaType, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            return false;
        }

        await ApplyMatchFromDetailsAsync(filePath, parsed, details, mediaType, cancellationToken)
            .ConfigureAwait(false);
        return true;
    }

    /// <summary>
    /// Removes the movie row and runs matching again for its file path (correct wrong TMDB matches).
    /// </summary>
    public async Task<(bool Ok, int? NewLibraryMovieId, string? Error)> RematchMovieByLibraryIdAsync(int libraryMovieId,
        IProgress<ScanProgress>? progress = null, CancellationToken cancellationToken = default)
    {
        var path = await _repo.GetMovieFilePathByLibraryIdAsync(libraryMovieId, cancellationToken)
            .ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(path))
            return (false, null, "Movie not found or file path is empty.");

        if (!await _repo.DeleteMovieByIdAsync(libraryMovieId, cancellationToken).ConfigureAwait(false))
            return (false, null, "Movie could not be removed from the library.");

        var result = await RunScanOnFilesAsync(new[] { path }, progress, cancellationToken).ConfigureAwait(false);
        var newId = await _repo.GetLibraryMovieIdByFilePathAsync(path, cancellationToken).ConfigureAwait(false);
        if (newId is { } id)
            return (true, id, null);

        if (result.Matched > 0)
            return (false, null, "Re-scan reported a match but the movie row was not found. Try a full library scan.");

        return (false, null,
            "The file was not auto-matched. Open Unmatched and pick the correct title, or fix the file name.");
    }

    /// <summary>
    /// Removes the series and re-runs matching for every video file under its folder (wrong show fix).
    /// </summary>
    public async Task<(bool Ok, int? NewLibraryShowId, string? Error)> RematchShowByLibraryIdAsync(int libraryShowId,
        IProgress<ScanProgress>? progress = null, CancellationToken cancellationToken = default)
    {
        var show = await _repo.GetShowByIdAsync(libraryShowId, cancellationToken).ConfigureAwait(false);
        if (show == null)
            return (false, null, "Series not found.");
        if (string.IsNullOrWhiteSpace(show.FolderPath))
            return (false, null, "Series has no folder path.");
        if (!Directory.Exists(show.FolderPath))
            return (false, null, "Series folder is not on disk.");

        var files = _scanner.ScanDirectory(show.FolderPath, recursive: true);
        if (files.Count == 0)
            return (false, null, "No video files found under this series folder.");

        var folderPath = show.FolderPath;
        if (!await _repo.DeleteShowByIdAsync(libraryShowId, cancellationToken).ConfigureAwait(false))
            return (false, null, "Could not remove the series from the library.");

        var result = await RunScanOnFilesAsync(files, progress, cancellationToken).ConfigureAwait(false);
        var newId = await _repo.GetLibraryShowIdByFolderPathAsync(folderPath, cancellationToken).ConfigureAwait(false);
        if (newId is { } id)
            return (true, id, null);

        if (result.Matched > 0)
            return (false, null, "Re-scan matched files but the series row was not found. Try a full library scan.");

        return (false, null,
            "Episodes were not auto-matched. Pick the correct series for this folder, or fix file names.");
    }

    /// <summary>
    /// Removes the series and attaches every video under its folder to a specific TMDB TV id.
    /// </summary>
    public async Task<(bool Ok, int? NewLibraryShowId, string? Error)> MatchShowFolderToTmdbAsync(int libraryShowId,
        int tmdbId, CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
            return (false, null, "Invalid TMDB id.");

        var show = await _repo.GetShowByIdAsync(libraryShowId, cancellationToken).ConfigureAwait(false);
        if (show == null)
            return (false, null, "Series not found.");
        if (string.IsNullOrWhiteSpace(show.FolderPath))
            return (false, null, "Series has no folder path.");
        if (!Directory.Exists(show.FolderPath))
            return (false, null, "Series folder is not on disk.");

        var files = _scanner.ScanDirectory(show.FolderPath, recursive: true);
        if (files.Count == 0)
            return (false, null, "No video files found under this series folder.");

        var folderPath = show.FolderPath;
        if (!await _repo.DeleteShowByIdAsync(libraryShowId, cancellationToken).ConfigureAwait(false))
            return (false, null, "Could not remove the series from the library.");

        foreach (var fp in files)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var applied = await MatchFileWithTmdbAsync(fp, tmdbId, "Series", cancellationToken).ConfigureAwait(false);
            if (!applied)
            {
                return (false, null,
                    $"Could not attach {Path.GetFileName(fp)}. Check season/episode numbers in the file name for this series.");
            }
        }

        var newId = await _repo.GetLibraryShowIdByFolderPathAsync(folderPath, cancellationToken).ConfigureAwait(false);
        return newId is { } rid
            ? (true, rid, null)
            : (false, null, "The series row was not found after applying the TMDB title.");
    }

    /// <summary>
    /// Removes one episode row and attaches its file to a specific TMDB TV series.
    /// </summary>
    public async Task<(bool Ok, int? ShowLibraryId, int? EpisodeId, string? Error)> RematchEpisodeFileToTmdbAsync(
        int episodeLibraryId, int tmdbId, CancellationToken cancellationToken = default)
    {
        if (tmdbId <= 0)
            return (false, null, null, "Invalid TMDB id.");

        var path = await _repo.GetEpisodeFilePathByIdAsync(episodeLibraryId, cancellationToken).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(path))
            return (false, null, null, "Episode not found or path is empty.");

        if (!await _repo.DeleteEpisodeAsync(episodeLibraryId, cancellationToken).ConfigureAwait(false))
            return (false, null, null, "Could not remove the episode.");

        var applied = await MatchFileWithTmdbAsync(path, tmdbId, "Series", cancellationToken).ConfigureAwait(false);
        if (!applied)
        {
            return (false, null, null,
                "Could not attach this file to that series. Check season/episode numbers in the file name.");
        }

        var ep = await _repo.TryGetEpisodeByFilePathAsync(path, cancellationToken).ConfigureAwait(false);
        return ep == null
            ? (false, null, null, "Matched file but episode row was not found.")
            : (true, ep.ShowId, ep.Id, null);
    }

    /// <summary>
    /// Removes the episode row and runs TMDB auto-matching again for that file only (wrong-series fix without picking manually).
    /// </summary>
    public async Task<(bool Ok, int? ShowLibraryId, int? EpisodeId, string? Error)> RematchEpisodeByLibraryIdAsync(
        int episodeLibraryId, IProgress<ScanProgress>? progress = null, CancellationToken cancellationToken = default)
    {
        var path = await _repo.GetEpisodeFilePathByIdAsync(episodeLibraryId, cancellationToken).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(path))
            return (false, null, null, "Episode not found or file path is empty.");

        if (!await _repo.DeleteEpisodeAsync(episodeLibraryId, cancellationToken).ConfigureAwait(false))
            return (false, null, null, "Could not remove the episode from the library.");

        var result = await RunScanOnFilesAsync(new[] { path }, progress, cancellationToken).ConfigureAwait(false);
        var ep = await _repo.TryGetEpisodeByFilePathAsync(path, cancellationToken).ConfigureAwait(false);
        if (ep != null)
            return (true, ep.ShowId, ep.Id, null);

        if (result.Matched > 0)
            return (false, null, null, "Re-scan reported a match but the episode row was not found. Try a full library scan.");

        return (false, null, null,
            "The file was not auto-matched. Use Re-link to pick the correct series, or fix the file name.");
    }

    /// <summary>
    /// Other unmatched rows that look like series episodes: same parent folder as <paramref name="matchedFilePath"/>,
    /// or scan-log clean name within Levenshtein distance &lt; 3 of <paramref name="matchedCleanName"/>.
    /// </summary>
    public async Task<IReadOnlyList<string>> FindBulkUnmatchedSeriesPathsAsync(string matchedFilePath,
        string? matchedCleanName, CancellationToken cancellationToken = default)
    {
        var refClean = matchedCleanName ?? "";
        var unmatched = await _repo.GetUnmatchedFilesAsync(cancellationToken).ConfigureAwait(false);
        var paths = new List<string>();

        foreach (var log in unmatched)
        {
            if (string.Equals(log.FilePath, matchedFilePath, StringComparison.OrdinalIgnoreCase))
                continue;

            var parsed = NameParser.Parse(log.FilePath);
            var mt = ResolveMediaTypeForBulk(log.FilePath, parsed);
            if (!string.Equals(mt, "Series", StringComparison.OrdinalIgnoreCase))
                continue;

            var sameShow = NameParser.SameSeriesShowRootDirectory(log.FilePath, matchedFilePath);
            var clean = log.CleanName ?? parsed.CleanName ?? "";
            var nameClose = StringDistance.Levenshtein(clean, refClean) < 3;
            if (sameShow || nameClose)
                paths.Add(log.FilePath);
        }

        return paths;
    }

    private static string ResolveMediaTypeForBulk(string filePath, ParseResult parsed)
    {
        var inferredMt = FileScanner.InferMediaType(filePath);
        var mediaType = string.IsNullOrEmpty(inferredMt)
            ? (string.IsNullOrEmpty(parsed.MediaType) ? "Movie" : parsed.MediaType)
            : inferredMt;
        if (mediaType != "Movie" && mediaType != "Series")
            mediaType = "Movie";
        return mediaType;
    }

    private async Task ApplyMatchFromDetailsAsync(string filePath, ParseResult parsed, TmdbDetails details,
        string mediaType, CancellationToken cancellationToken)
    {
        string? posterLocal = null;
        string? backdropLocal = null;
        if (!string.IsNullOrEmpty(details.PosterPath))
        {
            posterLocal = await _tmdb
                .DownloadImageAsync(details.PosterPath, $"poster_{mediaType}_{details.Id}.jpg", cancellationToken)
                .ConfigureAwait(false);
        }

        if (!string.IsNullOrEmpty(details.BackdropPath))
        {
            backdropLocal = await _tmdb
                .DownloadImageAsync(details.BackdropPath, $"backdrop_{details.Id}.jpg", cancellationToken,
                    subfolder: null, tmdbImageSize: "w1280")
                .ConfigureAwait(false);
        }

        var genres = details.Genres.Count > 0 ? string.Join(", ", details.Genres) : null;
        var year = ParseYear(details.ReleaseDate);

        var isArabic = MediaLanguageHelper.ComputeIsArabic(details.OriginalLanguage, filePath);

        if (mediaType == "Series")
        {
            var folderPath = NameParser.GetShowFolderFullPath(filePath);
            var show = new Show
            {
                TmdbId = details.Id,
                Title = details.Title,
                TitleAr = string.IsNullOrEmpty(details.OriginalTitle) ? null : details.OriginalTitle,
                Year = year,
                Overview = string.IsNullOrEmpty(details.Overview) ? null : details.Overview,
                PosterLocalPath = posterLocal,
                BackdropLocalPath = backdropLocal,
                Genres = genres,
                VoteAverage = details.VoteAverage,
                FolderPath = folderPath,
                IsArabic = isArabic,
                IsMatched = true,
                DateAdded = DateTime.UtcNow
            };

            var saved = await _repo.SaveShowAsync(show, cancellationToken).ConfigureAwait(false);

            if (parsed.Season.HasValue && parsed.Episode.HasValue)
            {
                var ep = await BuildSeriesEpisodeRowAsync(saved, parsed, filePath, cancellationToken)
                    .ConfigureAwait(false);
                await _repo.SaveEpisodeAsync(ep, cancellationToken).ConfigureAwait(false);
            }
            else if (LooksLikeSpecialsEpisode(filePath))
            {
                // Specials commonly sit under a "Specials" folder and don't always include S00E01 in the filename.
                // Treat as Season 0 and assign the next available episode number so it becomes playable.
                var next = await NextSpecialEpisodeNumberAsync(saved.Id, cancellationToken).ConfigureAwait(false);
                var inferred = new ParseResult
                {
                    CleanName = parsed.CleanName,
                    Season = 0,
                    Episode = next,
                    Year = parsed.Year,
                    IsArabic = parsed.IsArabic,
                    MediaType = parsed.MediaType,
                    Confidence = parsed.Confidence
                };
                var ep = await BuildSeriesEpisodeRowAsync(saved, inferred, filePath, cancellationToken)
                    .ConfigureAwait(false);
                await _repo.SaveEpisodeAsync(ep, cancellationToken).ConfigureAwait(false);
            }

            var castRows = details.Cast.Select(c => new CastMember
            {
                PersonTmdbId = c.Id,
                MediaId = details.Id,
                MediaType = "Series",
                Name = c.Name,
                Character = c.Character,
                ProfilePath = string.IsNullOrWhiteSpace(c.ProfilePath) ? null : c.ProfilePath.Trim(),
                BillingOrder = c.BillingOrder,
                ProfileLocalPath = c.ProfileLocalPath
            });
            await _repo.ReplaceCastMembersAsync(details.Id, "Series", castRows, cancellationToken)
                .ConfigureAwait(false);
        }
        else
        {
            var movie = new Movie
            {
                TmdbId = details.Id,
                Title = details.Title,
                TitleAr = string.IsNullOrEmpty(details.OriginalTitle) ? null : details.OriginalTitle,
                Year = year,
                Overview = string.IsNullOrEmpty(details.Overview) ? null : details.Overview,
                PosterLocalPath = posterLocal,
                BackdropLocalPath = backdropLocal,
                Genres = genres,
                VoteAverage = details.VoteAverage,
                Runtime = details.Runtime,
                FilePath = filePath,
                IsArabic = isArabic,
                IsMatched = true,
                DateAdded = DateTime.UtcNow
            };
            await _repo.SaveMovieAsync(movie, cancellationToken).ConfigureAwait(false);

            var castRows = details.Cast.Select(c => new CastMember
            {
                PersonTmdbId = c.Id,
                MediaId = details.Id,
                MediaType = "Movie",
                Name = c.Name,
                Character = c.Character,
                ProfilePath = string.IsNullOrWhiteSpace(c.ProfilePath) ? null : c.ProfilePath.Trim(),
                BillingOrder = c.BillingOrder,
                ProfileLocalPath = c.ProfileLocalPath
            });
            await _repo.ReplaceCastMembersAsync(details.Id, "Movie", castRows, cancellationToken)
                .ConfigureAwait(false);
        }

        await _repo.SaveScanLogAsync(new ScanLog
        {
            FilePath = filePath,
            CleanName = parsed.CleanName,
            Status = "Matched",
            MatchedTitle = details.Title,
            TmdbId = details.Id,
            Confidence = parsed.Confidence.ToString(),
            SuggestionsJson = null,
            ScannedAt = DateTime.UtcNow
        }, cancellationToken).ConfigureAwait(false);
    }

    private static int? ParseYear(string? releaseDate)
    {
        if (string.IsNullOrEmpty(releaseDate) || releaseDate.Length < 4)
            return null;
        return int.TryParse(releaseDate.AsSpan(0, 4), out var y) ? y : null;
    }

    private async Task<Episode> BuildSeriesEpisodeRowAsync(Show saved, ParseResult parsed, string filePath,
        CancellationToken cancellationToken)
    {
        string? title = null;
        string? stillLocal = null;
        var se = parsed.Season!.Value;
        var en = parsed.Episode!.Value;
        try
        {
            var meta = await _tmdb.TryGetTvEpisodeAsync(saved.TmdbId, se, en, cancellationToken)
                .ConfigureAwait(false);
            if (meta != null)
            {
                title = string.IsNullOrWhiteSpace(meta.Value.Name) ? null : meta.Value.Name.Trim();
                if (!string.IsNullOrWhiteSpace(meta.Value.StillPath))
                {
                    stillLocal = await _tmdb
                        .DownloadImageAsync(meta.Value.StillPath, $"still_tv{saved.TmdbId}_S{se}E{en}.jpg",
                            cancellationToken, "Stills", "w300")
                        .ConfigureAwait(false);
                }
            }
        }
        catch
        {
            /* episode API or image download — still save file row */
        }

        return new Episode
        {
            ShowId = saved.Id,
            Season = se,
            EpisodeNumber = en,
            Title = title,
            StillLocalPath = stillLocal,
            FilePath = filePath
        };
    }

    private static bool LooksLikeSpecialsEpisode(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
            return false;
        foreach (var raw in filePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
        {
            var seg = raw.Trim();
            if (seg.Equals("Specials", StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    private async Task<int> NextSpecialEpisodeNumberAsync(int showId, CancellationToken cancellationToken)
    {
        try
        {
            var eps = await _repo.GetEpisodesForShowAsync(showId, cancellationToken).ConfigureAwait(false);
            var max = eps.Where(e => e.Season == 0).Select(e => e.EpisodeNumber).DefaultIfEmpty(0).Max();
            return Math.Clamp(max + 1, 1, 999);
        }
        catch
        {
            return 1;
        }
    }

    /// <summary>
    /// When the primary query returns hits but none pass auto-match, merge searches from folder / alternate titles
    /// so the correct TMDB row can outrank misleading first-query results.
    /// </summary>
    private async Task<List<TmdbSearchResult>> MergeAlternateCandidateSearchesAsync(string filePath,
        ParseResult parsed, string mediaType, IReadOnlyList<TmdbSearchResult> seed,
        CancellationToken cancellationToken)
    {
        var merged = new List<TmdbSearchResult>();
        var seen = new HashSet<int>();
        foreach (var x in seed)
        {
            if (seen.Add(x.Id))
                merged.Add(x);
        }

        foreach (var c in NameParser.BuildSearchCandidates(filePath))
        {
            if (string.Equals(c, parsed.CleanName, StringComparison.OrdinalIgnoreCase))
                continue;
            List<TmdbSearchResult> res;
            try
            {
                res = await _tmdb.SearchAsync(c, mediaType, parsed.IsArabic, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch
            {
                continue;
            }

            foreach (var x in res)
            {
                if (seen.Add(x.Id))
                    merged.Add(x);
                if (merged.Count >= 20)
                    return merged;
            }
        }

        return merged;
    }

    private async Task SaveUnmatchedAsync(string filePath, ParseResult parsed,
        IReadOnlyList<TmdbSearchResult> searchResults, CancellationToken cancellationToken)
    {
        var top3 = searchResults.Take(3)
            .Select(r => new
            {
                r.Id,
                Title = r.Title,
                r.OriginalTitle,
                r.ReleaseDate,
                r.Popularity
            }).ToList();

        await _repo.SaveScanLogAsync(new ScanLog
        {
            FilePath = filePath,
            CleanName = parsed.CleanName,
            Status = "Unmatched",
            MatchedTitle = null,
            TmdbId = null,
            Confidence = parsed.Confidence.ToString(),
            SuggestionsJson = JsonConvert.SerializeObject(top3),
            ScannedAt = DateTime.UtcNow
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Smart bulk auto-match: single clear hit or 2× popularity gap; then year + language confidence (≥2 total).
    /// </summary>
    public static bool TrySmartBulkAutoMatch(ParseResult parsed, List<TmdbSearchResult> results,
        out TmdbSearchResult chosen)
    {
        chosen = default!;
        if (results.Count == 0)
            return false;

        var sorted = results.OrderByDescending(r => r.Popularity).ToList();
        var top = sorted[0];
        var secondPop = sorted.Count >= 2 ? sorted[1].Popularity : 0.0;
        var structural = sorted.Count == 1 || top.Popularity >= 2.0 * secondPop;
        if (!structural)
            return false;

        var confidence = 1;

        static int? YearFromResult(TmdbSearchResult r)
        {
            var d = r.ReleaseDate ?? "";
            return d.Length >= 4 && int.TryParse(d.AsSpan(0, 4), out var yy) ? yy : null;
        }

        if (parsed.Year.HasValue && YearFromResult(top) == parsed.Year)
            confidence++;

        var ol = (top.OriginalLanguage ?? "").Trim().ToLowerInvariant();
        var tmdbIsArabic = ol.StartsWith("ar", StringComparison.Ordinal);
        if (parsed.IsArabic == tmdbIsArabic)
            confidence++;

        if (confidence < 2)
            return false;

        chosen = top;
        return true;
    }

    /// <summary>
    /// TMDB auto-match: rank by title similarity + year/language hints; avoid trusting API order or raw popularity alone.
    /// </summary>
    private static bool TryPickAutoMatch(ParseResult parsed, List<TmdbSearchResult> results, string mediaType,
        out TmdbSearchResult chosen)
    {
        chosen = default!;
        if (results.Count == 0)
            return false;

        var qNorm = NormalizeTitleForMatch(parsed.CleanName);
        if (qNorm.Length < 2)
            return false;

        var isSeries = string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase);
        var minStrong = parsed.IsArabic ? 0.62 : 0.66;
        var minAccept = parsed.IsArabic ? 0.50 : 0.55;
        var minGap = parsed.IsArabic ? 0.055 : 0.075;

        var scored = results
            .Select(r => (r, Score: ScoreSearchResultAgainstParsed(parsed, r, mediaType)))
            .OrderByDescending(x => x.Score)
            .ThenByDescending(x => x.r.Popularity)
            .ToList();

        var best = scored[0];
        var secondScore = scored.Count >= 2 ? scored[1].Score : -1.0;

        // Very high score (exact or near-exact title match) — accept with minimal gap requirement
        if (best.Score >= 0.95)
        {
            chosen = best.r;
            return true;
        }

        if (best.Score >= 0.84 && (secondScore < 0 || best.Score - secondScore >= 0.02))
        {
            chosen = best.r;
            return true;
        }

        if (best.Score >= minStrong + 0.06 && (secondScore < 0 || best.Score - secondScore >= minGap))
        {
            chosen = best.r;
            return true;
        }

        var yearAligned = parsed.Year.HasValue && YearFromSearchResult(best.r) == parsed.Year;
        if (yearAligned && best.Score >= 0.44 &&
            (secondScore < 0 || best.Score - secondScore >= minGap * 0.75))
        {
            chosen = best.r;
            return true;
        }

        // High popularity + decent score — likely the correct mainstream title
        if (best.r.Popularity >= 8.0 && best.Score >= 0.70 &&
            (secondScore < 0 || best.Score - secondScore >= 0.02))
        {
            chosen = best.r;
            return true;
        }

        if (best.Score >= minAccept && (secondScore < 0 || best.Score - secondScore >= minGap) &&
            best.Score >= minStrong - 0.04)
        {
            chosen = best.r;
            return true;
        }

        if (results.Count == 1)
        {
            var only = scored[0];
            var onlyYearOk = parsed.Year.HasValue && YearFromSearchResult(only.r) == parsed.Year;
            if (onlyYearOk && only.Score >= 0.38)
            {
                chosen = only.r;
                return true;
            }

            if (only.Score >= minStrong)
            {
                chosen = only.r;
                return true;
            }

            if (only.r.Popularity >= 8 && only.Score >= 0.48)
            {
                chosen = only.r;
                return true;
            }

            return false;
        }

        // Series filenames with SxxExx: allow a slightly weaker title score if the query clearly refers to one hit.
        if (isSeries && parsed.Confidence == ParseConfidence.High && best.Score >= 0.46 &&
            (secondScore < 0 || best.Score - secondScore >= 0.025))
        {
            chosen = best.r;
            return true;
        }

        // Fallback: if best score is decent and has clear popularity lead, accept
        if (best.Score >= 0.58 && best.r.Popularity >= 5.0 &&
            (secondScore < 0 || best.Score - secondScore >= 0.01 || best.r.Popularity >= scored[1].r.Popularity * 1.5))
        {
            chosen = best.r;
            return true;
        }

        return false;
    }

    private static readonly HashSet<string> TitleStopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "the", "a", "an", "and", "or", "of", "le", "la", "les", "un", "une", "des", "el", "los", "las", "de", "du"
    };

    private static string NormalizeTitleForMatch(string? s)
    {
        if (string.IsNullOrWhiteSpace(s))
            return "";
        var sb = new System.Text.StringBuilder(s.Length);
        foreach (var c in s.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(c))
                sb.Append(c);
            else
                sb.Append(' ');
        }

        return Regex.Replace(sb.ToString(), @"\s+", " ", RegexOptions.CultureInvariant).Trim();
    }

    private static HashSet<string> TitleTokens(string normalizedSpaceSeparated)
    {
        return normalizedSpaceSeparated.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(t => t.Length > 0 && !TitleStopWords.Contains(t))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static double TokenJaccard(HashSet<string> a, HashSet<string> b)
    {
        if (a.Count == 0 && b.Count == 0)
            return 1;
        if (a.Count == 0 || b.Count == 0)
            return 0;
        var inter = 0;
        foreach (var t in a)
        {
            if (b.Contains(t))
                inter++;
        }

        var union = a.Count + b.Count(t => !a.Contains(t));
        return union == 0 ? 0 : (double)inter / union;
    }

    private static double TitleSimilarityToOneTitle(string queryNorm, HashSet<string> queryTokens, string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate))
            return 0;
        var candNorm = NormalizeTitleForMatch(candidate);
        if (candNorm.Length == 0)
            return 0;

        // Exact match (case-insensitive, normalized) → perfect score
        if (string.Equals(queryNorm, candNorm, StringComparison.OrdinalIgnoreCase))
            return 1.0;

        var maxLen = Math.Max(queryNorm.Length, candNorm.Length);
        var dist = StringDistance.Levenshtein(queryNorm, candNorm);
        var levSim = 1.0 - (double)dist / maxLen;
        var jaccard = TokenJaccard(queryTokens, TitleTokens(candNorm));
        var best = Math.Max(levSim, jaccard);

        // Substring containment boost
        if (queryNorm.Length >= 4 && candNorm.Length >= 4)
        {
            if (candNorm.Contains(queryNorm, StringComparison.OrdinalIgnoreCase) ||
                queryNorm.Contains(candNorm, StringComparison.OrdinalIgnoreCase))
                best = Math.Max(best, 0.82);
        }

        // Token-exact match (all query tokens present in candidate and vice versa)
        var candTokens = TitleTokens(candNorm);
        if (queryTokens.Count > 0 && candTokens.Count > 0 && queryTokens.SetEquals(candTokens))
            best = Math.Max(best, 0.98);

        return Math.Clamp(best, 0, 1);
    }

    private static double ScoreSearchResultAgainstParsed(ParseResult parsed, TmdbSearchResult r, string mediaType)
    {
        var qNorm = NormalizeTitleForMatch(parsed.CleanName);
        if (qNorm.Length < 2)
            return 0;
        var qTokens = TitleTokens(qNorm);

        var raw = Math.Max(
            TitleSimilarityToOneTitle(qNorm, qTokens, r.Title),
            TitleSimilarityToOneTitle(qNorm, qTokens, r.OriginalTitle));

        if (string.Equals(mediaType, "Movie", StringComparison.OrdinalIgnoreCase))
        {
            var qPolish = NormalizeTitleForMatch(NameParser.PolishMovieSearchTitle(parsed.CleanName));
            if (qPolish.Length >= 2 && !string.Equals(qPolish, qNorm, StringComparison.OrdinalIgnoreCase))
            {
                var tPolish = TitleTokens(qPolish);
                raw = Math.Max(raw,
                    Math.Max(
                        TitleSimilarityToOneTitle(qPolish, tPolish, r.Title),
                        TitleSimilarityToOneTitle(qPolish, tPolish, r.OriginalTitle)));
            }

            var trimmedHd = Regex
                .Replace(parsed.CleanName ?? "", @"\s+\b(hd|uhd)\s*$", "", RegexOptions.IgnoreCase)
                .Trim();
            var qHd = NormalizeTitleForMatch(trimmedHd);
            if (qHd.Length >= 2 && !string.Equals(qHd, qNorm, StringComparison.OrdinalIgnoreCase))
            {
                var tHd = TitleTokens(qHd);
                raw = Math.Max(raw,
                    Math.Max(
                        TitleSimilarityToOneTitle(qHd, tHd, r.Title),
                        TitleSimilarityToOneTitle(qHd, tHd, r.OriginalTitle)));
            }
        }

        var score = raw;
        if (parsed.Year.HasValue)
        {
            var ry = YearFromSearchResult(r);
            if (ry.HasValue)
            {
                if (ry.Value == parsed.Year.Value)
                    score = Math.Min(1.0, score + 0.2);
                else
                    score = Math.Max(0, score - 0.2);
            }
        }

        var ol = (r.OriginalLanguage ?? "").Trim().ToLowerInvariant();
        var tmdbArabic = ol.StartsWith("ar", StringComparison.Ordinal);
        if (parsed.IsArabic == tmdbArabic)
            score = Math.Min(1.0, score + 0.04);

        return Math.Clamp(score, 0, 1);
    }

    private static int? YearFromSearchResult(TmdbSearchResult r)
    {
        var d = r.ReleaseDate ?? "";
        return d.Length >= 4 && int.TryParse(d.AsSpan(0, 4), out var yy) ? yy : null;
    }
}
