using Microsoft.Extensions.Logging;
using Pitflix.Core.Api;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services;

public sealed record RatingsEnrichmentResult(RatingsSnapshot? Snapshot, string? FailureReason);

/// <summary>Phase 2 — builds and persists <see cref="RatingsSnapshot"/> from TMDB (anchor), MDBList (primary external), PHP IMDb (IMDb-only fallback).</summary>
public sealed class RatingsEnrichmentService
{
    private readonly RatingsSnapshotRepository _snapshots;
    private readonly MdbListService _mdbList;
    private readonly PhpImdbGrabberClient _phpImdb;
    private readonly ITmdbClientFactory _tmdbClientFactory;
    private readonly IResolvedApiKeysAccessor _apiKeys;
    private readonly ILogger<RatingsEnrichmentService> _log;

    public RatingsEnrichmentService(
        RatingsSnapshotRepository snapshots,
        MdbListService mdbList,
        PhpImdbGrabberClient phpImdb,
        ITmdbClientFactory tmdbClientFactory,
        IResolvedApiKeysAccessor apiKeys,
        ILogger<RatingsEnrichmentService> log)
    {
        _snapshots = snapshots;
        _mdbList = mdbList;
        _phpImdb = phpImdb;
        _tmdbClientFactory = tmdbClientFactory;
        _apiKeys = apiKeys;
        _log = log;
    }

    /// <summary>Fetches sources, merges by priority, persists one row per <c>(TmdbId, MediaType)</c>.</summary>
    public async Task<RatingsEnrichmentResult> EnrichAndPersistAsync(int tmdbId, string mediaType, CancellationToken ct = default)
    {
        var mt = NormalizeMediaType(mediaType);
        if (mt == null || tmdbId <= 0)
            return new RatingsEnrichmentResult(null, "invalid_input");

        var apiKey = _apiKeys.ResolvedTmdbApiKey;
        var tmdb = _tmdbClientFactory.Create();
        if (tmdb == null || string.IsNullOrEmpty(apiKey))
        {
            _log.LogDebug("Ratings enrichment: TMDB unavailable for {Media} {Id}", mt, tmdbId);
            return new RatingsEnrichmentResult(null, "tmdb_unavailable");
        }

        var anchor = await tmdb.TryGetRatingsAnchorAsync(tmdbId, mt, ct).ConfigureAwait(false);
        if (anchor == null)
            return new RatingsEnrichmentResult(null, "anchor_not_found");

        var imdbId = string.IsNullOrWhiteSpace(anchor.ImdbId) ? null : anchor.ImdbId.Trim();
        if (string.IsNullOrEmpty(imdbId))
        {
            try
            {
                imdbId = await tmdb.TryGetImdbIdAsync(tmdbId, mt, ct).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _log.LogDebug(ex, "Ratings enrichment: external_ids fallback failed for {Media} {Id}", mt, tmdbId);
            }
        }

        var sourceMask = RatingsSourceMask.Tmdb;
        string? imdbRating = null;
        string? imdbVotes = null;
        string? rtCritics = null;
        string? rtAudience = null;

        MdbListRatings? mdbResult = null;
        try
        {
            mdbResult = await _mdbList.GetRatingsAsync(imdbId, tmdbId, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Ratings enrichment: MDBList lookup failed for {Media} {Id}", mt, tmdbId);
        }

        if (mdbResult != null)
        {
            sourceMask |= RatingsSourceMask.Mdblist;
            if (mdbResult.ImdbScore is { } imdbVal)
            {
                imdbRating = imdbVal.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture);
                imdbVotes = mdbResult.ImdbVotes?.ToString(System.Globalization.CultureInfo.InvariantCulture);
            }

            if (mdbResult.RottenTomatoesScore is { } rt)
                rtCritics = rt.ToString("0", System.Globalization.CultureInfo.InvariantCulture) + "%";
            if (mdbResult.RottenTomatoesAudience is { } rta)
                rtAudience = rta.ToString("0", System.Globalization.CultureInfo.InvariantCulture) + "%";
        }

        if (string.IsNullOrWhiteSpace(imdbRating) && !string.IsNullOrEmpty(imdbId))
        {
            try
            {
                var php = await _phpImdb.TryFetchAsync(imdbId, ct).ConfigureAwait(false);
                if (php != null)
                {
                    sourceMask |= RatingsSourceMask.PhpImdb;
                    imdbRating = php.RatingDisplay.Trim();
                    imdbVotes = string.IsNullOrWhiteSpace(php.VoteCountDisplay) ? null : php.VoteCountDisplay.Trim();
                }
            }
            catch (Exception ex)
            {
                _log.LogDebug(ex, "Ratings enrichment: PHP IMDb fallback failed for {Imdb}", imdbId);
            }
        }

        var now = DateTime.UtcNow;
        var (tier, nextRefresh) = ComputeRefreshSchedule(anchor, now);
        var confidence = ComputeConfidence(anchor.VoteCount, imdbRating, rtCritics, rtAudience);

        var row = new RatingsSnapshot
        {
            TmdbId = tmdbId,
            MediaType = mt,
            TmdbRating = anchor.VoteAverage,
            TmdbVoteCount = anchor.VoteCount,
            ImdbRating = imdbRating,
            ImdbVotes = imdbVotes,
            RottenTomatoesCritics = rtCritics,
            RottenTomatoesAudience = rtAudience,
            RatingsLastUpdatedAtUtc = now,
            RatingsConfidence = confidence,
            ImdbId = imdbId,
            SourceMask = sourceMask,
            RefreshTier = tier,
            NextRefreshAtUtc = nextRefresh
        };

        var saved = await _snapshots.AddOrUpdateSnapshotAsync(row, ct).ConfigureAwait(false);
        return new RatingsEnrichmentResult(saved, null);
    }

    private static string? NormalizeMediaType(string mediaType)
    {
        if (string.IsNullOrWhiteSpace(mediaType))
            return null;
        if (mediaType.Equals("Movie", StringComparison.OrdinalIgnoreCase) ||
            mediaType.Equals("movie", StringComparison.OrdinalIgnoreCase))
            return "Movie";
        if (mediaType.Equals("Series", StringComparison.OrdinalIgnoreCase) ||
            mediaType.Equals("tv", StringComparison.OrdinalIgnoreCase))
            return "Series";
        return null;
    }

    /// <summary>Doc 2.5: base 0; +0.5 if TMDB votes &gt; 1000; +0.3 if IMDb present; +0.2 if any RT field present.</summary>
    public static double ComputeConfidence(int? tmdbVoteCount, string? imdbRating, string? rtCritics, string? rtAudience)
    {
        var c = 0.0;
        if (tmdbVoteCount is > 1000)
            c += 0.5;
        if (!string.IsNullOrWhiteSpace(imdbRating))
            c += 0.3;
        if (!string.IsNullOrWhiteSpace(rtCritics) || !string.IsNullOrWhiteSpace(rtAudience))
            c += 0.2;
        return Math.Clamp(c, 0, 1);
    }

    /// <summary>Doc 2.6: hot ~8h, normal 24h, cold 7d (heuristic from votes + title year).</summary>
    public static (string Tier, DateTime NextRefreshUtc) ComputeRefreshSchedule(TmdbRatingsAnchor anchor, DateTime nowUtc)
    {
        var y = anchor.Year ?? 0;
        var votes = anchor.VoteCount ?? 0;
        var currentYear = nowUtc.Year;

        var hot = votes >= 4000 || y >= currentYear - 1;
        var cold = votes < 80 && y > 0 && y <= currentYear - 15;

        if (hot)
            return ("hot", nowUtc.AddHours(8));
        if (cold)
            return ("cold", nowUtc.AddDays(7));
        return ("normal", nowUtc.AddHours(24));
    }
}
