"""Imports movies watched on Letterboxd but never logged in TV Time (the gap the TV Time importer
can't see) into Trakt and PitFlix, with real historical dates.

Source data:
  - `watched_missing_from_tvtime.csv` (Title, "Year (Letterboxd)") -- the 218-movie gap, already
    computed by a prior TV-Time-vs-Letterboxd comparison pass (Desktop/TVTime-vs-Letterboxd/).
  - `letterboxd_export/watched.csv` (Date, Name, Year, Letterboxd URI) -- the real Letterboxd data
    export, joined back in on (title, year) to recover each movie's actual watched date.

Deliberately scoped to ONLY the missing-from-TV-Time set, not all 655 Letterboxd-watched movies --
importing ones already covered by the TV Time import would create duplicate watch events for the
same physical viewing (inflating stats), since this script has no way to know "same movie, same
watch" vs "a genuine rewatch" the way the TV Time data's own dedup logic does.

Shares tmdb_movie_map.json with the TV Time movie importer (safe: keyed by title string, new
entries just add to the same cache) so titles already resolved there are free hits here too.

Usage:
  python letterboxd_import.py --dry-run     # preview matches, no writes
  python letterboxd_import.py                 # real import to Trakt + PitFlix (resumable)
  python letterboxd_import.py --skip-trakt    # PitFlix only
  python letterboxd_import.py --skip-pitflix  # Trakt only
"""
from __future__ import annotations

import argparse
import csv
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

import httpx

from tmdb_match import TmdbMatcher, load_pitflix_tmdb_key
from pitflix_import import load_json, save_json, mark_movie_watched, to_iso
from trakt_import import TraktClient, load_trakt_credentials, MOVIE_BATCH_SIZE, import_movie_batch

REPO_ROOT = Path(__file__).resolve().parents[2]
GDPR_DIR_DEFAULT = Path(r"C:\Users\Abd Allah\Downloads\Telegram Desktop\gdpr-data")
COMPARISON_DIR_DEFAULT = Path(r"C:\Users\Abd Allah\Desktop\TVTime-vs-Letterboxd")
TMDB_MOVIE_DETAILS_URL = "https://api.themoviedb.org/3/movie/{id}"


def load_letterboxd_watched_dates(letterboxd_export_dir: Path) -> dict[tuple[str, str], str]:
    """(title, year) -> Letterboxd 'Date' (their log date -- close enough to real watch date for
    entries with no diary page)."""
    path = letterboxd_export_dir / "watched.csv"
    out: dict[tuple[str, str], str] = {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            name = (row.get("Name") or "").strip()
            year = (row.get("Year") or "").strip()
            date = (row.get("Date") or "").strip()
            if name and date:
                out[(name, year)] = date
    return out


def load_missing_titles(comparison_dir: Path) -> list[tuple[str, str]]:
    path = comparison_dir / "watched_missing_from_tvtime.csv"
    out: list[tuple[str, str]] = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            title = (row.get("Title") or "").strip()
            year = (row.get("Year (Letterboxd)") or "").strip()
            if title:
                out.append((title, year))
    return out


class MovieRuntimeCache:
    """Movie tmdb_id -> runtime in minutes, fetched from TMDB once per movie (movies -- unlike
    shows -- still have a plain, non-deprecated top-level "runtime" field)."""

    def __init__(self, tmdb_key: str, cache_path: Path):
        self.tmdb_key = tmdb_key
        self.cache_path = cache_path
        self.client = httpx.Client(timeout=15)
        self.cache: dict[str, int] = load_json(cache_path, {})

    def get(self, tmdb_id: int) -> int:
        key = str(tmdb_id)
        if key in self.cache:
            return self.cache[key]

        try:
            resp = self.client.get(TMDB_MOVIE_DETAILS_URL.format(id=tmdb_id), params={"api_key": self.tmdb_key})
        except httpx.HTTPError:
            return 0
        if resp.status_code != 200:
            return 0

        minutes = int(resp.json().get("runtime") or 0)
        self.cache[key] = minutes
        save_json(self.cache_path, self.cache)
        return minutes


def to_watched_at_iso(date_str: str) -> str:
    """Letterboxd's 'Date' column is plain 'YYYY-MM-DD' with no time -- treat as start of day UTC."""
    dt = datetime.strptime(date_str.strip(), "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gdpr-dir", type=Path, default=GDPR_DIR_DEFAULT,
                         help="Folder containing letterboxd_export/ (for watched.csv dates)")
    parser.add_argument("--comparison-dir", type=Path, default=COMPARISON_DIR_DEFAULT,
                         help="Folder containing watched_missing_from_tvtime.csv")
    parser.add_argument("--pitflix-url", default="http://127.0.0.1:5280/api", help="PitFlix API base URL")
    parser.add_argument("--tmdb-key", help="TMDB API key (defaults to PitFlix's configured key)")
    parser.add_argument("--interactive", action="store_true", help="Confirm ambiguous TMDB matches by hand")
    parser.add_argument("--dry-run", action="store_true", help="Only resolve/print matches, no writes")
    parser.add_argument("--limit", type=int, help="Only process the first N movies (for testing)")
    parser.add_argument("--retry-errors", action="store_true", help="Re-attempt movies that errored last run")
    parser.add_argument("--skip-trakt", action="store_true", help="Don't import to Trakt")
    parser.add_argument("--skip-pitflix", action="store_true", help="Don't import to PitFlix")
    args = parser.parse_args()

    letterboxd_export_dir = args.gdpr_dir / "letterboxd_export"
    if not letterboxd_export_dir.exists():
        raise SystemExit(f"Letterboxd export not found at {letterboxd_export_dir}")
    if not args.comparison_dir.exists():
        raise SystemExit(f"Comparison folder not found: {args.comparison_dir}")

    cache_dir = args.gdpr_dir / "_import_cache"
    cache_dir.mkdir(exist_ok=True)

    print("Loading Letterboxd watched dates and the TV-Time-vs-Letterboxd gap list...")
    watched_dates = load_letterboxd_watched_dates(letterboxd_export_dir)
    missing_titles = load_missing_titles(args.comparison_dir)
    print(f"{len(missing_titles)} movies watched on Letterboxd but not in TV Time.")

    if args.limit:
        missing_titles = missing_titles[: args.limit]

    tmdb_key = args.tmdb_key or load_pitflix_tmdb_key(REPO_ROOT)
    # Shares the same cache the TV Time movie importer already built up.
    matcher = TmdbMatcher(tmdb_key, cache_dir / "tmdb_movie_map.json", interactive=args.interactive,
                           media_type="movie")
    movie_runtime_cache = MovieRuntimeCache(tmdb_key, cache_dir / "movie_runtime_cache.json")

    progress_path = cache_dir / "letterboxd_movie_progress.json"
    progress: dict[str, str] = load_json(progress_path, {})

    resolved: list[tuple[str, int, str, str, int]] = []  # (name, tmdb_id, title, watched_at_iso, runtime_minutes)
    skipped = 0
    for title, year in missing_titles:
        status = progress.get(title)
        if status == "done":
            continue
        if status and status.startswith("error") and not args.retry_errors:
            continue

        query_key = f"{title} ({year})" if year else title
        match = matcher.info(query_key)
        if match is None:
            if progress.get(title) != "unmatched":
                progress[title] = "unmatched"
                skipped += 1
            continue

        date_str = watched_dates.get((title, year))
        if date_str is None:
            # Year mismatch between the two source files (rare) -- fall back to title-only lookup.
            candidates = [d for (n, _), d in watched_dates.items() if n == title]
            date_str = candidates[0] if candidates else None
        if date_str is None:
            progress[title] = "error: no watched date found in letterboxd_export/watched.csv"
            continue

        try:
            iso = to_watched_at_iso(date_str)
        except ValueError:
            progress[title] = f"error: unparseable date {date_str!r}"
            continue

        runtime_minutes = movie_runtime_cache.get(match["id"])
        print(f"{title} ({year}) -> tmdb:{match['id']} {match['title']} ({match['year']})  watched {date_str}")
        resolved.append((title, match["id"], match["title"], iso, runtime_minutes))

    save_json(progress_path, progress)
    print(f"\n{len(resolved)} resolved and ready to import, {skipped} unmatched (review in /tvtime-review).")

    if args.dry_run:
        print("\nDry run -- no writes made. Re-run without --dry-run to import for real.")
        return

    if not resolved:
        return

    if not args.skip_trakt:
        client = TraktClient(load_trakt_credentials())
        print(f"\nImporting {len(resolved)} movies to Trakt in batches of {MOVIE_BATCH_SIZE}...")
        for i in range(0, len(resolved), MOVIE_BATCH_SIZE):
            batch = resolved[i:i + MOVIE_BATCH_SIZE]
            try:
                added = import_movie_batch(client, [(tmdb_id, iso) for _, tmdb_id, _, iso, _ in batch])
                print(f"  batch {i // MOVIE_BATCH_SIZE + 1}: {added} watch events added ({len(batch)} movies)")
            except Exception as e:
                print(f"  batch {i // MOVIE_BATCH_SIZE + 1} ERROR: {e}")

    if not args.skip_pitflix:
        pitflix_client = httpx.Client(base_url=args.pitflix_url, timeout=httpx.Timeout(30.0, connect=10.0))
        try:
            pitflix_client.get("/stats")
        except httpx.HTTPError as e:
            raise SystemExit(f"Could not reach PitFlix.API at {args.pitflix_url} -- is it running? ({e})")

        print(f"\nImporting {len(resolved)} movies into PitFlix (sequential)...")
        done = errored = 0
        for i, (name, tmdb_id, title, iso, runtime_minutes) in enumerate(resolved, start=1):
            try:
                mark_movie_watched(pitflix_client, tmdb_id, title, iso, runtime_minutes)
                progress[name] = "done"
                done += 1
                print(f"  [{i}/{len(resolved)}] done: {name} (~{runtime_minutes}min)")
            except Exception as e:
                progress[name] = f"error: {e}"
                errored += 1
                print(f"  [{i}/{len(resolved)}] ERROR: {name}: {e}")
            save_json(progress_path, progress)
        print(f"\nPitFlix import complete. done={done} errored={errored}")


if __name__ == "__main__":
    main()
