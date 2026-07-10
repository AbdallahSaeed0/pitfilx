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

export function moveControlInZone(
  prefs: PlayerLayoutPrefs,
  id: PlayerLayoutControlId,
  direction: "earlier" | "later",
): PlayerLayoutPrefs {
  const zone = prefs.zones[id];
  const zoneControls = getControlsInZone(prefs, zone, { visibleOnly: false });
  const idxInZone = zoneControls.indexOf(id);
  const swapIdx = direction === "earlier" ? idxInZone - 1 : idxInZone + 1;
  const swapWith = zoneControls[swapIdx];
  if (!swapWith) return prefs;

  const order = [...prefs.order];
  const globalIdx = order.indexOf(id);
  const swapGlobalIdx = order.indexOf(swapWith);
  if (globalIdx < 0 || swapGlobalIdx < 0) return prefs;

  order[globalIdx] = swapWith;
  order[swapGlobalIdx] = id;
  return { ...prefs, order };
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
