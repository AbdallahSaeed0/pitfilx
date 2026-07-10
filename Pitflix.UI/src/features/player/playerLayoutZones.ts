import { DEFAULT_PLAYER_LAYOUT_PREFS, type PlayerLayoutControlId, type PlayerLayoutPrefs, type PlayerLayoutZone } from "./playerLayoutTypes";
import { normalizeControlOrder } from "./playerLayoutOrder";

export function groupControlsByZone(prefs: PlayerLayoutPrefs): Record<PlayerLayoutZone, PlayerLayoutControlId[]> {
  const grouped: Record<PlayerLayoutZone, PlayerLayoutControlId[]> = {
    left: [],
    center: [],
    right: [],
  };
  const order = normalizeControlOrder(prefs.order);
  for (const id of order) {
    if (!prefs.visible[id]) continue;
    grouped[prefs.zones[id]].push(id);
  }
  return grouped;
}

export function migrateLegacyLayoutPrefs(parsed: Record<string, unknown>): PlayerLayoutPrefs {
  const transport =
    parsed.transportAlignment === "left" ||
    parsed.transportAlignment === "center" ||
    parsed.transportAlignment === "right"
      ? (parsed.transportAlignment as PlayerLayoutZone)
      : "center";
  const secondary: PlayerLayoutZone =
    parsed.secondaryAlignment === "left" ? "left" : "right";

  return {
    ...DEFAULT_PLAYER_LAYOUT_PREFS,
    controlSize:
      parsed.controlSize === "compact" || parsed.controlSize === "large"
        ? parsed.controlSize
        : DEFAULT_PLAYER_LAYOUT_PREFS.controlSize,
    zones: {
      volume: secondary,
      prev: transport,
      seekBack: transport,
      playPause: transport,
      seekForward: transport,
      next: transport,
      subtitles: secondary,
      speed: secondary,
      devtools: secondary,
      audio: secondary,
      subDelay: secondary,
    },
    visible: { ...DEFAULT_PLAYER_LAYOUT_PREFS.visible },
    order: [...DEFAULT_PLAYER_LAYOUT_PREFS.order],
  };
}
