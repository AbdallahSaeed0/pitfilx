import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import type { PlaybackPolEventPayload } from "./playbackTypes";
import { usePlaybackPolStore } from "./playbackStore";

let unlisten: UnlistenFn | null = null;

/**
 * Subscribes once to `playback-pol-event` and feeds the central zustand store.
 * Call from a root shell (e.g. `App`) so POL is warm before `/player`.
 */
export function startPlaybackPolEventListener(): () => void {
  if (!isTauri()) {
    return () => {};
  }
  if (unlisten) {
    return () => {
      void unlisten?.();
      unlisten = null;
    };
  }
  void listen<PlaybackPolEventPayload>("playback-pol-event", (ev) => {
    usePlaybackPolStore.getState().applyPayload(ev.payload);
  }).then((u) => {
    unlisten = u;
  });
  return () => {
    void unlisten?.();
    unlisten = null;
  };
}
