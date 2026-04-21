# Pitflix Production Overhaul - Implementation Spec

This is the implementation blueprint for a full upgrade of:

1. trailers ingestion
2. ratings enrichment
3. playback tracking

Scope target:

- low-noise ingestion
- persistent data
- crash-safe tracking
- background automation
- scalable and observable services

## Current baseline (from codebase)

- Trailers are assembled on-demand from TMDB + YouTube RSS/Data API search flows (`TrailersFeedHelpers`, `ScrapedTrailerPoolBuilder`, `YoutubeDataApiTrailerDiscovery`) and are not persisted as a canonical trailer catalog.
- Ratings are aggregated at request time (`RatingsAggregationService`) with memory cache only; no persistent ratings table.
- Playback history uses `WatchHistories` with `EstimatedSeconds`, `FileDurationSeconds`, `StartedAt`, `StoppedAt`; heartbeat currently 10s in `PlayerPage`.
- Background jobs currently exist for scanning only (`LibraryAutoScanService`, `PinnedFolderScanService`).

---

## PHASE 1 - Trailers system (high priority)

## 1.1 Architecture changes

Add a persistent ingestion pipeline:

- **Source adapters**
  - `YoutubeChannelFeedIngestionService` (channel uploads playlist preferred)
  - `YoutubeSearchFallbackIngestionService` (strict query fallback only)
- **Normalization/filtering**
  - `TrailerTitleFilter` (allow/block rules)
  - `TrailerChannelTrustPolicy` (whitelist + priority)
  - `TrailerDedupeService` (video-level + tmdb-level dedupe)
  - `TrailerTmdbMatcher` (fuzzy title + year + media type confidence)
- **Persistence**
  - `TrailerIngestionRepository` for upsert/read
- **Orchestration**
  - `TrailerIngestionBackgroundService` (every 2 hours default; configurable 1-3h)

## 1.2 Database schema

Add table `TrailerItems`:

- `Id` INTEGER PK
- `VideoId` TEXT NOT NULL UNIQUE
- `YoutubeUrl` TEXT NOT NULL
- `Title` TEXT NOT NULL
- `ChannelName` TEXT NOT NULL
- `ChannelId` TEXT NULL
- `TmdbId` INTEGER NOT NULL
- `MediaType` TEXT NOT NULL (`Movie`|`Series`)
- `PublishedAtUtc` TEXT NOT NULL
- `QualityScore` REAL NOT NULL
- `TrustTier` INTEGER NOT NULL (1 official studio, 2 distributor/media, 3 other)
- `IsOfficialChannel` INTEGER NOT NULL
- `MatchConfidence` REAL NOT NULL
- `IngestionSource` TEXT NOT NULL (`yt_channel_uploads`|`yt_search`)
- `CreatedAtUtc` TEXT NOT NULL
- `UpdatedAtUtc` TEXT NOT NULL
- `IsActive` INTEGER NOT NULL DEFAULT 1

Indexes:

- `IX_TrailerItems_TmdbId_PublishedAtUtc`
- `IX_TrailerItems_PublishedAtUtc`
- `IX_TrailerItems_ChannelName`
- unique `VideoId`

Add table `TrailerIngestionRuns`:

- `Id`, `StartedAtUtc`, `FinishedAtUtc`, `Status`, `FetchedCount`, `AcceptedCount`, `RejectedCount`, `ErrorSummary`

Add table `TrailerIngestionRejects`:

- `Id`, `RunId`, `VideoId`, `Title`, `ChannelName`, `ReasonCode`, `CreatedAtUtc`

## 1.3 Official channel whitelist

Create config file `Pitflix.API/Data/Trailers/official-youtube-channels.json`:

- map logical studio name to `channelId`, aliases, and trust tier
- include:
  - Netflix
  - Prime Video
  - Apple TV
  - Warner Bros
  - Universal Pictures
  - Paramount Pictures
  - Sony Pictures Entertainment
  - Marvel Entertainment
  - Disney
  - HBO/Max
  - A24
  - Lionsgate
  - Focus Features
  - 20th Century Studios

## 1.4 Filtering rules (strict)

Allow title only when:

- contains `"official trailer"` OR `"trailer"`

Reject title when contains any:

- `breakdown`, `explained`, `reaction`, `review`, `recap`
- `leak`, `leaked`, `rumor`
- `concept`, `fan made`, `edit`, `shorts`

Implementation details:

- normalize title with lowercase + punctuation collapse
- match blocked terms as token/phrase boundaries
- include reject reason code enum:
  - `missing_trailer_token`
  - `blocked_term`
  - `non_whitelisted_channel`
  - `tmdb_unmatched`
  - `duplicate_lower_quality`

## 1.5 Deduplication and quality scoring

Per TMDB item:

- group by `tmdbId`
- choose by:
  1) highest `TrustTier` (official first)
  2) title quality score (`official trailer` > `trailer #2` > generic)
  3) recency (`PublishedAtUtc`)
  4) resolution/engagement if available

Keep all accepted rows but mark inactive duplicates (`IsActive=0`) to preserve traceability.

## 1.6 TMDB matching

Use dedicated matcher:

- extract candidate title/year from YouTube title
- run TMDB search movie + tv
- compute score from:
  - token overlap
  - release year proximity
  - exact phrase presence
- accept only confidence >= threshold (start 0.72)

Discard unmatched content.

## 1.7 Background job

Add `TrailerIngestionBackgroundService : BackgroundService`:

- delay 2 min on startup
- run every 2 hours (`Pitflix:Trailers:IngestionIntervalMinutes`, bounded 60..180)
- lock single-run via `SemaphoreSlim` in singleton coordinator
- run steps:
  1. fetch from whitelisted channels
  2. filter
  3. match TMDB
  4. dedupe
  5. upsert + mark stale inactive
  6. persist run metrics and rejects

## 1.8 API endpoints

Add endpoints:

- `GET /api/trailers/latest?limit=20&mediaType=both|movie|tv`
  - source: `TrailerItems`
  - sort by `PublishedAtUtc desc`, active only
- `GET /api/trailers/{tmdbId}`
  - return best trailer + alternates for item

Response shape:

- `videoId`, `youtubeUrl`, `title`, `channelName`, `tmdbId`, `mediaType`, `publishedAtUtc`, `qualityScore`

---

## PHASE 2 - Ratings system (automated + persistent)

## 2.1 Architecture changes

Add persistent ratings snapshot model:

- `RatingsSnapshot` (single source of truth for UI/API)
- background enrichment worker + queue
- request path returns persisted values; triggers async refresh if stale

New services:

- `RatingsSnapshotRepository`
- `RatingsEnrichmentService`
- `RatingsRefreshSchedulerService` (BackgroundService)
- `RatingsWorkQueue` (channel-based producer/consumer)

## 2.2 Database schema

Add table `RatingsSnapshots`:

- `Id` PK
- `TmdbId` INTEGER NOT NULL
- `MediaType` TEXT NOT NULL (`Movie`|`Series`)
- `TmdbRating` REAL NULL
- `TmdbVoteCount` INTEGER NULL
- `ImdbRating` TEXT NULL
- `ImdbVotes` TEXT NULL
- `RottenTomatoesCritics` TEXT NULL
- `RottenTomatoesAudience` TEXT NULL
- `RatingsLastUpdatedAtUtc` TEXT NOT NULL
- `RatingsConfidence` REAL NOT NULL
- `ImdbId` TEXT NULL
- `SourceMask` INTEGER NOT NULL (bitmask: TMDB/OMDb/PHP)
- `RefreshTier` TEXT NOT NULL (`hot`,`normal`,`cold`)
- `NextRefreshAtUtc` TEXT NOT NULL
- `CreatedAtUtc` TEXT NOT NULL
- `UpdatedAtUtc` TEXT NOT NULL

Constraint:

- unique `(TmdbId, MediaType)`

Indexes:

- `IX_RatingsSnapshots_NextRefreshAtUtc`
- `IX_RatingsSnapshots_RatingsLastUpdatedAtUtc`

## 2.3 Enrichment triggers

Trigger queue enqueue on:

1. full scan completion
2. pinned scan completion
3. new movie/show added or re-matched
4. manual API trigger: `POST /api/ratings/re-enrich`

Implementation:

- emit domain event from scan pipeline/repository (`CatalogItemMatchedEvent`)
- consume event and enqueue `(tmdbId, mediaType)`

## 2.4 Source priority and behavior

Priority order:

1. TMDB anchor (always)
2. OMDb (IMDb + Rotten Tomatoes preferred)
3. PHP IMDb script fallback only (if OMDb missing IMDb value)

Adjust current behavior:

- move PHP IMDb from first-tier to fallback-only path
- keep OMDb as primary external metadata for IMDb/RT fields

## 2.5 Confidence scoring

Scoring function:

- base 0
- `+0.5` if TMDB vote count > 1000
- `+0.3` if IMDb exists (OMDb or PHP fallback)
- `+0.2` if Rotten Tomatoes critics or audience exists
- clamp to `0..1`

Persist score in `RatingsConfidence`.

## 2.6 Smart refresh

Set `RefreshTier` + `NextRefreshAtUtc`:

- hot/new/popular -> 6-12 hours (default 8h)
- normal -> 24h
- cold/old -> 7d

Tier rules:

- hot if recent release or high user activity/watch history touches
- cold if old + low change probability

## 2.7 API contract

Add endpoint:

- `GET /api/ratings/{tmdbId}?mediaType=movie|tv`

Behavior:

- returns persisted snapshot immediately
- if stale (`now >= NextRefreshAtUtc`) enqueue background refresh (non-blocking)
- include metadata:
  - `isStale`
  - `lastUpdatedAt`
  - `ratingsConfidence`

Guarantee:

- ratings survive rescan because they are not page-fetch artifacts anymore.

---

## PHASE 3 - Playback tracking (accuracy + crash safety)

## 3.1 UI/player changes

`PlayerPage` updates:

- heartbeat interval: from 10s to 5s
- send immediate progress update on seek events (debounced 300ms)
- maintain local checkpoint every 3s:
  - local storage key: `playback_checkpoint:{mediaKey}`
  - payload: `historyId`, `positionSeconds`, `durationSeconds`, `savedAtUtc`, `sessionId`

On player open:

- load checkpoint
- if checkpoint newer/higher than server estimate and reasonable, send reconcile progress call.

## 3.2 Backend schema updates (`WatchHistories`)

Add columns:

- `MaxKnownPositionSeconds` INTEGER NOT NULL DEFAULT 0
- `LastExplicitPositionSeconds` INTEGER NULL
- `LastHeartbeatAtUtc` TEXT NULL
- keep existing `StoppedAt`

Indexes:

- `IX_WatchHistories_FilePath_OpenedAt`
- `IX_WatchHistories_LastHeartbeatAtUtc`

## 3.3 API semantics improvements

`POST /api/history/{id}/progress`:

- updates:
  - `LastExplicitPositionSeconds` = provided position
  - `MaxKnownPositionSeconds` = max(previous, position)
  - `LastHeartbeatAtUtc` = now
- rejects regressions only for explicit position field; maxKnown remains monotonic.

`POST /api/history/{id}/stopped`:

- idempotent by `(historyId, stoppedAt rounded second)` or explicit idempotency token header
- marks terminal state `IsStopFinalized=1` (new bool)
- once finalized, delayed lower progress updates cannot reduce effective position.

## 3.4 Merge and resume logic

For resume candidate by file/media:

- evaluate all rows for same file path (or episode id if available)
- trusted resume position:
  - highest of `MaxKnownPositionSeconds`
  - fallback `EstimatedSeconds`
  - bounded by duration and anti-corruption guards

Do not use "latest row only".

## 3.5 Completion logic edge cases

Keep 90% completion rule and add:

- manual seek-to-end detection:
  - if seek lands within last N seconds and stop follows quickly -> completed
- short content handling:
  - if duration < 300s, completion threshold becomes max(85%, duration-20s)

---

## PHASE 4 - System integration and orchestration

## 4.1 Shared identity model

All systems resolve around:

- `TmdbId`
- `MediaType` (`Movie`/`Series`)
- optional episode id for playback rows

This enables:

- trailers lookup by tmdb
- ratings lookup by tmdb
- playback watch overlays cross-linked to same catalog item

## 4.2 Background jobs orchestration

Add hosted services:

- `TrailerIngestionBackgroundService`
- `RatingsRefreshSchedulerService`

Keep existing:

- `LibraryAutoScanService`
- `PinnedFolderScanService`

Create `BackgroundJobCoordinator` singleton:

- prevents competing heavy jobs
- supports light backpressure (scan -> enqueue ratings; trailers independent cadence)

## 4.3 Logging and observability

Structured logger categories:

- `Pitflix.Trailers.Ingestion`
- `Pitflix.Ratings.Enrichment`
- `Pitflix.Playback.Consistency`

Minimum fields:

- `runId`, `tmdbId`, `mediaType`, `historyId`, `source`, `reason`, `latencyMs`, `result`

Add diagnostics endpoints:

- `GET /api/ops/trailers/last-run`
- `GET /api/ops/ratings/queue-status`
- `GET /api/ops/playback/inconsistencies`

---

## PHASE 5 - Migration and rollout steps

## 5.1 Database migration sequence

1. Create new tables:
   - `TrailerItems`
   - `TrailerIngestionRuns`
   - `TrailerIngestionRejects`
   - `RatingsSnapshots`
2. Alter `WatchHistories` with new tracking columns.
3. Add indexes and unique constraints.
4. Backfill scripts:
   - populate `MaxKnownPositionSeconds = max(EstimatedSeconds, LastExplicitPositionSeconds or 0)`
   - seed `RatingsSnapshots` from current `RatingsAggregationService` for existing catalog in batches.

Use repository-level `Ensure...` methods first (current project pattern), then optionally formal EF migrations in a second hardening pass.

## 5.2 Service registration (`Program.cs`)

Add:

- singleton repositories/services for new domains
- hosted services for trailers + ratings scheduler
- bounded channels for enrichment queues

## 5.3 UI integration points

- Replace detail-page direct aggregate dependency with persisted ratings endpoint:
  - use `GET /api/ratings/{tmdbId}`
- Home/latest trailers pages consume:
  - `GET /api/trailers/latest`
  - `GET /api/trailers/{tmdbId}`
- Player:
  - 5s heartbeat
  - immediate seek flush
  - checkpoint recovery on mount

## 5.4 Edge cases handled

- YouTube quota exceeded -> partial run persisted with run status; retries next cycle.
- Whitelist drift/renamed channels -> aliases + channelId trust mapping.
- Duplicate trailer ids across multiple fetch sources -> unique videoId upsert.
- TMDB mismatch false positives -> confidence threshold and reject log trail.
- OMDb/PHP failures -> retain last known snapshot; mark stale and retry.
- App crash during playback -> checkpoint recovered and reconciled.
- Out-of-order progress/stop calls -> monotonic max position + idempotent stop finalize.

---

## Implementation execution order (recommended)

1. Phase 1 schema + ingestion service + latest/by-tmdb APIs.
2. Phase 2 persistent ratings table + enrichment queue + endpoint swap.
3. Phase 3 playback schema + heartbeat/checkpoint/idempotent finalize.
4. Phase 4 orchestration + diagnostics endpoints + hardening tests.

This order minimizes user-visible regressions while introducing persistence and reliability first.
