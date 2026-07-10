import type { PlayerControlSize, PlayerLayoutControlId, PlayerLayoutPrefs } from "./playerLayoutTypes";

export type PlayerLayoutSizeClasses = {
  navBtn: string;
  navIcon: string;
  seekBtn: string;
  seekIcon: string;
  seekLabel: string;
  playBtn: string;
  playIcon: string;
  secondaryBtn: string;
  secondaryIcon: string;
};

const SIZE_MAP: Record<PlayerControlSize, PlayerLayoutSizeClasses> = {
  compact: {
    navBtn: "h-8 w-8",
    navIcon: "h-[15px] w-[15px]",
    seekBtn: "h-8 w-8",
    seekIcon: "h-[13px] w-[13px]",
    seekLabel: "text-[6px]",
    playBtn: "h-10 w-10",
    playIcon: "h-4 w-4",
    secondaryBtn: "h-8 w-8",
    secondaryIcon: "h-3.5 w-3.5",
  },
  default: {
    navBtn: "h-9 w-9",
    navIcon: "h-[18px] w-[18px]",
    seekBtn: "h-9 w-9",
    seekIcon: "h-[15px] w-[15px]",
    seekLabel: "text-[7px]",
    playBtn: "h-12 w-12",
    playIcon: "h-5 w-5",
    secondaryBtn: "h-9 w-9",
    secondaryIcon: "h-4 w-4",
  },
  large: {
    navBtn: "h-11 w-11",
    navIcon: "h-[21px] w-[21px]",
    seekBtn: "h-11 w-11",
    seekIcon: "h-[18px] w-[18px]",
    seekLabel: "text-[8px]",
    playBtn: "h-14 w-14",
    playIcon: "h-6 w-6",
    secondaryBtn: "h-11 w-11",
    secondaryIcon: "h-[18px] w-[18px]",
  },
};

const SCALE_MAP: Record<PlayerControlSize, number> = {
  compact: 0.9,
  default: 1,
  large: 1.1,
};

export const CONTROL_SCALE_MIN = 0.65;
export const CONTROL_SCALE_MAX = 1.45;
export const CONTROL_SCALE_DEFAULT = 1;
export const CONTROL_SCALE_STEP = 0.01;

export function getPlayerLayoutSizeClasses(size: PlayerControlSize): PlayerLayoutSizeClasses {
  return SIZE_MAP[size] ?? SIZE_MAP.default;
}

export function resolveControlSize(prefs: PlayerLayoutPrefs, id: PlayerLayoutControlId): PlayerControlSize {
  return prefs.controlSizes[id] ?? prefs.controlSize;
}

export function controlSizeScale(size: PlayerControlSize): number {
  return SCALE_MAP[size] ?? 1;
}

export function clampControlScale(scale: number): number {
  return Math.min(CONTROL_SCALE_MAX, Math.max(CONTROL_SCALE_MIN, scale));
}

export function resolveControlScale(prefs: PlayerLayoutPrefs, id: PlayerLayoutControlId): number {
  const explicit = prefs.controlScales[id];
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return clampControlScale(explicit);
  }
  const legacy = prefs.controlSizes[id];
  if (legacy) return clampControlScale(controlSizeScale(legacy));
  return CONTROL_SCALE_DEFAULT;
}

export function hasControlScaleOverride(prefs: PlayerLayoutPrefs, id: PlayerLayoutControlId): boolean {
  return prefs.controlScales[id] != null || prefs.controlSizes[id] != null;
}

export function getControlSizeClasses(prefs: PlayerLayoutPrefs, id: PlayerLayoutControlId): PlayerLayoutSizeClasses {
  return getPlayerLayoutSizeClasses(resolveControlSize(prefs, id));
}

export const TIME_LABEL_SIZE_CLASSES: Record<PlayerControlSize, string> = {
  compact: "text-[10px]",
  default: "text-[12px]",
  large: "text-[14px]",
};
