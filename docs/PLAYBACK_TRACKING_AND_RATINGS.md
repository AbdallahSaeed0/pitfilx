# Playback Time Tracking and Ratings (IMDb + Rotten Tomatoes)

This document explains:

- how playback time tracking is connected to the media player
- how ratings from IMDb and Rotten Tomatoes are handled

Paths below are relative to the repo root.

## 1) Playback time tracking connected to the media player

### High-level flow

1. User starts playback from UI via `usePlayback`.
2. UI creates a watch-history row in API (`POST /api/history`) and receives `historyId`.
3. Player opens (built-in `/player` route + Tauri `player2_*`, or external player fallback).
4. During playback, UI periodically sends progress (`POST /api/history/{id}/progress`).
5. On close/end, UI sends final stop (`POST /api/history/{id}/stopped`) with final position.
6. Backend stores `EstimatedSeconds`, marks near-end as completed, and updates movie/episode watch status.

### Where playback starts

- `Pitflix.UI/src/hooks/usePlayback.ts`
  - Calls `addHistory(...)` before opening playback.
  - Computes resume position from:
    - previous history rows (`estimatedSeconds`)
    - optional preferred resume
  - Sets `startSeconds` when resume is meaningful.
  - For built-in player, navigates to `/player` and passes `historyId`, media context, and resume state.
  - For external API `/play` mode, registers a focus listener and calls `historyStopped(...)` when app regains focus.

### Player-side progress and stop writes

- `Pitflix.UI/src/pages/PlayerPage.tsx`
  - Every 10 seconds, sends `postHistoryProgress(historyId, { positionSeconds, durationSeconds, markWatching: true })`.
  - On user exit, end, or normal external-close paths:
    - calls `postHistoryProgress(...)` (best-effort final progress)
    - calls `historyStopped(historyId, { stoppedAt, positionSeconds })`
  - Has cleanup fallback on unmount to still send `historyStopped(...)` if final stop was not already handled.

### API endpoints used by player tracking

- `Pitflix.API/Program.cs`
  - `POST /api/history` -> creates a watch history row.
  - `POST /api/history/{id}/progress` -> authoritative progress updates.
  - `POST /api/history/{id}/stopped` -> final stop + optional final position.

### How backend stores progress and completion

- `Pitflix.Core/Database/LibraryRepository.cs`
  - `UpdateWatchHistoryProgressAsync(...)`
    - updates `FileDurationSeconds` (if provided)
    - updates `EstimatedSeconds` to max known progress
    - marks item completed when progress reaches 90% of duration
    - applies "Watching" state after 60s when not near end
  - `FinalizeWatchHistoryStoppedWithPositionAsync(...)`
    - stores final stop timestamp and position
    - marks completed using the same 90% rule
  - `UpdateWatchHistoryAfterReturnAsync(...)`
    - fallback mode when only session duration is known (no explicit position)

## 2) IMDb and Rotten Tomatoes ratings handling

### High-level rating strategy

Ratings are aggregated by `RatingsAggregationService` with tiered providers:

1. TMDB anchor data (base metadata + vote average/count + IMDb id when available)
2. IMDb score preferred from bundled PHP IMDb grabber (if available)
3. OMDb used for:
   - Rotten Tomatoes critics/audience values
   - IMDb fallback when PHP source is unavailable

Main file: `Pitflix.API/Services/RatingsAggregationService.cs`

### Backend ratings API

- `Pitflix.API/Program.cs`
  - `GET /api/ratings/aggregate?tmdbId=...&mediaType=movie|tv`
    - maps media type (`tv` -> `Series`, otherwise `Movie`)
    - returns combined rating payload
  - `GET /api/ratings/episode?tvTmdbId=...&season=...&episodeNumber=...`
    - episode rating path (TMDB first, then OMDb IMDb fallback)

### IMDb handling details

- Tier 1: `Pitflix.API/Services/PhpImdbGrabberClient.cs`
  - Runs bundled `External/php-imdb-detail/fetch_rating.php` via PHP CLI.
  - Returns `rating` and `votes` if successful.
  - Fails softly (timeout/script/php missing) so pipeline can continue.

- Tier 2 fallback: `Pitflix.API/Services/OmdbRatingClient.cs`
  - Can query by IMDb id (`i=tt...`) or title/year/type fallback.
  - If aggregate has no IMDb score yet, service uses OMDb `imdbRating` + `imdbVotes`.
  - Rating source is tagged (`php-imdb-detail` or `omdb`) for UI transparency.

### Rotten Tomatoes handling details

- Rotten Tomatoes values come from OMDb parsing:
  - Critics (Tomatometer) from `Ratings[]` source `"Rotten Tomatoes"` or `tomatoMeter`.
  - Audience from `tomatoUserMeter`.
- Parsed in `OmdbRatingClient.ParseOmdbTitleDocument(...)`.
- Exposed as:
  - `rottenTomatoesCritics`
  - `rottenTomatoesAudience`

### Caching and resiliency

- `RatingsAggregationService` caches aggregate responses in memory by `(mediaType, tmdbId)`.
- Cache duration:
  - shorter when OMDb is configured but unresolved
  - longer when resolved
- Service logs non-fatal provider failures and still returns partial results when possible.

### Frontend ratings display

- API client: `Pitflix.UI/src/api/ratings.ts`
- UI renderer: `Pitflix.UI/src/components/RatingsPanel.tsx`
  - shows provider chips (TMDB, IMDb, Rotten Tomatoes, Audience)
  - includes source label for IMDb (`php-imdb-detail` vs `OMDb`)
- Used in detail pages:
  - `Pitflix.UI/src/pages/DetailPage.tsx` for movies and shows

## 3) Configuration needed for ratings

- `Pitflix.API/appsettings.local.EXAMPLE.json`
  - `Pitflix:OmdbApiKey` for OMDb access (required for Rotten Tomatoes fields and OMDb fallback paths)
  - optional `PhpExecutable` and `PhpImdbDetailScript` overrides for PHP IMDb tier

If OMDb is not configured, app still returns TMDB baseline and may include IMDb only when PHP tier succeeds.
