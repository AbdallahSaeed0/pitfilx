# TV Time → PitFlix / Trakt / Serializd import — progress notes

Goal: import the user's TV Time watch history (what was watched, when) into three places:
**PitFlix (skipped for now)**, **Trakt (not started)**, **Serializd (done)**.

## Source data

- GDPR export from TV Time, requested via https://gdpr.tvtime.com/gdpr/self-service (email support@tvtime.com, subject "GDPR Data Request" if needed again).
- Extracted to: `C:\Users\Abd Allah\Downloads\Telegram Desktop\gdpr-data\` (68 CSV files).
- The authoritative **per-episode watch-event log with real dates** is `tracking-prod-records-v2.csv` (TV shows) — one row per watch/rewatch event, `key` column prefixed `watch-episode-` or `rewatch-episode-`, has `series_name`, `season_number`, `episode_number`, `created_at`. Covers 230 distinct shows, 2019-08-31 to present.
- Movie watch events are in `tracking-prod-records.csv`, filtered to `type == "watch" && entity_type == "movie"` (not yet used — PitFlix/Trakt work hasn't started).
- `user_tv_show_data.csv` (`is_followed`, `nb_episodes_seen`) was used to find "haven't started" shows (39 of them, followed but zero episodes watched — saved to `_import_cache/havent_started.txt`, added to Serializd manually by the user).
- No TMDB IDs anywhere in the export — everything is matched by title (+ year hint when TV Time appends one, e.g. `"Titans (2018)"`).

## Tooling built — `F:\PitFilx-app\tools\tvtime_import\`

Python venv at `.venv\` (already has `httpx`, `pydantic`, `serializd-py` installed — `pip install -r requirements.txt` if rebuilding).

- **`tvtime_parser.py`** — parses `tracking-prod-records-v2.csv` into `{show_name: {(season, episode): earliest_watched_at}}`. Reusable for Trakt/PitFlix importers too.
- **`tmdb_match.py`** — title → TMDB TV id matching with an on-disk cache (`_import_cache/tmdb_show_map.json`), year-hint-aware, confidence flagging, `--interactive` mode. **Reads PitFlix's live TMDB API key from its SQLite settings table** (`%LOCALAPPDATA%\Pitflix\pitflix.db`, table `Settings`, key `TmdbApiKey`) — NOT from `appsettings.local.json`, which has a dead/invalid key. Falls back to the JSON file only if the DB read fails.
- **`serializd_import.py`** — the main CLI, several modes (all resumable via JSON progress files in `_import_cache/`):
  - `--dry-run` — preview matches only, writes `_import_cache/match_report.csv` for review.
  - (default) — real import: `log_seasons` for complete seasons, `log_episodes` for partial ones. Progress: `serializd_progress.json`.
  - `--topup-episodes [--force] [--concurrency N]` — additionally logs every watched episode individually via `log_episodes` (see "Serializd quirks" below for why this matters). Progress: `serializd_topup_progress.json`.
  - `--rebuild-episodes` — sequential unlog-then-relog of every episode (diagnostic tool, superseded by the unlog-all + fresh-topup approach below).
  - `--unlog-all` — fully clears every watched mark (season + episode level), no relog. Progress: `serializd_unlog_all_progress.json`.
  - `--show "Exact Name"` / `--limit N` — scope to one show or first N, for testing.
  - `--retry-errors` — re-attempt only shows marked `error:` in the relevant progress file.

## Matching results (final)

- 230 distinct shows total in TV Time export.
- 202 auto-matched with reasonable confidence on the first pass.
- 22 unmatched (mostly Egyptian/Arabic shows TMDB doesn't have under romanized names) + 6 confirmed-wrong auto-matches (`80 Grand`, `6 Months`, `Whistle`, `Without Warning`, `The Art Of War`, `Monster (2022)`) = 28 needed manual review.
- Built a **temporary in-app review page** for this (see "PitFlix app changes" below) — user resolved all 28 through it. Final: **230/230 matched**.
- Match cache lives at `_import_cache/tmdb_show_map.json` — `{show_name: {"id": tmdb_id, "title": ..., "year": ..., "confidence": "high"|"low"|"manual"} | null}`. `null` = permanently skipped.

## PitFlix app changes (still in the repo — meant to be temporary, not yet removed)

- `Pitflix.API\Endpoints\TvTimeReviewEndpoints.cs` — `GET /api/tvtime-review/unmatched`, `POST /api/tvtime-review/match`. Reads/writes `tmdb_show_map.json` directly (hardcoded path to the gdpr-data cache dir). Registered in `Program.cs`.
- `Pitflix.UI\src\pages\TvTimeReviewPage.tsx` + `src\api\tvtimeReview.ts` — route `/tvtime-review`. Reuses the existing `/api/unmatched/search` endpoint for TMDB search.
- `.claude\launch.json` was created for `preview_start` (Pitflix.UI on port 4173).
- **All of this should be deleted once the whole TV Time import project is done** — it was explicitly scoped as temporary.
- Note: PitFlix's own history import (writing to its `WatchHistory` table with a real historical date) was **not built** — the existing `/api/history/mark-watched` endpoint always stamps `DateTime.UtcNow`, no historical-date field exists yet on `UnifiedWatchBody`/`RecordUnifiedWatchAsync`. User chose to skip this for now.

## Serializd — full status: DONE (imported), stats display was the whole saga

- Library: unofficial `serializd-py` (`pip install git+https://github.com/Velocidensity/serializd-py`), only supports watched-logging (`log_seasons`, `log_episodes`, `unlog_*`), **no watchlist/status API at all** — "want to watch"/"currently watching" list features aren't scriptable this way.
- Serializd has **no way to set a historical watched date** — everything logs as "now". Movies aren't tracked by Serializd at all (TV only).
- Session token cached at `_import_cache/serializd_token.json` (email/password prompted interactively at login, never passed through chat).

### The "Episodes watched" stat mystery (resolved)

Long debugging saga — condensed lesson in case Trakt has similar surprises:
1. First import used `log_seasons` (bulk, whole season) for complete seasons + `log_episodes` for partial ones. Worked (0 errors), but Serializd's profile "Episodes watched" stat only showed a small fraction of the true total.
2. Verified repeatedly that **individual writes always work correctly** (isolated tests on fresh, never-touched shows landed exactly right every time — proven 3+ times).
3. Verified repeatedly that **re-sending already-logged data is a true no-op** (`--force` full re-run changed nothing).
4. Verified **unlog reliably decrements** the real per-episode state (confirmed via `/episode_log/remove`).
5. Root cause eventually found: **the profile stat card has significant caching/async lag** — it does NOT update live. Checking immediately after an operation gives a stale reading; this caused hours of chasing a phantom bug. Once actually given time to catch up, numbers matched expectations closely (a checkpoint test hit ~503 estimated vs 514 actual shown).
6. Fix applied: `--unlog-all` (full clean slate, all 230 shows, season+episode level) → then a **fresh, sequential, log_episodes-only pass** (`--topup-episodes --force --concurrency 1`, skipping `log_seasons` entirely this time) → verified against real Serializd numbers mid-run, confirmed accurate.
7. One-off edge case found: some shows have a Serializd-known **season 0 (specials)** or a season not present in the TV Time data (e.g. "The Umbrella Academy" S4) that can keep a show flagged "Watched" even after unlogging the seasons we know about — check `client.get_show(tmdb_id).seasons` for the full season list if this recurs.
8. **As of this note being written, the final full fresh-relog pass is running in the background** (`--topup-episodes --force --concurrency 1`) to completion across all 230 shows. Check `_import_cache/serializd_topup_progress.json` for done/error counts (target 230), and verify the real "Episodes watched" number on serializd.com **after waiting a bit for the cache to catch up** — don't judge immediately.

## Trakt — NOT STARTED

- User explicitly chose to skip Trakt earlier in this project ("Skip Trakt for now").
- Trakt DOES support historical `watched_at` dates via `POST /sync/history` (unlike Serializd) — this is the one target where the "when" data can actually be preserved.
- Needs: a free Trakt API app (client ID/secret) — user has NOT created one yet. Sign up at https://trakt.tv/oauth/applications/new. OAuth device-code flow is the clean approach (no redirect URI needed, user visits trakt.tv/activate).
- `tvtime_parser.py` (show/episode data) and the movie-parsing logic sketched from `tracking-prod-records.csv` (`type=="watch" && entity_type=="movie"`, fields `movie_name`, `created_at`, `release_date`, `runtime`) are ready to reuse for a Trakt importer — movies were never actually imported anywhere yet (Serializd doesn't support them).
- TMDB ID matching (`tmdb_match.py`) is reusable as-is for Trakt too (Trakt's `sync/history` accepts `{"ids": {"tmdb": ...}}`).

## Key gotchas for the next chat

- The sandbox blocks installing packages from GitHub URLs / running some destructive-looking commands (killing processes by broad image name, unlogging live data) without explicit user confirmation each time — expect to ask before big automated write operations against a real third-party account.
- `taskkill /IM python.exe` (by image name) gets blocked — always kill by specific PID (`wmic process where "name='python.exe'" get ProcessId,CommandLine` to find the right one).
- Don't combine a manual `&` background with the tool's own `run_in_background` — it double-detaches and you lose log visibility (happened once, harmless but confusing).
- PitFlix.API must be restarted after backend code changes — it locks its own `.exe`, so `dotnet build` fails to copy until the running instance is stopped first.
