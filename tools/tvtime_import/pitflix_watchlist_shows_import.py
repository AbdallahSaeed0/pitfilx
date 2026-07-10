"""Imports TV Time's "haven't started" shows (followed, but zero episodes watched -- i.e. a TV
show want-to-watch list; TV Time and Letterboxd have no formal "TV watchlist" feature, so this is
reconstructed from user_tv_show_data.csv) into PitFlix's built-in Watch Later list as Series items.

Source list: _import_cache/havent_started.txt (one show name per line, already produced by an
earlier pass over user_tv_show_data.csv -- is_followed == true && nb_episodes_seen == 0).

PitFlix.API must be running on http://127.0.0.1:5280 for real (non-dry-run) imports.

Usage:
  python pitflix_watchlist_shows_import.py --dry-run
  python pitflix_watchlist_shows_import.py
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

import httpx

from tmdb_match import TmdbMatcher, load_pitflix_tmdb_key

REPO_ROOT = Path(__file__).resolve().parents[2]
PITFLIX_BASE_URL = "http://127.0.0.1:5280/api"
GDPR_DIR = Path(r"C:\Users\Abd Allah\Downloads\Telegram Desktop\gdpr-data")
WATCH_LATER_LIST_ID = 2


def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def add_series_to_list(client: httpx.Client, list_id: int, tmdb_id: int, title: str) -> None:
    resp = client.post(f"/lists/{list_id}/items", json={
        "tmdbId": tmdb_id,
        "mediaType": "Series",
        "title": title,
    })
    resp.raise_for_status()
    body = resp.json()
    if not body.get("success"):
        raise RuntimeError(f"PitFlix rejected the request: {body}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gdpr-dir", type=Path, default=GDPR_DIR)
    parser.add_argument("--source-file", type=Path, default=None,
                         help="Defaults to <gdpr-dir>/_import_cache/havent_started.txt")
    parser.add_argument("--pitflix-url", default=PITFLIX_BASE_URL)
    parser.add_argument("--list-id", type=int, default=WATCH_LATER_LIST_ID)
    parser.add_argument("--tmdb-key")
    parser.add_argument("--interactive", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--retry-errors", action="store_true")
    args = parser.parse_args()

    cache_dir = args.gdpr_dir / "_import_cache"
    cache_dir.mkdir(exist_ok=True)
    source_file = args.source_file or (cache_dir / "havent_started.txt")

    names = [line.strip() for line in source_file.read_text(encoding="utf-8").splitlines() if line.strip()]
    print(f"{len(names)} not-yet-started shows loaded from {source_file}")

    tmdb_key = args.tmdb_key or load_pitflix_tmdb_key(REPO_ROOT)
    matcher = TmdbMatcher(tmdb_key, cache_dir / "tmdb_show_map.json", interactive=args.interactive, media_type="tv")

    progress_path = cache_dir / "pitflix_watchlist_shows_progress.json"
    progress: dict[str, str] = load_json(progress_path, {})

    report_rows = []
    resolved: list[tuple[str, int, str]] = []
    skipped = 0
    for name in names:
        status = progress.get(name)
        if status == "done":
            continue
        if status and status.startswith("error") and not args.retry_errors:
            continue

        match = matcher.info(name)
        if match is None:
            if progress.get(name) != "unmatched":
                progress[name] = "unmatched"
                skipped += 1
                report_rows.append([name, "", "", "", "unmatched"])
            continue

        report_rows.append([name, match["title"], match["year"], match["id"], "matched"])
        resolved.append((name, match["id"], match["title"]))

    save_json(progress_path, progress)

    client = httpx.Client(base_url=args.pitflix_url, timeout=httpx.Timeout(30.0, connect=10.0))
    if not args.dry_run:
        try:
            client.get("/lists")
        except httpx.HTTPError as e:
            raise SystemExit(f"Could not reach PitFlix.API at {args.pitflix_url} -- is it running? ({e})")

    done = errored = 0
    if not args.dry_run and resolved:
        print(f"\nAdding {len(resolved)} shows to list #{args.list_id}...")
        for i, (name, tmdb_id, title) in enumerate(resolved, start=1):
            try:
                add_series_to_list(client, args.list_id, tmdb_id, title)
                progress[name] = "done"
                done += 1
                print(f"  [{i}/{len(resolved)}] added: {title}")
            except Exception as e:
                progress[name] = f"error: {e}"
                errored += 1
                print(f"  [{i}/{len(resolved)}] ERROR: {title}: {e}")
            save_json(progress_path, progress)

    if args.dry_run:
        report_path = cache_dir / "pitflix_watchlist_shows_match_report.csv"
        with report_path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["source_name", "matched_title", "matched_year", "tmdb_id", "status"])
            writer.writerows(report_rows)
        print(f"\nReview report written to {report_path}")

    print(f"\n{'Preview' if args.dry_run else 'Import'} complete. "
          f"added={done} skipped(unmatched)={skipped} errored={errored} "
          f"(progress saved to {progress_path})")


if __name__ == "__main__":
    main()
