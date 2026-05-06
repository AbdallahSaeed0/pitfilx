# TMDB Native Trailer Discovery

## Overview

The TMDB Native Trailer Discovery feature fetches the **latest trailers directly from TMDB** instead of relying only on YouTube channel uploads. This ensures you get truly recent trailers for movies and TV shows that were recently released or aired.

### Key Benefits

- **Recency-First**: Filters by trailer publication date, not just media release date
- **TV-Smart**: Avoids old long-running series by checking first-air dates (max 6 months old for TV)
- **Deduplication**: Prevents duplicate trailers by video ID
- **Quality-Focused**: Prioritizes trailers over teasers, and recent over old
- **Complementary**: Works alongside YouTube channel polling (doesn't replace it)

## Configuration

Add these settings to your `appsettings.json` or environment variables to enable TMDB native trailer discovery:

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

### Settings Explained

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `EnableTmdbNative` | `false` | bool | Enable/disable TMDB native trailer discovery |
| `TmdbNativePublishedAfterDays` | `14` | 1-90 | Only include trailers published within the last N days |

### Environment Variables

You can also use environment variables (higher precedence):

```bash
# Enable TMDB native trailers
export PITFLIX_TRAILERS_ENABLETMDBNATIVE=true

# Only include trailers from last 7 days
export PITFLIX_TRAILERS_TMDBNATIVEPUBLISHEDAFTERDAYS=7
```

## How It Works

### Discovery Process

1. **Fetch Recent Content** from TMDB:
   - Movies: Released in the last 6 months (sorted by popularity)
   - TV Shows: First aired in the last 3 months (sorted by popularity)
   - Fetches up to 3 pages of each for comprehensive coverage

2. **Extract YouTube Trailers**:
   - For each title, queries TMDB's `/videos` endpoint
   - Extracts all YouTube videos with type: Trailer, Teaser, or Clip
   - **Requires `published_at` timestamp** (only videos with publication dates are included)

3. **Apply Recency Filters**:
   - Trailer must be published within the last N days (configurable, default 14)
   - For TV series: First-air date must be within 6 months (prevents old shows)
   - Deduplicates by video ID

4. **Calculate Quality Score** (0.0-1.0):
   - **Recency weight (0.40 max)**: Most important
     - Published ≤1 day ago: 0.40
     - Published ≤7 days ago: 0.35
     - Published ≤14 days ago: 0.30
     - Published ≤30 days ago: 0.20
     - Published >30 days ago: 0.10
   - **Type weight (0.30 max)**:
     - "Trailer" type: 0.30
     - "Teaser" type: 0.20
     - Other types: 0.10
   - **Popularity weight (0.15 max)**: Based on TMDB vote count

5. **Merge with YouTube Sources**:
   - Combined with YouTube channel uploads
   - Per-TMDB-ID deduplication: Keeps the trailer with highest quality score
   - Inserted into database

### Example Flow

```
Input: Today is 2026-04-29, TmdbNativePublishedAfterDays=14

1. Fetch movies released 2025-10-29 → 2026-04-29 (6 months)
2. Fetch TV shows first aired 2026-01-29 → 2026-04-29 (3 months)
   ↓
3. For each title, get YouTube videos from TMDB
   ↓
4. Filter:
   ✓ Trailer "Deadpool & Wolverine - Official Trailer" (published 2026-04-20, 9 days ago)
   ✓ Teaser "Deadpool & Wolverine - Teaser" (published 2026-04-15, 14 days ago)
   ✗ Teaser "Old Clip" (published 2026-02-01, 87 days ago) - too old
   ✗ Clip from 2024 - no published_at date
   ↓
5. Calculate quality scores
   - Official Trailer: recency 0.35 + type 0.30 + popularity 0.10 = 0.75
   - Teaser: recency 0.30 + type 0.20 + popularity 0.08 = 0.58
   ↓
6. Merge with YouTube sources and deduplicate
```

## Recency Guarantees

### Movies

- **Release Date**: Within 6 months
- **Trailer Date**: Customizable window (default 14 days)
- Example: Only trailers published in the last 2 weeks

### TV Series

- **First-Air Date**: Within 3 months of fetch date
- **Series Age Cap**: Maximum 6 months old (filters out long-running shows from seasons past)
- **Trailer Date**: Customizable window (default 14 days)
- Example: "Game of Thrones" won't appear even if an old season has a recent trailer

## Troubleshooting

### No trailers being discovered

1. **Check if enabled**: Verify `EnableTmdbNative=true` in config
2. **Check TMDB API**: Ensure your TMDB API key is valid
3. **Check logs**: Look for "TMDB native trailer discovery" log messages
4. **Verify data**: TMDB's `/videos` endpoint returns videos with `published_at` timestamps

### Too many old trailers

- **Decrease `TmdbNativePublishedAfterDays`**: Change from 14 to 7 or 3
- Example: `TmdbNativePublishedAfterDays=7` only shows trailers from last week

### Duplicates with YouTube sources

- This is expected and handled automatically
- Quality score determines which trailer wins per TMDB ID
- Higher quality (newer, official trailers) are kept

## Performance Notes

- **API Calls**: ~18-20 calls per ingestion run (3 pages × 2 media types + video fetch for each title)
- **Rate Limiting**: Uses same TMDB API key as other features, respects API rate limits
- **Cache**: Existing trailer data is reused; only truly new entries are added
- **DB Impact**: Minimal; only high-quality matches are persisted

## API Integration

### New Methods

#### `TmdbClient.GetLatestTmdbTrailersAsync()`

Fetches latest trailers from recently-released content with full YouTube details.

```csharp
var latestTrailers = await tmdbClient.GetLatestTmdbTrailersAsync(cancellationToken);
// Returns: List<(TmdbId, MediaType, Title, ReleaseDate, VideoKey, VideoName, VideoType, PublishedAtUtc, VoteAverage, VoteCount)>
```

#### `TmdbNativeTrailerDiscovery.DiscoverLatestAsync()`

Main discovery method with optional recency cutoff.

```csharp
var discovery = new TmdbNativeTrailerDiscovery(logger);
var trailers = await discovery.DiscoverLatestAsync(
    tmdbClient,
    trailerPublishedAfterUtc: DateTime.UtcNow.AddDays(-14),
    cancellationToken
);
// Returns: List<TrailerItem> ready for database persistence
```

## Real-World Examples

### Use Case 1: "Latest Trailers" Feed

**Goal**: Show only trailers from last 7 days

```json
{
  "EnableTmdbNative": true,
  "TmdbNativePublishedAfterDays": 7
}
```

Result: Only trailers published in the last week appear, ensuring truly latest content.

### Use Case 2: Weekly Trailer Digest

**Goal**: Trailers from movies/shows released last 1-2 weeks

```json
{
  "EnableTmdbNative": true,
  "TmdbNativePublishedAfterDays": 14
}
```

Result: Comprehensive recent trailers for all newly released content.

### Use Case 3: Conservative (YouTube-Primary)

**Goal**: Use YouTube as primary, TMDB as supplement

```json
{
  "EnableTmdbNative": false
}
```

Result: Feature is disabled; traditional YouTube channel polling continues.

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│ Trailer Ingestion Run                                   │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
   YouTube Channels           TMDB Native Discovery
   • Fetch uploads            • Fetch recent movies (6mo)
   • Search fallback          • Fetch recent TV (3mo)
   • Match to TMDB            • Extract YouTube videos
   • Quality scoring          • Filter by publish date
        │                             │
        └──────────────┬──────────────┘
                       ▼
              Combined Candidates
              (deduped per TMDB ID)
                       │
                       ▼
              Per-TMDB-ID Selection
              (keep highest quality)
                       │
                       ▼
              Database Persistence
              (AddOrUpdate)
                       │
                       ▼
              Purge old inactive
              (retention policy)
```

## Future Enhancements

Possible improvements:

1. **Region-Based Filtering**: Only trailers for your market
2. **Genre-Based Discovery**: Only trailers for genres you care about
3. **Language Variants**: Support multiple language trailers
4. **Manual Priority Queue**: Force certain titles to top of trailer feed
5. **Webhook Notifications**: Alert when trailers for favorite actors drop

## Support

For issues or questions:

1. Check application logs for `TMDB native trailer discovery` entries
2. Verify TMDB API key in configuration
3. Ensure recent movies/shows exist on TMDB (publish within configured window)
4. Review the implementation in `TmdbNativeTrailerDiscovery.cs`
