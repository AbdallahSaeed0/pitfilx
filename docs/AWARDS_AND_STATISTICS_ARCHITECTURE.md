# Awards and Statistics Architecture

This document explains how awards data and watch statistics are produced in Pitflix, from storage to API to UI.

## Awards

### Data source and shape

- Awards are curated JSON files in `Pitflix.API/Data/Awards`.
- `catalog.json` defines providers/cards (name, subtitle, styling, and optional artwork pointers).
- Yearly editions live under `editions/<award-id>/<year>.json` and contain categories/nominees.

### Backend flow

- Endpoints are in `Pitflix.API/Program.cs` under `/api/awards/*`.
- `Pitflix.API/Services/Awards/FileAwardsDataProvider.cs` loads raw awards JSON.
- `Pitflix.API/Services/Awards/AwardsService.cs` enriches payloads and normalizes output contracts.
- Contracts used by API/UI are in `Pitflix.API/Services/Awards/AwardsContracts.cs`.

### Artwork behavior

- Preferred path is local/same-origin image URLs for desktop-webview stability.
- Cache + path logic is handled in `Pitflix.API/Services/Awards/AwardsImageCache.cs`.
- Shared image URL mapping/proxy logic uses `Pitflix.API/ImageUrls.cs` and `/api/img/tmdb`.
- If cached artwork is missing, the service can fall back to TMDB-derived image URLs.

### UI consumption

- API client: `Pitflix.UI/src/api/awards.ts`
- Pages:
  - `Pitflix.UI/src/pages/AwardsPage.tsx`
  - `Pitflix.UI/src/pages/AwardHubPage.tsx`
  - `Pitflix.UI/src/pages/AwardEditionPage.tsx`

## Statistics

### What statistics represent

- Library inventory stats (movies, series, episodes, unmatched).
- Watch-state and completion progress.
- Time-based watch stats derived from history/progress events.

### Backend sources

- API endpoints are in `Pitflix.API/Program.cs`:
  - `/api/stats`
  - `/api/stats/watch`
- Core aggregation is done in `Pitflix.Core/Database/LibraryRepository.cs`.
- Playback history is written through:
  - `POST /api/history`
  - `POST /api/history/{id}/progress`
  - `POST /api/history/{id}/stopped`
- These feed derived watch metrics and completion status.

### Ratings and external signals

- Ratings aggregation is handled by `Pitflix.API/Services/RatingsAggregationService.cs`.
- Providers include TMDB baseline plus optional OMDb/PHP IMDb enrichers.
- Stats endpoints focus on internal watch/library signals; ratings are exposed separately via ratings APIs.

### UI consumption

- Stats API clients:
  - `Pitflix.UI/src/api/stats.ts`
  - `Pitflix.UI/src/api/watchStats.ts`
- Stats surfaces:
  - `Pitflix.UI/src/pages/StatsPage.tsx`
  - widgets that query `["stats"]` with React Query

## Operational notes

- Awards are primarily deterministic JSON + enrichment, so failures are usually missing files/ids or image fetch issues.
- Statistics depend on watch-history events; gaps usually come from missing progress/stopped writes.
- When validating changes:
  - check awards endpoints with a known award/year
  - check `/api/stats` and `/api/stats/watch` before/after a short playback session
