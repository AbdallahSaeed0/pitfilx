// Video durations for My Device's duration badge + "sort by duration". Read natively in batches
// (`device_video_durations` — Windows' own media properties, ffmpeg header probe as a fallback)
// and cached per path + file size, so a folder's durations are only ever probed once.
//
// Private Mode durations are kept in memory only — never written to localStorage — so private
// file paths don't leak into normal persistent storage.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "pitflix.device.videoDurations.v1";
const MAX_PERSISTED = 20_000;
const BATCH_SIZE = 60;

/** [seconds, sizeBytes] — size lets a replaced file (same path, different content) re-probe. */
type Persisted = Record<string, [number, number]>;

const cache = new Map<string, { secs: number | null; size: number }>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let persisted: Persisted | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function keyOf(path: string): string {
  return path.replace(/\//g, "\\").toLowerCase();
}

function loadPersisted(): Persisted {
  if (persisted) return persisted;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    persisted = raw ? (JSON.parse(raw) as Persisted) : {};
  } catch {
    persisted = {};
  }
  for (const [k, [secs, size]] of Object.entries(persisted)) {
    if (!cache.has(k)) cache.set(k, { secs, size });
  }
  return persisted;
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const data = loadPersisted();
    const keys = Object.keys(data);
    if (keys.length > MAX_PERSISTED) {
      for (const k of keys.slice(0, keys.length - MAX_PERSISTED)) delete data[k];
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // quota — durations just get re-probed next session
    }
  }, 1500);
}

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Cached duration in seconds, or undefined when not (yet) known. */
export function getVideoDuration(path: string): number | undefined {
  loadPersisted();
  const hit = cache.get(keyOf(path));
  return hit?.secs ?? undefined;
}

export type DurationRequest = { path: string; size?: number | null };

/** Probes every not-yet-cached video in the background; subscribers re-render as batches land. */
export function requestVideoDurations(items: DurationRequest[], opts: { persist: boolean }): void {
  if (!isTauri() || items.length === 0) return;
  const store = loadPersisted();
  const todo: DurationRequest[] = [];
  for (const item of items) {
    const k = keyOf(item.path);
    const hit = cache.get(k);
    const size = item.size ?? 0;
    if (hit && (hit.size === size || !item.size)) continue;
    if (inFlight.has(k)) continue;
    inFlight.add(k);
    todo.push(item);
  }
  if (todo.length === 0) return;

  void (async () => {
    for (let i = 0; i < todo.length; i += BATCH_SIZE) {
      const batch = todo.slice(i, i + BATCH_SIZE);
      let results: (number | null)[] = [];
      try {
        results = await invoke<(number | null)[]>("device_video_durations", {
          paths: batch.map((b) => b.path),
        });
      } catch {
        results = batch.map(() => null);
      }
      batch.forEach((b, idx) => {
        const k = keyOf(b.path);
        const secs = results[idx] ?? null;
        const size = b.size ?? 0;
        inFlight.delete(k);
        cache.set(k, { secs, size });
        if (opts.persist && secs != null) {
          store[k] = [Math.round(secs * 10) / 10, size];
        }
      });
      if (opts.persist) schedulePersist();
      emit();
    }
  })();
}

/** Re-renders the caller whenever any duration arrives. */
export function useVideoDurationsVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

export function useVideoDuration(path: string): number | undefined {
  useVideoDurationsVersion();
  return getVideoDuration(path);
}

export function formatVideoDuration(totalSecs: number): string {
  const s = Math.max(0, Math.round(totalSecs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
