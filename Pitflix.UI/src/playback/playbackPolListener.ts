import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import type { PlaybackPolEventPayload } from "./playbackTypes";
import { usePlaybackPolStore } from "./playbackStore";
import { useActivePlayerStore } from "../store/activePlayerStore";

let unlistenPol: UnlistenFn | null = null;
let unlistenIpcError: UnlistenFn | null = null;

/**
 * Subscribes once to `playback-pol-event` and feeds the central zustand store.
 * Also listens to `player-ipc-error` as a safety net: when mpv's IPC pipe dies
 * (user closes mpv window directly), this clears the chip even if PlayerPage
 * has already unmounted and its own listener is gone.
 * Call from a root shell (e.g. `App`) so POL is warm before `/player`.
 */
export function startPlaybackPolEventListener(): () => void {
  if (!isTauri()) {
    return () => {};
  }
  if (unlistenPol) {
    return () => {
      void unlistenPol?.();
      unlistenPol = null;
      void unlistenIpcError?.();
      unlistenIpcError = null;
    };
  }

  void listen<PlaybackPolEventPayload>("playback-pol-event", (ev) => {
    usePlaybackPolStore.getState().applyPayload(ev.payload);
  }).then((u) => {
    unlistenPol = u;
  });

  // Safety-net: when the IPC pipe dies (mpv closed by user) the Rust side emits
  // this event before the coalesced playback-pol-event arrives. Clear both stores
  // immediately so the "Now Playing" chip disappears without waiting for the
  // orchestrator state to propagate.
  // Only act if the pol store currently shows an active phase AND no switch is in
  // progress — avoids falsely clearing state during internal close-and-reopen
  // (episode/sibling switches, or player2_open on an already-open session).
  void listen<{ message?: string; session_id?: number }>("player-ipc-error", () => {
    if (useActivePlayerStore.getState().switchInProgress) return;
    const phase = usePlaybackPolStore.getState().snapshot.phase;
    const isActive = phase === "loading" || phase === "playing" || phase === "paused" || phase === "buffering";
    if (isActive) {
      usePlaybackPolStore.getState().reset();
      useActivePlayerStore.getState().setLaunchState(null);
    }
  }).then((u) => {
    unlistenIpcError = u;
  });

  return () => {
    void unlistenPol?.();
    unlistenPol = null;
    void unlistenIpcError?.();
    unlistenIpcError = null;
  };
}
