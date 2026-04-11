# Pitflix — Current State Audit

**Scope:** Pitflix.UI (Tauri + React) with Pitflix.API (`http://127.0.0.1:5001`), i.e. the stack used with `npm run tauri dev`.

**Audit date:** 2026-03-30 (includes a live API snapshot from that session).

---

## 1. What Is Working End-to-End

Assumptions: Pitflix.API is running, library folders are configured, and TMDB is reachable (via DB setting, `appsettings.local.json`, or `TMDB_API_KEY`).

### Navigation

- Sidebar: Home, Movies, Series, Unmatched, My Lists, Settings; footer chips for movie/series/unmatched counts (from `/api/stats`).
- React Router navigation; poster cards link to `/movie/:id` and `/show/:id`.
- **Scan Library** in the sidebar triggers `/api/scan/start` (empty `folders` ⇒ API uses saved library paths) with scan progress streaming.

### Library & browsing

- **Home:** “Continue Watching” (recent history), “Recently Added” (merged movies + series by `dateAdded`), horizontal rows for movies and series (first page).
- **Movies / Series:** Language (en/ar), debounced search, genre, sort, watch filter, pagination, grid. Movies page: multi-select and bulk “mark completed” via `/api/library/bulk-watch`; favorite heart when a “Favorites” list exists.

### Scanning & matching

- Scan pipeline on the API (`/api/scan/start`, progress + SSE).
- **Unmatched:** Paged list, per-row TMDB suggestions, manual TMDB search, single-item match, skip, post-match **sibling bulk** flow (sequential `POST .../match` for related episode files).

### Playback & history

- **Play** → `/api/play` spawns configured player (`MediaPlayerPath` or `vlc`) and logs history.
- **Continue Watching** data from `/api/history` (API enriches posters with fallbacks).

### Lists

- List CRUD and items; list detail grid. Detail toolbar: watched toggle, Favorites (list name contains `"Favorites"`), “Add to list…”, refresh metadata, “More like this” scroll.

### Detail pages (movie / show)

- Hero, title, year, rating, runtime (movie), genres, overview.
- **Movie:** Play when file path exists; poster/backdrop picker (TMDB images + `POST /api/images/{libraryId}/select`).
- **Show:** Seasons → episodes with play, subtitle hint, per-episode watched (`/api/episodes/{id}//watch`).
- **Cast** row → `/person/:tmdbId` when `personTmdbId > 0`.
- **More like this:** Local library titles by shared genres.

### Settings (UI)

- Library folders, external player (detected + browse + save), scan, refresh artwork, cleanup, remove title by search, clear image cache, watch overview + counts.

### Static assets

- Local image cache under `/images/...` with CORS for dev origins.

### Live snapshot (example session)

- `/api/ping` → `pitflix-api`.
- Example counts from one run: **69** matched movies, **115** matched series, **1984** unmatched (your DB will differ over time).

---

## 2. What Is Broken, Incomplete, or Fragile

### Configuration / product gaps

- **No TMDB API key field in React Settings** — API supports it via `GET/POST /api/settings`; keys must use file, env, or other means. Masked `tmdbApiKey` in JSON can be empty while a file key still works (confusing).
- **Tauri `lib.rs`** only exposes `greet` — real behavior is **web UI + Pitflix.API**, not Rust commands for library/playback.

### Watch progress / Continue Watching

- History includes `estimatedSeconds` / duration fields, but **Home does not pass `startSeconds` to `playFile`** — **resume is not applied** from UI though `/api/play` supports it (VLC/mpv).
- **`historyStopped` is not called from the React app** — **stopped-at / session updates from the UI are not wired**.

### UX / navigation

- **Back:** Only movie/show detail use `navigate(-1)`. Home, Movies, Series, Unmatched, Lists, list detail, Settings, Person have **no page-level back** (sidebar / browser back only).
- **`navigate(-1)`** weak if user opened a URL directly.
- **List detail** title is generic **“List”**; list name not shown; no explicit back.
- **Person:** no back; library posters use raw `<img>` (usually OK if API returns URLs; inconsistent with `MediaImage`).

### Unmatched

- Match failures often **console-only**, little in-UI error text.
- **`POST /api/unmatched/bulk-match` exists** but UI **loops single match** for bulk siblings (works, doesn’t use dedicated endpoint).

### Detail API vs UI

- API returns **crew** for movie/show; **UI shows cast only**, not crew.

### Runtime

- No guarantee of zero crashes from static review; depends on environment and data.

---

## 3. Settings Page — Current State

### Shown

- Watch overview (movies/series: not watched, in progress, watched).
- Library folders: list, Browse, Remove, manual path + Add.
- External player: quick picks, path input, Browse `.exe`, Save player.
- Scan Library, Refresh posters from TMDB, Clean Up Library, Remove specific title, Clear image cache.
- Tiles: matched movies, matched series, unmatched count.

### Buttons

- Intended to call documented API routes; errors surfaced where implemented (timeouts, API down, TMDB).

### Missing vs ideal UX

- **TMDB API key** edit/save in this UI.
- In-app **reset database** (Settings text may refer to manual SQLite deletion).

---

## 4. Detail Page — Current State

### Sections

- Back, hero, metadata, actions, **DetailToolbar**, **Cast**, **More like this**; series adds **Episodes** (above cast).

### Cast

- From API `cast` array. Stale/empty cast possible until **Refresh from TMDB** or metadata sync.

### Episodes (series)

- By season; titles; subtitle hint; Play; watched toggle. Thumbs use **series poster**, not per-episode art.

### Buttons

- Movie **Play** when path exists.
- Toolbar: watched, Favorite, add to list, refresh TMDB, more like this.
- **Back** uses **history** (`navigate(-1)`).

---

## 5. Navigation — Current State

| Question | Answer |
|----------|--------|
| Back on all pages? | **No** — explicit “← Back” on movie/show detail only. |
| Browser history? | **Yes** for normal in-app clicks (React Router). |
| Pages with no dedicated back? | Home, Movies, Series, Unmatched, My Lists, List detail, Settings, Person (rely on sidebar or browser). |

---

## 6. Unmatched Page — Current State

| Area | State |
|------|--------|
| Pagination | **Yes** (`page`, `pageSize=30`, `totalPages` from API). |
| Search | **Yes** (filter + TMDB search + folder hints). |
| Bulk matching | **Yes** for sibling episodes (confirm → per-id match loop). |
| Unmatched count | **Per-database** (example: **1984** on 2026-03-30 snapshot). |

---

## 7. API Endpoints — Reference

### Typically OK when inputs and config are valid

`GET /api/ping`  
`GET /api/movies`, `GET /api/movies/{id}`  
`GET /api/series`, `GET /api/series/{id}`, `GET /api/series/{id}/episodes`  
`POST /api/movies/{id}/watch`, `POST /api/series/{id}/watch`  
`POST /api/library/movies/{id}/refresh-metadata`, `POST /api/library/series/{id}/refresh-metadata`  
`GET /api/unmatched`, `POST /api/unmatched/{id}/match`, `POST /api/unmatched/bulk-match`, `POST /api/unmatched/{id}/skip`, `POST /api/unmatched/search`  
`POST /api/scan/start`, `GET /api/scan/progress`, `POST /api/scan/cancel`, `GET /api/scan/stream`  
`GET /api/history`, `POST /api/history`, `POST /api/history/{id}/stopped`  
`GET/POST /api/lists` (+ items, contains, tmdb-ids, delete item)  
`GET /api/people/{tmdbId}`  
`GET /api/images/{tmdbId}/posters|backdrops`, `POST /api/images/{id}/select`  
`POST /api/library/cleanup`, `POST /api/library/refresh-artwork`, `GET /api/library/title-search`, `DELETE /api/library/movie|show/{id}`  
`POST /api/maintenance/clear-image-cache`  
`POST /api/episodes/{id}/watch`  
`GET/POST /api/settings`, `GET /api/settings/media-player-candidates`, path add/remove, native pick folder/exe  
`GET /api/stats`  
`POST /api/play`, `POST /api/library/bulk-watch`  
Static: `/images/...`; diagnostics: `/api/debug/images`, etc.

### Designed error responses (not necessarily bugs)

- **400:** e.g. scan without TMDB key, no library paths, invalid body.
- **404:** missing entity or image file.
- **409:** scan already running.
- **Unmatched match:** may return **200 JSON** with **`success: false`** (TMDB missing, log not found, pipeline failure).

### TMDB

- If `TmdbClientFactory.Create()` returns null, searches/matches/enrichment degrade — **config/environment**, not missing routes.

---

## Summary

The **Pitflix.UI + Pitflix.API** path is largely complete for browse, scan, match, lists, detail, and external play. Main gaps: **TMDB key not in React Settings**, **resume / stop-time not wired from UI**, and **navigation/polish on list and person sub-pages**.

---

*Generated from codebase review and optional live API checks. Update this file when major features or endpoints change.*
