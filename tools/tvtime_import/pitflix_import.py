"""Imports TV show watch history from a TV Time GDPR export into PitFlix's own local stats
(Settings -> Stats), preserving the real historical watched date per episode.

Talks to PitFlix's local API (POST /api/history/mark-watched, with the WatchedAt field added
for this project) -- PitFlix.API must be running on http://127.0.0.1:5280 for this to work.
Reuses the same TMDB match cache Trakt's importer already fully resolved (230/230 shows) and
fetches each show's average episode runtime from TMDB once (cached) so PitFlix's "total watch
time" stat is accurate, not just episode/genre counts.

Usage:
  python pitflix_import.py --dry-run                 # preview matches + payload sizes, no writes
  python pitflix_import.py                             # real import (resumable)
  python pitflix_import.py --show "The Office (US)"    # just one show, for testing
  python pitflix_import.py --retry-errors              # re-attempt shows that errored last run
  python pitflix_import.py --movies                    # import movies instead of shows
  python pitflix_import.py --movies --dry-run          # preview movie matches only
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Windows consoles default to a legacy codepage that mangles non-ASCII show titles on print().
sys.stdout.reconfigure(encoding="utf-8")

import httpx

from tmdb_match import TmdbMatcher, load_pitflix_tmdb_key
from tvtime_parser import load_or_build_movie_cache, load_or_build_show_cache

REPO_ROOT = Path(__file__).resolve().parents[2]
PITFLIX_BASE_URL = "http://127.0.0.1:5280/api"
TMDB_SHOW_DETAILS_URL = "https://api.themoviedb.org/3/tv/{id}"


def to_iso(raw: str) -> str:
    """Same tolerant normalizer as trakt_import.py -- TV Time's created_at has shown up as both
    'YYYY-MM-DD HH:MM:SS' and full ISO 8601."""
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


def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


class RuntimeCache:
    """Show tmdb_id -> average episode runtime in minutes, fetched from TMDB once per show."""

    def __init__(self, tmdb_key: str, cache_path: Path):
        self.tmdb_key = tmdb_key
        self.cache_path = cache_path
        self.client = httpx.Client(timeout=15)
        self.cache: dict[str, int] = load_json(cache_path, {})

    def get(self, tmdb_id: int) -> int:
        key = str(tmdb_id)
        if key in self.cache:
            return self.cache[key]

        # Only cache on a definitive TMDB response -- a network/timeout failure must NOT be
        # cached as "0 minutes", or a transient hiccup permanently poisons this show's runtime
        # (this bit us for real: 124/229 shows cached as 0min during a network interruption).
        try:
            resp = self.client.get(TMDB_SHOW_DETAILS_URL.format(id=tmdb_id), params={"api_key": self.tmdb_key})
        except httpx.HTTPError:
            return 0

        if resp.status_code != 200:
            return 0

        data = resp.json()
        # TMDB deprecated the show-level "episode_run_time" array -- it's always [] now.
        # Actual per-episode runtime lives on the last/next aired episode instead.
        minutes = 0
        runtimes = data.get("episode_run_time") or []
        if runtimes:
            minutes = int(runtimes[0])
        else:
            last_ep = data.get("last_episode_to_air") or {}
            next_ep = data.get("next_episode_to_air") or {}
            minutes = int(last_ep.get("runtime") or next_ep.get("runtime") or 0)

        self.cache[key] = minutes
        save_json(self.cache_path, self.cache)
        return minutes


def mark_episode_watched(client: httpx.Client, tmdb_id: int, title: str, season: int, episode: int,
                          watched_at_iso: str, runtime_minutes: int) -> None:
    resp = client.post("/history/mark-watched", json={
        "tmdbId": tmdb_id,
        "mediaType": "Series",
        "title": title,
        "source": "manual",
        "seasonNumber": season,
        "episodeNumber": episode,
        "runtimeMinutes": runtime_minutes,
        "watchedAt": watched_at_iso,
    })
    resp.raise_for_status()
    body = resp.json()
    if not body.get("success"):
        raise RuntimeError(f"PitFlix rejected the request: {body}")


def import_show(client: httpx.Client, tmdb_id: int, title: str, episodes: dict[tuple[int, int], str],
                 runtime_minutes: int) -> int:
    count = 0
    for (season, ep), watched_at in sorted(episodes.items()):
        if season == 0:
            continue  # specials -- same call as the Trakt importer, numbering isn't reliable
        try:
            iso = to_iso(watched_at)
        except ValueError:
            continue
        mark_episode_watched(client, tmdb_id, title, season, ep, iso, runtime_minutes)
        count += 1
    return count


def mark_movie_watched(client: httpx.Client, tmdb_id: int, title: str, watched_at_iso: str,
                        runtime_minutes: int) -> None:
    resp = client.post("/history/mark-watched", json={
        "tmdbId": tmdb_id,
        "mediaType": "Movie",
        "title": title,
        "source": "manual",
        "runtimeMinutes": runtime_minutes,
        "watchedAt": watched_at_iso,
    })
    resp.raise_for_status()
    body = resp.json()
    if not body.get("success"):
        raise RuntimeError(f"PitFlix rejected the request: {body}")


def run_movies(args, cache_dir: Path, tmdb_key: str, client: httpx.Client) -> None:
    print("Parsing TV Time movie watch events...")
    events = load_or_build_movie_cache(args.gdpr_dir, cache_dir / "movie_watch_history.json")
    print(f"Found {len(events)} movie watch events.")

    # Same cache file and "(YYYY)" query-key convention as trakt_import.py --movies, so both
    # scripts share one resolved match cache instead of re-asking TMDB twice.
    matcher = TmdbMatcher(tmdb_key, cache_dir / "tmdb_movie_map.json", interactive=args.interactive,
                           media_type="movie")
    progress_path = cache_dir / "pitflix_movie_progress.json"
    progress: dict[str, str] = load_json(progress_path, {})

    names = sorted({e.name for e in events})
    if args.limit:
        names = names[: args.limit]
    pending_names = {
        n for n in names
        if progress.get(n) != "done" and not (progress.get(n, "").startswith("error") and not args.retry_errors)
    }

    report_rows = []
    resolved: list[tuple[str, int, str, str, int]] = []  # (name, tmdb_id, title, watched_at_iso, runtime_minutes)
    skipped = 0
    for event in events:
        if event.name not in pending_names:
            continue
        query_key = f"{event.name} ({event.release_date[:4]})" if event.release_date else event.name
        match = matcher.info(query_key)
        if match is None:
            if progress.get(event.name) != "unmatched":
                progress[event.name] = "unmatched"
                skipped += 1
                report_rows.append([event.name, "", "", "", "unmatched"])
            continue

        try:
            iso = to_iso(event.watched_at)
        except ValueError:
            continue

        report_rows.append([event.name, match["title"], match["year"], match["id"], "matched"])
        resolved.append((event.name, match["id"], match["title"], iso, event.runtime_minutes))

    save_json(progress_path, progress)

    done = errored = 0
    if not args.dry_run and resolved:
        print(f"\nImporting {len(resolved)} movie watch events into PitFlix "
              f"(sequential -- local SQLite write safety)...")
        for i, (name, tmdb_id, title, iso, runtime_minutes) in enumerate(resolved, start=1):
            try:
                mark_movie_watched(client, tmdb_id, title, iso, runtime_minutes)
                progress[name] = "done"
                done += 1
                print(f"  [{i}/{len(resolved)}] done: {name} (~{runtime_minutes}min)")
            except Exception as e:
                progress[name] = f"error: {e}"
                errored += 1
                print(f"  [{i}/{len(resolved)}] ERROR: {name}: {e}")
            save_json(progress_path, progress)

    if args.dry_run:
        report_path = cache_dir / "pitflix_movie_match_report.csv"
        with report_path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["tv_time_name", "matched_title", "matched_year", "tmdb_id", "status"])
            writer.writerows(report_rows)
        print(f"\nReview report written to {report_path}")

    print(f"\n{'Preview' if args.dry_run else 'Import'} complete. "
          f"movies_done={done} skipped(unmatched)={skipped} movies_errored={errored} "
          f"(progress saved to {progress_path})")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gdpr-dir", type=Path,
                         default=Path(r"C:\Users\Abd Allah\Downloads\Telegram Desktop\gdpr-data"),
                         help="Path to the extracted TV Time GDPR export folder")
    parser.add_argument("--pitflix-url", default=PITFLIX_BASE_URL, help="PitFlix API base URL")
    parser.add_argument("--tmdb-key", help="TMDB API key (defaults to PitFlix's configured key)")
    parser.add_argument("--interactive", action="store_true", help="Confirm ambiguous TMDB matches by hand")
    parser.add_argument("--dry-run", action="store_true", help="Only resolve/print matches, no PitFlix writes")
    parser.add_argument("--limit", type=int, help="Only process the first N shows (for testing)")
    parser.add_argument("--show", help="Only process a single show by its exact TV Time name")
    parser.add_argument("--retry-errors", action="store_true", help="Re-attempt shows that errored last run")
    parser.add_argument("--movies", action="store_true",
                         help="Import movies instead of TV shows (separate progress file/cache).")
    args = parser.parse_args()

    if not args.gdpr_dir.exists():
        raise SystemExit(f"GDPR export folder not found: {args.gdpr_dir}")

    cache_dir = args.gdpr_dir / "_import_cache"
    cache_dir.mkdir(exist_ok=True)

    client = httpx.Client(base_url=args.pitflix_url, timeout=httpx.Timeout(30.0, connect=10.0))
    if not args.dry_run:
        try:
            client.get("/stats")
        except httpx.HTTPError as e:
            raise SystemExit(f"Could not reach PitFlix.API at {args.pitflix_url} -- is it running? ({e})")

    if args.movies:
        tmdb_key = args.tmdb_key or load_pitflix_tmdb_key(REPO_ROOT)
        run_movies(args, cache_dir, tmdb_key, client)
        return

    print("Parsing TV Time export...")
    shows = load_or_build_show_cache(args.gdpr_dir, cache_dir / "show_watch_history.json")
    print(f"Found {len(shows)} shows with episode watch data.")

    tmdb_key = args.tmdb_key or load_pitflix_tmdb_key(REPO_ROOT)
    matcher = TmdbMatcher(tmdb_key, cache_dir / "tmdb_show_map.json", interactive=args.interactive)
    runtime_cache = RuntimeCache(tmdb_key, cache_dir / "show_runtime_cache.json")

    progress_path = cache_dir / "pitflix_progress.json"
    progress: dict[str, str] = load_json(progress_path, {})

    names = sorted(shows.keys())
    if args.show:
        names = [n for n in names if n == args.show]
        if not names:
            raise SystemExit(f"No show named exactly {args.show!r} found in the export.")
    if args.limit:
        names = names[: args.limit]

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
        print(f"\nImporting {len(to_import)} shows into PitFlix (sequential -- local SQLite write safety)...")
        for i, (name, tmdb_id) in enumerate(to_import, start=1):
            runtime_minutes = runtime_cache.get(tmdb_id)
            try:
                count = import_show(client, tmdb_id, matcher.info(name)["title"], shows[name].episodes,
                                     runtime_minutes)
                progress[name] = "done"
                done += 1
                total_episodes += count
                print(f"  [{i}/{len(to_import)}] done: {name} ({count} episodes, ~{runtime_minutes}min each)")
            except Exception as e:
                progress[name] = f"error: {e}"
                errored += 1
                print(f"  [{i}/{len(to_import)}] ERROR: {name}: {e}")
            save_json(progress_path, progress)

    if args.dry_run:
        report_path = cache_dir / "pitflix_match_report.csv"
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
