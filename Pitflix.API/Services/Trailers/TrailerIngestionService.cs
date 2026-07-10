using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.RegularExpressions;
using Pitflix.API.Services;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services.Trailers;

public sealed class TrailerIngestionService
{
    private static readonly Regex BlockedTitlePattern = new(
        @"\b(breakdown|explained|reaction|reviews?|recap|leak|leaked|rumou?r|concept(\s+trailer)?|fan\s*made|fanedit|edit\b|shorts?|gameplay|clip\b|clips\b|promo\s*clip|exclusive\s*clip|first\s*reaction|full\s*movie|spoiler|spoilers|vfx|behind\s*the\s*scenes|\bbts\b|podcast|interview|unboxing|mashup|compilation|music\s*video|\bmv\b|not\s*official|unofficial|clickbait|hd\s*remaster|upscaled|funko|tik\s*tok)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled, TimeSpan.FromMilliseconds(200));

    private const int YoutubeFetchPublishedAfterDays = 120;
    private const int YoutubeSearchMaxResults = 50;
    private const int YoutubeSearchMaxPages = 3;

    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _configuration;
    private readonly OfficialTrailersChannelProvider _channelsProvider;
    private readonly TrailersRepository _trailersRepo;
    private readonly TrailerMonitorRuntime _monitorRuntime;
    private readonly ITmdbClientFactory _tmdbClientFactory;
    private readonly ILogger<TrailerIngestionService> _log;

    public TrailerIngestionService(
        IHttpClientFactory httpFactory,
        IConfiguration configuration,
        OfficialTrailersChannelProvider channelsProvider,
        TrailersRepository trailersRepo,
        TrailerMonitorRuntime monitorRuntime,
        ITmdbClientFactory tmdbClientFactory,
        ILogger<TrailerIngestionService> log)
    {
        _httpFactory = httpFactory;
        _configuration = configuration;
        _channelsProvider = channelsProvider;
        _trailersRepo = trailersRepo;
        _monitorRuntime = monitorRuntime;
        _tmdbClientFactory = tmdbClientFactory;
        _log = log;
    }

    internal sealed record YoutubeVideoCandidate(
        string VideoId,
        string Title,
        string ChannelName,
        string ChannelId,
        DateTime PublishedAtUtc,
        int ChannelPriority,
        int TrustTier,
        string IngestionSourceTag,
        string MediaFocusHint);

    public async Task<TrailerIngestionRunResult> IngestAsync(CancellationToken ct = default)
    {
        var apiKey = _configuration["Pitflix:YoutubeApiKey"]?.Trim()
                     ?? _configuration["YoutubeApiKey"]?.Trim()
                     ?? Environment.GetEnvironmentVariable("PITFLIX_YOUTUBE_API_KEY")?.Trim();

        var tmdb = _tmdbClientFactory.Create();
        
        // Discover TMDB native trailers EARLY/INDEPENDENTLY (before YouTube processing)
        // This ensures they get added even if YouTube API quota is hit
        var tmdbNativeTrailers = new List<TrailerItem>();
        var enableTmdbNative = _configuration.GetValue("Pitflix:Trailers:EnableTmdbNative", false);
        if (enableTmdbNative && tmdb != null)
        {
            try
            {
                var tmdbNativeDiscovery = new TmdbNativeTrailerDiscovery(_log);
                var tmdbNativePublishedAfterDays = Math.Clamp(
                    _configuration.GetValue("Pitflix:Trailers:TmdbNativePublishedAfterDays", 14), 1, 90);
                var publishedCutoff = DateTime.UtcNow.AddDays(-tmdbNativePublishedAfterDays);
                tmdbNativeTrailers = await tmdbNativeDiscovery.DiscoverLatestAsync(tmdb, publishedCutoff, ct)
                    .ConfigureAwait(false);
                _log.LogInformation(
                    "Trailers ingestion: TMDB native discovery (early) fetched {Count} trailers",
                    tmdbNativeTrailers.Count);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Trailers ingestion: TMDB native discovery failed, continuing with YouTube sources");
            }
        }

        // YouTube API is optional — RSS is the no-key fallback.
        // Previously this returned early with "missing_youtube_api_key", meaning production
        // instances without a YouTube Data API key could never ingest any trailers.
        var hasYoutubeKey = !string.IsNullOrWhiteSpace(apiKey);
        if (!hasYoutubeKey && !enableTmdbNative)
            _log.LogInformation("Trailers ingestion: No YouTube API key — will use public RSS feeds as fallback.");

        var channels = await _channelsProvider.GetChannelsAsync(ct).ConfigureAwait(false);
        if (!hasYoutubeKey && !enableTmdbNative && channels.Count == 0)
        {
            _log.LogWarning("Trailers ingestion skipped: no YouTube API key and no official channels configured for RSS fallback");
            return new TrailerIngestionRunResult(0, 0, 0, 0, 0, "missing_youtube_api_key_and_channels", false, 0, 0);
        }

        // If TMDB native found trailers and YouTube is not required, skip YouTube and use TMDB-only
        if (enableTmdbNative && tmdbNativeTrailers.Count > 0 && string.IsNullOrWhiteSpace(apiKey))
        {
            _log.LogInformation(
                "Trailers ingestion: TMDB-only mode (no YouTube API), persisting {Count} TMDB native trailers",
                tmdbNativeTrailers.Count);
            
            // Go straight to deduplication and persistence with TMDB native trailers
            var tmdbOnlyByMatch = new List<TrailerItem>();
            foreach (var g in tmdbNativeTrailers.GroupBy(x => (x.TmdbId, x.MediaType)))
            {
                var ordered = g.OrderByDescending(x => x.PublishedAtUtc)  // Most recent first
                    .ThenByDescending(x => x.QualityScore)
                    .ThenByDescending(x => x.MatchConfidence).ToList();
                
                // Keep up to 3 recent trailers per TMDB ID for variety (Trailer, Teaser, Clip)
                var kept = ordered.Take(3).ToList();
                tmdbOnlyByMatch.AddRange(kept);
                
                _log.LogDebug(
                    "TMDB-only dedup: {Title} ({MediaType}, TMDB {TmdbId}) - kept {KeptCount} of {TotalCount} trailers, most recent published {PublishedAt:o}",
                    g.First().Title, g.Key.MediaType, g.Key.TmdbId, kept.Count, ordered.Count, ordered[0].PublishedAtUtc);
            }

            var tmdbInserted = 0;
            foreach (var t in tmdbOnlyByMatch)
            {
                await _trailersRepo.AddOrUpdateTrailerAsync(t, ct).ConfigureAwait(false);
                tmdbInserted++;
            }

            var tmdbRetentionDays = 90;
            if (int.TryParse(_configuration["Pitflix:Trailers:InactiveRetentionDays"], out var rDays))
                tmdbRetentionDays = rDays;
            var tmdbPurged = await _trailersRepo.PurgeInactiveTrailersOlderThanAsync(tmdbRetentionDays, ct).ConfigureAwait(false);

            _log.LogInformation(
                "Pitflix.Trailers.Ingest summary (TMDB-only) Matched={Matched} Inserted={Inserted} Purged={Purged}",
                tmdbNativeTrailers.Count, tmdbInserted, tmdbPurged);

            return new TrailerIngestionRunResult(0, 0, 0, tmdbNativeTrailers.Count, tmdbInserted, null, false, tmdbPurged, 0);
        }

        _log.LogInformation(
            "Pitflix.Trailers.Ingest start Channels={ChannelCount}",
            channels.Count);

        var exampleTraceLogs = _configuration.GetValue("Pitflix:Trailers:ExampleTraceLogs", true);
        var traceLastStage = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        void TraceStage(string traceId, string stage, string? videoId = null, string? title = null, string? detail = null)
        {
            if (!exampleTraceLogs)
                return;
            traceLastStage[traceId] = stage;
            _log.LogWarning(
                "{Prefix} traceId={TraceId} stage={Stage} videoId={VideoId} title={Title} detail={Detail}",
                TrailerIngestionTraceDiagnostics.LogPrefix, traceId, stage, videoId ?? "", title ?? "", detail ?? "");
        }

        void TraceFromCandidate(string stage, YoutubeVideoCandidate v, string? detail = null)
        {
            var id = TrailerIngestionTraceDiagnostics.MatchTraceId(v.Title);
            if (id == null)
                return;
            TraceStage(id, stage, v.VideoId, v.Title, detail);
        }

        void TraceFromTrailerItem(string stage, TrailerItem t, string? detail = null)
        {
            var id = TrailerIngestionTraceDiagnostics.MatchTraceId(t.Title);
            if (id == null)
                return;
            TraceStage(id, stage, t.VideoId, t.Title, detail);
        }

        var channelsToPoll = channels.Where(c => c.Enabled).ToList();
        var uploadCandidates = new List<YoutubeVideoCandidate>();
        var searchCandidates = new List<YoutubeVideoCandidate>();
        var quotaStop = false;
        var channelsPolled = 0;
        var newUploadsSinceWatermark = 0;
        var fallbackUsed = false;

        // Try YouTube API if key exists, but gracefully handle quota exceeded
        if (hasYoutubeKey)
        {
            foreach (var ch in channelsToPoll)
            {
                if (quotaStop)
                    break;
                channelsPolled++;
                _log.LogInformation("Trailers channel uploads sync start Channel={Channel} ChannelId={ChannelId}", ch.Name,
                    ch.ChannelId);
                var (uploads, hitQ, newSince) = await FetchNewUploadsFromChannelAsync(apiKey!, ch, ct).ConfigureAwait(false);
                newUploadsSinceWatermark += newSince;
                uploadCandidates.AddRange(uploads);
                if (hitQ)
                {
                    quotaStop = true;
                    _log.LogWarning("Trailers ingestion: YouTube quota hit during uploads playlist poll. Will fall back to RSS.");
                }

                _log.LogInformation(
                    "Trailers channel uploads sync end Channel={Channel} Candidates={Count} NewSinceWatermark={NewSince}",
                    ch.Name, uploads.Count, newSince);
            }

            var enableSearch = _configuration.GetValue("Pitflix:Trailers:EnableSearchFallback", true);
            if (!quotaStop && enableSearch)
            {
                fallbackUsed = true;
                foreach (var ch in channelsToPoll)
                {
                    if (quotaStop)
                        break;
                    var (videos, hitQuota) = await FetchFromChannelSearchAsync(apiKey!, ch, ct).ConfigureAwait(false);
                    if (hitQuota)
                    {
                        quotaStop = true;
                        _log.LogWarning("Trailers ingestion: YouTube quota hit during search fallback. Will fall back to RSS.");
                    }

                    searchCandidates.AddRange(videos);
                }
            }
        }

        // RSS fallback: runs when no YouTube API key OR when quota was hit mid-poll.
        // Public YouTube RSS feeds require no authentication and return the last ~15 videos
        // per channel — enough to catch recent trailer drops from all official channels.
        var useRss = !hasYoutubeKey || quotaStop;
        if (useRss && channelsToPoll.Count > 0)
        {
            _log.LogInformation("Trailers ingestion: fetching from YouTube RSS (no-key fallback) for {Count} channels", channelsToPoll.Count);
            var channelLookup = channelsToPoll.ToDictionary(c => c.ChannelId, StringComparer.Ordinal);
            using var rssHttp = _httpFactory.CreateClient();
            rssHttp.DefaultRequestHeaders.UserAgent.ParseAdd("Pitflix/1.0 (trailer-rss)");
            var channelIds = channelsToPoll.Select(c => c.ChannelId).ToList();
            var (rssItems, rssErrors) = await YoutubeRssTrailerDiscovery.FetchRecentFromChannelsAsync(
                rssHttp, channelIds, maxEntriesPerChannel: 25, ct).ConfigureAwait(false);
            foreach (var err in rssErrors)
                _log.LogWarning("Trailers RSS fetch error: {Error}", err);

            var publishedAfterRss = DateTime.UtcNow.AddDays(-YoutubeFetchPublishedAfterDays);
            foreach (var r in rssItems)
            {
                var vidId = YoutubeRssTrailerDiscovery.TryExtractVideoId(r.SourceUrl);
                if (string.IsNullOrWhiteSpace(vidId)) continue;
                if (uploadCandidates.Any(u => u.VideoId == vidId)) continue; // already from API
                var pub = r.PublishedAtUtc ?? DateTime.UtcNow;
                if (pub < publishedAfterRss) continue;
                // Extract channel ID from source name "youtube-rss:{channelId}"
                var sourceName = r.SourceName ?? "";
                var chanId = sourceName.StartsWith("youtube-rss:", StringComparison.Ordinal)
                    ? sourceName["youtube-rss:".Length..]
                    : "";
                channelLookup.TryGetValue(chanId, out var chanEntry);
                uploadCandidates.Add(new YoutubeVideoCandidate(
                    VideoId: vidId,
                    Title: r.RawTitle,
                    ChannelName: chanEntry?.Name ?? chanId,
                    ChannelId: chanId,
                    PublishedAtUtc: pub,
                    ChannelPriority: chanEntry?.Priority ?? 50,
                    TrustTier: chanEntry?.TrustTier ?? 3,
                    IngestionSourceTag: "yt_rss",
                    MediaFocusHint: chanEntry?.MediaFocus ?? "both"
                ));
                channelsPolled++;
            }
            _log.LogInformation("Trailers ingestion: RSS yielded {Count} additional candidates", uploadCandidates.Count);
        }

        var byVideoId = new Dictionary<string, YoutubeVideoCandidate>(StringComparer.Ordinal);
        foreach (var c in searchCandidates)
            byVideoId[c.VideoId] = c;
        foreach (var c in uploadCandidates)
            byVideoId[c.VideoId] = c;

        var fetched = byVideoId.Values.ToList();

        _log.LogInformation(
            "Pitflix.Trailers.Ingest merged Raw={Fetched} Uploads={Up} Search={Se} QuotaStopped={QuotaStop} FallbackSearch={Fallback}",
            fetched.Count, uploadCandidates.Count, searchCandidates.Count, quotaStop, fallbackUsed);

        foreach (var v in fetched)
            TraceFromCandidate("youtube_fetched", v, $"channel={v.ChannelName} priority={v.ChannelPriority}");

        var filtered = new List<YoutubeVideoCandidate>();
        var filteredOut = 0;
        foreach (var v in fetched)
        {
            if (!PassesStrictTitleFilter(v.Title))
            {
                filteredOut++;
                _log.LogInformation(
                    "Trailers ingestion filtered out video {VideoId} title={Title} channel={ChannelName} reason=title_filter",
                    v.VideoId, v.Title, v.ChannelName);
                if (TryExplainTitleFilterFailure(v.Title, out var tf))
                    TraceFromCandidate("filtered_out_title_gate", v, $"reason={tf}");
                continue;
            }

            filtered.Add(v);
        }

        var byVideo = filtered
            .GroupBy(x => x.VideoId, StringComparer.Ordinal)
            .Select(g => g.OrderByDescending(TrailerMatchScorer.ScoreCandidatePreMatch).ThenByDescending(x => x.PublishedAtUtc).First())
            .ToList();

        if (tmdb == null)
        {
            _log.LogWarning("Trailers ingestion skipped TMDB matching: TMDB client unavailable");
            if (exampleTraceLogs)
            {
                foreach (var id in TrailerIngestionTraceDiagnostics.KnownTraceIds)
                    TraceStage(id, "aborted_tmdb_client_unavailable", detail: "no TMDB match pass");
            }

            return new TrailerIngestionRunResult(fetched.Count, filtered.Count, filteredOut, 0, 0, "tmdb_unavailable",
                quotaStop, 0, 0, 0, uploadCandidates.Count, searchCandidates.Count, channelsPolled, fallbackUsed,
                newUploadsSinceWatermark);
        }

        var matched = new List<TrailerItem>();
        var unmatched = 0;
        foreach (var c in byVideo)
        {
            TraceFromCandidate("post_title_filter_pipeline", c, "entering_tmdb_match");
            var parsed = NormalizeAndParseCandidateTitle(c.Title);
            if (string.IsNullOrWhiteSpace(parsed.CleanTitle) || parsed.CleanTitle.Length < 2)
            {
                unmatched++;
                TraceFromCandidate("unmatched_empty_clean_title", c, $"raw_clean_len={parsed.CleanTitle?.Length ?? 0}");
                continue;
            }

            var queries = BuildTmdbSearchQueries(parsed.CleanTitle);
            TmdbDiscoverItem? picked = null;
            var hint = (c.MediaFocusHint ?? "both").Trim().ToLowerInvariant();
            if (hint == "tv")
            {
                foreach (var q in queries)
                {
                    picked = await TryDiscoverTvAsync(tmdb, q, parsed, c, ct).ConfigureAwait(false);
                    if (picked != null)
                        break;
                }

                if (picked == null)
                {
                    foreach (var q in queries)
                    {
                        picked = await TryDiscoverMovieAsync(tmdb, q, parsed, c, ct).ConfigureAwait(false);
                        if (picked != null)
                            break;
                    }
                }
            }
            else
            {
                foreach (var q in queries)
                {
                    picked = await TryDiscoverMovieAsync(tmdb, q, parsed, c, ct).ConfigureAwait(false);
                    if (picked != null)
                        break;
                }

                if (picked == null && hint != "movie")
                {
                    foreach (var q in queries)
                    {
                        picked = await TryDiscoverTvAsync(tmdb, q, parsed, c, ct).ConfigureAwait(false);
                        if (picked != null)
                            break;
                    }
                }
            }

            if (picked == null)
            {
                unmatched++;
                _log.LogInformation(
                    "Trailers ingestion unmatched video {VideoId} title={Title} cleaned={Cleaned}",
                    c.VideoId, c.Title, parsed.CleanTitle);
                TraceFromCandidate("unmatched_no_tmdb_pick", c,
                    $"cleaned={parsed.CleanTitle};queries={string.Join(" | ", queries.Take(6))}");
                continue;
            }

            var tmdbId = picked.Id;
            var mediaType = picked.MediaType.Equals("tv", StringComparison.OrdinalIgnoreCase) ? "Series" : "Movie";
            var matchConfidence = TrailerMatchScorer.ComputeMatchConfidence(parsed, picked, c.TrustTier);
            var minAcceptConf = TrailerMatchScorer.MinMatchConfidenceToAccept(c);
            if (matchConfidence < minAcceptConf)
            {
                unmatched++;
                _log.LogInformation(
                    "Trailers ingestion low-confidence reject video={VideoId} title={Title} tmdbId={TmdbId} conf={Conf:F2}",
                    c.VideoId, c.Title, tmdbId, matchConfidence);
                TraceFromCandidate("rejected_low_match_confidence", c,
                    $"tmdbId={tmdbId} mediaType={mediaType} conf={matchConfidence:F3} min={minAcceptConf:F3} tmdbTitle={picked.Title}");
                continue;
            }

            var quality = TrailerMatchScorer.ComputeQualityScore(c.TrustTier, matchConfidence, c.Title, c.PublishedAtUtc);
            var item = new TrailerItem
            {
                VideoId = c.VideoId,
                YoutubeUrl = $"https://www.youtube.com/watch?v={c.VideoId}",
                Title = c.Title,
                ChannelName = c.ChannelName,
                ChannelId = c.ChannelId,
                IngestionSource = string.IsNullOrWhiteSpace(c.IngestionSourceTag) ? "yt_channel_uploads" : c.IngestionSourceTag,
                MatchConfidence = matchConfidence,
                TrustTier = c.TrustTier,
                TmdbId = tmdbId,
                MediaType = mediaType,
                PublishedAtUtc = c.PublishedAtUtc,
                QualityScore = quality,
                IsActive = true
            };
            matched.Add(item);
            TraceFromTrailerItem("matched_in_memory", item,
                $"tmdbId={tmdbId} mediaType={mediaType} quality={quality:F3} conf={matchConfidence:F3}");
        }

        // Add TMDB native trailers to matched list
        matched.AddRange(tmdbNativeTrailers);
        if (tmdbNativeTrailers.Count > 0)
        {
            _log.LogInformation(
                "Trailers ingestion: added {Count} TMDB native trailers to matched pool (total matched: {Total})",
                tmdbNativeTrailers.Count, matched.Count);
        }

        var byTmdb = new List<TrailerItem>();
        foreach (var g in matched.GroupBy(x => (x.TmdbId, x.MediaType)))
        {
            var ordered = g.OrderByDescending(x => x.PublishedAtUtc)  // Most recent first
                .ThenByDescending(x => x.QualityScore)
                .ThenByDescending(x => x.MatchConfidence)
                .ThenBy(x => x.TrustTier).ToList();
            
            // Keep up to 3 recent trailers per TMDB ID (Trailer/Teaser prioritized)
            // This allows multiple trailers for the same content (e.g., official trailer + teaser + clip)
            var kept = ordered.Take(3).ToList();
            byTmdb.AddRange(kept);
            
            var winner = ordered[0];
            TraceFromTrailerItem("selected_per_tmdb_scope_for_db", winner,
                $"tmdbId={winner.TmdbId} mediaType={winner.MediaType} quality={winner.QualityScore:F3} conf={winner.MatchConfidence:F3} kept={kept.Count}_of_{ordered.Count}");
            
            foreach (var loser in ordered.Skip(3))
            {
                TraceFromTrailerItem("deduped_in_memory_loser_not_persisted_this_run", loser,
                    $"kept_count=3 quality={loser.QualityScore:F3} rank={ordered.IndexOf(loser)} of {ordered.Count} " +
                    $"note=keeping_3_most_recent_per_tmdb_id");
            }
        }

        var skippedAsLowerQuality = Math.Max(0, matched.Count - byTmdb.Count);

        var insertedOrUpdated = 0;
        foreach (var t in byTmdb)
        {
            await _trailersRepo.AddOrUpdateTrailerAsync(t, ct).ConfigureAwait(false);
            var id = TrailerIngestionTraceDiagnostics.MatchTraceId(t.Title);
            if (id == null)
                continue;
            var persisted = await _trailersRepo.GetTrailerByVideoIdAsync(t.VideoId, ct).ConfigureAwait(false);
            if (persisted == null)
            {
                TraceStage(id, "persist_query_missing_row", t.VideoId, t.Title, "unexpected_after_AddOrUpdate");
                continue;
            }

            TraceStage(id, "after_db_reconcile", persisted.VideoId, persisted.Title,
                $"isActive={persisted.IsActive} quality={persisted.QualityScore:F3} conf={persisted.MatchConfidence:F3} " +
                $"tmdbId={persisted.TmdbId} mediaType={persisted.MediaType}");
            if (!persisted.IsActive)
            {
                var scopeRows = await _trailersRepo
                    .GetTrailersByTmdbIdAsync(persisted.TmdbId, persisted.MediaType, activeOnly: null, limit: 8, cancellationToken: ct)
                    .ConfigureAwait(false);
                var activeWinner = scopeRows.FirstOrDefault(x => x.IsActive);
                TraceStage(id, "inactive_after_reconcile_hint", persisted.VideoId, persisted.Title,
                    activeWinner == null
                        ? "no_active_row_in_scope"
                        : $"activeWinnerVideoId={activeWinner.VideoId} activeWinnerQuality={activeWinner.QualityScore:F3} " +
                          $"activeWinnerConf={activeWinner.MatchConfidence:F3} activeWinnerPublished={activeWinner.PublishedAtUtc:o}");
            }
        }

        insertedOrUpdated = byTmdb.Count;

        var retentionDays = 90;
        if (int.TryParse(_configuration["Pitflix:Trailers:InactiveRetentionDays"], out var rd))
            retentionDays = rd;
        var purged = await _trailersRepo.PurgeInactiveTrailersOlderThanAsync(retentionDays, ct).ConfigureAwait(false);

        _log.LogInformation(
            "Pitflix.Trailers.Ingest summary Fetched={Fetched} Filtered={Filtered} FilteredOut={FilteredOut} Matched={Matched} Unmatched={Unmatched} Inserted={Inserted} SkippedDedup={Skipped} Purged={Purged} QuotaStopped={QuotaStopped}",
            fetched.Count, filtered.Count, filteredOut, matched.Count, unmatched, insertedOrUpdated, skippedAsLowerQuality,
            purged, quotaStop);

        if (exampleTraceLogs)
        {
            foreach (var id in TrailerIngestionTraceDiagnostics.KnownTraceIds)
            {
                var last = traceLastStage.TryGetValue(id, out var s) ? s : "never_seen_youtube_fetch";
                _log.LogWarning(
                    "{Prefix} traceId={TraceId} run_summary lastStage={LastStage} quotaStoppedEarly={Quota}",
                    TrailerIngestionTraceDiagnostics.LogPrefix, id, last, quotaStop);
            }
        }

        var run = new TrailerIngestionRunResult(fetched.Count, filtered.Count, filteredOut, matched.Count,
            insertedOrUpdated,
            null, quotaStop, purged, skippedAsLowerQuality, unmatched, uploadCandidates.Count, searchCandidates.Count,
            channelsPolled, fallbackUsed, newUploadsSinceWatermark);
        _monitorRuntime.RecordRun(run);
        return run;
    }

    private static bool PassesStrictTitleFilter(string title) => !TryExplainTitleFilterFailure(title, out _);

    private static bool TryExplainTitleFilterFailure(string title, [NotNullWhen(true)] out string? reason)
    {
        reason = null;
        if (string.IsNullOrWhiteSpace(title))
        {
            reason = "empty_title";
            return true;
        }

        var normalized = TrailerMatchScorer.NormalizeTitle(title);
        
        // Reject obvious junk
        if (BlockedTitlePattern.IsMatch(normalized))
        {
            reason = "blocked_title_pattern";
            return true;
        }

        // Allow if contains "trailer" or "teaser" (primary gate - very permissive)
        if (Regex.IsMatch(normalized, @"\b(trailer|teaser)\b", RegexOptions.IgnoreCase))
        {
            return false;
        }

        // If no trailer/teaser word, reject (too risky)
        reason = "missing_trailer_or_teaser_word";
        return true;
    }

    private async Task<(List<YoutubeVideoCandidate> Videos, bool QuotaExceeded, int NewSinceWatermark)>
        FetchNewUploadsFromChannelAsync(string apiKey, OfficialTrailersChannelProvider.OfficialChannelEntry channel,
            CancellationToken ct)
    {
        var http = _httpFactory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(45);
        var outList = new List<YoutubeVideoCandidate>();
        var newSince = 0;
        var now = DateTime.UtcNow;

        try
        {
            var state = await _trailersRepo.GetTrailerChannelSyncStateAsync(channel.ChannelId, ct).ConfigureAwait(false)
                        ?? new TrailerChannelSyncState
                        {
                            ChannelId = channel.ChannelId,
                            ChannelName = channel.Name,
                            LastCheckedAtUtc = DateTime.UtcNow
                        };

            state.ChannelName = channel.Name;
            var playlistId = state.UploadsPlaylistId;
            if (string.IsNullOrWhiteSpace(playlistId))
            {
                playlistId = await TryResolveUploadsPlaylistIdAsync(http, apiKey, channel.ChannelId, ct)
                    .ConfigureAwait(false);
                state.UploadsPlaylistId = playlistId;
            }

            if (string.IsNullOrWhiteSpace(playlistId))
            {
                state.LastCheckedAtUtc = now;
                await _trailersRepo.UpsertTrailerChannelSyncStateAsync(state, ct).ConfigureAwait(false);
                return (outList, false, 0);
            }

            var pageSize = Math.Clamp(_configuration.GetValue("Pitflix:Trailers:UploadsPlaylistPageSize", 15), 5, 50);
            var plUrl =
                "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails" +
                $"&playlistId={Uri.EscapeDataString(playlistId)}&maxResults={pageSize}" +
                $"&key={Uri.EscapeDataString(apiKey)}";

            using var resp = await TrailerYoutubeSearchResilience.TrySendGetWithRetriesAsync(
                    http, plUrl, TrailerYoutubeSearchResilience.DefaultUserAgent, 5, TimeSpan.FromSeconds(18), ct)
                .ConfigureAwait(false);
            if (resp == null)
            {
                state.LastCheckedAtUtc = now;
                await _trailersRepo.UpsertTrailerChannelSyncStateAsync(state, ct).ConfigureAwait(false);
                return (outList, false, 0);
            }

            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (TrailerYoutubeSearchResilience.LooksLikeYoutubeQuotaExceeded(body))
                return (outList, true, newSince);

            if (!resp.IsSuccessStatusCode || string.IsNullOrWhiteSpace(body) ||
                !TrailerYoutubeSearchResilience.TryParseJsonDocument(body, out var doc) || doc is null)
            {
                state.LastCheckedAtUtc = now;
                await _trailersRepo.UpsertTrailerChannelSyncStateAsync(state, ct).ConfigureAwait(false);
                return (outList, false, 0);
            }

            using (doc)
            {
                if (!doc.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
                {
                    state.LastCheckedAtUtc = now;
                    await _trailersRepo.UpsertTrailerChannelSyncStateAsync(state, ct).ConfigureAwait(false);
                    return (outList, false, 0);
                }

                DateTime? headPub = null;
                string? headVid = null;
                var watermark = state.LastSeenPublishedAtUtc;
                var lookbackHours = Math.Clamp(_configuration.GetValue("Pitflix:Trailers:InitialUploadsLookbackHours", 168),
                    24, 720);
                var lookbackCutoff = now.AddHours(-lookbackHours);
                for (var ei = 0; ei < items.GetArrayLength(); ei++)
                {
                    var item = items[ei];
                    if (!item.TryGetProperty("contentDetails", out var cd))
                        continue;

                    var vid = cd.TryGetProperty("videoId", out var vEl) ? vEl.GetString() : null;
                    var snippet = item.TryGetProperty("snippet", out var sn) ? sn : default;
                    var published = now;
                    if (cd.TryGetProperty("videoPublishedAt", out var vp) && vp.ValueKind == JsonValueKind.String &&
                        DateTime.TryParse(vp.GetString(), out var p0))
                        published = DateTime.SpecifyKind(p0, DateTimeKind.Utc).ToUniversalTime();
                    else if (snippet.ValueKind != JsonValueKind.Undefined &&
                             snippet.TryGetProperty("publishedAt", out var pEl) &&
                             DateTime.TryParse(pEl.GetString(), out var p1))
                        published = DateTime.SpecifyKind(p1, DateTimeKind.Utc).ToUniversalTime();

                    if (ei == 0 && !string.IsNullOrWhiteSpace(vid) && vid!.Length == 11)
                    {
                        headPub = published;
                        headVid = vid;
                    }

                    if (string.IsNullOrWhiteSpace(vid) || vid.Length != 11)
                        continue;

                    var title = snippet.ValueKind != JsonValueKind.Undefined && snippet.TryGetProperty("title", out var tEl)
                        ? tEl.GetString()?.Trim()
                        : null;
                    if (string.IsNullOrWhiteSpace(title))
                        continue;

                    var isNew = watermark is null
                        ? published >= lookbackCutoff
                        : published > watermark.Value;
                    if (!isNew)
                        continue;

                    newSince++;
                    outList.Add(new YoutubeVideoCandidate(
                        vid,
                        title!,
                        channel.Name,
                        channel.ChannelId,
                        published,
                        channel.Priority,
                        channel.TrustTier,
                        "yt_channel_uploads",
                        channel.MediaFocus));
                }

                if (headPub is { } hp && headVid is { } hv)
                {
                    state.LastSeenPublishedAtUtc = hp;
                    state.LastSeenVideoId = hv;
                }

                state.LastCheckedAtUtc = now;
                await _trailersRepo.UpsertTrailerChannelSyncStateAsync(state, ct).ConfigureAwait(false);
            }

            return (outList, false, newSince);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Trailers uploads poll failed channel={Channel}", channel.Name);
            return (outList, false, newSince);
        }
    }

    private static async Task<string?> TryResolveUploadsPlaylistIdAsync(HttpClient http, string apiKey, string channelId,
        CancellationToken ct)
    {
        var url =
            $"https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id={Uri.EscapeDataString(channelId)}&key={Uri.EscapeDataString(apiKey)}";
        using var resp = await TrailerYoutubeSearchResilience.TrySendGetWithRetriesAsync(
                http, url, TrailerYoutubeSearchResilience.DefaultUserAgent, 3, TimeSpan.FromSeconds(14), ct)
            .ConfigureAwait(false);
        if (resp == null || !resp.IsSuccessStatusCode)
            return null;
        var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (TrailerYoutubeSearchResilience.LooksLikeYoutubeQuotaExceeded(body) ||
            !TrailerYoutubeSearchResilience.TryParseJsonDocument(body, out var doc) || doc is null)
            return null;
        using (doc)
        {
            if (!doc.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array ||
                items.GetArrayLength() == 0)
                return null;
            var first = items[0];
            if (!first.TryGetProperty("contentDetails", out var cd))
                return null;
            if (!cd.TryGetProperty("relatedPlaylists", out var rp))
                return null;
            if (!rp.TryGetProperty("uploads", out var up) || up.ValueKind != JsonValueKind.String)
                return null;
            return up.GetString();
        }
    }

    private async Task<(IReadOnlyList<YoutubeVideoCandidate> Videos, bool QuotaExceeded)> FetchFromChannelSearchAsync(
        string apiKey,
        OfficialTrailersChannelProvider.OfficialChannelEntry channel,
        CancellationToken ct)
    {
        var http = _httpFactory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(45);

        var publishedAfter = DateTime.UtcNow.AddDays(-YoutubeFetchPublishedAfterDays)
            .ToString("yyyy-MM-dd'T'HH:mm:ss.fffZ");
        var trustTier = channel.TrustTier;
        var list = new List<YoutubeVideoCandidate>();
        string? pageToken = null;

        try
        {
            for (var page = 0; page < YoutubeSearchMaxPages; page++)
            {
                var url =
                    "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date" +
                    $"&maxResults={YoutubeSearchMaxResults}" +
                    $"&channelId={Uri.EscapeDataString(channel.ChannelId)}" +
                    $"&publishedAfter={Uri.EscapeDataString(publishedAfter)}" +
                    $"&key={Uri.EscapeDataString(apiKey)}";
                if (!string.IsNullOrEmpty(pageToken))
                    url += $"&pageToken={Uri.EscapeDataString(pageToken)}";

                using var resp = await TrailerYoutubeSearchResilience.TrySendGetWithRetriesAsync(
                        http, url, TrailerYoutubeSearchResilience.DefaultUserAgent, maxAttempts: 5,
                        perAttemptTimeout: TimeSpan.FromSeconds(18), ct)
                    .ConfigureAwait(false);
                if (resp == null)
                {
                    _log.LogWarning("Trailers ingestion channel fetch no response channel={Channel}", channel.Name);
                    return (list, false);
                }

                var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                if (TrailerYoutubeSearchResilience.LooksLikeYoutubeQuotaExceeded(body))
                    return (list, true);

                if (!resp.IsSuccessStatusCode)
                {
                    _log.LogWarning("Trailers ingestion channel fetch failed channel={Channel} status={Status}",
                        channel.Name, (int)resp.StatusCode);
                    return (list, false);
                }

                if (string.IsNullOrWhiteSpace(body) || !TrailerYoutubeSearchResilience.TryParseJsonDocument(body, out var doc) ||
                    doc is null)
                    return (list, false);

                using (doc)
                {
                    pageToken = null;
                    if (doc.RootElement.TryGetProperty("nextPageToken", out var npt) &&
                        npt.ValueKind == JsonValueKind.String)
                        pageToken = npt.GetString();

                    if (!doc.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
                        return (list, false);

                    foreach (var item in items.EnumerateArray())
                    {
                        var videoId = item.TryGetProperty("id", out var idEl) &&
                                      idEl.TryGetProperty("videoId", out var vidEl)
                            ? vidEl.GetString()
                            : null;
                        if (string.IsNullOrWhiteSpace(videoId) || videoId!.Length != 11)
                            continue;

                        var snippet = item.TryGetProperty("snippet", out var sn) ? sn : default;
                        var title = snippet.ValueKind != JsonValueKind.Undefined && snippet.TryGetProperty("title", out var tEl)
                            ? tEl.GetString()?.Trim()
                            : null;
                        if (string.IsNullOrWhiteSpace(title))
                            continue;

                        var channelName = snippet.ValueKind != JsonValueKind.Undefined &&
                                          snippet.TryGetProperty("channelTitle", out var cEl)
                            ? cEl.GetString()?.Trim()
                            : channel.Name;
                        var channelId = snippet.ValueKind != JsonValueKind.Undefined &&
                                        snippet.TryGetProperty("channelId", out var cidEl)
                            ? cidEl.GetString()?.Trim()
                            : channel.ChannelId;

                        var published = DateTime.UtcNow;
                        if (snippet.ValueKind != JsonValueKind.Undefined &&
                            snippet.TryGetProperty("publishedAt", out var pEl) &&
                            DateTime.TryParse(pEl.GetString(), out var p))
                            published = DateTime.SpecifyKind(p, DateTimeKind.Utc).ToUniversalTime();

                        list.Add(new YoutubeVideoCandidate(
                            videoId,
                            title!,
                            string.IsNullOrWhiteSpace(channelName) ? channel.Name : channelName!,
                            string.IsNullOrWhiteSpace(channelId) ? channel.ChannelId : channelId!,
                            published,
                            channel.Priority,
                            trustTier,
                            "yt_search_fallback",
                            channel.MediaFocus));
                    }
                }

                if (string.IsNullOrEmpty(pageToken))
                    break;
            }

            _log.LogInformation("Trailers ingestion channel={Channel} fetched={Count}", channel.Name, list.Count);
            return (list, false);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Trailers ingestion channel fetch exception channel={Channel}", channel.Name);
            return (list, false);
        }
    }

    private async Task<TmdbDiscoverItem?> TryDiscoverMovieAsync(
        TmdbClient tmdb,
        string searchQuery,
        (string CleanTitle, int? Year) parsed,
        YoutubeVideoCandidate c,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(searchQuery))
            return null;

        var years = new List<int?>();
        if (parsed.Year is { } y)
            years.Add(y);
        years.Add(null);
        var minRatio = TrailerMatchScorer.MinTitleRatioFor(c.TrustTier);

        foreach (var releaseYear in years)
        {
            var movieId = await RetryNullableAsync(() => tmdb.TryFindMovieIdBySearchAsync(searchQuery, releaseYear, ct), ct)
                .ConfigureAwait(false);
            if (movieId is not > 0)
                continue;
            var d = await RetryDiscoverAsync(tmdb, movieId.Value, "Movie", ct).ConfigureAwait(false);
            if (d == null)
                continue;
            if (!TrailerMatchScorer.TitleLikelyMatches(parsed.CleanTitle, d.Title, minRatio, c.TrustTier))
                continue;
            if (!TrailerMatchScorer.YearGate(parsed.Year, d.ReleaseDate, c.TrustTier))
                continue;
            return d;
        }

        return null;
    }

    private async Task<TmdbDiscoverItem?> TryDiscoverTvAsync(
        TmdbClient tmdb,
        string searchQuery,
        (string CleanTitle, int? Year) parsed,
        YoutubeVideoCandidate c,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(searchQuery))
            return null;

        var years = new List<int?>();
        if (parsed.Year is { } y)
            years.Add(y);
        years.Add(null);
        var minRatio = TrailerMatchScorer.MinTitleRatioFor(c.TrustTier);

        foreach (var firstAirYear in years)
        {
            var tvId = await RetryNullableAsync(() => tmdb.TryFindTvIdBySearchAsync(searchQuery, firstAirYear, ct), ct)
                .ConfigureAwait(false);
            if (tvId is not > 0)
                continue;
            var d = await RetryDiscoverAsync(tmdb, tvId.Value, "Series", ct).ConfigureAwait(false);
            if (d == null)
                continue;
            if (!TrailerMatchScorer.TitleLikelyMatches(parsed.CleanTitle, d.Title, minRatio, c.TrustTier))
                continue;
            if (!TrailerMatchScorer.YearGate(parsed.Year, d.ReleaseDate, c.TrustTier))
                continue;
            return d;
        }

        return null;
    }

    private static IReadOnlyList<string> BuildTmdbSearchQueries(string cleaned)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var list = new List<string>();

        void TryAdd(string? s)
        {
            var v = Regex.Replace(s ?? "", @"\s+", " ").Trim();
            if (v.Length < 2 || !seen.Add(v))
                return;
            list.Add(v);
        }

        TryAdd(cleaned);
        var noArticle = Regex.Replace(cleaned, @"^(the|a|an)\s+", "", RegexOptions.IgnoreCase).Trim();
        TryAdd(noArticle);

        var lastColon = cleaned.LastIndexOf(':');
        if (lastColon > 0 && lastColon < cleaned.Length - 2)
        {
            TryAdd(cleaned[(lastColon + 1)..].Trim());
            TryAdd(cleaned[..lastColon].Trim());
        }

        foreach (var sep in new[] { " – ", " - ", " — " })
        {
            var i = cleaned.IndexOf(sep, StringComparison.Ordinal);
            if (i <= 0)
                continue;
            TryAdd(cleaned[..i].Trim());
            TryAdd(cleaned[(i + sep.Length)..].Trim());
        }

        foreach (var seg in cleaned.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            TryAdd(seg);

        return list.OrderByDescending(s => s.Length).Take(10).ToList();
    }

    private static (string CleanTitle, int? Year) NormalizeAndParseCandidateTitle(string raw)
    {
        var text = raw.Trim();
        int? year = null;
        var ym = Regex.Match(text, @"\b(19\d{2}|20\d{2})\b");
        if (ym.Success && int.TryParse(ym.Groups[1].Value, out var y))
            year = y;

        text = Regex.Replace(text, @"(?i)\btrailer\s*#?\s*[2-9]\b", " ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"(?i)\b#shorts?\b", " ");
        text = Regex.Replace(text,
            @"(?i)\b(only\s+on\s+)?(prime\s*video|amazon\s*studios|amazon\s*mgm(\s+studios?)?|disney\+|disney\s*plus|apple\s*tv\+?|netflix|hulu|peacock|hbo\s*max|hbo|max\s*originals?|\bmax\b)\b",
            " ");
        text = Regex.Replace(text, @"(?i)\b(s\d{1,2})\s*(e\d{1,2})\b", " ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\[[^\]]+\]", " ");
        text = Regex.Replace(text, @"\([^\)]*\)", " ");
        text = Regex.Replace(text, @"(?i)\b(4k|uhd|hdr|blu-?ray|remaster|hd)\b", " ");
        text = Regex.Replace(text, @"(?i)\bofficial\b", " ");
        text = Regex.Replace(text, @"(?i)\bfinal\b", " ");
        text = Regex.Replace(text, @"(?i)\bteaser\b", " ");
        text = Regex.Replace(text, @"(?i)\btrailer\b", " ");
        text = Regex.Replace(text, @"(?i)\b(movie|film|series|season)\b", " ");
        text = Regex.Replace(text, @"[|:,\-–—]", " ");
        text = Regex.Replace(text, @"\s+", " ").Trim();
        return (text, year);
    }

    private static async Task<T?> RetryNullableAsync<T>(Func<Task<T?>> fn, CancellationToken ct) where T : struct
    {
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            var r = await fn().ConfigureAwait(false);
            if (r != null)
                return r;
            if (attempt < 3)
                await Task.Delay(120 * attempt + Random.Shared.Next(30, 90), ct).ConfigureAwait(false);
        }

        return null;
    }

    private static async Task<TmdbDiscoverItem?> RetryDiscoverAsync(TmdbClient tmdb, int id, string mediaType,
        CancellationToken ct)
    {
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            var d = await tmdb.TryGetDiscoverItemAsync(id, mediaType, ct).ConfigureAwait(false);
            if (d != null)
                return d;
            if (attempt < 3)
                await Task.Delay(100 * attempt + Random.Shared.Next(20, 80), ct).ConfigureAwait(false);
        }

        return null;
    }
}

public sealed record TrailerIngestionRunResult(
    int FetchedCount,
    int FilteredCount,
    int FilteredOutCount,
    int MatchedCount,
    int InsertedOrUpdatedCount,
    string? Error,
    bool QuotaStopped,
    int PurgedCount,
    int SkippedDedupCount,
    int UnmatchedCount = 0,
    int UploadsFetchedCount = 0,
    int SearchFetchedCount = 0,
    int ChannelsPolled = 0,
    bool FallbackSearchUsed = false,
    int NewUploadsSeenCount = 0);
