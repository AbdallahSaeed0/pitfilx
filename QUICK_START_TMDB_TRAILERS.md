# Quick Start: TMDB Native Trailers

## Enable the Feature (2 minutes)

### Option 1: appsettings.json

Add to your `appsettings.json`:

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

### Option 2: Environment Variables

```bash
# Linux/Mac
export PITFLIX_TRAILERS_ENABLETMDBNATIVE=true
export PITFLIX_TRAILERS_TMDBNATIVEPUBLISHEDAFTERDAYS=14

# Windows PowerShell
$env:PITFLIX_TRAILERS_ENABLETMDBNATIVE="true"
$env:PITFLIX_TRAILERS_TMDBNATIVEPUBLISHEDAFTERDAYS="14"
```

## What It Does

When enabled during trailer ingestion:

1. ✅ Fetches recently-released movies (last 6 months) and TV (last 3 months) from TMDB
2. ✅ Extracts their YouTube trailers with publication dates
3. ✅ Filters to only trailers published in last N days (default: 14)
4. ✅ For TV: Ensures first-air date is within 6 months (prevents old show trailers)
5. ✅ Deduplicates with YouTube channel sources
6. ✅ Best quality trailer per title wins
7. ✅ Persists to database

## Configuration Presets

### Strict (This Week Only)
```json
{"TmdbNativePublishedAfterDays": 3}
```
Only trailers published in the last 3 days.

### Balanced (Last 2 Weeks)
```json
{"TmdbNativePublishedAfterDays": 14}
```
Trailers from this week and last week.

### Lenient (Last Month)
```json
{"TmdbNativePublishedAfterDays": 30}
```
Broader window for more trailers.

## Verify It's Working

### Check Logs

After a trailer ingestion run (scheduled or manual), look for:

```
TMDB native trailer discovery starting: looking for trailers published after [timestamp]
TMDB native trailer discovery: fetched X trailers, filtered to Y with recent publications
Trailers ingestion: added Y TMDB native trailers to matched pool (total matched: Z)
```

### Check Database

Query trailers with source "tmdb_native":

```sql
SELECT VideoId, Title, IngestionSource, PublishedAtUtc, QualityScore
FROM Trailers
WHERE IngestionSource = 'tmdb_native'
ORDER BY PublishedAtUtc DESC
LIMIT 10;
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No TMDB trailers appearing | Verify `EnableTmdbNative=true` in config. Check logs for errors. |
| Too many old trailers | Decrease `TmdbNativePublishedAfterDays` from 14 to 7 or 3. |
| Same trailer from YouTube and TMDB | Normal! Quality score determines winner. Higher = better. |
| TMDB API errors | Ensure TMDB API key is valid and has quota remaining. |
| Performance issues | TMDB discovery adds ~20 API calls per run. If too slow, disable temporarily. |

## Real-World Example

**Configuration:**
```json
{
  "EnableTmdbNative": true,
  "TmdbNativePublishedAfterDays": 7
}
```

**Result on 2026-04-29:**

Discovers:
- ✅ "Inside Out 3" trailer (published 2026-04-25, released 2026-06-14)
- ✅ "Deadpool & Wolverine" teaser (published 2026-04-22, released 2026-07-26)
- ✅ "The Last of Us Season 2" trailer (published 2026-04-27, aired 2026-04-15)
- ❌ "The Office" - no recent trailer (show older than 6 months)
- ❌ Old trailer (published 2026-04-15) - outside 7-day window
- ❌ Video without publication date - skipped

Per-title winner (if also in YouTube channel):
- If official trailer has higher recency score → use that one
- Otherwise → use YouTube channel version

## Code Location

- **Implementation**: `Pitflix.API/Services/Trailers/TmdbNativeTrailerDiscovery.cs`
- **TMDB Method**: `Pitflix.Core/Api/TmdbClient.cs` → `GetLatestTmdbTrailersAsync()`
- **Integration**: `Pitflix.API/Services/Trailers/TrailerIngestionService.cs`
- **Docs**: `TMDB_NATIVE_TRAILERS.md`

## What's New in the Code

### New TMDB Client Method
```csharp
// Get latest trailers from TMDB with YouTube links and publication dates
var trailers = await tmdbClient.GetLatestTmdbTrailersAsync(cancellationToken);
```

### New Discovery Service
```csharp
// Discover and filter latest trailers
var discovery = new TmdbNativeTrailerDiscovery(logger);
var items = await discovery.DiscoverLatestAsync(tmdbClient, publishedCutoff, ct);
```

### Integration in Ingestion Service
```csharp
// Automatically included when EnableTmdbNative=true
// Runs during normal trailer ingestion workflow
// Gracefully handles errors (continues with YouTube-only if disabled)
```

## Next Steps

1. ✅ Add config to `appsettings.json`
2. ✅ Restart API service
3. ✅ Trigger trailer ingestion (manually or wait for scheduled run)
4. ✅ Check logs for "TMDB native discovery" entries
5. ✅ Verify database has new trailers with `IngestionSource = 'tmdb_native'`
6. ✅ Enjoy latest trailers automatically! 🎬

## Questions?

- Check `TMDB_NATIVE_TRAILERS.md` for detailed docs
- Review `IMPLEMENTATION_NOTES.md` for architecture details
- Check application logs for "TMDB native" entries
- Verify TMDB API key and rate limits
