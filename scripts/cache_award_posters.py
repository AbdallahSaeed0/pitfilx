#!/usr/bin/env python3
"""
Download award edition posters/backdrops into %LOCALAPPDATA%\\Pitflix\\Images\\awards-cache\\
so Pitflix.API can serve them via /images/awards-cache/... (see AwardsImageCache.cs).

Requires TMDB_API_KEY (v3) in the environment.

Usage:
  set TMDB_API_KEY=...
  python scripts/cache_award_posters.py --all
  python scripts/cache_award_posters.py --edition Pitflix.API/Data/Awards/editions/academy-awards/2022.json
  python scripts/cache_award_posters.py --all --write-tmdb-ids
"""

from __future__ import annotations

import argparse
import json
import hashlib
import os
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TMDB_BASE = "https://api.themoviedb.org/3"
IMAGE_BASE = "https://image.tmdb.org/t/p"


def cache_root() -> Path:
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    else:
        base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "Pitflix" / "Images" / "awards-cache"


def nominee_hash(category_id: str, title: str) -> str:
    """First 16 hex chars of SHA256 — must match AwardsImageCache.NomineeFileBase in C#."""
    key = f"{category_id}:{title}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def search_query(title: str) -> str:
    """Use film title after em dash when row is 'Name — Film'."""
    t = (title or "").strip()
    if not t:
        return t
    for sep in ("\u2014", "\u2013", " – ", " — ", " - "):
        if sep in t:
            parts = t.split(sep, 1)
            if len(parts) == 2 and parts[1].strip():
                return parts[1].strip()
    return t


def http_json(url: str) -> dict | list | None:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code} {url}: {body[:200]}", file=sys.stderr)
        return None
    except urllib.error.URLError as e:
        print(f"URL error {url}: {e}", file=sys.stderr)
        return None


def download_file(url: str, dest: Path) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "PitflixAwardCache/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            dest.write_bytes(resp.read())
        return True
    except OSError as e:
        print(f"Download failed {url} -> {dest}: {e}", file=sys.stderr)
        return False


def find_movie(
    api_key: str, query: str, year: int
) -> tuple[int, str | None, str | None] | None:
    q = urllib.parse.quote(query)
    url = f"{TMDB_BASE}/search/movie?api_key={api_key}&query={q}&page=1&year={year}"
    data = http_json(url)
    if not data or not isinstance(data, dict):
        return None
    results = data.get("results") or []
    if not results:
        return None
    mid = int(results[0]["id"])
    p = results[0].get("poster_path")
    # backdrop often missing on search; fetch details
    detail = http_json(f"{TMDB_BASE}/movie/{mid}?api_key={api_key}")
    bd = None
    if isinstance(detail, dict):
        bd = detail.get("backdrop_path")
    return mid, p, bd


def find_tv(api_key: str, query: str, year: int) -> tuple[int, str | None, str | None] | None:
    q = urllib.parse.quote(query)
    url = f"{TMDB_BASE}/search/tv?api_key={api_key}&query={q}&page=1&first_air_date_year={year}"
    data = http_json(url)
    if not data or not isinstance(data, dict):
        return None
    results = data.get("results") or []
    if not results:
        return None
    tid = int(results[0]["id"])
    p = results[0].get("poster_path")
    detail = http_json(f"{TMDB_BASE}/tv/{tid}?api_key={api_key}")
    bd = None
    if isinstance(detail, dict):
        bd = detail.get("backdrop_path")
    return tid, p, bd


def save_tmdb_image(fragment: str | None, size: str, dest: Path) -> bool:
    if not fragment:
        return False
    path = fragment if fragment.startswith("/") else "/" + fragment
    url = f"{IMAGE_BASE}/{size}{path}"
    return download_file(url, dest)


def process_edition(
    path: Path,
    api_key: str,
    *,
    skip_existing: bool,
    write_tmdb_ids: bool,
    dry_run: bool,
) -> int:
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    award_id = data.get("awardId") or ""
    year = int(data.get("year") or 0)
    if not award_id or year <= 0:
        print(f"Skip invalid: {path}", file=sys.stderr)
        return 0

    root = cache_root()
    award_dir = root / award_id
    year_dir = award_dir / str(year)
    year_poster = award_dir / f"{year}-poster.jpg"
    year_backdrop = award_dir / f"{year}-backdrop.jpg"

    categories = data.get("categories") or []
    best_picture_winner_assets: tuple[Path | None, Path | None] = (None, None)
    touched = 0

    for cat in categories:
        cat_id = cat.get("id") or ""
        for nominee in cat.get("nominees") or []:
            title = (nominee.get("title") or "").strip()
            if not title:
                continue
            media = (nominee.get("mediaType") or "movie").lower()
            q = search_query(title)
            h = nominee_hash(cat_id, title)
            poster_path = year_dir / f"{h}-poster.jpg"
            backdrop_path = year_dir / f"{h}-backdrop.jpg"

            need_poster = not (skip_existing and poster_path.is_file())
            need_backdrop = not (skip_existing and backdrop_path.is_file())
            must_resolve_id = bool(
                write_tmdb_ids and nominee.get("tmdbId") in (None, 0)
            )
            if not need_poster and not need_backdrop and not must_resolve_id:
                if cat_id == "best-picture" and nominee.get("winner") and poster_path.is_file():
                    best_picture_winner_assets = (
                        poster_path,
                        backdrop_path if backdrop_path.is_file() else None,
                    )
                continue

            if dry_run:
                print(f"Would resolve: {award_id}/{year} [{cat_id}] {title!r} -> {h}")
                touched += 1
                time.sleep(0.05)
                continue

            mid: int | None
            try:
                tr = nominee.get("tmdbId")
                mid = int(tr) if tr is not None else None
            except (TypeError, ValueError):
                mid = None
            if mid is not None and mid <= 0:
                mid = None
            poster_frag: str | None = None
            backdrop_frag: str | None = None

            if mid is not None and mid > 0:
                if media == "tv":
                    detail = http_json(f"{TMDB_BASE}/tv/{mid}?api_key={api_key}")
                else:
                    detail = http_json(f"{TMDB_BASE}/movie/{mid}?api_key={api_key}")
                if isinstance(detail, dict):
                    poster_frag = detail.get("poster_path")
                    backdrop_frag = detail.get("backdrop_path")
            else:
                time.sleep(0.2)
                found = None
                if media == "tv":
                    found = find_tv(api_key, q, year)
                else:
                    found = find_movie(api_key, q, year)
                if found:
                    mid, poster_frag, backdrop_frag = found
                    if write_tmdb_ids:
                        nominee["tmdbId"] = mid

            ok_p = True
            ok_b = True
            if need_poster and poster_frag:
                ok_p = save_tmdb_image(poster_frag, "w500", poster_path)
            if need_backdrop and backdrop_frag:
                ok_b = save_tmdb_image(backdrop_frag, "w1280", backdrop_path)

            if ok_p or poster_path.is_file():
                touched += 1
            time.sleep(0.15)

            if cat_id == "best-picture" and nominee.get("winner"):
                if poster_path.is_file():
                    best_picture_winner_assets = (poster_path, backdrop_path if backdrop_path.is_file() else None)

    if not dry_run and best_picture_winner_assets[0]:
        pp, bp = best_picture_winner_assets
        try:
            if pp and pp.is_file():
                shutil.copy2(pp, year_poster)
            if bp and bp.is_file():
                shutil.copy2(bp, year_backdrop)
        except OSError as e:
            print(f"Year-level copy failed: {e}", file=sys.stderr)

    if write_tmdb_ids and not dry_run:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return touched


def cache_catalog_entries(
    data_root: Path, *, skip_existing: bool, dry_run: bool
) -> int:
    """Write awards-cache/<id>/catalog-poster.jpg and catalog-backdrop.jpg from catalog.json TMDB paths."""
    cat_path = data_root / "Pitflix.API" / "Data" / "Awards" / "catalog.json"
    if not cat_path.is_file():
        print(f"Missing {cat_path}", file=sys.stderr)
        return 0
    data = json.loads(cat_path.read_text(encoding="utf-8"))
    root = cache_root()
    n = 0
    for a in data.get("awards", []):
        aid = (a.get("id") or "").strip()
        if not aid:
            continue
        award_dir = root / aid
        poster_dest = award_dir / "catalog-poster.jpg"
        backdrop_dest = award_dir / "catalog-backdrop.jpg"
        event_dest = award_dir / "event-poster.jpg"
        event_backdrop_dest = award_dir / "event-backdrop.jpg"
        pp = a.get("cardPosterPath")
        bp = a.get("heroBackdropPath")
        ev = a.get("eventPosterPath")
        eb = a.get("eventBackdropPath")
        if dry_run:
            print(f"catalog: {aid} poster={pp!r} backdrop={bp!r}")
            n += 1
            continue
        if pp and (not skip_existing or not poster_dest.is_file()):
            if save_tmdb_image(pp, "w342", poster_dest):
                n += 1
            time.sleep(0.1)
        if bp and (not skip_existing or not backdrop_dest.is_file()):
            if save_tmdb_image(bp, "w1280", backdrop_dest):
                n += 1
            time.sleep(0.1)
        if ev and (not skip_existing or not event_dest.is_file()):
            if save_tmdb_image(ev, "w342", event_dest):
                n += 1
            time.sleep(0.1)
        if eb and (not skip_existing or not event_backdrop_dest.is_file()):
            if save_tmdb_image(eb, "w1280", event_backdrop_dest):
                n += 1
            time.sleep(0.1)
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description="Cache award posters under LocalAppData/Pitflix/Images")
    ap.add_argument(
        "--edition",
        type=Path,
        help="Single edition JSON (e.g. .../academy-awards/2022.json)",
    )
    ap.add_argument(
        "--all",
        action="store_true",
        help="Process every edition JSON under Pitflix.API/Data/Awards/editions",
    )
    ap.add_argument(
        "--catalog",
        action="store_true",
        help="Download hub card images from Data/Awards/catalog.json (no TMDB search API; still fetches image.tmdb.org)",
    )
    ap.add_argument(
        "--data-root",
        type=Path,
        default=None,
        help="Repo root containing Pitflix.API (default: parent of scripts/)",
    )
    ap.add_argument("--skip-existing", action="store_true", default=True)
    ap.add_argument("--force", action="store_true", help="Re-download even if files exist")
    ap.add_argument("--write-tmdb-ids", action="store_true", help="Write resolved tmdbId into edition JSON")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    api_key = os.environ.get("TMDB_API_KEY", "").strip()
    skip_existing = not args.force
    root = args.data_root or Path(__file__).resolve().parent.parent

    if args.catalog:
        if args.dry_run:
            cache_catalog_entries(root, skip_existing=skip_existing, dry_run=True)
            print(f"Cache root: {cache_root()}")
            return 0
        cn = cache_catalog_entries(root, skip_existing=skip_existing, dry_run=False)
        print(f"Catalog images written: {cn}  -> {cache_root()}")
        if not args.edition and not args.all:
            return 0

    if not api_key and not args.dry_run and (args.edition or args.all):
        print("Set TMDB_API_KEY (TMDB v3 API key).", file=sys.stderr)
        return 1

    if args.edition:
        paths = [args.edition.resolve()]
    elif args.all:
        editions = root / "Pitflix.API" / "Data" / "Awards" / "editions"
        if not editions.is_dir():
            print(f"Missing editions dir: {editions}", file=sys.stderr)
            return 1
        paths = sorted(editions.glob("*/*.json"))
    else:
        ap.print_help()
        return 2

    total = 0
    for p in paths:
        if not p.is_file():
            continue
        n = process_edition(
            p,
            api_key,
            skip_existing=skip_existing,
            write_tmdb_ids=args.write_tmdb_ids,
            dry_run=args.dry_run,
        )
        total += n
        print(f"{p.name}: {n} updates")

    print(f"Cache root: {cache_root()}  (total file ops / resolves: {total})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
