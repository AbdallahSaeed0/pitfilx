import { invoke, isTauri } from "@tauri-apps/api/core";

/** Appends a line to `%LOCALAPPDATA%\\Pitflix\\pitflix-player-debug.log` (or the OS app log dir). */
export function playerDebugLog(line: string) {
  if (!isTauri()) return;
  void invoke("player2_debug_log", { line }).catch(() => {});
}

/** Every `player2_*` failure should surface somewhere — silent catches look like “dead buttons”. */
export function logPlayer2InvokeFailure(cmd: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[pitflix-player] ${cmd} failed`, err);
  playerDebugLog(`PlayerPage ${cmd} failed: ${msg}`);
}
