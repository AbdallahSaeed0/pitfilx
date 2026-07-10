import { useCallback, useEffect, useState } from "react";
import {
  loadPlayerLayoutPrefs,
  PLAYER_LAYOUT_CHANGED_EVENT,
  savePlayerLayoutPrefs,
} from "../features/player/playerLayoutStorage";
import { DEFAULT_PLAYER_LAYOUT_PREFS } from "../features/player/playerLayoutTypes";
import type { PlayerLayoutControlId, PlayerLayoutPrefs, PlayerLayoutZone } from "../features/player/playerLayoutTypes";
import type { PlayerControlSize } from "../features/player/playerLayoutTypes";

export function usePlayerLayoutPrefs() {
  const [layoutPrefs, setLayoutPrefs] = useState<PlayerLayoutPrefs>(() => loadPlayerLayoutPrefs());

  useEffect(() => {
    const onChange = () => setLayoutPrefs(loadPlayerLayoutPrefs());
    window.addEventListener(PLAYER_LAYOUT_CHANGED_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(PLAYER_LAYOUT_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const commitLayoutPrefs = useCallback((prefs: PlayerLayoutPrefs) => {
    savePlayerLayoutPrefs(prefs);
    setLayoutPrefs(prefs);
  }, []);

  const setControlZone = useCallback((id: PlayerLayoutControlId, zone: PlayerLayoutZone) => {
    setLayoutPrefs((prev) => {
      const next = { ...prev, zones: { ...prev.zones, [id]: zone } };
      savePlayerLayoutPrefs(next);
      return next;
    });
  }, []);

  const setControlVisible = useCallback((id: PlayerLayoutControlId, visible: boolean) => {
    setLayoutPrefs((prev) => {
      const next = { ...prev, visible: { ...prev.visible, [id]: visible } };
      savePlayerLayoutPrefs(next);
      return next;
    });
  }, []);

  const setControlSize = useCallback((controlSize: PlayerControlSize) => {
    setLayoutPrefs((prev) => {
      const next = { ...prev, controlSize };
      savePlayerLayoutPrefs(next);
      return next;
    });
  }, []);

  const resetLayoutPrefs = useCallback(() => {
    savePlayerLayoutPrefs(DEFAULT_PLAYER_LAYOUT_PREFS);
    setLayoutPrefs(DEFAULT_PLAYER_LAYOUT_PREFS);
  }, []);

  return {
    layoutPrefs,
    setLayoutPrefs,
    commitLayoutPrefs,
    setControlZone,
    setControlVisible,
    setControlSize,
    resetLayoutPrefs,
  };
}
