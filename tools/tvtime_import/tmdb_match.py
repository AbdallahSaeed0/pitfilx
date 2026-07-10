"""Title -> TMDB TV show ID matching, with an on-disk cache and optional
interactive disambiguation for the picks the auto-matcher is unsure about."""
from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from pathlib import Path

import httpx

TMDB_SEARCH_TV_URL = "https://api.themoviedb.org/3/search/tv"
TMDB_SEARCH_MOVIE_URL = "https://api.themoviedb.org/3/search/movie"

# TV Time disambiguates same-titled shows with a trailing "(US)"/"(2018)" tag that
# TMDB's search chokes on literally (0 results) -- stripped before searching, and
# the year (if any) is used afterwards to pick the right same-titled result.
_COUNTRY_SUFFIX_RE = re.compile(r"\s*\((US|UK|AU|CA|FR|DE|IE)\)\s*$", re.IGNORECASE)
_YEAR_SUFFIX_RE = re.compile(r"\s*\((\d{4})\)\s*$")

_STOPWORDS = {"the", "a", "an", "of", "and", "&"}


def _significant_words(title: str) -> set[str]:
    return {w for w in re.findall(r"[\w']+", title.lower()) if w not in _STOPWORDS}


def _load_key_from_pitflix_db() -> str | None:
    """PitFlix resolves TmdbApiKey from its SQLite settings table first (see
    AppSettings.ResolveTmdbApiKeyFromSources) -- that's the key actually in
    live use, which can differ from whatever's sitting in appsettings.local.json."""
    local_appdata = os.environ.get("LOCALAPPDATA")
    if not local_appdata:
        return None
    db_path = Path(local_appdata) / "Pitflix" / "pitflix.db"
    if not db_path.exists():
        return None
    try:
        conn = sqlite3.connect(str(db_path))
        row = conn.execute("SELECT Value FROM Settings WHERE Key = 'TmdbApiKey'").fetchone()
        conn.close()
        return row[0] if row and row[0] else None
    except sqlite3.Error:
        return None


def _load_key_from_local_json(repo_root: Path) -> str | None:
    settings_path = repo_root / "Pitflix.API" / "appsettings.local.json"
    if not settings_path.exists():
        return None
    data = json.loads(settings_path.read_text(encoding="utf-8"))
    key = data.get("TmdbApiKey")
    return key if key and "PASTE_YOUR_KEY" not in key else None


def load_pitflix_tmdb_key(repo_root: Path) -> str:
    key = _load_key_from_pitflix_db() or _load_key_from_local_json(repo_root)
    if not key:
        raise SystemExit(
            "No valid TMDB API key found in PitFlix's SQLite settings or appsettings.local.json. "
            "Pass one explicitly with --tmdb-key."
        )
    return key


class TmdbMatcher:
    """Title -> TMDB id matcher. `media_type` picks between TV shows ("tv", the default -- kept
    for backward compatibility with existing show-matching cache files) and movies ("movie"),
    which differ only in which TMDB search endpoint and result field names apply."""

    def __init__(self, api_key: str, cache_path: Path, interactive: bool = False, media_type: str = "tv"):
        self.api_key = api_key
        self.cache_path = cache_path
        self.interactive = interactive
        self.media_type = media_type
        self.search_url = TMDB_SEARCH_TV_URL if media_type == "tv" else TMDB_SEARCH_MOVIE_URL
        self.title_field = "name" if media_type == "tv" else "title"
        self.date_field = "first_air_date" if media_type == "tv" else "release_date"
        self.client = httpx.Client(timeout=15)
        # {name: {"id": int, "title": str, "year": str} | None}
        self.cache: dict[str, dict | None] = {}
        if cache_path.exists():
            raw = json.loads(cache_path.read_text(encoding="utf-8"))
            # Tolerate the old plain int|null cache format from before this file tracked titles/years.
            # `false` is a deliberate, permanent skip written by the review UI (distinct from `null`,
            # which means "the auto-matcher found nothing") -- treat it exactly like "no match" here
            # so it's silently excluded from imports, same as any other unresolved title. This is an
            # in-memory-only normalization: since info() returns straight from the cache on a hit
            # without ever calling _save(), the on-disk `false` is never overwritten back to `null`.
            self.cache = {
                name: (None if val is False
                       else val if val is None or isinstance(val, dict)
                       else {"id": val, "title": None, "year": None, "confidence": "legacy"})
                for name, val in raw.items()
            }

    def _save(self):
        self.cache_path.write_text(json.dumps(self.cache, indent=2, ensure_ascii=False), encoding="utf-8")

    def _search(self, query: str) -> list[dict]:
        resp = self.client.get(
            self.search_url,
            params={"api_key": self.api_key, "query": query, "include_adult": "true"},
        )
        resp.raise_for_status()
        time.sleep(0.05)  # TMDB's rate limit is generous, but stay polite
        return resp.json().get("results", [])

    def resolve(self, name: str) -> int | None:
        """Returns a TMDB id for `name`, or None if unresolved. Cached across runs."""
        info = self.info(name)
        return info["id"] if info else None

    def info(self, name: str) -> dict | None:
        """Returns {"id", "title", "year", "confidence"} for `name`, or None if unresolved.
        Cached across runs."""
        if name in self.cache:
            return self.cache[name]

        hint_year = None
        m = _YEAR_SUFFIX_RE.search(name)
        if m:
            hint_year = m.group(1)
            search_name = _YEAR_SUFFIX_RE.sub("", name).strip()
        else:
            search_name = name

        results = self._search(search_name)
        if not results:
            stripped = _COUNTRY_SUFFIX_RE.sub("", search_name).strip()
            if stripped and stripped != search_name:
                results = self._search(stripped)

        match = self._pick(name, results, hint_year)
        self.cache[name] = match
        self._save()
        return match

    def _to_match(self, r: dict, confidence: str) -> dict:
        return {
            "id": r["id"],
            "title": r.get(self.title_field, ""),
            "year": (r.get(self.date_field) or "?")[:4],
            "confidence": confidence,
        }

    def _pick(self, name: str, results: list[dict], hint_year: str | None) -> dict | None:
        if not results:
            print(f"  [no TMDB match] {name}")
            return None

        # Exact (case-insensitive) title match wins outright without prompting.
        for r in results:
            if r.get(self.title_field, "").strip().lower() == name.strip().lower():
                return self._to_match(r, "high")

        # A trailing "(YYYY)" TV Time gave us matching a candidate's release/air year is a strong signal.
        if hint_year:
            for r in results:
                if (r.get(self.date_field) or "")[:4] == hint_year:
                    match = self._to_match(r, "high")
                    print(f"  [auto/year] {name} -> {match['title']} ({match['year']}) [{match['id']}]")
                    return match

        if not self.interactive:
            top = results[0]
            shares_a_word = bool(_significant_words(name) & _significant_words(top.get(self.title_field, "")))
            confidence = "high" if shares_a_word else "low"
            match = self._to_match(top, confidence)
            flag = "" if confidence == "high" else "  [LOW CONFIDENCE - review this one]"
            print(f"  [auto] {name} -> {match['title']} ({match['year']}) [{match['id']}]{flag}")
            return match

        print(f"\nMatch for: {name}")
        for i, r in enumerate(results[:5], start=1):
            print(f"  {i}. {r.get(self.title_field, '?')} ({(r.get(self.date_field) or '?')[:4]}) - tmdb:{r['id']}")
        print("  0. skip this one")
        while True:
            choice = input("  pick> ").strip()
            if choice == "0" or choice == "":
                return None
            if choice.isdigit() and 1 <= int(choice) <= min(5, len(results)):
                return self._to_match(results[int(choice) - 1], "confirmed")
            print("  invalid choice")
