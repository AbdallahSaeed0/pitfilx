import { PLAYER_LAYOUT_PREFS_STORAGE_KEY } from "./playerConstants";
import { migrateLegacyLayoutPrefs } from "./playerLayoutZones";
import { normalizeControlOrder } from "./playerLayoutOrder";
import {
  DEFAULT_PLAYER_LAYOUT_PREFS,
  DEFAULT_SEEK_BAR_PREFS,
  PLAYER_LAYOUT_CONTROL_ORDER,
  type PlayerControlSize,
  type PlayerLayoutControlId,
  type PlayerLayoutPrefs,
  type PlayerLayoutZone,
  type PlayerSeekBarPrefs,
} from "./playerLayoutTypes";
import { parseSeekBarColor, parseSeekBarThickness } from "./playerSeekBarLayout";

export const PLAYER_LAYOUT_CHANGED_EVENT = "pitflix-player-layout-changed";

function parseZone(v: unknown, fallback: PlayerLayoutZone): PlayerLayoutZone {
  return v === "left" || v === "center" || v === "right" ? v : fallback;
}

function parseControlSize(v: unknown): PlayerControlSize {
  return v === "compact" || v === "large" ? v : "default";
}

function parseControlSizes(raw: Record<string, unknown> | undefined): Partial<Record<PlayerLayoutControlId, PlayerControlSize>> {
  const out: Partial<Record<PlayerLayoutControlId, PlayerControlSize>> = {};
  if (!raw) return out;
  for (const id of PLAYER_LAYOUT_CONTROL_ORDER) {
    const val = raw[id];
    if (val === "compact" || val === "default" || val === "large") out[id] = val;
  }
  return out;
}

function parseControlScales(raw: Record<string, unknown> | undefined): Partial<Record<PlayerLayoutControlId, number>> {
  const out: Partial<Record<PlayerLayoutControlId, number>> = {};
  if (!raw) return out;
  for (const id of PLAYER_LAYOUT_CONTROL_ORDER) {
    const val = raw[id];
    if (typeof val === "number" && Number.isFinite(val)) out[id] = val;
  }
  return out;
}

function parseSeekBar(raw: unknown): PlayerSeekBarPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SEEK_BAR_PREFS };
  const o = raw as Record<string, unknown>;
  return {
    visible: typeof o.visible === "boolean" ? o.visible : DEFAULT_SEEK_BAR_PREFS.visible,
    thickness: parseSeekBarThickness(o.thickness),
    color: parseSeekBarColor(o.color),
    thumbVisible: typeof o.thumbVisible === "boolean" ? o.thumbVisible : DEFAULT_SEEK_BAR_PREFS.thumbVisible,
    hoverPreviewVisible:
      typeof o.hoverPreviewVisible === "boolean" ? o.hoverPreviewVisible : DEFAULT_SEEK_BAR_PREFS.hoverPreviewVisible,
    currentTimeVisible:
      typeof o.currentTimeVisible === "boolean" ? o.currentTimeVisible : DEFAULT_SEEK_BAR_PREFS.currentTimeVisible,
    remainingTimeVisible:
      typeof o.remainingTimeVisible === "boolean" ? o.remainingTimeVisible : DEFAULT_SEEK_BAR_PREFS.remainingTimeVisible,
    timeLabelSize: parseControlSize(o.timeLabelSize),
  };
}

function parseZones(raw: Record<string, unknown> | undefined): Record<PlayerLayoutControlId, PlayerLayoutZone> {
  const zones = { ...DEFAULT_PLAYER_LAYOUT_PREFS.zones };
  if (!raw) return zones;
  for (const id of PLAYER_LAYOUT_CONTROL_ORDER) {
    const val = raw[id];
    if (val != null) zones[id] = parseZone(val, zones[id]);
  }
  if (raw.prevNext != null) {
    const z = parseZone(raw.prevNext, zones.prev);
    zones.prev = z;
    zones.next = z;
  }
  return zones;
}

function parseVisible(raw: Record<string, unknown> | undefined): Record<PlayerLayoutControlId, boolean> {
  const visible = { ...DEFAULT_PLAYER_LAYOUT_PREFS.visible };
  if (!raw) return visible;
  for (const id of PLAYER_LAYOUT_CONTROL_ORDER) {
    const val = raw[id];
    if (typeof val === "boolean") visible[id] = val;
  }
  if (typeof raw.prevNext === "boolean") {
    visible.prev = raw.prevNext;
    visible.next = raw.prevNext;
  }
  return visible;
}

function parseOrder(raw: unknown): PlayerLayoutControlId[] {
  if (!Array.isArray(raw)) return normalizeControlOrder(DEFAULT_PLAYER_LAYOUT_PREFS.order);
  const expanded = raw.flatMap((id) => (id === "prevNext" ? ["prev", "next"] : [id]));
  return normalizeControlOrder(expanded);
}

export function parsePlayerLayoutPrefs(raw: string | null): PlayerLayoutPrefs {
  if (!raw) return DEFAULT_PLAYER_LAYOUT_PREFS;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed.zones && (parsed.transportAlignment != null || parsed.secondaryAlignment != null)) {
      const migrated = migrateLegacyLayoutPrefs(parsed);
      const visible = parseVisible(
        parsed.visible && typeof parsed.visible === "object"
          ? (parsed.visible as Record<string, unknown>)
          : undefined,
      );
      return {
        ...migrated,
        visible,
        order: parseOrder(parsed.order ?? migrated.order),
        seekBar: parseSeekBar(parsed.seekBar ?? migrated.seekBar),
        controlScales: parseControlScales(
          parsed.controlScales && typeof parsed.controlScales === "object"
            ? (parsed.controlScales as Record<string, unknown>)
            : undefined,
        ),
        controlSizes: parseControlSizes(
          parsed.controlSizes && typeof parsed.controlSizes === "object"
            ? (parsed.controlSizes as Record<string, unknown>)
            : undefined,
        ),
      };
    }

    const rawZones =
      parsed.zones && typeof parsed.zones === "object"
        ? (parsed.zones as Record<string, unknown>)
        : undefined;
    const rawVisible =
      parsed.visible && typeof parsed.visible === "object"
        ? (parsed.visible as Record<string, unknown>)
        : undefined;

    return {
      controlSize: parseControlSize(parsed.controlSize),
      controlScales: parseControlScales(
        parsed.controlScales && typeof parsed.controlScales === "object"
          ? (parsed.controlScales as Record<string, unknown>)
          : undefined,
      ),
      controlSizes: parseControlSizes(
        parsed.controlSizes && typeof parsed.controlSizes === "object"
          ? (parsed.controlSizes as Record<string, unknown>)
          : undefined,
      ),
      zones: parseZones(rawZones),
      visible: parseVisible(rawVisible),
      order: parseOrder(parsed.order),
      seekBar: parseSeekBar(parsed.seekBar),
    };
  } catch {
    return DEFAULT_PLAYER_LAYOUT_PREFS;
  }
}

export function loadPlayerLayoutPrefs(): PlayerLayoutPrefs {
  return parsePlayerLayoutPrefs(
    typeof localStorage !== "undefined" ? localStorage.getItem(PLAYER_LAYOUT_PREFS_STORAGE_KEY) : null,
  );
}

export function savePlayerLayoutPrefs(prefs: PlayerLayoutPrefs): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PLAYER_LAYOUT_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent(PLAYER_LAYOUT_CHANGED_EVENT));
}

export function layoutPrefsEqual(a: PlayerLayoutPrefs, b: PlayerLayoutPrefs): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
