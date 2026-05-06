# Pitflix Trailers System

## Overview

The Pitflix trailers system automatically discovers and ingests the latest movie and TV show trailers from TMDB. It prioritizes recency and quality, ensuring users always see truly new content without manual searching.

## How It Works

### Automatic Discovery Pipeline

The system uses a multi-source approach to discover trailers:

```
1. TMDB Sources (Parallel Fetch)
   ├─ Recent movies (last 6 months)
   ├─ Trending movies (weekly)
   ├─ Recent TV (last 3 months)
   ├─ Trending TV (weekly)
   ├─ On-the-air TV (new seasons broadcasting/streaming)
   └─ Popular TV (catches shows with new season trailers)

2. Deduplication
   └─ Remove duplicate TMDB IDs from multiple sources

3. Video Extraction
   └─ Fetch YouTube video metadata from TMDB for each title

4. Recency Filtering
   ├─ Trailer published date (must be within last 14 days by default)
   └─ Media release/first-air date (TV shows must be recent, ~6 months max)

5. Quality Scoring
   ├─ Recency weight (40% if <1 day old, 30% if <7 days, etc.)
   ├─ Video type (Trailer > Teaser > Clip)
   └─ Popularity (vote count from TMDB)

6. Persistence
   └─ Store in SQLite database for app display
```

### Key Features

✅ **Automatic**: No manual title searches needed  
✅ **Comprehensive**: Fetches 1,300+ candidates, filters to recent ones  
✅ **Multi-source**: Catches new content across trending, popular, and on-the-air lists  
✅ **Smart Filtering**: Ensures trailers are genuinely recent (not old series with old trailers)  
✅ **Quality-first**: Deduplicates and ranks trailers by quality score  
✅ **Independent**: Runs separately from YouTube API, unaffected by quota limits  

## Configuration

### Enable/Disable TMDB Native Discovery

In `appsettings.json`:

```json
"Pitflix": {
  "Trailers": {
    "EnableTmdbNative": true,                    // Enable TMDB native discovery
    "TmdbNativePublishedAfterDays": 14           // Trailers published in last N days
  }
}
```

### TMDB API Key

The system needs a TMDB API key (free from https://www.themoviedb.org/settings/api):

**Resolution order:**
1. Database `Settings` table (`TmdbApiKey`)
2. `appsettings.local.json` → `"TmdbApiKey": "..."`
3. Environment variable `TMDB_API_KEY`

### Performance Tuning

```json
"Pitflix": {
  "Trailers": {
    "PollIntervalMinutes": 120,                  // How often to run ingestion
    "TmdbNativePublishedAfterDays": 14,          // Recency window for trailers
    "InactiveRetentionDays": 90                  // Keep trailers for N days
  }
}
```

## What Gets Discovered

### Sources
- **Recent Movies**: Released in last 6 months
- **Popular Movies**: Trending movies (re-releases, special editions, etc.)
- **Recent TV**: First aired in last 3 months
- **Popular TV**: Currently trending shows (catches new seasons of established shows)
- **On-the-Air TV**: Shows currently broadcasting/streaming (new seasons)

### Filtering
- **By Publication Date**: Only trailers published in last 14 days (configurable)
- **By Media Age**: TV shows must have first-air date within last ~6 months (prevents old long-running shows)
- **By Video Type**: Only Trailer, Teaser, or Clip types
- **By Deduplicate**: One trailer per TMDB ID (best quality wins)

### Results

**Example run:**
```
Fetched: 1,316 trailers from all TMDB sources
Filtered: 76 with recent publication dates
Matched: 76 trailers ready for display
Inserted: 21 new/updated to database
Skipped: 55 already in database (deduplication)
```

## Ingestion Process

### Endpoint
```
POST /api/trailers/ingest
```

### Response Example
```json
{
  "ok": true,
  "matchedCount": 76,
  "insertedOrUpdatedCount": 21,
  "skippedDedupCount": 55,
  "quotaStopped": false,
  "error": null
}
```

### Automatic Scheduling
- Runs every 120 minutes (configurable)
- Processes independently of YouTube API
- Logs all activities for debugging

## Troubleshooting

### No trailers discovered?

1. **Check TMDB API key**
   ```csharp
   // Verify in database or settings
   // ResolvedTmdbApiKey should not be null
   ```

2. **Check EnableTmdbNative setting**
   ```json
   "EnableTmdbNative": true  // Must be true
   ```

3. **Check logs for errors**
   ```
   "TMDB native trailer discovery failed"
   "TMDB client is null"
   ```

### Duplicate key errors (FIXED)
- **Previous issue**: Fetching from multiple sources caused duplicate TMDB IDs
- **Solution**: System now deduplicates before processing
- **Status**: ✅ Fixed in latest commit

### Trailers not showing in UI?

1. Check `HomeTrailersLatestCore` endpoint filtering:
   - `freshTrailerCutoffUtc` = 21 days
   - `recentReleaseCutoff` = 75 days
   
2. Trailers older than 21 days won't show unless media released recently

## Database Schema

### TrailerItems Table
```sql
CREATE TABLE TrailerItems (
    Id INTEGER PRIMARY KEY,
    VideoId TEXT UNIQUE,              -- YouTube video ID
    YoutubeUrl TEXT,                  -- Full YouTube URL
    Title TEXT,                       -- Video title
    ChannelName TEXT,                 -- "TMDB" for native discovery
    ChannelId TEXT,                   -- "tmdb-native" for native discovery
    IngestionSource TEXT,             -- "tmdb_native" for this system
    MatchConfidence REAL,             -- 0.95 for TMDB native
    TrustTier INTEGER,                -- 1 for TMDB native (high trust)
    TmdbId INTEGER,                   -- TMDB movie/TV ID
    MediaType TEXT,                   -- "Movie" or "Series"
    PublishedAtUtc TEXT,              -- Trailer publish date
    QualityScore REAL,                -- Computed quality score (0-1)
    IsActive INTEGER,                 -- 1 if active
    CreatedAtUtc TEXT,                -- When added to database
    UpdatedAtUtc TEXT                 -- Last update time
);

-- Key indexes for performance
CREATE INDEX IX_TrailerItems_PublishedAtUtc ON TrailerItems(PublishedAtUtc DESC);
CREATE INDEX IX_TrailerItems_TmdbId_MediaType_PublishedAtUtc ON TrailerItems(TmdbId, MediaType, PublishedAtUtc DESC);
CREATE INDEX IX_TrailerItems_IsActive_PublishedAtUtc ON TrailerItems(IsActive, PublishedAtUtc DESC);
```

## Code Structure

### Key Files
- **`Pitflix.Core/Api/TmdbClient.cs`**
  - `GetLatestTmdbTrailersAsync()` - Fetches from all TMDB sources
  - `DiscoverPopularTvAsync()` - Popular TV discovery
  - `GetOnTheAirTvAsync()` - On-the-air TV discovery

- **`Pitflix.API/Services/Trailers/TmdbNativeTrailerDiscovery.cs`**
  - `DiscoverLatestAsync()` - Main discovery orchestration
  - `ComputeQualityScore()` - Quality scoring logic

- **`Pitflix.API/Services/Trailers/TrailerIngestionService.cs`**
  - `IngestAsync()` - Main ingestion pipeline
  - Early TMDB native execution before YouTube processing

### Quality Score Calculation
```csharp
Score = RecencyWeight(40%) + VideoTypeWeight(30%) + PopularityWeight(15%)

RecencyWeight:
  ≤ 1 day   → 0.40
  ≤ 7 days  → 0.35
  ≤ 14 days → 0.30
  ≤ 30 days → 0.20
  > 30 days → 0.10

VideoTypeWeight:
  Trailer → 0.30
  Teaser  → 0.20
  Clip    → 0.10

PopularityWeight: min(voteCount / 100, 1.0) * 0.15
```

## Performance Characteristics

- **Parallel fetching**: All TMDB sources fetched concurrently
- **Efficient deduplication**: Single `.DistinctBy()` pass
- **Batch processing**: All videos fetched in parallel for speed
- **Typical execution**: ~5-10 seconds for full discovery cycle

## Future Enhancements

- [ ] User preference for trailer recency window
- [ ] Integration with other trailer sources (IMDb, Rotten Tomatoes)
- [ ] Manual trailer selection UI
- [ ] Trailer quality metadata (1080p, 4K, etc.)
- [ ] Language-specific trailer discovery
- [ ] Analytics on trailer views/clicks

## Support

For issues or questions about the trailer system:

1. Check logs: `Trailers ingestion:` prefix in application logs
2. Enable trace logging for specific titles in config
3. Test TMDB API key: Verify it's valid on TMDB website
4. Check database: Query `TrailerItems` table for discovered trailers
