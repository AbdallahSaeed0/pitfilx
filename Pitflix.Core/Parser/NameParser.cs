using System.Globalization;
using System.Text.RegularExpressions;
using Pitflix.Core.Scanner;

namespace Pitflix.Core.Parser;

public static partial class NameParser
{
    [GeneratedRegex(@"(?i)S(?<s>\d{1,2})[._\s-]*(?:E|EP)(?<e>\d{1,3})(?![0-9])", RegexOptions.CultureInvariant)]
    private static partial Regex SeasonEpisodePattern();

    // "NxNN" scene layout, e.g. 1x05, 12x103. Episode requires 2–3 digits so resolutions and titles
    // like "4x4" or "1920x1080" are not misread as season/episode markers.
    [GeneratedRegex(@"(?i)(?<!\d)(?<s>\d{1,2})x(?<e>\d{2,3})(?![0-9])", RegexOptions.CultureInvariant)]
    private static partial Regex SeasonEpisodeXPattern();

    // "Episode 3", "Ep.03", "E03"
    [GeneratedRegex(@"(?i)(?<!\w)(?:EPISODE|EP|E)[.\s_-]*(?<e>\d{1,3})(?!\d)", RegexOptions.CultureInvariant)]
    private static partial Regex EpisodeWordPattern();

    // Filename is just a number (01, 1, 103) optionally with small suffix.
    [GeneratedRegex(@"^(?<e>\d{1,3})(?:\s*[-_.]\s*\w+)?$", RegexOptions.CultureInvariant)]
    private static partial Regex EpisodeNumberOnlyPattern();

    // "ShowName.01", "ShowName - 02", "ShowName_03": a bare 1-2 digit number trailing the title,
    // separated by punctuation, with no E/Episode/SxxExx marker at all. Only trusted where the caller
    // already knows the file sits under a Season N folder (see TryInferEpisodeFromFileName call site) —
    // 3-digit values are excluded so 480/720/1080/2160 quality tags are never misread as an episode.
    [GeneratedRegex(@"(?<=[.\s_-])(?<e>\d{1,2})\s*$", RegexOptions.CultureInvariant)]
    private static partial Regex TrailingBareEpisodeNumberPattern();

    [GeneratedRegex(@"(?<!\d)(?:19\d{2}|20[0-2]\d|2030)(?!\d)", RegexOptions.CultureInvariant)]
    private static partial Regex YearPattern();

    [GeneratedRegex(@"\[[^\]]*\]", RegexOptions.CultureInvariant)]
    private static partial Regex BracketTagPattern();

    /// <summary>Parenthetical release tags e.g. <c>(1080p WEB-DL)</c>, <c>(BluRay x264)</c>.</summary>
    [GeneratedRegex(
        @"\(\s*(?:(?:web[-\s]?dl|webrip|bluray|b[-]?rrip|hdtv|dvdrip|brrip|dvd|remux|workprint|pdtv|dsr)(?:\s+[\w.-]{0,40})?|(?:720|1080|2160|480)p(?:\s+[\w.-]{0,40})?|(?:4k|uhd|hdr|sdr)(?:\s+[\w.-]{0,24})?|x264|x265|hevc|h\.?\s*264|h\.?\s*265|10bit|8bit|aac|dts|eac3|ac3|truehd|atmos|5\.1|2\.0)(?:\s*[\w.-]{0,40})?\s*\)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ParenReleaseTagPattern();

    /// <summary>S01, s2, etc.</summary>
    [GeneratedRegex(@"^S\d{1,3}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SeasonFolderShortPattern();

    /// <summary>Season 1, Season.1, Season_01, SEASON-02 — common release layouts.</summary>
    [GeneratedRegex(@"^Season[.\s_-]*\d{1,3}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SeasonFolderWordPattern();

    [GeneratedRegex(@"^Saison[.\s_-]*\d{1,3}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SaisonFolderPattern();

    [GeneratedRegex(@"^Staffel[.\s_-]*\d{1,3}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex StaffelFolderPattern();

    [GeneratedRegex(@"^Temporada[.\s_-]*\d{1,3}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex TemporadaFolderPattern();

    [GeneratedRegex(@"^Seizoen[.\s_-]*\d{1,3}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SeizoenFolderPattern();

    [GeneratedRegex(@"^Stagione[.\s_-]*\d{1,3}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex StagioneFolderPattern();

    private static readonly HashSet<string> LibraryRootSegments = new(StringComparer.OrdinalIgnoreCase)
    {
        "English", "Engilsh", "Arabic", "Movies", "Series", "Movie", "TV", "Films",
        // Common library sort folders (Arabic / organiser labels)
        "اجنبي", "اجنبى", "افلام", "أفلام", "مسلسلات", "عالمية", "Foreign", "Western", "New", "New Releases",
        // Genre / category folders
        "Anime", "Animation", "Animated", "Cartoon", "Cartoons", "Documentary", "Documentaries",
        "Horror", "Comedy", "Action", "Drama", "Thriller", "SciFi", "Sci-Fi", "Fantasy", "Romance",
        "Kids", "Family", "Classic", "Classics", "International", "Foreign Films"
    };

    private static readonly HashSet<string> GenericVideoFileNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "movie", "video", "sample", "file", "film", "dvd", "bluray"
    };

    /// <summary>Extra folder between season and files (e.g. Show/S01/1080p/ep.mkv) — must not become the show root.</summary>
    private static readonly HashSet<string> ReleaseQualityFolderSegments = new(StringComparer.OrdinalIgnoreCase)
    {
        "1080p", "720p", "480p", "2160p", "1440p", "576p", "432p", "4k", "uhd", "hd", "sd",
        "bluray", "blu-ray", "webrip", "web-dl", "webdl", "hdtv", "dvdrip", "bdrip", "brrip", "remux", "hdr", "sdr",
        "x264", "x265", "hevc", "h264", "h265", "avc",
    };

    /// <summary>
    /// After one of these dot segments, a trailing alphanumeric token is treated as a release group
    /// (<c>...720p.bluray.sujaidr</c> → drop <c>sujaidr</c>). Kept stricter than all quality tokens so we do not eat
    /// real title words after <c>720p</c> alone.
    /// </summary>
    private static readonly HashSet<string> DotSegmentBeforeLikelySceneGroup = new(StringComparer.OrdinalIgnoreCase)
    {
        "bluray", "blu-ray", "brrip", "bdrip", "webrip", "web-dl", "webdl", "hdtv", "dvdrip", "dvd", "remux",
        "x264", "x265", "hevc", "h264", "h265", "avc",
        "proper", "repack", "internal", "limited", "uncut",
    };

    private static readonly HashSet<string> NeverStripTrailingDotReleaseGroupSegment = new(StringComparer.OrdinalIgnoreCase)
    {
        "extras", "extra", "sample", "proof", "subs", "sub", "specials", "special", "deleted", "extended",
        "trailer", "trailers", "featurette", "featurettes", "promo", "preair", "cd1", "cd2", "part1", "part2",
        "commentary", "feature", "complete",
    };

    /// <summary>Short scene tags often placed after codecs (hyphen-groups cover many; dots use this).</summary>
    private static readonly HashSet<string> ShortLowercaseDotReleaseGroups = new(StringComparer.OrdinalIgnoreCase)
    {
        "psa", "evo", "ntb", "ettv", "fgt", "megusta", "sujaidr", "dmz", "hdt", "ctrlhd", "pdtv", "yify", "yts",
    };

    [GeneratedRegex(@"^Series[.\s_-]*\d{1,3}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SeriesNumberFolderPattern();

    [GeneratedRegex(@"^Vol(?:ume)?[.\s_-]*\d{1,3}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex VolumeNumberFolderPattern();

    /// <summary>Release/site noise stripped before TMDB search (word-boundary aware).</summary>
    private static readonly string[] NoiseTokens =
    [
        "web-dl", "webrip", "hdrip", "bluray", "brrip", "blu-ray", "x264", "x265", "hevc",
        "720p", "1080p", "2160p", "480p", "4k", "aac", "hdtv", "dts", "ac3", "6ch",
        "dvdrip", "dvd", "remux", "hdr", "sdr", "10bit", "8bit", "5.1", "2.0",
        "internal", "repack", "proper", "extended", "unrated", "final", "cut", "theatrical",
        "webdl", "bdrip", "bdr", "bd-rip", "web", "dl", "dsnp", "amzn", "nf", "hmax", "atvp", "dsnp+", "hulu",
        "mycima", "cima", "cimaclub", "wecima", "egybest", "akwam", "yts", "yts.mx", "yify",
        "akwam.net", "mycima.tv", "wecima.com", "aflamhq", "aflam", "mazika2day", "mazika",
        "arabseed", "akoam", "akoam.com", "shahid4u", "cima4u", "faselhd", "egydead",
        "dvrip", "camrip", "tsrip", "psa", "rarbg", "ettv", "evo", "ntb",
        "nobody", "mr", "by",
        // Encodes / sources / release qualifiers that were slipping through and polluting search titles.
        "imax", "xvid", "divx", "hd", "hc", "6ch", "youtube", "sample",
        // Streaming-site tails (…​CimaClub.Com / …MaZiKa2daY.CoM leave a bare "com").
        // NOTE: intentionally not "net"/"org" — those are real title words ("The Net").
        "com",
        // Localisation tags on Arabic rips.
        "arabic", "مدبلج", "مترجم", "مدبلجه", "مترجمة",
        // Arabic structural words that prefix/suffix rip filenames but aren't part of the TMDB title:
        // film / play / series / episode / full / complete / version.
        "فيلم", "مسرحية", "مسلسل", "حلقة", "الحلقة", "كامل", "كامله", "كاملة", "نسخة", "نسخه"
    ];

    /// <summary>Trailing release-group token after a hyphen (e.g. <c>...HEVC-PSA</c>).</summary>
    [GeneratedRegex(@"-(?i)([A-Z0-9]{2,12})$", RegexOptions.CultureInvariant)]
    private static partial Regex TrailingReleaseGroupHyphen();

    /// <summary>Standalone <c>S01E05</c> / <c>s10e12</c> dot segment (episode payload already removed from string elsewhere).</summary>
    [GeneratedRegex(@"^(?i)s\d{1,2}[._\s-]*e\d{1,3}(?![0-9])$", RegexOptions.CultureInvariant)]
    private static partial Regex SeasonEpisodeDotSegmentPattern();

    [GeneratedRegex(
        @"(?i)(\.akwam\.net|\.akwam\b|\.my\s*cima\.tv|mycima\.tv|wecima\.com|my\s*cima|we\s*cima|cima\s*club|egy\s*best)",
        RegexOptions.CultureInvariant)]
    private static partial Regex SiteNoisePattern();

    [GeneratedRegex(@"(?<![\w])(?:480|720|1080|2160)(?![\w\d])", RegexOptions.CultureInvariant)]
    private static partial Regex StandaloneQualityNumberPattern();

    // Leading library index like "01 Title", "10.Title", "3-Title"
    [GeneratedRegex(@"^(?<n>\d{1,3})[.\s_-]+(?<rest>.+)$", RegexOptions.CultureInvariant)]
    private static partial Regex LeadingIndexPattern();

    public static ParseResult Parse(string filePath)
    {
        var fileName = Path.GetFileNameWithoutExtension(filePath);
        if (string.IsNullOrEmpty(fileName))
            return EmptyResult();

        var isArabic = FileScanner.IsArabicForMediaPath(filePath);
        var mediaType = ResolveLibraryMediaType(filePath);

        var seMatch = SeasonEpisodePattern().Match(fileName);
        string? seasonEpisodeToken = null;
        int? season = null;
        int? episode = null;
        if (seMatch.Success)
        {
            season = int.Parse(seMatch.Groups["s"].Value, CultureInfo.InvariantCulture);
            episode = int.Parse(seMatch.Groups["e"].Value, CultureInfo.InvariantCulture);
            seasonEpisodeToken = seMatch.Value;
        }
        else
        {
            var xMatch = SeasonEpisodeXPattern().Match(fileName);
            if (xMatch.Success)
            {
                season = int.Parse(xMatch.Groups["s"].Value, CultureInfo.InvariantCulture);
                episode = int.Parse(xMatch.Groups["e"].Value, CultureInfo.InvariantCulture);
                seasonEpisodeToken = xMatch.Value;
            }
            else
            {
                // If the file sits under a Season folder but the release name is "Episode 3" or "03", infer SxxExx.
                season = TryInferSeasonFromPath(filePath);
                episode = TryInferEpisodeFromFileName(fileName);
                // A known Season folder makes a trailing bare number ("ShowName.03.mkv") unambiguous
                // enough to trust as the episode number — outside a Season folder this stays unset.
                if (season.HasValue && !episode.HasValue)
                {
                    var trailing = TrailingBareEpisodeNumberPattern().Match(fileName.TrimEnd());
                    if (trailing.Success &&
                        int.TryParse(trailing.Groups["e"].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var te))
                        episode = te;
                }
            }
        }

        // Files like ShowName\01.mkv (no Season N in path): we still have an episode number but season
        // inference stops at the show folder — default to season 1 so matching/storage can proceed.
        if (string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase) &&
            episode.HasValue &&
            !season.HasValue)
            season = 1;

        var yearMatch = YearPattern().Match(fileName);
        int? year = null;
        if (yearMatch.Success && int.TryParse(yearMatch.Value, out var y) && y is >= 1900 and <= 2030)
            year = y;

        // The show title precedes the SxxExx / NxNN marker in virtually all layouts; everything after it
        // is release noise or the episode title. Truncating at the marker prevents leftovers like
        // "Show - - Title" (dangling separators) and keeps the episode title out of the show query.
        var nameSource = fileName;
        if (!string.IsNullOrEmpty(seasonEpisodeToken))
        {
            var tokenIdx = fileName.IndexOf(seasonEpisodeToken, StringComparison.OrdinalIgnoreCase);
            if (tokenIdx > 0)
                nameSource = fileName.Substring(0, tokenIdx);
        }

        var clean = BuildCleanName(nameSource, seasonEpisodeToken, yearMatch.Success ? yearMatch.Value : null);

        // Leading-index episode files ("01 - Pilot.mkv") name the episode, not the show — take the show
        // title from the folder instead of the leftover episode title.
        var hadLeadingIndexEpisode =
            seasonEpisodeToken == null &&
            episode.HasValue &&
            string.Equals(mediaType, "Series", StringComparison.OrdinalIgnoreCase) &&
            LeadingIndexPattern().IsMatch(fileName.Trim());

        if (ShouldInferTitleFromPath(fileName, clean) || hadLeadingIndexEpisode)
        {
            var inferred = InferTitleFromPath(filePath);
            if (!string.IsNullOrEmpty(inferred))
                clean = ApplyNoiseStrippingToTitle(inferred);
        }

        clean = FinalizeCleanName(clean);
        if (string.Equals(mediaType, "Movie", StringComparison.OrdinalIgnoreCase))
            clean = FinalizeCleanName(PolishMovieDisplayTitle(clean));

        var confidence = ParseConfidence.Low;
        if (seasonEpisodeToken != null)
            confidence = ParseConfidence.High;
        else if (season.HasValue && episode.HasValue)
            confidence = ParseConfidence.Medium;
        else if (year.HasValue)
            confidence = ParseConfidence.Medium;

        return new ParseResult
        {
            CleanName = clean,
            Season = season,
            Episode = episode,
            Year = year,
            IsArabic = isArabic,
            MediaType = mediaType,
            Confidence = confidence
        };
    }

    /// <summary>
    /// Build additional candidate queries for TMDB if the primary clean name fails (e.g. leading index, garbage token file names).
    /// </summary>
    public static IReadOnlyList<string> BuildSearchCandidates(string filePath)
    {
        var parsed = Parse(filePath);
        var list = new List<string>();

        void Add(string? s)
        {
            s = FinalizeCleanName(s ?? "");
            if (string.IsNullOrWhiteSpace(s))
                return;
            if (!list.Contains(s, StringComparer.OrdinalIgnoreCase))
                list.Add(s);
        }

        Add(parsed.CleanName);

        // Arabizi chat-speak → romanized variant ("Khayal Ma2ata" → "Khayal Maata") so TMDB can hit it.
        Add(ArabicText.RomanizeChatSpeak(parsed.CleanName));

        // Arabic script normalized (alef/ya/ta-marbuta unified) as an alternate query spelling.
        if (ArabicText.ContainsArabic(parsed.CleanName))
        {
            Add(ArabicText.Normalize(parsed.CleanName));

            // Arabic rips frequently append the cast: "TITLE - actor - actor". Try the title alone.
            // Scoped to Arabic so English titles with a real " - " (e.g. "Mission Impossible - Fallout")
            // are never truncated.
            var dashIdx = parsed.CleanName.IndexOf(" - ", StringComparison.Ordinal);
            if (dashIdx > 2)
            {
                var head = parsed.CleanName[..dashIdx];
                Add(head);
                Add(ArabicText.Normalize(head));
            }
        }

        // If the file name is "10 Something..." try removing the index prefix.
        Add(StripLeadingIndexPrefix(parsed.CleanName));

        // Every meaningful parent folder (e.g. …\John Wick\John Wick 2014\file.mkv → both folder titles).
        foreach (var folderTitle in EnumeratePathFolderTitleCandidates(filePath))
        {
            Add(folderTitle);
            Add(StripLeadingIndexPrefix(folderTitle));
        }

        return list;
    }

    /// <summary>Extra normalization before TMDB title scoring for noisy movie filenames.</summary>
    public static string PolishMovieSearchTitle(string cleanName) =>
        PolishMovieDisplayTitle(FinalizeCleanName(cleanName ?? ""));

    /// <summary>Walks up from the file folder, yielding each non-skippable segment as a cleaned title.</summary>
    public static IReadOnlyList<string> EnumeratePathFolderTitleCandidates(string filePath)
    {
        var list = new List<string>();
        var dir = Path.GetDirectoryName(filePath);
        while (!string.IsNullOrEmpty(dir))
        {
            var segment = Path.GetFileName(dir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (string.IsNullOrEmpty(segment))
                break;

            if (!IsSkippablePathSegment(segment))
            {
                var cleaned = FinalizeCleanName(CleanupFolderName(segment));
                if (!string.IsNullOrWhiteSpace(cleaned) && !IsWeakPathFolderTitle(cleaned))
                    list.Add(cleaned);
            }

            dir = Path.GetDirectoryName(dir);
        }

        return list;
    }

    private static bool IsWeakPathFolderTitle(string s)
    {
        if (s.Length <= 1)
            return true;
        if (s.All(char.IsDigit))
            return true;
        return ReleaseQualityFolderSegments.Contains(s);
    }

    private static string PolishMovieDisplayTitle(string s)
    {
        if (string.IsNullOrWhiteSpace(s))
            return s;
        // "American Ultra HD" → closer to TMDB "American Ultra"
        s = Regex.Replace(s, @"(?i)\bultra\s+hd\b", "Ultra", RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"(?i)\bmovie\s+hd\b", " ", RegexOptions.CultureInvariant);
        s = CollapseSpaces(s).Trim();
        return s;
    }

    /// <summary>Full path to the show root folder (skips season/library segments).</summary>
    public static string GetShowFolderFullPath(string filePath)
    {
        var dir = Path.GetDirectoryName(filePath);
        while (!string.IsNullOrEmpty(dir))
        {
            var segment = Path.GetFileName(dir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (string.IsNullOrEmpty(segment))
                break;

            if (!IsSkippablePathSegment(segment))
                return dir;

            dir = Path.GetDirectoryName(dir);
        }

        return Path.GetDirectoryName(filePath) ?? "";
    }

    /// <summary>Normalized full path to the series library folder (all seasons under this path).</summary>
    public static string? GetSeriesShowRootFullPath(string? filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
            return null;
        try
        {
            var root = GetShowFolderFullPath(filePath.Trim());
            if (string.IsNullOrWhiteSpace(root))
                return null;
            return Path.GetFullPath(root);
        }
        catch
        {
            return null;
        }
    }

    public static bool SameSeriesShowRootDirectory(string? pathA, string? pathB)
    {
        var a = GetSeriesShowRootFullPath(pathA);
        var b = GetSeriesShowRootFullPath(pathB);
        return a != null && b != null && string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    }

    private static string ResolveLibraryMediaType(string filePath)
    {
        var fromFolders = FileScanner.InferMediaType(filePath);
        if (fromFolders is "Movie" or "Series")
            return fromFolders;

        var fileName = Path.GetFileNameWithoutExtension(filePath);
        if (string.IsNullOrEmpty(fileName))
            return "";

        // Paths like ..\Show.Name\Season 1\episode.mkv with no Movies/Series parent still need a TV lookup.
        if (SeasonEpisodePattern().IsMatch(fileName) || SeasonEpisodeXPattern().IsMatch(fileName))
            return "Series";

        if (TryInferSeasonFromPath(filePath).HasValue)
        {
            if (TryInferEpisodeFromFileName(fileName).HasValue)
                return "Series";

            // Bare trailing number ("ShowName.03.mkv") under a known Season folder — same fallback
            // the main Parse() flow uses to fill in Episode; see there for why it's gated on the folder.
            var trailing = TrailingBareEpisodeNumberPattern().Match(fileName.TrimEnd());
            if (trailing.Success)
                return "Series";
        }

        // An explicit "E04" / "Episode 2" marker in the filename is unambiguous on its own — don't
        // also require a Season N folder. Without this, files like "Show.E04.mp4" or "Show Episode 2.mp4"
        // sitting directly in a show folder (no per-season subfolder) fall through with MediaType="",
        // which then blocks the season-defaults-to-1 fallback below and the episode never gets attached.
        if (EpisodeWordPattern().IsMatch(fileName))
            return "Series";

        return "";
    }

    private static ParseResult EmptyResult() => new()
    {
        CleanName = "",
        MediaType = "",
        Confidence = ParseConfidence.Low
    };

    private static bool DotSegmentAnchorsProbableSceneGroup(string seg)
    {
        var t = seg.Trim();
        if (t.Length == 0)
            return false;
        if (DotSegmentBeforeLikelySceneGroup.Contains(t))
            return true;
        if (ReleaseQualityFolderSegments.Contains(t))
            return true;
        if (SeasonEpisodeDotSegmentPattern().IsMatch(t))
            return true;
        return Regex.IsMatch(t, @"(?i)^(480|720|1080|2160|576|432)p$", RegexOptions.CultureInvariant);
    }

    private static bool LooksLikeDotSeparatedReleaseGroupToken(string seg)
    {
        if (NeverStripTrailingDotReleaseGroupSegment.Contains(seg))
            return false;
        var t = seg.Trim();
        if (t.Length is < 2 or > 12)
            return false;
        if (!t.All(static c => char.IsLetterOrDigit(c)))
            return false;
        if (t.All(char.IsDigit))
            return false;
        if (t.Length == 4 && int.TryParse(t, NumberStyles.Integer, CultureInfo.InvariantCulture, out var y) &&
            y is >= 1900 and <= 2035)
            return false;
        if (DotSegmentAnchorsProbableSceneGroup(t))
            return false;
        if (ShortLowercaseDotReleaseGroups.Contains(t))
            return true;
        if (t.Any(char.IsAsciiDigit))
            return true;
        var hasUpper = t.Any(static c => c is >= 'A' and <= 'Z');
        var hasLower = t.Any(static c => c is >= 'a' and <= 'z');
        if (hasUpper && !hasLower)
            return true;
        // Long lowercase letter-only tokens (e.g. sujaidr) — avoid 2–4 letter words that may be real titles.
        return t.Length >= 5 && hasLower && !t.Any(char.IsAsciiDigit);
    }

    /// <summary>
    /// Dot-delimited scene layout: <c>title.S10E12.720p.bluray.sujaidr</c> — drop release-group tail after encode/quality.
    /// Hyphen groups are handled separately via <see cref="TrailingReleaseGroupHyphen"/>.
    /// </summary>
    private static string StripTrailingDotSeparatedReleaseGroups(string fileNameWithoutExt)
    {
        var parts = fileNameWithoutExt.Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length < 2)
            return fileNameWithoutExt;
        var list = new List<string>(parts);
        while (list.Count >= 2)
        {
            var last = list[^1];
            var prev = list[^2];
            if (!LooksLikeDotSeparatedReleaseGroupToken(last))
                break;
            if (!DotSegmentAnchorsProbableSceneGroup(prev))
                break;
            list.RemoveAt(list.Count - 1);
        }

        return string.Join(".", list);
    }

    private static string BuildCleanName(string fileName, string? seasonEpisodeToken, string? yearToken)
    {
        var s = StripLeadingIndexFromFileName(fileName);
        s = StripTrailingDotSeparatedReleaseGroups(s);

        // Some releases append an encode/part marker like "x264_2" or "..._1" which can survive
        // noise-token stripping (because "x264" is removed but "_2" remains). Detect this early so
        // we can safely drop the trailing numeric suffix later.
        var hasTrailingEncodeSuffix = Regex.IsMatch(fileName, @"(?i)(x264|x265|hevc)\s*[_-]\s*\d{1,2}$",
            RegexOptions.CultureInvariant) ||
                                     Regex.IsMatch(fileName, @"(?i)[._-](?:cd|disc|disk|part)[._-]?\d{1,2}$",
                                         RegexOptions.CultureInvariant);

        if (!string.IsNullOrEmpty(seasonEpisodeToken))
            s = s.Replace(seasonEpisodeToken, " ", StringComparison.OrdinalIgnoreCase);

        if (!string.IsNullOrEmpty(yearToken))
            s = s.Replace(yearToken, " ", StringComparison.Ordinal);

        // "(2014)" style year already handled via yearToken — remove leftover empty parens.
        s = Regex.Replace(s, @"\(\s*(19\d{2}|20\d{2})\s*\)", " ", RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"\(\s*\)", " ", RegexOptions.CultureInvariant);

        s = TrailingReleaseGroupHyphen().Replace(s, "");
        s = BracketTagPattern().Replace(s, " ");
        s = ParenReleaseTagPattern().Replace(s, " ");
        s = SiteNoisePattern().Replace(s, " ");
        s = Regex.Replace(s, @"\.akwam\.net", " ", RegexOptions.IgnoreCase);
        s = Regex.Replace(s, @"\.akwam\b", " ", RegexOptions.IgnoreCase);

        // If we detected an encode suffix, remove the final "_2" / "-2" before normalizing separators.
        if (hasTrailingEncodeSuffix)
            s = Regex.Replace(s, @"(?i)[_-]\s*\d{1,2}$", " ", RegexOptions.CultureInvariant);

        // Audio channel layouts (5.1 / 7.1 / 2.0) must go before dots collapse to spaces, otherwise
        // "5.1" survives as "5 1" and wrecks the search title (e.g. "The Matrix 5 1" → 0 TMDB results).
        s = Regex.Replace(s, @"(?<!\d)[2457]\.[01](?!\d)", " ", RegexOptions.CultureInvariant);

        s = s.Replace('.', ' ').Replace('_', ' ');

        s = ApplyNoiseStrippingToTitle(s);

        // Drop trailing part/disc markers that sometimes remain after noise stripping.
        // This is gated by "hasTrailingEncodeSuffix" so we don't break legitimate sequels like "Saw 2".
        if (hasTrailingEncodeSuffix)
            s = Regex.Replace(s, @"(?<=\s|^)\d{1,2}(?=\s*$)", " ", RegexOptions.CultureInvariant);

        return FinalizeCleanName(s);
    }

    private static string ApplyNoiseStrippingToTitle(string s)
    {
        s = Regex.Replace(s, @"(?i)\bultra\s+hd\b", " ultra ", RegexOptions.CultureInvariant);

        // Multi-word release qualifiers.
        s = Regex.Replace(s, @"(?i)\bdirector'?s\s+cut\b", " ", RegexOptions.CultureInvariant);
        // Space-separated audio layout that survived separator normalisation ("5 1", "7 1", "2 0").
        s = Regex.Replace(s, @"(?<![\w\d])[2457]\s+[01](?![\w\d])", " ", RegexOptions.CultureInvariant);

        // Strip trailing episode-like patterns: "- 01", "- 12", etc.
        s = Regex.Replace(s, @"\s*-\s*\d{1,3}\s*$", " ", RegexOptions.CultureInvariant);

        foreach (var token in NoiseTokens)
        {
            var pattern = $@"(?<![\w]){Regex.Escape(token)}(?![\w])";
            s = Regex.Replace(s, pattern, " ", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        }

        // Standalone "TV" / HDTV (not inside another word)
        s = Regex.Replace(s, @"(?<![\w])HDTV(?![\w])", " ", RegexOptions.IgnoreCase);
        s = Regex.Replace(s, @"(?<![\w])DVDRip(?![\w])", " ", RegexOptions.IgnoreCase);
        s = Regex.Replace(s, @"(?<![\w])CAMRip(?![\w])", " ", RegexOptions.IgnoreCase);
        s = Regex.Replace(s, @"(?<![\w])TV(?![\w])", " ", RegexOptions.IgnoreCase);

        s = StandaloneQualityNumberPattern().Replace(s, " ");
        return CollapseSpaces(s);
    }

    /// <summary>Trim edges; drop trailing/leading punctuation; strip trailing quality-only tokens.</summary>
    private static string FinalizeCleanName(string s)
    {
        // Strip zero-width and bidirectional control characters (common in Arabic rips, e.g. "…منير‬")
        // — they never belong in a title and corrupt the TMDB search query.
        s = Regex.Replace(s, "[​-‏‪-‮⁦-⁩؜﻿]", "",
            RegexOptions.CultureInvariant);
        s = CollapseSpaces(s).Trim();
        s = Regex.Replace(s, @"^[\s._\-]+|[\s._\-]+$", "");
        // Trailing token that is only a quality number
        s = Regex.Replace(s, @"(?<=\s|^)(480|720|1080|2160)(?=\s*$)", "", RegexOptions.IgnoreCase);
        s = CollapseSpaces(s).Trim();
        s = Regex.Replace(s, @"^[\s._\-]+|[\s._\-]+$", "");
        return s;
    }

    private static bool ShouldInferTitleFromPath(string fileNameWithoutExt, string cleanName)
    {
        if (string.IsNullOrEmpty(cleanName))
            return true;

        if (GenericVideoFileNames.Contains(cleanName))
            return true;

        if (SeasonEpisodePattern().Replace(fileNameWithoutExt, "", 1).Trim().Length == 0)
            return true;

        if (cleanName.All(char.IsDigit))
            return true;

        // Garbage token file names like "04cmme", "1a2b3c", "x01abc" should use folder name.
        // Heuristic: short, single-token, mixed letters+digits, no spaces.
        if (!cleanName.Contains(' ', StringComparison.Ordinal) &&
            cleanName.Length <= 10 &&
            cleanName.Any(char.IsLetter) &&
            cleanName.Any(char.IsDigit))
            return true;

        if (cleanName.StartsWith("Episode ", StringComparison.OrdinalIgnoreCase) ||
            cleanName.StartsWith("Ep ", StringComparison.OrdinalIgnoreCase) ||
            cleanName.Equals("Episode", StringComparison.OrdinalIgnoreCase) ||
            cleanName.Equals("Ep", StringComparison.OrdinalIgnoreCase))
            return true;

        return false;
    }

    private static string InferTitleFromPath(string filePath)
    {
        var dir = Path.GetDirectoryName(filePath);
        while (!string.IsNullOrEmpty(dir))
        {
            var segment = Path.GetFileName(dir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (string.IsNullOrEmpty(segment))
                break;

            if (!IsSkippablePathSegment(segment))
                return CleanupFolderName(segment);

            dir = Path.GetDirectoryName(dir);
        }

        return "";
    }

    private static string StripLeadingIndexFromFileName(string fileNameWithoutExt)
    {
        var t = fileNameWithoutExt.Trim();
        if (t.Length == 0)
            return fileNameWithoutExt;
        var m = LeadingIndexPattern().Match(t);
        if (!m.Success)
            return fileNameWithoutExt;
        var rest = (m.Groups["rest"].Value ?? "").Trim();
        if (rest.Length < 2 || !rest.Any(char.IsLetter))
            return fileNameWithoutExt;
        return rest;
    }

    private static string StripLeadingIndexPrefix(string? title)
    {
        var s = (title ?? "").Trim();
        if (string.IsNullOrWhiteSpace(s))
            return "";
        var m = LeadingIndexPattern().Match(s);
        if (!m.Success)
            return s;

        // Only strip when there's still a meaningful remainder (at least 2 chars and contains a letter).
        var rest = (m.Groups["rest"].Value ?? "").Trim();
        if (rest.Length < 2 || !rest.Any(char.IsLetter))
            return s;
        return rest;
    }

    private static bool IsSkippablePathSegment(string segment)
    {
        if (segment == "عربي")
            return true;

        if (LibraryRootSegments.Contains(segment))
            return true;

        if (segment.Equals("Specials", StringComparison.OrdinalIgnoreCase) ||
            segment.Equals("Extras", StringComparison.OrdinalIgnoreCase) ||
            segment.Equals("Featurettes", StringComparison.OrdinalIgnoreCase) ||
            segment.Equals("Deleted Scenes", StringComparison.OrdinalIgnoreCase))
            return true;

        if (segment.Equals("Episodes", StringComparison.OrdinalIgnoreCase) ||
            segment.Equals("Episode", StringComparison.OrdinalIgnoreCase))
            return true;

        if (ReleaseQualityFolderSegments.Contains(segment))
            return true;

        if (SeriesNumberFolderPattern().IsMatch(segment) || VolumeNumberFolderPattern().IsMatch(segment))
            return true;

        if (SaisonFolderPattern().IsMatch(segment))
            return true;

        if (StaffelFolderPattern().IsMatch(segment) ||
            TemporadaFolderPattern().IsMatch(segment) ||
            SeizoenFolderPattern().IsMatch(segment) ||
            StagioneFolderPattern().IsMatch(segment))
            return true;

        if (SeasonFolderShortPattern().IsMatch(segment) || SeasonFolderWordPattern().IsMatch(segment))
            return true;

        return false;
    }

    private static string CleanupFolderName(string segment)
    {
        var s = segment.Trim();
        // Square-bracket tags: [720p], [YTS.MX], [BluRay], etc.
        s = BracketTagPattern().Replace(s, " ");
        s = Regex.Replace(s, @"\(\s*(19\d{2}|20\d{2})\s*\)", " ", RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"\(\s*\)", " ", RegexOptions.CultureInvariant);
        s = ParenReleaseTagPattern().Replace(s, " ");
        s = SiteNoisePattern().Replace(s, " ");
        s = s.Replace('.', ' ').Replace('_', ' ');
        s = Regex.Replace(s, @"([a-z\d])([A-Z])", "$1 $2");
        s = TrailingReleaseGroupHyphen().Replace(s, "");
        s = ApplyNoiseStrippingToTitle(s);
        return FinalizeCleanName(s);
    }

    private static string CollapseSpaces(string s)
    {
        return Regex.Replace(s, @"\s+", " ", RegexOptions.CultureInvariant);
    }

    private static int? TryInferSeasonFromPath(string filePath)
    {
        try
        {
            var dir = Path.GetDirectoryName(filePath);
            while (!string.IsNullOrEmpty(dir))
            {
                var segment = Path.GetFileName(dir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
                if (string.IsNullOrEmpty(segment))
                    break;

                if (SeasonFolderShortPattern().IsMatch(segment))
                {
                    var digits = Regex.Replace(segment, @"(?i)^S", "", RegexOptions.CultureInvariant);
                    return int.TryParse(digits, NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) ? s : null;
                }

                if (SeasonFolderWordPattern().IsMatch(segment))
                {
                    var digits = Regex.Replace(segment, @"(?i)^Season[.\s_-]*", "", RegexOptions.CultureInvariant);
                    return int.TryParse(digits, NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) ? s : null;
                }

                if (segment.Equals("Specials", StringComparison.OrdinalIgnoreCase))
                    return 0;

                if (!IsSkippablePathSegment(segment))
                    break;

                dir = Path.GetDirectoryName(dir);
            }
        }
        catch
        {
            /* ignore */
        }

        return null;
    }

    private static int? TryInferEpisodeFromFileName(string fileNameWithoutExt)
    {
        if (string.IsNullOrWhiteSpace(fileNameWithoutExt))
            return null;

        var m = EpisodeWordPattern().Match(fileNameWithoutExt);
        if (m.Success && int.TryParse(m.Groups["e"].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var e1))
            return e1;

        var trimmed = fileNameWithoutExt.Trim();
        var m0 = EpisodeNumberOnlyPattern().Match(trimmed);
        if (m0.Success &&
            int.TryParse(m0.Groups["e"].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var e0))
            return e0;

        // Strip noise first; then see if it became only digits.
        var cleaned = BuildCleanName(fileNameWithoutExt, null, null);
        var m2 = EpisodeNumberOnlyPattern().Match(cleaned);
        if (m2.Success && int.TryParse(m2.Groups["e"].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var e2))
            return e2;

        return null;
    }
}
