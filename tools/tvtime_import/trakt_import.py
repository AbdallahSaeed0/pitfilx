"""Imports TV show watch history from a TV Time GDPR export into Trakt, preserving the real
historical watched-at date per episode -- Trakt's `POST /sync/history` supports this natively
(unlike Serializd, which always logs "now").

Auth: reuses the Trakt connection already established via the PitFlix desktop app (Settings ->
Trakt). Client id/secret and the connected user's access/refresh tokens are read straight out of
PitFlix's live SQLite DB (same DB tmdb_match.py already reads TmdbApiKey from) -- no separate
login/device-code flow needed. If a request 401s, this script refreshes the token itself and
writes the new pair back into that DB, so PitFlix and this script never drift out of sync.

Usage:
  python trakt_import.py --dry-run                 # preview matches + payload sizes, no writes
  python trakt_import.py                             # real import (resumable)
  python trakt_import.py --show "The Office (US)"    # just one show, for testing
  python trakt_import.py --retry-errors              # re-attempt only shows that errored
  python trakt_import.py --movies                    # import movies instead of shows
  python trakt_import.py --movies --dry-run          # preview movie matches only
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sqlite3
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

# Windows consoles default to a legacy codepage that mangles non-ASCII show titles on print().
sys.stdout.reconfigure(encoding="utf-8")

import httpx

from tmdb_match import TmdbMatcher, load_pitflix_tmdb_key
from tvtime_parser import load_or_build_movie_cache, load_or_build_show_cache

REPO_ROOT = Path(__file__).resolve().parents[2]
TRAKT_BASE_URL = "https://api.trakt.tv"
TRAKT_REDIRECT_URI = "http://localhost:5280/api/trakt/callback"  # only relevant for the refresh_token grant
CALL_DELAY_SECONDS = 0.3
MAX_RETRIES = 5
MOVIE_BATCH_SIZE = 25


# ── Auth: share PitFlix's own Trakt connection instead of a separate login ──────────────────

def _pitflix_db_path() -> Path | None:
    local_appdata = os.environ.get("LOCALAPPDATA")
    if not local_appdata:
        return None
    db_path = Path(local_appdata) / "Pitflix" / "pitflix.db"
    return db_path if db_path.exists() else None


def load_trakt_credentials() -> dict:
    db_path = _pitflix_db_path()
    if db_path is None:
        raise SystemExit(r"Could not find PitFlix's SQLite DB (%LOCALAPPDATA%\Pitflix\pitflix.db).")

    conn = sqlite3.connect(str(db_path))
    try:
        def setting(key: str) -> str | None:
            row = conn.execute("SELECT Value FROM Settings WHERE Key = ?", (key,)).fetchone()
            return row[0] if row and row[0] else None

        client_id = setting("TraktClientId")
        client_secret = setting("TraktClientSecret")
        row = conn.execute(
            "SELECT AccessToken, RefreshToken, IsConnected FROM TraktSettings WHERE Id = 1"
        ).fetchone()
    finally:
        conn.close()

    if not client_id or not client_secret:
        raise SystemExit("No Trakt Client ID/Secret saved in PitFlix -- add them in Settings -> Trakt first.")
    if not row or not row[2] or not row[0]:
        raise SystemExit("PitFlix is not connected to Trakt -- connect it in Settings -> Trakt first.")

    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "access_token": row[0],
        "refresh_token": row[1],
        "db_path": db_path,
    }


def _save_refreshed_tokens(db_path: Path, access_token: str, refresh_token: str, expires_in: int) -> None:
    """Writes a refreshed token pair back into PitFlix's DB so the desktop app keeps working
    with the same live connection instead of silently drifting out of sync with this script."""
    expires_at = datetime.fromtimestamp(time.time() + expires_in, tz=timezone.utc)
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            "UPDATE TraktSettings SET AccessToken = ?, RefreshToken = ?, TokenExpiresAt = ?, IsConnected = 1 "
            "WHERE Id = 1",
            (access_token, refresh_token, expires_at.strftime("%Y-%m-%dT%H:%M:%S")),
        )
        conn.commit()
    finally:
        conn.close()


class TraktClient:
    def __init__(self, creds: dict):
        self.creds = creds
        self.access_token = creds["access_token"]
        self._refresh_lock = threading.Lock()
        self.session = httpx.Client(
            base_url=TRAKT_BASE_URL,
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={
                "Content-Type": "application/json",
                "trakt-api-version": "2",
                "trakt-api-key": creds["client_id"],
                # Trakt's Cloudflare WAF 403s requests with no User-Agent -- learned this the
                # hard way building PitFlix's own Trakt integration.
                "User-Agent": "Pitflix-TvTimeImport/1.0",
            },
        )

    def _refresh(self) -> None:
        with self._refresh_lock:
            resp = self.session.post("/oauth/token", json={
                "refresh_token": self.creds["refresh_token"],
                "client_id": self.creds["client_id"],
                "client_secret": self.creds["client_secret"],
                "redirect_uri": TRAKT_REDIRECT_URI,
                "grant_type": "refresh_token",
            })
            resp.raise_for_status()
            data = resp.json()
            self.access_token = data["access_token"]
            self.creds["refresh_token"] = data["refresh_token"]
            _save_refreshed_tokens(self.creds["db_path"], data["access_token"], data["refresh_token"],
                                    data["expires_in"])
            print("  (refreshed Trakt access token)")

    def post(self, path: str, json_body: dict) -> httpx.Response:
        resp: httpx.Response | None = None
        refreshed_once = False
        for attempt in range(MAX_RETRIES):
            resp = self.session.post(path, json=json_body,
                                      headers={"Authorization": f"Bearer {self.access_token}"})
            if resp.status_code == 401 and not refreshed_once:
                self._refresh()
                refreshed_once = True
                continue
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 2 ** attempt))
                print(f"    (rate limited, waiting {wait}s...)")
                time.sleep(wait)
                continue
            if resp.status_code >= 500:
                wait = 2 ** attempt
                print(f"    (Trakt {resp.status_code}, retrying in {wait}s...)")
                time.sleep(wait)
                continue
            return resp
        return resp  # last response, caller checks status


# ── TV Time date -> Trakt ISO 8601 ───────────────────────────────────────────────────────────

def to_trakt_iso(raw: str) -> str:
    """TV Time's created_at has shown up as both 'YYYY-MM-DD HH:MM:SS' and full ISO 8601 across
    different export fields -- normalize either to the 'Z'-suffixed form Trakt expects."""
    s = raw.strip()
    if not s:
        raise ValueError("empty timestamp")
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


# ── Payload building + import ────────────────────────────────────────────────────────────────

def build_show_payload(tmdb_id: int, episodes: dict[tuple[int, int], str]) -> tuple[dict, int]:
    """Builds one POST /sync/history body for a whole show: {show ids} + nested seasons/episodes,
    each episode carrying its own watched_at so the real date survives. Specials (season 0) are
    skipped -- their numbering isn't reliably comparable to TMDB's, same call the Serializd
    importer makes."""
    seasons: dict[int, list[dict]] = {}
    skipped_dates = 0
    for (season, ep), watched_at in episodes.items():
        if season == 0:
            continue
        try:
            iso = to_trakt_iso(watched_at)
        except ValueError:
            skipped_dates += 1
            continue
        seasons.setdefault(season, []).append({"number": ep, "watched_at": iso})

    payload = {
        "shows": [{
            "ids": {"tmdb": tmdb_id},
            "seasons": [
                {"number": s, "episodes": sorted(eps, key=lambda e: e["number"])}
                for s, eps in sorted(seasons.items())
            ],
        }]
    }
    episode_count = sum(len(eps) for eps in seasons.values())
    return payload, episode_count


def import_show(client: TraktClient, tmdb_id: int, episodes: dict[tuple[int, int], str]) -> int:
    payload, episode_count = build_show_payload(tmdb_id, episodes)
    if episode_count == 0:
        return 0

    resp = client.post("/sync/history", payload)
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Trakt returned {resp.status_code}: {resp.text[:300]}")

    body = resp.json()
    added_eps = body.get("added", {}).get("episodes", 0)
    not_found = body.get("not_found", {})
    if not_found.get("shows") or not_found.get("episodes"):
        print(f"    Trakt couldn't resolve: {not_found}")
    time.sleep(CALL_DELAY_SECONDS)
    return added_eps


def import_movie_batch(client: TraktClient, entries: list[tuple[int, str]]) -> int:
    """entries: list of (tmdb_id, watched_at_iso) -- one tuple per watch event (a movie watched
    twice appears twice, which Trakt records as two separate history entries, i.e. a rewatch)."""
    payload = {"movies": [{"ids": {"tmdb": tmdb_id}, "watched_at": watched_at} for tmdb_id, watched_at in entries]}
    resp = client.post("/sync/history", payload)
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Trakt returned {resp.status_code}: {resp.text[:300]}")

    body = resp.json()
    added = body.get("added", {}).get("movies", 0)
    not_found = body.get("not_found", {})
    if not_found.get("movies"):
        print(f"    Trakt couldn't resolve: {not_found['movies']}")
    time.sleep(CALL_DELAY_SECONDS)
    return added


def run_movies(args, cache_dir: Path, tmdb_key: str) -> None:
    print("Parsing TV Time movie watch events...")
    events = load_or_build_movie_cache(args.gdpr_dir, cache_dir / "movie_watch_history.json")
    print(f"Found {len(events)} movie watch events.")

    matcher = TmdbMatcher(tmdb_key, cache_dir / "tmdb_movie_map.json", interactive=args.interactive,
                           media_type="movie")
    progress_path = cache_dir / "trakt_movie_progress.json"
    progress: dict[str, str] = load_json(progress_path, {})

    names = sorted({e.name for e in events})
    if args.limit:
        names = names[: args.limit]
    pending_names = {
        n for n in names
        if progress.get(n) != "done" and not (progress.get(n, "").startswith("error") and not args.retry_errors)
    }

    report_rows = []
    resolved: list[tuple[str, int, str]] = []  # (name, tmdb_id, watched_at_iso)
    skipped = 0
    for event in events:
        if event.name not in pending_names:
            continue
        match = matcher.info(f"{event.name} ({event.release_date[:4]})" if event.release_date else event.name)
        # tmdb_match's cache key includes the "(YYYY)" hint when we have one -- re-derive plain
        # name -> match by looking it up the same way every time for this event.
        if match is None:
            if progress.get(event.name) != "unmatched":
                progress[event.name] = "unmatched"
                skipped += 1
                report_rows.append([event.name, "", "", "", "unmatched"])
            continue

        try:
            iso = to_trakt_iso(event.watched_at)
        except ValueError:
            continue

        report_rows.append([event.name, match["title"], match["year"], match["id"], "matched"])
        resolved.append((event.name, match["id"], iso))

    save_json(progress_path, progress)

    done = errored = 0
    if not args.dry_run and resolved:
        client = TraktClient(load_trakt_credentials())
        print(f"Trakt: using PitFlix's connected account.")
        print(f"\nImporting {len(resolved)} movie watch events in batches of {MOVIE_BATCH_SIZE}...")

        for i in range(0, len(resolved), MOVIE_BATCH_SIZE):
            batch = resolved[i:i + MOVIE_BATCH_SIZE]
            batch_names = sorted({name for name, _, _ in batch})
            try:
                added = import_movie_batch(client, [(tmdb_id, iso) for _, tmdb_id, iso in batch])
                for name in batch_names:
                    progress[name] = "done"
                done += len(batch_names)
                print(f"  batch {i // MOVIE_BATCH_SIZE + 1}: {added} watch events added ({len(batch_names)} movies)")
            except Exception as e:
                for name in batch_names:
                    progress[name] = f"error: {e}"
                errored += len(batch_names)
                print(f"  batch {i // MOVIE_BATCH_SIZE + 1} ERROR: {e}")
            save_json(progress_path, progress)

    if args.dry_run:
        report_path = cache_dir / "trakt_movie_match_report.csv"
        with report_path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["tv_time_name", "matched_title", "matched_year", "tmdb_id", "status"])
            writer.writerows(report_rows)
        print(f"\nReview report written to {report_path}")

    print(f"\n{'Preview' if args.dry_run else 'Import'} complete. "
          f"movies_done={done} skipped(unmatched)={skipped} movies_errored={errored} "
          f"(progress saved to {progress_path})")


# ── CLI plumbing (mirrors serializd_import.py) ───────────────────────────────────────────────

def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gdpr-dir", type=Path,
                         default=Path(r"C:\Users\Abd Allah\Downloads\Telegram Desktop\gdpr-data"),
                         help="Path to the extracted TV Time GDPR export folder")
    parser.add_argument("--tmdb-key", help="TMDB API key (defaults to PitFlix's configured key)")
    parser.add_argument("--interactive", action="store_true", help="Confirm ambiguous TMDB matches by hand")
    parser.add_argument("--dry-run", action="store_true", help="Only resolve/print matches, no Trakt writes")
    parser.add_argument("--limit", type=int, help="Only process the first N shows (for testing)")
    parser.add_argument("--show", help="Only process a single show by its exact TV Time name")
    parser.add_argument("--retry-errors", action="store_true", help="Re-attempt shows that errored last run")
    parser.add_argument("--concurrency", type=int, default=3,
                         help="How many shows to import in parallel (default 3). Trakt enforces real rate "
                              "limits (429s) unlike Serializd -- this script backs off and retries "
                              "automatically, but keep this modest.")
    parser.add_argument("--movies", action="store_true",
                         help="Import movies instead of TV shows (separate progress file/cache).")
    args = parser.parse_args()

    if not args.gdpr_dir.exists():
        raise SystemExit(f"GDPR export folder not found: {args.gdpr_dir}")

    cache_dir = args.gdpr_dir / "_import_cache"
    cache_dir.mkdir(exist_ok=True)

    if args.movies:
        tmdb_key = args.tmdb_key or load_pitflix_tmdb_key(REPO_ROOT)
        run_movies(args, cache_dir, tmdb_key)
        return

    print("Parsing TV Time export...")
    shows = load_or_build_show_cache(args.gdpr_dir, cache_dir / "show_watch_history.json")
    print(f"Found {len(shows)} shows with episode watch data.")

    tmdb_key = args.tmdb_key or load_pitflix_tmdb_key(REPO_ROOT)
    # Reuses the exact same match cache Serializd's importer already fully resolved (230/230).
    matcher = TmdbMatcher(tmdb_key, cache_dir / "tmdb_show_map.json", interactive=args.interactive)

    progress_path = cache_dir / "trakt_progress.json"
    progress: dict[str, str] = load_json(progress_path, {})

    names = sorted(shows.keys())
    if args.show:
        names = [n for n in names if n == args.show]
        if not names:
            raise SystemExit(f"No show named exactly {args.show!r} found in the export.")
    if args.limit:
        names = names[: args.limit]

    client = None
    if not args.dry_run:
        creds = load_trakt_credentials()
        client = TraktClient(creds)
        print(f"Trakt: using PitFlix's connected account (client_id ...{creds['client_id'][-6:]}).")

    report_rows = []
    to_import: list[tuple[str, int]] = []
    skipped = 0
    for name in names:
        status = progress.get(name)
        if status == "done":
            continue
        if status and status.startswith("error") and not args.retry_errors:
            continue

        show = shows[name]
        match = matcher.info(name)
        season_summary = ", ".join(f"S{s}:{len(eps)}ep" for s, eps in sorted(show.seasons.items()))

        if match is None:
            progress[name] = "unmatched"
            skipped += 1
            report_rows.append([name, "", "", "", season_summary, "unmatched"])
            continue

        tmdb_id = match["id"]
        print(f"{name} -> tmdb:{tmdb_id}  [{season_summary}]")
        report_rows.append([name, match["title"], match["year"], tmdb_id, season_summary, "matched"])
        to_import.append((name, tmdb_id))

    save_json(progress_path, progress)

    done = errored = 0
    total_episodes = 0
    if not args.dry_run and to_import:
        progress_lock = threading.Lock()
        print(f"\nImporting {len(to_import)} shows to Trakt with concurrency={args.concurrency}...")

        def worker(name: str, tmdb_id: int):
            try:
                count = import_show(client, tmdb_id, shows[name].episodes)
                return name, count, None
            except Exception as e:
                return name, 0, str(e)

        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            futures = [pool.submit(worker, name, tmdb_id) for name, tmdb_id in to_import]
            for future in as_completed(futures):
                name, count, error = future.result()
                with progress_lock:
                    if error is None:
                        progress[name] = "done"
                        done += 1
                        total_episodes += count
                        print(f"  done: {name} ({count} episodes)")
                    else:
                        progress[name] = f"error: {error}"
                        errored += 1
                        print(f"  ERROR: {name}: {error}")
                    save_json(progress_path, progress)

    if args.dry_run:
        report_path = cache_dir / "trakt_match_report.csv"
        with report_path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["tv_time_name", "matched_title", "matched_year", "tmdb_id", "seasons", "status"])
            writer.writerows(report_rows)
        print(f"\nReview report written to {report_path}")

    print(f"\n{'Preview' if args.dry_run else 'Import'} complete. "
          f"done={done} skipped(unmatched)={skipped} errored={errored} episodes_added={total_episodes} "
          f"(progress saved to {progress_path})")


if __name__ == "__main__":
    main()
