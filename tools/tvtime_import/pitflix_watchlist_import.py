"""Imports the combined "want to watch" movie list from TV Time (type == "towatch") and
Letterboxd (watchlist.csv) into PitFlix's built-in Watch Later list, via POST /api/lists/{id}/items.

PitFlix.API must be running on http://127.0.0.1:5280 for real (non-dry-run) imports.
Reuses tmdb_match.TmdbMatcher (same TMDB key PitFlix itself uses) for title -> TMDB id resolution.

Usage:
  python pitflix_watchlist_import.py --dry-run     # preview matches + report only, no writes
  python pitflix_watchlist_import.py               # real import (resumable)
  python pitflix_watchlist_import.py --retry-errors
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

import httpx

from tmdb_match import TmdbMatcher, load_pitflix_tmdb_key

REPO_ROOT = Path(__file__).resolve().parents[2]
PITFLIX_BASE_URL = "http://127.0.0.1:5280/api"
GDPR_DIR = Path(r"C:\Users\Abd Allah\Downloads\Telegram Desktop\gdpr-data")
LB_DIR = GDPR_DIR / "letterboxd_export"
WATCH_LATER_LIST_ID = 2  # PitFlix's built-in "Watch Later" list (confirmed via GET /api/lists)


def norm(name: str) -> str:
    if not name:
        return ""
    n = name.strip().lower()
    n = re.sub(r"[^\w\s]", "", n, flags=re.UNICODE)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def valid_year(rd: str) -> str | None:
    if not rd:
        return None
    y = rd[:4]
    if not y.isdigit() or int(y) < 1900:
        return None
    return y


def load_tvtime_towatch(gdpr_dir: Path) -> list[tuple[str, str | None]]:
    """(name, year) for every distinct movie marked "towatch", deduped by TV Time's internal
    movie uuid (not by title text -- two different films can share an exact title)."""
    uuid_year: dict[str, str] = {}
    uuid_name: dict[str, str] = {}
    towatch_uuids: set[str] = set()

    with (gdpr_dir / "tracking-prod-records.csv").open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if row.get("entity_type") != "movie":
                continue
            u = row.get("uuid") or ""
            name = row.get("movie_name") or ""
            yr = valid_year(row.get("release_date") or "")
            if name:
                uuid_name[u] = name
            if yr and u not in uuid_year:
                uuid_year[u] = yr
            if row.get("type") == "towatch":
                towatch_uuids.add(u)

    return [(uuid_name.get(u, ""), uuid_year.get(u)) for u in towatch_uuids if uuid_name.get(u)]


def load_letterboxd_watchlist(lb_dir: Path) -> list[tuple[str, str | None]]:
    out = []
    with (lb_dir / "watchlist.csv").open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            out.append((row.get("Name", ""), row.get("Year") or None))
    return out


def dedupe_combined(tvtime: list[tuple[str, str | None]], letterboxd: list[tuple[str, str | None]]
                     ) -> list[tuple[str, str | None]]:
    """Union of both watchlists, collapsing same-film entries (exact title+year, or exact title
    when one side lacks a year, or a close title match sharing a year) down to one row."""
    lb_by_norm: dict[str, list[tuple[str, str | None]]] = {}
    for name, year in letterboxd:
        lb_by_norm.setdefault(norm(name), []).append((name, year))

    combined: list[tuple[str, str | None]] = []
    consumed_lb: set[tuple[str, str | None]] = set()

    for name, year in tvtime:
        key = norm(name)
        candidates = [c for c in lb_by_norm.get(key, []) if c not in consumed_lb]
        match = None
        if candidates:
            if year:
                exact = [c for c in candidates if c[1] == year]
                match = exact[0] if exact else (candidates[0] if len(candidates) == 1 else None)
            else:
                match = candidates[0] if len(candidates) == 1 else None
        if match is None and year:
            # fuzzy fallback: same year, similar-enough title text
            for other_key, cands in lb_by_norm.items():
                for c in cands:
                    if c in consumed_lb or c[1] != year:
                        continue
                    if SequenceMatcher(None, key, other_key).ratio() >= 0.8:
                        match = c
                        break
                if match:
                    break
        if match:
            consumed_lb.add(match)
            combined.append((match[0], match[1] or year))  # prefer Letterboxd's title text
        else:
            combined.append((name, year))

    for name, year in letterboxd:
        if (name, year) not in consumed_lb:
            combined.append((name, year))

    return combined


def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def add_to_watch_later(client: httpx.Client, list_id: int, tmdb_id: int, title: str) -> None:
    resp = client.post(f"/lists/{list_id}/items", json={
        "tmdbId": tmdb_id,
        "mediaType": "Movie",
        "title": title,
    })
    resp.raise_for_status()
    body = resp.json()
    if not body.get("success"):
        raise RuntimeError(f"PitFlix rejected the request: {body}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gdpr-dir", type=Path, default=GDPR_DIR)
    parser.add_argument("--letterboxd-dir", type=Path, default=LB_DIR)
    parser.add_argument("--pitflix-url", default=PITFLIX_BASE_URL)
    parser.add_argument("--list-id", type=int, default=WATCH_LATER_LIST_ID)
    parser.add_argument("--tmdb-key")
    parser.add_argument("--interactive", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--retry-errors", action="store_true")
    args = parser.parse_args()

    cache_dir = args.gdpr_dir / "_import_cache"
    cache_dir.mkdir(exist_ok=True)

    tvtime = load_tvtime_towatch(args.gdpr_dir)
    letterboxd = load_letterboxd_watchlist(args.letterboxd_dir)
    print(f"TV Time towatch: {len(tvtime)} | Letterboxd watchlist: {len(letterboxd)}")

    combined = dedupe_combined(tvtime, letterboxd)
    combined.sort(key=lambda x: x[0].lower())
    print(f"Combined, deduped: {len(combined)} unique titles")

    if args.limit:
        combined = combined[: args.limit]

    tmdb_key = args.tmdb_key or load_pitflix_tmdb_key(REPO_ROOT)
    matcher = TmdbMatcher(tmdb_key, cache_dir / "tmdb_watchlist_map.json", interactive=args.interactive,
                           media_type="movie")

    progress_path = cache_dir / "pitflix_watchlist_progress.json"
    progress: dict[str, str] = load_json(progress_path, {})

    client = httpx.Client(base_url=args.pitflix_url, timeout=httpx.Timeout(30.0, connect=10.0))
    if not args.dry_run:
        try:
            client.get("/lists")
        except httpx.HTTPError as e:
            raise SystemExit(f"Could not reach PitFlix.API at {args.pitflix_url} -- is it running? ({e})")

    report_rows = []
    resolved: list[tuple[str, int, str]] = []  # (progress_key, tmdb_id, title)
    skipped = 0
    for name, year in combined:
        progress_key = f"{name} ({year})" if year else name
        status = progress.get(progress_key)
        if status == "done":
            continue
        if status and status.startswith("error") and not args.retry_errors:
            continue

        query_key = f"{name} ({year})" if year else name
        match = matcher.info(query_key)
        if match is None:
            if progress.get(progress_key) != "unmatched":
                progress[progress_key] = "unmatched"
                skipped += 1
                report_rows.append([name, year or "", "", "", "", "unmatched"])
            continue

        report_rows.append([name, year or "", match["title"], match["year"], match["id"], "matched"])
        resolved.append((progress_key, match["id"], match["title"]))

    save_json(progress_path, progress)

    done = errored = 0
    if not args.dry_run and resolved:
        print(f"\nAdding {len(resolved)} movies to list #{args.list_id}...")
        for i, (progress_key, tmdb_id, title) in enumerate(resolved, start=1):
            try:
                add_to_watch_later(client, args.list_id, tmdb_id, title)
                progress[progress_key] = "done"
                done += 1
                print(f"  [{i}/{len(resolved)}] added: {title}")
            except Exception as e:
                progress[progress_key] = f"error: {e}"
                errored += 1
                print(f"  [{i}/{len(resolved)}] ERROR: {title}: {e}")
            save_json(progress_path, progress)

    if args.dry_run:
        report_path = cache_dir / "pitflix_watchlist_match_report.csv"
        with report_path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["source_title", "source_year", "matched_title", "matched_year", "tmdb_id", "status"])
            writer.writerows(report_rows)
        print(f"\nReview report written to {report_path}")

    print(f"\n{'Preview' if args.dry_run else 'Import'} complete. "
          f"added={done} skipped(unmatched)={skipped} errored={errored} "
          f"(progress saved to {progress_path})")


if __name__ == "__main__":
    main()
