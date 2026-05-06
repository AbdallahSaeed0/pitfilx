# TMDB Native Trailers - Implementation Summary

## What Was Added

### 1. **New TmdbClient Method** (`Pitflix.Core/Api/TmdbClient.cs`)

Added `GetLatestTmdbTrailersAsync()` method that:
- Fetches movies released in last 6 months (3 pages, by popularity)
- Fetches TV shows first aired in last 3 months (3 pages, by popularity)  
- Extracts YouTube trailer metadata from TMDB's `/videos` endpoint
- Returns tuples containing: TmdbId, MediaType, Title, ReleaseDate, VideoKey, VideoName, VideoType, PublishedAtUtc, VoteAverage, VoteCount
- Only includes videos with explicit `published_at` timestamps (ensures true recency data)
- Deduplicates by video key and sorts by most recent first

**Key insight**: TMDB's `GetYoutubePromosDetailedAsync()` already provides `published_at` timestamps, so we can be truly recency-focused.

### 2. **New Discovery Service** (`Pitflix.API/Services/Trailers/TmdbNativeTrailerDiscovery.cs`)

Encapsulates the discovery logic with:
- `DiscoverLatestAsync()` method that:
  - Uses the new TMDB method to fetch trailers
  - Filters by trailer publication date (configurable cutoff, default 14 days)
  - **For TV series**: Additionally checks first-air date is within 6 months (prevents old long-running shows)
  - Computes quality scores based on recency, type, and popularity
  - Returns `TrailerItem` objects ready for database persistence
- Comprehensive logging for troubleshooting
- Returns empty list on errors (graceful degradation)

**Smart filtering**: The 6-month TV series age cap ensures you don't get old trailers for shows like "The Office" or "Breaking Bad" that have been streaming forever.

### 3. **Integration into TrailerIngestionService** (`Pitflix.API/Services/Trailers/TrailerIngestionService.cs`)

Modified `IngestAsync()` to:
- Check for `Pitflix:Trailers:EnableTmdbNative` config flag (default: false)
- If enabled:
  - Creates `TmdbNativeTrailerDiscovery` instance
  - Fetches latest trailers with configurable publication date cutoff
  - Logs results for monitoring
  - Gracefully handles errors (logs warning, continues with YouTube-only)
- Adds TMDB native trailers to the matched pool
- Per-TMDB-ID deduplication ensures the best quality trailer wins
  - Higher quality scores from newer sources take precedence
  - YouTube official channels still compete fairly

**Design philosophy**: TMDB native discovery is complementary, not replacement. Both sources feed the same deduplication pipeline, so YouTube official channels still have a chance to win if they have higher quality scores.

## Configuration

Enable in `appsettings.json`:

```json
{
  "Pitflix": {
    "Trailers": {
      "EnableTmdbNative": true,
      "TmdbNativePublishedAfterDays": 14
    }
  }
}
```

Or via environment variables:
```bash
PITFLIX_TRAILERS_ENABLETMDBNATIVE=true
PITFLIX_TRAILERS_TMDBNATIVEPUBLISHEDAFTERDAYS=14
```

## How It Ensures "Latest" Trailers

### 1. **Recency-First Filtering**
- Looks at trailer `published_at` date, not media release date
- Configurable window (default 14 days) - set to 3 or 7 for even stricter
- Ensures trailers are actually recent, not old trailers for old media

### 2. **Media Age Filtering (For TV Only)**
- Movies: No age limit (recent trailers for old movies are fine)
- TV: Maximum 6 months old (prevents "The Office" reruns from showing trailers)
- Why? TV shows often have long runs; you want trailers from recent seasons, not ancient ones

### 3. **Publication Date Validation**
- Only includes videos where TMDB has a `published_at` timestamp
- This data comes directly from YouTube's API via TMDB
- Prevents synthetic/undated content

### 4. **Quality-Based Deduplication**
Quality score (0.0-1.0) factors:
- **Recency (40%)**: Most important
  - ≤1 day: 0.40 (highest)
  - ≤7 days: 0.35
  - ≤14 days: 0.30
  - ≤30 days: 0.20
  - >30 days: 0.10
- **Video Type (30%)**: Official trailers preferred
  - Trailer: 0.30
  - Teaser: 0.20
  - Clip: 0.10
- **Popularity (15%)**: Vote count on TMDB
  - Up to 0.15 based on engagement

Example: "Deadpool & Wolverine Official Trailer" (published 1 day ago) gets score ~0.85, beats an older teaser with score ~0.50.

## Files Modified

1. **Pitflix.Core/Api/TmdbClient.cs** - Added GetLatestTmdbTrailersAsync() method (~130 lines)
2. **Pitflix.API/Services/Trailers/TrailerIngestionService.cs** - Integrated TMDB native discovery into ingest pipeline (~20 lines)

## Files Created

1. **Pitflix.API/Services/Trailers/TmdbNativeTrailerDiscovery.cs** - New discovery service (~100 lines)
2. **TMDB_NATIVE_TRAILERS.md** - Comprehensive documentation

## Testing Recommendations

1. **Basic Test**: Enable feature, run ingestion, check logs for "TMDB native discovery" entries
2. **Recency Test**: Set `TmdbNativePublishedAfterDays=3`, verify only 3-day-old trailers appear
3. **TV Filtering Test**: Look for a long-running TV show (The Office, Friends, etc.) - should NOT appear if last season >6mo old
4. **Deduplication Test**: Run with both YouTube and TMDB enabled, verify no duplicate video IDs in database
5. **Graceful Degradation Test**: Disable TMDB API key, verify service logs warning but continues

## Performance Impact

- **API Calls per Run**: ~18-20 (3 movie pages + 3 TV pages + video fetch for each)
- **Database Impact**: Minimal (only new high-quality matches inserted)
- **Memory**: Temporary lists during discovery (GCed after each run)
- **Rate Limiting**: Uses same TMDB API quota as existing features

## Backward Compatibility

✅ **Fully backward compatible**
- Feature is disabled by default (`EnableTmdbNative=false`)
- Existing YouTube channel polling continues unchanged
- No database schema changes
- No API contract changes

## Security

- ✅ No new network endpoints exposed
- ✅ No user input processed (config-only)
- ✅ TMDB API calls use existing authentication
- ✅ No sensitive data logged beyond standard ingestion logs

## Next Steps

1. Enable in development: Set `EnableTmdbNative=true` in local config
2. Test end-to-end: Run trailer ingestion, check UI for latest trailers
3. Adjust `TmdbNativePublishedAfterDays` to your preference:
   - 3-7 days: Very strict (only this week's trailers)
   - 14 days: Balanced (this and last week)
   - 30 days: Lenient (last month's trailers)
4. Monitor logs for "TMDB native" entries
5. Adjust TV series age cap if needed (currently 6 months in code, configurable if needed)

## Architecture Notes

The implementation follows the existing Pitflix trailer pipeline:

```
Discovery Source → Candidates → TMDB Matching → Quality Scoring → Deduplication → Database
```

TMDB Native fits naturally into this pipeline at the "Discovery Source" stage:

```
YouTube Channels ─┐
TMDB Native ──────┼→ Candidates → ... → Database
RSS Feeds ────────┘
```

Per-TMDB-ID deduplication ensures fair competition: if YouTube has an official trailer published yesterday and TMDB has the same trailer but published 3 days ago, the YouTube version (higher recency score) wins.
