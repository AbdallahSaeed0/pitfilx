import { useEffect, useState } from "react";

function parseReleaseUtc(dateStr: string, timeStr?: string | null): number | null {
  if (!dateStr?.trim()) return null;
  const d = timeStr?.trim()
    ? new Date(`${dateStr.trim()}T${timeStr.trim()}:00`)
    : new Date(`${dateStr.trim()}T00:00:00`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
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
