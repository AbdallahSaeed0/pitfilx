import type { PlayerLayoutControlId, PlayerLayoutPrefs, PlayerLayoutZone } from "./playerLayoutTypes";
import { PLAYER_LAYOUT_CONTROL_ORDER } from "./playerLayoutTypes";

const ALL_IDS = PLAYER_LAYOUT_CONTROL_ORDER;

const ZONE_RANK: Record<PlayerLayoutZone, number> = { left: 0, center: 1, right: 2 };

export function normalizeControlOrder(order: unknown): PlayerLayoutControlId[] {
  if (!Array.isArray(order)) return [...ALL_IDS];
  const valid = order.filter(
    (id): id is PlayerLayoutControlId =>
      typeof id === "string" && ALL_IDS.includes(id as PlayerLayoutControlId),
  );
  const seen = new Set(valid);
  const missing = ALL_IDS.filter((id) => !seen.has(id));
  return [...valid, ...missing];
}

export function getControlsInZone(
  prefs: PlayerLayoutPrefs,
  zone: PlayerLayoutZone,
  opts?: { visibleOnly?: boolean },
): PlayerLayoutControlId[] {
  const visibleOnly = opts?.visibleOnly ?? true;
  return prefs.order.filter((id) => {
    if (visibleOnly && !prefs.visible[id]) return false;
    return prefs.zones[id] === zone;
  });
}

export function getControlIndexInZone(prefs: PlayerLayoutPrefs, id: PlayerLayoutControlId): number {
  const zone = prefs.zones[id];
  return getControlsInZone(prefs, zone, { visibleOnly: false }).indexOf(id);
}

/**
 * Drag-and-drop reorder: moves `id` into `zone` at `targetIndex`, where the index is measured
 * against that zone's VISIBLE controls with `id` itself excluded — matching the drag preview,
 * which only ever renders visible controls (i.e. "insert before the visible control currently at
 * this position"). Hidden controls in the zone keep their existing relative position untouched.
 * `targetIndex >= visible zone length` appends after the last visible control in the zone.
 */
export function moveControlToZoneIndex(
  prefs: PlayerLayoutPrefs,
  id: PlayerLayoutControlId,
  zone: PlayerLayoutZone,
  targetIndex: number,
): PlayerLayoutPrefs {
  const zones = prefs.zones[id] === zone ? prefs.zones : { ...prefs.zones, [id]: zone };
  const order = prefs.order.filter((x) => x !== id);
  const zoneIds = order.filter((cid) => zones[cid] === zone && prefs.visible[cid]);
  const clampedIndex = Math.max(0, Math.min(targetIndex, zoneIds.length));
  const anchorId = zoneIds[clampedIndex];

  let insertAt: number;
  if (anchorId) {
    insertAt = order.indexOf(anchorId);
  } else {
    const lastInZoneIdx = order.reduce((acc, cid, i) => (zones[cid] === zone ? i : acc), -1);
    if (lastInZoneIdx >= 0) {
      insertAt = lastInZoneIdx + 1;
    } else {
      const nextZoneIdx = order.findIndex((cid) => ZONE_RANK[zones[cid]] > ZONE_RANK[zone]);
      insertAt = nextZoneIdx === -1 ? order.length : nextZoneIdx;
    }
  }
  order.splice(insertAt, 0, id);
  return { ...prefs, zones, order };
}

export function setControlZone(
  prefs: PlayerLayoutPrefs,
  id: PlayerLayoutControlId,
  zone: PlayerLayoutZone,
): PlayerLayoutPrefs {
  if (prefs.zones[id] === zone) return prefs;

  const zones = { ...prefs.zones, [id]: zone };
  const order = prefs.order.filter((x) => x !== id);

  const lastInZoneIdx = order.reduce((acc, cid, i) => (zones[cid] === zone ? i : acc), -1);
  if (lastInZoneIdx >= 0) {
    order.splice(lastInZoneIdx + 1, 0, id);
  } else {
    const insertIdx = order.findIndex((cid) => ZONE_RANK[zones[cid]] > ZONE_RANK[zone]);
    order.splice(insertIdx === -1 ? order.length : insertIdx, 0, id);
  }

  return { ...prefs, zones, order };
}
