export const DEVICE_MEDIA_SETTINGS_KEY = "pitflix.device.mediaSettings.v1";

export type DeviceMediaSettings = {
  /** Thumbnail frame picked randomly between these % positions in the video. */
  thumbMinPct: number;
  thumbMaxPct: number;
  /** First hover preview starts at a random time in this range (seconds). */
  previewStartMinSec: number;
  previewStartMaxSec: number;
  /** Each new hover / auto-advance jumps forward by a random amount in this range (seconds). */
  previewStepMinSec: number;
  previewStepMaxSec: number;
  /** While still hovering, jump to the next part after this many seconds. */
  previewAutoAdvanceSec: number;
};

export const DEFAULT_DEVICE_MEDIA_SETTINGS: DeviceMediaSettings = {
  thumbMinPct: 35,
  thumbMaxPct: 65,
  previewStartMinSec: 120,
  previewStartMaxSec: 180,
  previewStepMinSec: 300,
  previewStepMaxSec: 480,
  previewAutoAdvanceSec: 5,
};

const listeners = new Set<() => void>();

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function normalizeDeviceMediaSettings(
  raw: Partial<DeviceMediaSettings> | null | undefined,
): DeviceMediaSettings {
  const d = DEFAULT_DEVICE_MEDIA_SETTINGS;
  const thumbMinPct = clamp(Number(raw?.thumbMinPct ?? d.thumbMinPct), 0, 99);
  let thumbMaxPct = clamp(Number(raw?.thumbMaxPct ?? d.thumbMaxPct), 1, 100);
  if (thumbMaxPct <= thumbMinPct) thumbMaxPct = Math.min(100, thumbMinPct + 1);

  const previewStartMinSec = clamp(Number(raw?.previewStartMinSec ?? d.previewStartMinSec), 0, 7200);
  let previewStartMaxSec = clamp(Number(raw?.previewStartMaxSec ?? d.previewStartMaxSec), 1, 7200);
  if (previewStartMaxSec < previewStartMinSec) previewStartMaxSec = previewStartMinSec;

  const previewStepMinSec = clamp(Number(raw?.previewStepMinSec ?? d.previewStepMinSec), 1, 7200);
  let previewStepMaxSec = clamp(Number(raw?.previewStepMaxSec ?? d.previewStepMaxSec), 1, 7200);
  if (previewStepMaxSec < previewStepMinSec) previewStepMaxSec = previewStepMinSec;

  const previewAutoAdvanceSec = clamp(Number(raw?.previewAutoAdvanceSec ?? d.previewAutoAdvanceSec), 1, 120);

  return {
    thumbMinPct,
    thumbMaxPct,
    previewStartMinSec,
    previewStartMaxSec,
    previewStepMinSec,
    previewStepMaxSec,
    previewAutoAdvanceSec,
  };
}

export function loadDeviceMediaSettings(): DeviceMediaSettings {
  try {
    const raw = localStorage.getItem(DEVICE_MEDIA_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_DEVICE_MEDIA_SETTINGS };
    return normalizeDeviceMediaSettings(JSON.parse(raw) as Partial<DeviceMediaSettings>);
  } catch {
    return { ...DEFAULT_DEVICE_MEDIA_SETTINGS };
  }
}

let cachedSettings: DeviceMediaSettings | null = null;

export function getDeviceMediaSettings(): DeviceMediaSettings {
  if (!cachedSettings) cachedSettings = loadDeviceMediaSettings();
  return cachedSettings;
}

export function saveDeviceMediaSettings(next: DeviceMediaSettings): DeviceMediaSettings {
  const normalized = normalizeDeviceMediaSettings(next);
  cachedSettings = normalized;
  try {
    localStorage.setItem(DEVICE_MEDIA_SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    // ignore
  }
  listeners.forEach((cb) => cb());
  return normalized;
}

export function resetDeviceMediaSettings(): DeviceMediaSettings {
  return saveDeviceMediaSettings({ ...DEFAULT_DEVICE_MEDIA_SETTINGS });
}

export function subscribeDeviceMediaSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
