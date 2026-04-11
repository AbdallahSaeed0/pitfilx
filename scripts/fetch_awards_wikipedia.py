#!/usr/bin/env python3
"""
Build Pitflix Academy Awards JSON from English Wikipedia (MediaWiki API).

Python alternative to scripts/fetch-awards-wikipedia.mjs (same output shape).

IMDb: event pages use AWS WAF; ``requests``/``urllib`` get a bot challenge, not real HTML.
This script does not scrape IMDb. Wikipedia is the practical automated source.

Usage (repo root)::
    python scripts/fetch_awards_wikipedia.py --from=2018 --to=2024
    python scripts/fetch_awards_wikipedia.py --upgrade-seed --from=1929 --to=2026
    python scripts/fetch_awards_wikipedia.py --dry-run --from=2022 --to=2022

Requires Python 3.9+ (stdlib only: urllib, json, argparse, pathlib, re).

Data: Wikipedia (CC BY-SA). Verify with AMPAS.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
EDITIONS_ROOT = REPO_ROOT / "Pitflix.API" / "Data" / "Awards" / "editions"
MW_API = "https://en.wikipedia.org/w/api.php"
UA = "PitflixAwardsWikiImport-Python/1.0 (local tool; contact maintainer)"

WIKI_NAME_TO_ID = {
    "Best Picture": "best-picture",
    "Best Directing": "best-director",
    "Best Director": "best-director",
    "Best Actor in a Leading Role": "best-actor",
    "Best Actress in a Leading Role": "best-actress",
    "Best Actor in a Supporting Role": "best-supporting-actor",
    "Best Actress in a Supporting Role": "best-supporting-actress",
    "Best Writing (Original Screenplay)": "best-original-screenplay",
    "Best Original Screenplay": "best-original-screenplay",
    "Best Writing (Adapted Screenplay)": "best-adapted-screenplay",
    "Best Adapted Screenplay": "best-adapted-screenplay",
    "Best International Feature Film": "best-international",
    "Best Foreign Language Film": "best-international",
    "Best Animated Feature": "best-animated",
    "Best Animated Feature Film": "best-animated",
    "Best Documentary Feature": "best-documentary",
    "Best Documentary Feature Film": "best-documentary",
}

CATEGORY_TITLES = {
    "best-picture": "Best Picture",
    "best-director": "Best Director",
    "best-actor": "Best Actor in a Leading Role",
    "best-actress": "Best Actress in a Leading Role",
    "best-supporting-actor": "Best Actor in a Supporting Role",
    "best-supporting-actress": "Best Actress in a Supporting Role",
    "best-original-screenplay": "Best Original Screenplay",
    "best-adapted-screenplay": "Best Adapted Screenplay",
    "best-international": "Best International Feature Film",
    "best-animated": "Best Animated Feature",
    "best-documentary": "Best Documentary Feature",
}

MULTI_LINE_CATS = frozenset(
    {
        "best-director",
        "best-actor",
        "best-actress",
        "best-supporting-actor",
        "best-supporting-actress",
        "best-original-screenplay",
        "best-adapted-screenplay",
    }
)


def ordinal(n: int) -> str:
    v = n % 100
    if 10 <= v <= 20:
        suf = "th"
    else:
        suf = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf}"


def oscars_page_title(ceremony_year: int) -> str:
    n = ceremony_year - 1928
    if n < 1:
        raise ValueError(f"year {ceremony_year} before modern Oscars layout")
    return f"{ordinal(n)} Academy Awards"


def is_replaceable_auto(path: Path) -> bool:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        ds = str(data.get("dataSource") or "")
        if ds in ("wikidata-sparql-seed", "wikidata-sparql", "wikipedia-mediawiki-api"):
            return True
        if "winner-only" in str(data.get("notes") or ""):
            return True
        return False
    except (OSError, json.JSONDecodeError):
        return False


def fetch_wikitext(page_title: str) -> str:
    q = urllib.parse.urlencode(
        {
            "action": "parse",
            "page": page_title,
            "prop": "wikitext",
            "format": "json",
        }
    )
    req = urllib.request.Request(f"{MW_API}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
    j = json.loads(raw)
    if "error" in j:
        raise RuntimeError(j["error"].get("info", str(j["error"])))
    w = j.get("parse", {}).get("wikitext", {}).get("*")
    if not w:
        raise RuntimeError(f"No wikitext for {page_title!r}")
    return w


def wiki_links(line: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for m in re.finditer(r"\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]", line):
        target = m.group(1).strip()
        disp = (m.group(2) or m.group(1)).strip()
        target = re.sub(r"#.*$", "", target)
        if target.startswith("Category:") or target.startswith("File:"):
            continue
        out.append((target, disp))
    return out


def strip_trail(line: str) -> str:
    line = re.sub(r"\{\{double dagger\}\}", "", line, flags=re.I)
    line = re.sub(r"\{\{[^}]+\}\}", "", line)
    line = re.sub(r"<ref[\s\S]*?</ref>", "", line, flags=re.I)
    line = re.sub(r"<ref[^>]*/>", "", line, flags=re.I)
    line = re.sub(r"\s+as\s+[\s\S]*$", "", line, flags=re.I)
    return line.strip()


def end_of_balanced_template(s: str, open_idx: int) -> int:
    depth = 0
    i = open_idx
    while i < len(s) - 1:
        if s[i : i + 2] == "{{":
            depth += 1
            i += 2
            continue
        if s[i : i + 2] == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return i
            continue
        i += 1
    return len(s)


def display_for_line(line: str, cat_id: str) -> str | None:
    clean = strip_trail(line)
    links = wiki_links(clean)
    if not links:
        return None

    if cat_id == "best-picture":
        for _, disp in links:
            if not re.match(r"^Academy Award", disp):
                return disp
        return links[0][1]

    if cat_id in MULTI_LINE_CATS:
        if len(links) >= 2:
            return f"{links[0][1]} — {links[1][1]}"
        return links[0][1]

    if cat_id in ("best-international", "best-animated", "best-documentary"):
        return links[0][1]

    return links[0][1]


def parse_oscar_categories(wikitext: str) -> list[dict]:
    wn = re.search(r"==\s*Winners and nominees\s*==", wikitext, re.I)
    chunk = wikitext[wn.start() :] if wn else wikitext

    categories: list[dict] = []
    pos = 0
    while True:
        idx = chunk.find("{{Award category|", pos)
        if idx < 0:
            break
        end_header = end_of_balanced_template(chunk, idx)
        header = chunk[idx:end_header]
        m = re.search(r"\[\[Academy Award for [^\]|]+\|([^\]]+)\]\]", header)
        wiki_short = m.group(1).strip() if m else ""
        pos = end_header
        if not wiki_short:
            continue
        cat_id = WIKI_NAME_TO_ID.get(wiki_short)
        if not cat_id:
            continue
        nxt = chunk.find("{{Award category|", pos)
        body = chunk[pos:] if nxt < 0 else chunk[pos:nxt]

        nominees: list[dict] = []
        for raw_line in body.split("\n"):
            line = raw_line.strip()
            if not re.match(r"^\*+\s*", line):
                continue
            is_nom = bool(re.match(r"^\*\*", line))
            is_win = (not is_nom) and ("''" in line)
            if not is_win and not is_nom:
                continue
            title = display_for_line(line, cat_id)
            if not title or len(title) < 2:
                continue
            nominees.append(
                {
                    "title": title,
                    "mediaType": "movie",
                    "tmdbId": None,
                    "winner": is_win,
                }
            )

        if nominees:
            categories.append(
                {
                    "id": cat_id,
                    "name": CATEGORY_TITLES.get(cat_id, wiki_short),
                    "nominees": nominees,
                }
            )

    by_id: dict[str, dict] = {}
    for c in categories:
        cid = c["id"]
        if cid not in by_id:
            by_id[cid] = {"id": cid, "name": c["name"], "nominees": list(c["nominees"])}
            continue
        p = by_id[cid]
        seen = {f"{n['title']}\t{n['winner']}" for n in p["nominees"]}
        for n in c["nominees"]:
            k = f"{n['title']}\t{n['winner']}"
            if k not in seen:
                seen.add(k)
                p["nominees"].append(n)

    order = list(CATEGORY_TITLES.keys())
    return sorted(by_id.values(), key=lambda x: order.index(x["id"]) if x["id"] in order else 999)


def main() -> int:
    ap = argparse.ArgumentParser(description="Import Oscars from English Wikipedia (API, not HTML scrape).")
    ap.add_argument("--from", dest="y_from", type=int, default=None, metavar="YEAR")
    ap.add_argument("--to", dest="y_to", type=int, default=None, metavar="YEAR")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--upgrade-seed", action="store_true", dest="upgrade_seed")
    ap.add_argument("--dry-run", action="store_true", dest="dry_run")
    args = ap.parse_args()

    end = args.y_to if args.y_to is not None else datetime.now(timezone.utc).year
    start = args.y_from if args.y_from is not None else end - 25
    if start > end:
        print("Invalid --from / --to", file=sys.stderr)
        return 1

    out_dir = EDITIONS_ROOT / "academy-awards"
    print(f"Wikipedia Oscars → {out_dir}/{{year}}.json", file=sys.stderr)
    print(f"Years {start}–{end} ({end - start + 1} years)", file=sys.stderr)
    if args.dry_run:
        print("DRY RUN", file=sys.stderr)

    for y in range(start, end + 1):
        out_file = out_dir / f"{y}.json"
        if out_file.exists() and not args.force:
            if not args.upgrade_seed or not is_replaceable_auto(out_file):
                continue

        try:
            title = oscars_page_title(y)
        except ValueError:
            print(f"  SKIP {y}: year out of range", file=sys.stderr)
            continue

        try:
            wikitext = fetch_wikitext(title)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as e:
            print(f"  ERROR {y} ({title}): {e}", file=sys.stderr)
            continue

        categories = parse_oscar_categories(wikitext)
        if not categories:
            print(f"  SKIP {y}: no parsed categories from {title}", file=sys.stderr)
            continue

        doc = {
            "awardId": "academy-awards",
            "year": y,
            "label": f"{title} ({y})",
            "categories": categories,
            "dataSource": "wikipedia-mediawiki-api",
            "notes": (
                "Imported from English Wikipedia wikitext (Python; Winners and nominees / {{Award category}}). "
                "CC BY-SA. Verify with AMPAS. tmdbId null unless enriched separately."
            ),
        }
        summary = ", ".join(f"{c['id']}:{len(c['nominees'])}" for c in categories)
        if args.dry_run:
            print(f"  would write academy-awards/{y}.json — {summary}", file=sys.stderr)
            continue

        out_dir.mkdir(parents=True, exist_ok=True)
        out_file.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
        print(f"  wrote academy-awards/{y}.json — {summary}", file=sys.stderr)

    print("Done.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
