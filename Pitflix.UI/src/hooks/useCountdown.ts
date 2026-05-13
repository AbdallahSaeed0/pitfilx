import { format, parseISO } from "date-fns";
import { enUS } from "date-fns/locale";
import { fromZonedTime } from "date-fns-tz";
import { useEffect, useState } from "react";

/**
 * All TMDB listing dates are interpreted on the **Cairo** clock so the countdown matches regional TV listings.
 * IANA zone (Egypt, UTC+2 year-round).
 */
export const AIR_SCHEDULE_TIMEZONE = "Africa/Cairo";

/**
 * TMDB `air_date` is `YYYY-MM-DD` without timezone — treat calendar day boundaries as **Cairo** local time.
 */
function parseAirDateToEpochMs(dateStr: string, timeStr?: string | null): number | null {
  if (!dateStr?.trim()) return null;
  const ds = dateStr.trim();
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ds);
  if (!dm) return null;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;

  const ts = timeStr?.trim();
  if (!ts) {
    const wall = new Date(y, mo - 1, d, 23, 59, 59, 999);
    return fromZonedTime(wall, AIR_SCHEDULE_TIMEZONE).getTime();
  }

  const tm = /^(\d{1,2}):(\d{2})$/.exec(ts);
  if (!tm) {
    const wall = new Date(y, mo - 1, d, 23, 59, 59, 999);
    return fromZonedTime(wall, AIR_SCHEDULE_TIMEZONE).getTime();
  }
  const hh = Number(tm[1]);
  const mm = Number(tm[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
    const wall = new Date(y, mo - 1, d, 23, 59, 59, 999);
    return fromZonedTime(wall, AIR_SCHEDULE_TIMEZONE).getTime();
  }
  const wall = new Date(y, mo - 1, d, hh, mm, 0, 0);
  return fromZonedTime(wall, AIR_SCHEDULE_TIMEZONE).getTime();
}

/** Calendar label for TMDB `YYYY-MM-DD` (neutral English; matches listing row). */
export function formatAirDateForDisplay(isoDate: string): string {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!dm) return isoDate;
  const iso = `${dm[1]}-${dm[2]}-${dm[3]}`;
  try {
    return format(parseISO(iso), "MMM d, yyyy", { locale: enUS });
  } catch {
    return isoDate;
  }
}

export function useCountdown(targetUtcMs: number | null) {
  const [remainingMs, setRemainingMs] = useState(() =>
    targetUtcMs == null ? null : Math.max(0, targetUtcMs - Date.now()),
  );

  useEffect(() => {
    if (targetUtcMs == null) {
      setRemainingMs(null);
      return;
    }
    const tick = () => setRemainingMs(Math.max(0, targetUtcMs - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [targetUtcMs]);

  return remainingMs;
}

/** Epoch ms for the scheduled instant (local calendar day when date-only). Kept name for existing imports. */
export function airDateToUtcMs(airDate: string, airTime?: string | null): number | null {
  return parseAirDateToEpochMs(airDate, airTime);
}

export type CountdownUnit = "d" | "h" | "m" | "s";

export type CountdownSegment = { unit: CountdownUnit; value: number };

/** Drops leading zero segments but keeps at least the last non-empty unit (e.g. 45s). */
function trimCountdownSegments(segments: CountdownSegment[]): CountdownSegment[] {
  let start = 0;
  while (start < segments.length - 1 && segments[start].value === 0) start += 1;
  return segments.slice(start);
}

/** Segments for countdown UI — omits noisy seconds when ≥1 day remains. */
export function toCountdownSegments(ms: number | null): CountdownSegment[] | null {
  if (ms == null) return null;
  if (ms <= 0) return [];
  if (ms > 0 && ms < 1000) return [{ unit: "s", value: 1 }];
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (d >= 1) {
    return trimCountdownSegments([
      { unit: "d", value: d },
      { unit: "h", value: h },
      { unit: "m", value: m },
    ]);
  }
  if (h >= 1) {
    return trimCountdownSegments([
      { unit: "h", value: h },
      { unit: "m", value: m },
      { unit: "s", value: sec },
    ]);
  }
  return trimCountdownSegments([
    { unit: "m", value: m },
    { unit: "s", value: sec },
  ]);
}

/** Plain string for debugging or legacy use — matches historical `Xd Xh Xm Xs` shape. */
export function formatCountdown(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms <= 0) return "Airing now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(" ");
}
