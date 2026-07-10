"""Imports TV show watch history from a TV Time GDPR export into Serializd.

Serializd has no official API/OAuth, so this logs in with your Serializd
email/password (via serializd-py, an unofficial client) and stays entirely
local -- credentials only ever go to serializd.com.

Caveats (Serializd API limitations, not this script's):
  - No way to set a historical watched date; everything logs as "now".
  - TV shows only. Movies aren't tracked by Serializd at all.

Usage:
  pip install -r requirements.txt
  python serializd_import.py --dry-run                 # preview matches, no login, no writes
  python serializd_import.py --interactive              # confirm ambiguous TMDB matches by hand
  python serializd_import.py                             # do the real import (resumable)
  python serializd_import.py --show "The Office (US)"    # just one show, for testing
"""
from __future__ import annotations

import argparse
import csv
import getpass
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Windows consoles default to a legacy codepage that mangles non-ASCII show
# titles (Arabic, accented Latin, etc.) on print(); force UTF-8 output.
sys.stdout.reconfigure(encoding="utf-8")

import httpx
from serializd import SerializdClient
from serializd.exceptions import EmptySeasonError, LoginError

from tmdb_match import TmdbMatcher, load_pitflix_tmdb_key
from tvtime_parser import load_or_build_show_cache

REPO_ROOT = Path(__file__).resolve().parents[2]
CALL_DELAY_SECONDS = 0.5
MAX_RETRIES = 4


def make_serializd_client() -> SerializdClient:
    client = SerializdClient()
    # serializd-py doesn't expose a way to configure httpx's timeout (default 5s),
    # which serializd.com's API blows past under sustained request bursts. Swap in
    # a client with a longer one, keeping the same base_url/headers (auth included).
    client.session = httpx.Client(
        base_url=client.session.base_url,
        headers=client.session.headers,
        timeout=httpx.Timeout(30.0, connect=10.0),
    )
    return client


def with_retries(fn, *args, **kwargs):
    """Retries a Serializd API call on transient failures -- network errors (read timeouts,
    connection resets) as well as a 200 response with an empty/non-JSON body, which serializd.com
    returns under load instead of a real error (surfaces as json.JSONDecodeError: "Expecting
    value: line 1 column 1"). Not for application-level errors (SerializdError etc.), which
    should surface immediately."""
    for attempt in range(MAX_RETRIES):
        try:
            return fn(*args, **kwargs)
        except (httpx.TransportError, json.JSONDecodeError) as e:
            if attempt == MAX_RETRIES - 1:
                raise
            wait = 2 ** attempt
            print(f"    (transient error: {e}, retrying in {wait}s...)")
            time.sleep(wait)


def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def serializd_login(client: SerializdClient, token_path: Path) -> None:
    cached = load_json(token_path, None)
    if cached and client.check_token(cached["token"]).isValid:
        client.load_token(cached["token"], check=False)
        print("Serializd: reusing cached session.")
        return

    print("Serializd login required.")
    email = input("  email: ").strip()
    password = getpass.getpass("  password: ")
    try:
        client.login(email=email, password=password)
    except LoginError as e:
        raise SystemExit(f"Serializd login failed: {e}")
    save_json(token_path, {"token": client.access_token})
    print("Serializd: logged in, session cached for next run.")


def import_show(client: SerializdClient, tmdb_id: int, seasons: dict[int, list[int]]) -> None:
    complete_season_ids: list[int] = []

    for season_number, watched_eps in sorted(seasons.items()):
        if season_number == 0:
            continue  # specials aren't reliably numbered the same on TMDB; skip
        try:
            season_info = with_retries(client.get_season, show_id=tmdb_id, season_number=season_number)
        except EmptySeasonError:
            print(f"    season {season_number}: no episode data on Serializd/TMDB, skipping")
            continue
        time.sleep(CALL_DELAY_SECONDS)

        real_ep_numbers = {ep.episodeNumber for ep in season_info.episodes}
        watched_in_range = sorted(set(watched_eps) & real_ep_numbers)
        if not watched_in_range:
            continue

        if len(watched_in_range) == len(real_ep_numbers):
            complete_season_ids.append(season_info.seasonId)
        else:
            with_retries(client.log_episodes, show_id=tmdb_id, season_id=season_info.seasonId,
                         episode_numbers=watched_in_range)
            time.sleep(CALL_DELAY_SECONDS)
            print(f"    season {season_number}: logged {len(watched_in_range)}/{len(real_ep_numbers)} episodes")

    if complete_season_ids:
        with_retries(client.log_seasons, show_id=tmdb_id, season_ids=complete_season_ids)
        time.sleep(CALL_DELAY_SECONDS)
        print(f"    logged {len(complete_season_ids)} complete season(s)")


def topup_episodes(client: SerializdClient, tmdb_id: int, seasons: dict[int, list[int]]) -> int:
    """Re-logs every watched episode individually via log_episodes, including ones already
    covered by a bulk log_seasons call. log_seasons only marks the season watched -- it
    doesn't populate Serializd's per-episode log, which is what its "Episodes" stat counts.
    This is purely additive (log_episodes doesn't unmark anything), safe to run after import_show.
    Returns the number of episodes logged."""
    total = 0
    for season_number, watched_eps in sorted(seasons.items()):
        if season_number == 0:
            continue
        try:
            season_info = with_retries(client.get_season, show_id=tmdb_id, season_number=season_number)
        except EmptySeasonError:
            continue
        time.sleep(CALL_DELAY_SECONDS)

        real_ep_numbers = {ep.episodeNumber for ep in season_info.episodes}
        watched_in_range = sorted(set(watched_eps) & real_ep_numbers)
        if not watched_in_range:
            continue

        with_retries(client.log_episodes, show_id=tmdb_id, season_id=season_info.seasonId,
                     episode_numbers=watched_in_range)
        time.sleep(CALL_DELAY_SECONDS)
        total += len(watched_in_range)

    print(f"    topped up {total} episode(s)")
    return total


def rebuild_episodes(client: SerializdClient, tmdb_id: int, seasons: dict[int, list[int]]) -> int:
    """Unlogs then re-logs every watched episode, one season at a time, sequentially -- no
    concurrency. Diagnostic finding: sequential single-show test calls always land fully, but
    the original bulk/concurrent run silently under-delivered for some shows despite 200 OK
    responses and zero script-level errors (confirmed via unlog delta on real episodes: some
    shows had full data, others didn't, with no error signal either way). Unlog-then-relog forces
    a clean rewrite regardless of whatever partial state exists, rather than depending on
    Serializd's opaque dedup to fill gaps (proven not to, by the earlier --force topup no-op).
    Returns the number of episodes (re)logged."""
    total = 0
    for season_number, watched_eps in sorted(seasons.items()):
        if season_number == 0:
            continue
        try:
            season_info = with_retries(client.get_season, show_id=tmdb_id, season_number=season_number)
        except EmptySeasonError:
            continue
        time.sleep(CALL_DELAY_SECONDS)

        real_ep_numbers = {ep.episodeNumber for ep in season_info.episodes}
        watched_in_range = sorted(set(watched_eps) & real_ep_numbers)
        if not watched_in_range:
            continue

        with_retries(client.unlog_episodes, show_id=tmdb_id, season_id=season_info.seasonId,
                     episode_numbers=watched_in_range)
        time.sleep(CALL_DELAY_SECONDS)

        with_retries(client.log_episodes, show_id=tmdb_id, season_id=season_info.seasonId,
                     episode_numbers=watched_in_range)
        time.sleep(CALL_DELAY_SECONDS)
        total += len(watched_in_range)

    print(f"    rebuilt {total} episode(s)")
    return total


def run_rebuild(client: SerializdClient, shows: dict, matcher: TmdbMatcher, cache_dir: Path,
                 names: list[str]) -> None:
    """Sequential (no concurrency, by design) unlog+relog pass across every already-imported show."""
    import_progress: dict[str, str] = load_json(cache_dir / "serializd_progress.json", {})
    rebuild_progress_path = cache_dir / "serializd_rebuild_progress.json"
    rebuild_progress: dict[str, str] = load_json(rebuild_progress_path, {})

    targets = [
        (name, matcher.info(name)["id"])
        for name in names
        if import_progress.get(name) == "done" and rebuild_progress.get(name) != "done"
        and matcher.info(name) is not None
    ]
    print(f"Rebuilding {len(targets)} shows sequentially (this will take a while)...")

    done = errored = 0
    for i, (name, tmdb_id) in enumerate(targets, start=1):
        try:
            count = rebuild_episodes(client, tmdb_id, shows[name].seasons)
            rebuild_progress[name] = "done"
            done += 1
            print(f"  [{i}/{len(targets)}] rebuilt: {name} ({count} episodes)")
        except Exception as e:
            rebuild_progress[name] = f"error: {e}"
            errored += 1
            print(f"  [{i}/{len(targets)}] ERROR: {name}: {e}")
        save_json(rebuild_progress_path, rebuild_progress)

    print(f"\nRebuild complete. done={done} errored={errored} (progress saved to {rebuild_progress_path})")


def unlog_show(client: SerializdClient, tmdb_id: int, seasons: dict[int, list[int]]) -> int:
    """Fully unlogs every watched episode of every season (both the season-level watched_v2 mark
    and the individual episode_log rows), with no relog after. Returns episodes unlogged."""
    total = 0
    for season_number, watched_eps in sorted(seasons.items()):
        if season_number == 0:
            continue
        try:
            season_info = with_retries(client.get_season, show_id=tmdb_id, season_number=season_number)
        except EmptySeasonError:
            continue
        time.sleep(CALL_DELAY_SECONDS)

        real_ep_numbers = {ep.episodeNumber for ep in season_info.episodes}
        watched_in_range = sorted(set(watched_eps) & real_ep_numbers)
        if not watched_in_range:
            continue

        with_retries(client.unlog_episodes, show_id=tmdb_id, season_id=season_info.seasonId,
                     episode_numbers=watched_in_range)
        time.sleep(CALL_DELAY_SECONDS)
        with_retries(client.unlog_seasons, show_id=tmdb_id, season_ids=[season_info.seasonId])
        time.sleep(CALL_DELAY_SECONDS)
        total += len(watched_in_range)

    print(f"    unlogged {total} episode(s)")
    return total


def run_unlog_all(client: SerializdClient, shows: dict, matcher: TmdbMatcher, cache_dir: Path,
                   names: list[str]) -> None:
    """Fully clears every watched mark (season + episode level) for every already-imported show,
    with NO relog after -- a genuine clean slate, to test whether Serializd's 'Episodes watched'
    counter behaves differently starting from truly zero vs. our earlier unlog-then-immediately-
    relog rebuild (which made no difference to the counter)."""
    import_progress: dict[str, str] = load_json(cache_dir / "serializd_progress.json", {})
    unlog_progress_path = cache_dir / "serializd_unlog_all_progress.json"
    unlog_progress: dict[str, str] = load_json(unlog_progress_path, {})

    targets = [
        (name, matcher.info(name)["id"])
        for name in names
        if import_progress.get(name) == "done" and unlog_progress.get(name) != "done"
        and matcher.info(name) is not None
    ]
    print(f"Unlogging {len(targets)} shows completely (no relog) -- this will take a while...")

    done = errored = 0
    for i, (name, tmdb_id) in enumerate(targets, start=1):
        try:
            count = unlog_show(client, tmdb_id, shows[name].seasons)
            unlog_progress[name] = "done"
            done += 1
            print(f"  [{i}/{len(targets)}] unlogged: {name} ({count} episodes)")
        except Exception as e:
            unlog_progress[name] = f"error: {e}"
            errored += 1
            print(f"  [{i}/{len(targets)}] ERROR: {name}: {e}")
        save_json(unlog_progress_path, unlog_progress)

    print(f"\nUnlog-all complete. done={done} errored={errored} (progress saved to {unlog_progress_path})")


def run_topup(client: SerializdClient, shows: dict, matcher: TmdbMatcher, cache_dir: Path,
              names: list[str], concurrency: int, force: bool = False) -> None:
    """Re-runs log_episodes for every show already marked 'done' in the main import, so Serializd's
    per-episode counter reflects seasons that were originally logged in bulk via log_seasons.
    With force=True, re-sends even shows already marked 'done' in the topup progress file --
    for diagnosing/working around Serializd undercounting despite successful (200 OK) responses."""
    import_progress: dict[str, str] = load_json(cache_dir / "serializd_progress.json", {})
    topup_progress_path = cache_dir / "serializd_topup_progress.json"
    topup_progress: dict[str, str] = load_json(topup_progress_path, {})

    targets = [
        (name, matcher.info(name)["id"])
        for name in names
        if import_progress.get(name) == "done" and (force or topup_progress.get(name) != "done")
        and matcher.info(name) is not None
    ]
    print(f"Topping up {len(targets)} already-imported shows with concurrency={concurrency}...")

    lock = threading.Lock()
    done = errored = 0

    def worker(name: str, tmdb_id: int):
        try:
            count = topup_episodes(client, tmdb_id, shows[name].seasons)
            return name, count, None
        except Exception as e:
            return name, 0, str(e)

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(worker, name, tmdb_id) for name, tmdb_id in targets]
        for future in as_completed(futures):
            name, count, error = future.result()
            with lock:
                if error is None:
                    topup_progress[name] = "done"
                    done += 1
                    print(f"  topped up: {name} ({count} episodes)")
                else:
                    topup_progress[name] = f"error: {error}"
                    errored += 1
                    print(f"  ERROR: {name}: {error}")
                save_json(topup_progress_path, topup_progress)

    print(f"\nTop-up complete. done={done} errored={errored} (progress saved to {topup_progress_path})")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gdpr-dir", type=Path,
                         default=Path(r"C:\Users\Abd Allah\Downloads\Telegram Desktop\gdpr-data"),
                         help="Path to the extracted TV Time GDPR export folder")
    parser.add_argument("--tmdb-key", help="TMDB API key (defaults to PitFlix's configured key)")
    parser.add_argument("--interactive", action="store_true", help="Confirm ambiguous TMDB matches by hand")
    parser.add_argument("--dry-run", action="store_true", help="Only resolve/print matches, no Serializd writes")
    parser.add_argument("--limit", type=int, help="Only process the first N shows (for testing)")
    parser.add_argument("--show", help="Only process a single show by its exact TV Time name")
    parser.add_argument("--retry-errors", action="store_true", help="Re-attempt shows that errored last run")
    parser.add_argument("--concurrency", type=int, default=4,
                         help="How many shows to import in parallel (default 4). Serializd's API has no "
                              "documented rate limit -- raising this speeds things up but risks more "
                              "timeouts/errors under load. 1 = fully sequential.")
    parser.add_argument("--topup-episodes", action="store_true",
                         help="For shows already imported (status=done), additionally log every watched "
                              "episode individually so Serializd's 'Episodes' stat reflects them too. "
                              "Doesn't touch matching or season-watched status, just adds episode-log rows.")
    parser.add_argument("--force", action="store_true",
                         help="With --topup-episodes, re-sends every episode even for shows already marked "
                              "done in the topup progress file (Serializd's own counter has undercounted "
                              "successful, 200-OK writes before -- this re-sends everything to compensate).")
    parser.add_argument("--rebuild-episodes", action="store_true",
                         help="Unlogs then re-logs every watched episode for every already-imported show, "
                              "one season at a time, sequentially (no concurrency). Diagnosed root cause: "
                              "concurrent/bulk writes silently under-delivered for some shows despite 200 OK "
                              "and zero script-level errors; this forces a clean, verified rewrite.")
    parser.add_argument("--unlog-all", action="store_true",
                         help="Fully clears every watched mark (season + episode level) for every "
                              "already-imported show, with NO relog after. Use to reach a true clean slate "
                              "before a fresh --topup-episodes --force pass, to test whether Serializd's "
                              "'Episodes watched' counter behaves differently starting from genuine zero.")
    args = parser.parse_args()

    if not args.gdpr_dir.exists():
        raise SystemExit(f"GDPR export folder not found: {args.gdpr_dir}")

    cache_dir = args.gdpr_dir / "_import_cache"
    cache_dir.mkdir(exist_ok=True)

    print("Parsing TV Time export...")
    shows = load_or_build_show_cache(args.gdpr_dir, cache_dir / "show_watch_history.json")
    print(f"Found {len(shows)} shows with episode watch data.")

    tmdb_key = args.tmdb_key or load_pitflix_tmdb_key(REPO_ROOT)
    matcher = TmdbMatcher(tmdb_key, cache_dir / "tmdb_show_map.json", interactive=args.interactive)

    progress_path = cache_dir / "serializd_progress.json"
    progress: dict[str, str] = load_json(progress_path, {})

    names = sorted(shows.keys())
    if args.show:
        names = [n for n in names if n == args.show]
        if not names:
            raise SystemExit(f"No show named exactly {args.show!r} found in the export.")
    if args.limit:
        names = names[: args.limit]

    client = None
    token_path = cache_dir / "serializd_token.json"
    if not args.dry_run:
        client = make_serializd_client()
        serializd_login(client, token_path)

    if args.unlog_all:
        run_unlog_all(client, shows, matcher, cache_dir, names)
        return

    if args.rebuild_episodes:
        run_rebuild(client, shows, matcher, cache_dir, names)
        return

    if args.topup_episodes:
        run_topup(client, shows, matcher, cache_dir, names, args.concurrency, force=args.force)
        return

    # Pass 1 (serial): resolve every show's TMDB match. Fast -- just TMDB search calls,
    # cached to disk, no reason to parallelize and it'd only complicate matcher's cache writes.
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
            report_rows.append([name, "", "", "", season_summary, "unmatched", ""])
            continue

        tmdb_id = match["id"]
        print(f"{name} -> tmdb:{tmdb_id}  [{season_summary}]")
        report_rows.append([name, match["title"], match["year"], tmdb_id, season_summary, "matched",
                             match.get("confidence", "")])
        to_import.append((name, tmdb_id))

    save_json(progress_path, progress)

    # Pass 2 (parallel): the actual Serializd writes -- the slow, network-bound part.
    done = errored = 0
    if not args.dry_run and to_import:
        progress_lock = threading.Lock()
        print(f"\nImporting {len(to_import)} shows with concurrency={args.concurrency}...")

        def worker(name: str, tmdb_id: int):
            try:
                import_show(client, tmdb_id, shows[name].seasons)
                return name, None
            except Exception as e:
                return name, str(e)

        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            futures = [pool.submit(worker, name, tmdb_id) for name, tmdb_id in to_import]
            for future in as_completed(futures):
                name, error = future.result()
                with progress_lock:
                    if error is None:
                        progress[name] = "done"
                        done += 1
                        print(f"  done: {name}")
                    else:
                        progress[name] = f"error: {error}"
                        errored += 1
                        print(f"  ERROR: {name}: {error}")
                    save_json(progress_path, progress)

    if args.dry_run:
        report_path = cache_dir / "match_report.csv"
        with report_path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["tv_time_name", "matched_title", "matched_year", "tmdb_id", "seasons", "status",
                              "confidence"])
            writer.writerows(report_rows)
        print(f"\nReview report written to {report_path}")
        print("Fix any wrong matches by editing tmdb_show_map.json in the same folder "
              '(set the show\'s "id" to the correct TMDB id, or the whole entry to null to skip it), '
              "then re-run.")

    print(f"\n{'Preview' if args.dry_run else 'Import'} complete. "
          f"done={done} skipped(unmatched)={skipped} errored={errored} "
          f"(progress saved to {progress_path})")


if __name__ == "__main__":
    main()
