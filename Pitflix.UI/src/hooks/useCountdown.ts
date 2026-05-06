import { useEffect, useState } from "react";

function parseReleaseUtc(dateStr: string, timeStr?: string | null): number | null {
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
    // TMDB air_date is date-only. Using end-of-day UTC avoids "countdown is too short" in many timezones.
    return Date.UTC(y, mo - 1, d, 23, 59, 59);
  }

  const tm = /^(\d{1,2}):(\d{2})$/.exec(ts);
  if (!tm) return Date.UTC(y, mo - 1, d, 23, 59, 59);
  const hh = Number(tm[1]);
  const mm = Number(tm[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return Date.UTC(y, mo - 1, d, 23, 59, 59);
  return Date.UTC(y, mo - 1, d, hh, mm, 0);
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

export function airDateToUtcMs(airDate: string, airTime?: string | null): number | null {
  const t = parseReleaseUtc(airDate, airTime);
  if (t == null) return null;
  // TMDB air_date is local US broadcast often — treat as local midnight if no time
  return t;
}

export function formatCountdown(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms <= 0) return "Now / started";
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
