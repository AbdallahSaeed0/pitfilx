"""Parses a TV Time GDPR data export into a canonical watch-history structure.

Shared by every TV Time importer (Serializd, Trakt, PitFlix) so each one only
has to deal with a clean {show/movie -> watched episodes/dates} shape instead
of TV Time's internal CSV quirks.

The authoritative per-event log is `tracking-prod-records-v2.csv` (TV shows)
and `tracking-prod-records.csv` (movies) -- both log one row per watch event
with a real timestamp, unlike the "*_latest" files which only keep the most
recent episode per show.
"""
from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ShowWatchData:
    name: str
    # (season_number, episode_number) -> earliest watched_at ISO string
    episodes: dict[tuple[int, int], str] = field(default_factory=dict)

    @property
    def seasons(self) -> dict[int, list[int]]:
        out: dict[int, list[int]] = {}
        for season, ep in self.episodes:
            out.setdefault(season, []).append(ep)
        for eps in out.values():
            eps.sort()
        return out


@dataclass
class MovieWatchEvent:
    name: str
    watched_at: str
    release_date: str = ""  # year hint for TMDB movie search disambiguation
    runtime_minutes: int = 0  # from TV Time's own data -- avoids a separate TMDB lookup per movie


def _parse_int(value: str) -> int | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def parse_show_watch_history(gdpr_dir: Path) -> dict[str, ShowWatchData]:
    """Reads tracking-prod-records-v2.csv into {show_name -> ShowWatchData}."""
    path = gdpr_dir / "tracking-prod-records-v2.csv"
    shows: dict[str, ShowWatchData] = {}

    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            key = row.get("key", "")
            if not (key.startswith("watch-episode-") or key.startswith("rewatch-episode-")):
                continue

            season = _parse_int(row.get("season_number", ""))
            episode = _parse_int(row.get("episode_number", ""))
            name = (row.get("series_name") or "").strip()
            created_at = (row.get("created_at") or "").strip()
            if season is None or episode is None or not name:
                continue

            show = shows.setdefault(name, ShowWatchData(name=name))
            ep_key = (season, episode)
            existing = show.episodes.get(ep_key)
            if existing is None or created_at < existing:
                show.episodes[ep_key] = created_at

    return shows


def parse_movie_watch_history(gdpr_dir: Path) -> list[MovieWatchEvent]:
    """Reads tracking-prod-records.csv 'watch'/movie rows into a flat event list. Unlike shows,
    these are NOT deduped -- each row is its own watch event (rewatches are legitimate repeats),
    and both the importers and PitFlix's own history table are fine recording each one."""
    path = gdpr_dir / "tracking-prod-records.csv"
    events: list[MovieWatchEvent] = []

    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if row.get("type") != "watch" or row.get("entity_type") != "movie":
                continue
            name = (row.get("movie_name") or "").strip()
            created_at = (row.get("created_at") or "").strip()
            if not name:
                continue
            release_date = (row.get("release_date") or "").strip()
            events.append(MovieWatchEvent(
                name=name,
                watched_at=created_at,
                release_date=release_date,
                # TV Time's "runtime" column is in SECONDS (verified against known movies, e.g.
                # Forrest Gump = 8520 = 142min * 60) -- convert to minutes here so every caller
                # gets real minutes, matching the field's name.
                runtime_minutes=(_parse_int(row.get("runtime", "")) or 0) // 60,
            ))

    return events


def load_or_build_movie_cache(gdpr_dir: Path, cache_path: Path) -> list[MovieWatchEvent]:
    """Parses (or reuses a cached JSON copy of) the movie watch-history event list."""
    if cache_path.exists():
        raw = json.loads(cache_path.read_text(encoding="utf-8"))
        return [MovieWatchEvent(**item) for item in raw]

    events = parse_movie_watch_history(gdpr_dir)
    cache_path.write_text(
        json.dumps([event.__dict__ for event in events], indent=2, ensure_ascii=False), encoding="utf-8")
    return events


def load_or_build_show_cache(gdpr_dir: Path, cache_path: Path) -> dict[str, ShowWatchData]:
    """Parses (or reuses a cached JSON copy of) the show watch-history."""
    if cache_path.exists():
        raw = json.loads(cache_path.read_text(encoding="utf-8"))
        return {
            name: ShowWatchData(
                name=name,
                episodes={
                    tuple(map(int, k.split("x"))): v
                    for k, v in data["episodes"].items()
                },
            )
            for name, data in raw.items()
        }

    shows = parse_show_watch_history(gdpr_dir)
    serializable = {
        name: {"episodes": {f"{s}x{e}": ts for (s, e), ts in show.episodes.items()}}
        for name, show in shows.items()
    }
    cache_path.write_text(json.dumps(serializable, indent=2, ensure_ascii=False), encoding="utf-8")
    return shows
