"""Imports movies watched on Letterboxd but NOT already covered by the TV Time watched-movie
import (`pitflix_import.py --movies`, already run: 792/792 done) into PitFlix's WatchHistories via
POST /api/history/mark-watched -- this is what drives the "Watched" badge on streaming/browse pages.

Reconciliation logic (title+year matching, with a fuzzy fallback) mirrors the earlier TV Time vs
Letterboxd comparison work so we don't double-import a film both services already agree on.

PitFlix.API must be running on http://127.0.0.1:5280.

Usage:
  python pitflix_letterboxd_watched_import.py --dry-run
  python pitflix_letterboxd_watched_import.py
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

import httpx

from tmdb_match import TmdbMatcher, load_pitflix_tmdb_key

REPO_ROOT = Path(__file__).resolve().parents[2]
PITFLIX_BASE_URL = "http://127.0.0.1:5280/api"
GDPR_DIR = Path(r"C:\Users\Abd Allah\Downloads\Telegram Desktop\gdpr-data")
LB_DIR = GDPR_DIR / "letterboxd_export"


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


def load_tvtime_watched(gdpr_dir: Path) -> set[str]:
    """Normalized titles TV Time marked "watch"/"rewatch" -- already imported into WatchHistories."""
    out = set()
    with (gdpr_dir / "tracking-prod-records.csv").open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if row.get("entity_type") == "movie" and row.get("type") in ("watch", "rewatch"):
                out.add(norm(row.get("movie_name") or ""))
    return out


def load_letterboxd_watched(lb_dir: Path) -> list[tuple[str, str | None, str | None]]:
    """(name, year, watched_date) from watched.csv."""
    out = []
    with (lb_dir / "watched.csv").open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            out.append((row.get("Name", ""), row.get("Year") or None, row.get("Date") or None))
    return out


def only_on_letterboxd(tvtime_norm: set[str], letterboxd: list[tuple[str, str | None, str | None]]
                        ) -> list[tuple[str, str | None, str | None]]:
    """Letterboxd-watched movies with no reasonable TV Time title match at all (exact norm, or a
    close fuzzy match) -- conservative, since a false "only on Letterboxd" just means a harmless
    duplicate WatchHistories row, not a missed import."""
    out = []
    for name, year, date in letterboxd:
        key = norm(name)
        if key in tvtime_norm:
            continue
        if any(SequenceMatcher(None, key, other).ratio() >= 0.85 for other in tvtime_norm):
            continue
        out.append((name, year, date))
    return out


def to_iso(raw: str | None) -> str | None:
    if not raw:
        return None
    s = raw.strip()
    if not s:
        return None
    try:
        dt = datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def mark_movie_watched(client: httpx.Client, tmdb_id: int, title: str, watched_at_iso: str | None) -> None:
    resp = client.post("/history/mark-watched", json={
        "tmdbId": tmdb_id,
        "mediaType": "Movie",
        "title": title,
        "source": "manual",
        **({"watchedAt": watched_at_iso} if watched_at_iso else {}),
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
    parser.add_argument("--tmdb-key")
    parser.add_argument("--interactive", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--retry-errors", action="store_true")
    args = parser.parse_args()

    cache_dir = args.gdpr_dir / "_import_cache"
    cache_dir.mkdir(exist_ok=True)

    tvtime_norm = load_tvtime_watched(args.gdpr_dir)
    letterboxd = load_letterboxd_watched(args.letterboxd_dir)
    print(f"Letterboxd watched: {len(letterboxd)} | TV Time watched (normalized titles): {len(tvtime_norm)}")

    only_lb = only_on_letterboxd(tvtime_norm, letterboxd)
    only_lb.sort(key=lambda x: x[0].lower())
    print(f"Letterboxd-only (not already covered by the TV Time import): {len(only_lb)}")

    tmdb_key = args.tmdb_key or load_pitflix_tmdb_key(REPO_ROOT)
    # Same cache file the TV Time movie importer used -- title+year query keys are the same shape.
    matcher = TmdbMatcher(tmdb_key, cache_dir / "tmdb_movie_map.json", interactive=args.interactive,
                           media_type="movie")

    progress_path = cache_dir / "pitflix_letterboxd_watched_progress.json"
    progress: dict[str, str] = load_json(progress_path, {})

    client = httpx.Client(base_url=args.pitflix_url, timeout=httpx.Timeout(30.0, connect=10.0))
    if not args.dry_run:
        try:
            client.get("/lists")
        except httpx.HTTPError as e:
            raise SystemExit(f"Could not reach PitFlix.API at {args.pitflix_url} -- is it running? ({e})")

    report_rows = []
    resolved: list[tuple[str, int, str, str | None]] = []
    skipped = 0
    for name, year, date in only_lb:
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
                report_rows.append([name, year or "", date or "", "", "", "unmatched"])
            continue

        watched_iso = to_iso(date)
        report_rows.append([name, year or "", date or "", match["title"], match["id"], "matched"])
        resolved.append((progress_key, match["id"], match["title"], watched_iso))

    save_json(progress_path, progress)

    done = errored = 0
    if not args.dry_run and resolved:
        print(f"\nMarking {len(resolved)} Letterboxd movies watched in PitFlix...")
        for i, (progress_key, tmdb_id, title, watched_iso) in enumerate(resolved, start=1):
            try:
                mark_movie_watched(client, tmdb_id, title, watched_iso)
                progress[progress_key] = "done"
                done += 1
                print(f"  [{i}/{len(resolved)}] done: {title}")
            except Exception as e:
                progress[progress_key] = f"error: {e}"
                errored += 1
                print(f"  [{i}/{len(resolved)}] ERROR: {title}: {e}")
            save_json(progress_path, progress)

    if args.dry_run:
        report_path = cache_dir / "pitflix_letterboxd_watched_match_report.csv"
        with report_path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["source_title", "source_year", "watched_date", "matched_title", "tmdb_id", "status"])
            writer.writerows(report_rows)
        print(f"\nReview report written to {report_path}")

    print(f"\n{'Preview' if args.dry_run else 'Import'} complete. "
          f"done={done} skipped(unmatched)={skipped} errored={errored} "
          f"(progress saved to {progress_path})")


if __name__ == "__main__":
    main()
