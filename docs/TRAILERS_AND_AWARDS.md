## Trailers + Awards — how they work

This doc explains how the **Trailers** and **Awards** features are wired end-to-end in Pitflix (UI → API → TMDB/local data), including the caching rules and the key files to edit.

---

## Trailers

### What the user sees (UI)

- **Home “Latest trailers” row**: cards that open an in-app trailer player modal.
  - UI: `Pitflix.UI/src/features/home/LatestTrailersSection.tsx`
  - Modal: `Pitflix.UI/src/components/trailers/TrailerModal.tsx`
- **Trailers browse page**: tabs for Latest / Upcoming, optional type filter, plus TMDB search.
  - UI: `Pitflix.UI/src/pages/TrailersPage.tsx`
  - API client: `Pitflix.UI/src/api/homeDiscover.ts`

Trailer thumbnail rule in UI:
- Prefer `backdropUrl` from API.
- Else fall back to YouTube thumbnail: `https://img.youtube.com/vi/<youtubeKey>/hqdefault.jpg`.

Trailer playback rule in UI (`TrailerModal`):
- Tries YouTube `<iframe>` embed.
- If embedding fails (some environments block it), shows a fallback and opens YouTube externally.

### API endpoints (backend)

Defined as minimal APIs in `Pitflix.API/Program.cs`:

- `GET /api/home/trailers`
  - Purpose: “Home row” feed (small list; currently returns up to 8 cards).
  - Uses TMDB to build a “latest-ish” candidate pool, then resolves trailer clips for candidates.

- `GET /api/trailers/browse?mode=...&filter=...&search=...`
  - Purpose: browse page feed.
  - Query params:
    - `mode`: `latest | upcoming-movies | upcoming-tv | all-upcoming`
    - `filter`: `movie | tv | all`
    - `search`: when length ≥ 2, TMDB search replaces the discover pool (still respects filter)

UI calls:
- Home: `getLatestTrailers()` → `GET /home/trailers`
- Browse: `browseTrailers(mode, filter, search)` → `GET /trailers/browse`

### How the API builds trailer cards

Core helper: `Pitflix.API/Services/TrailersFeedHelpers.cs`

High level flow:

1) **Build a candidate pool (TMDB discover/trending)**
- “Latest” pool is designed to feel current:
  - trending (week)
  - now playing / on the air
  - discover pages with release/first-air date in a rolling window (default: last 4 months)
  - window filter is handled by `LatestTrailerMonthsWindow` and `FilterLatestTrailerReleaseWindow(...)`

2) **Rank & de-dupe**
- `RankTrailerCandidatePool(...)` groups by `mediaType:id` and keeps the row with the highest `vote_count`.
- Orders by `vote_count` so more “popular” titles get trailer slots first.

3) **Resolve clips per title**
- `CollectTrailersForItemsAsync(...)` calls TMDB per candidate:
  - `TryGetTrailerAndTeaserClipsAsync(...)` → returns trailer/teaser clips (YouTube keys).
  - `GetArtworkPathsAsync(...)` (optional) for a `backdropUrl`.
- Dedupe is `mediaType:tmdbId:youtubeKey` so the same clip isn’t emitted twice.
- Output shape returned by the API matches `TrailerCard` in `Pitflix.UI/src/api/homeDiscover.ts`:
  - `tmdbId`, `mediaType`, `title`, `posterUrl`, `backdropUrl`, `youtubeKey`, `trailerTitle`, optional `releaseDate`

### Common “why does this look like that?” notes

- **Why “Latest” can show trailers + teasers**: TMDB may list both; the API emits both as separate cards.
- **Why upcoming uses “today or future”**: `IsUpcomingForTrailerPool(...)` allows today to avoid empty lists when TMDB uses near-term dates.

---

## Awards

### What the user sees (UI)

- **Awards catalog page** (`/awards`): list of award providers (Oscars, Emmys, …).
  - UI: `Pitflix.UI/src/pages/AwardsPage.tsx`
  - API client: `Pitflix.UI/src/api/awards.ts`
- **Award hub page** (`/awards/:awardId`): chooses an award year (tiles).
  - UI: `Pitflix.UI/src/pages/AwardHubPage.tsx`
- **Edition page** (`/awards/:awardId/:year`): categories + nominees, with posters/backdrops and “Open on TMDB” when available.
  - UI: `Pitflix.UI/src/pages/AwardEditionPage.tsx`

### Data sources (backend)

Awards are **curated local JSON**, optionally enriched with TMDB:

- Catalog metadata:
  - `Pitflix.API/Data/Awards/catalog.json`
  - Contains award id/name/subtitle/accent and optional TMDB image path fragments:
    - `cardPosterPath`, `heroBackdropPath`, and optional ceremony branding `eventPosterPath` / `eventBackdropPath`

- Editions (one file per year):
  - `Pitflix.API/Data/Awards/editions/<award-id>/<year>.json`
  - Contains categories + nominees.
  - Nominee entries can include `tmdbId`; if missing, the API can attempt to resolve it via TMDB search.

Provider implementation:
- `Pitflix.API/Services/Awards/FileAwardsDataProvider.cs` loads the JSON files.
- `IAwardsDataProvider` exists so additional providers can be added behind the same service.

### API endpoints (backend)

Defined in `Pitflix.API/Program.cs`:

- `GET /api/awards/catalog`
  - Returns `{ awards: AwardCatalogCardDto[] }`
- `GET /api/awards/{awardId}/years`
  - Returns `{ years: number[] }` from the edition JSON filenames
- `GET /api/awards/{awardId}/year-tiles`
  - Returns `{ tiles: { year, label?, posterUrl? }[] }`
- `GET /api/awards/{awardId}/{year}`
  - Returns an enriched `AwardEditionResponseDto` or 404

UI calls (from `Pitflix.UI/src/api/awards.ts`):
- `getAwardsCatalog()`
- `getAwardYears(awardId)`
- `getAwardYearTiles(awardId)`
- `getAwardEdition(awardId, year)`

### How awards images work (and why there are multiple URL types)

Pitflix prefers **same-origin images** (served from `Pitflix.API`) because embedded webviews (Tauri) can block direct `image.tmdb.org` loads.

There are three relevant image strategies:

1) **Local on-disk cache served by the API**
- Cache root: `%LocalAppData%/Pitflix/Images` via `Pitflix.Core/Services/ImageCacheService.cs`
- File → URL mapping: `Pitflix.API/ImageUrls.cs` maps cached files to `http://<api>/images/...`
- Awards cache folder: `%LocalAppData%/Pitflix/Images/awards-cache/...`
  - File naming rules: `Pitflix.API/Services/Awards/AwardsImageCache.cs`
  - Nominee filenames are a SHA256-based hash of `"{categoryId}:{title}"` (first 8 bytes → 16 hex chars)

2) **API proxy for TMDB images (same-origin URL, remote bytes)**
- `GET /api/img/tmdb?size=<token>&file=<filename>`
- Used as a safe fallback URL when you can’t (or don’t want to) write images to disk.

3) **Direct TMDB URLs**
- Used mainly in the trailers feature, and as a last-resort fallback in awards (when caching/proxy isn’t used).

### How award caching/enrichment is populated

Awards service:
- `Pitflix.API/Services/Awards/AwardsService.cs`

Catalog cards (`/api/awards/catalog`):
- Reads `catalog.json`
- Resolves image URLs by:
  - checking local cache first (same-origin `/images/...`)
  - if missing, attempts to download TMDB art into the awards cache
  - if download fails, falls back to the same-origin proxy URL (`/api/img/tmdb?...`)

Edition pages (`/api/awards/{awardId}/{year}`):
- Reads the year JSON from `Data/Awards/editions/...`
- For each nominee:
  - if `tmdbId` is missing and TMDB is configured, the API attempts to resolve it via TMDB search
  - if poster/backdrop aren’t cached yet, the API tries to fetch artwork paths from TMDB and download them into the awards cache
  - if caching fails, returns a proxy URL to TMDB
- Hero art:
  - tries to use year-level cached files (`<year>-poster.jpg`, `<year>-backdrop.jpg`)
  - if missing, picks a strong nominee (Best Picture winner or first TMDB-backed row) and uses its artwork

Offline/pre-cache script (optional but recommended for best UX):
- `scripts/cache_award_posters.py`
  - Downloads catalog art + edition nominee art into `%LocalAppData%/Pitflix/Images/awards-cache/`
  - Must keep hashing consistent with `AwardsImageCache.NomineeFileBase(...)`
  - Can optionally backfill `tmdbId` values into edition JSON (`--write-tmdb-ids`)

---

## “Where do I change X?”

- **Change trailers ranking/window**: `Pitflix.API/Services/TrailersFeedHelpers.cs` (`LatestTrailerMonthsWindow`, ranking logic)
- **Add a new award provider**: add an entry to `Pitflix.API/Data/Awards/catalog.json`, and create `editions/<award-id>/<year>.json`
- **Change award JSON schema**: `Pitflix.API/Services/Awards/AwardsContracts.cs` (and update the UI types in `Pitflix.UI/src/api/awards.ts`)
- **Fix award images not loading in Tauri**: prefer cached `/images/...` or proxy `/api/img/tmdb` URLs (awards already does this)

