import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { openPlayerWindow } from "../../api/player";
import { fileDisplayTitle } from "../device/deviceUtils";
import { usePlayback } from "../../hooks/usePlayback";
import { playerDebugLog } from "../player/playerDebug";

const RETRY_DELAYS_MS = [500, 1000, 2000, 3000];

/**
 * Handles "Open with Pitflix" from Windows Explorer for files outside the scanned library.
 * Two delivery paths, both funnelling into the exact same direct-path playback primitive the
 * Device page uses (`usePlayback().play`, preceded by `openPlayerWindow()`) — no metadata
 * lookup, no library matching, no prompts:
 *   1. Cold start — this is a brand-new process; the file path arrived as a launch arg and the
 *      Rust side stashed it (see `take_pending_open_file_path` in src-tauri/src/lib.rs). Pulled
 *      once on mount.
 *   2. Already running — the Rust `tauri-plugin-single-instance` handler in the FIRST instance
 *      intercepts the second launch's argv and emits `open-file-path` to this already-mounted
 *      listener, then brings the existing window forward.
 *
 * On a true cold start `play()` fires while the bundled API sidecar may only just have finished
 * binding its port — its first request or two can transiently fail before the app is fully warm.
 * Retry with backoff instead of silently dropping the play request (this was seen as "app opens
 * but nothing plays" — the unhandled promise rejection from `play()` was previously swallowed).
 */
export function OpenFileListenerHost() {
  const { play } = usePlayback();

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    const attemptPlay = async (trimmed: string, name: string, attempt: number): Promise<void> => {
      if (cancelled) return;
      try {
        await play(trimmed, fileDisplayTitle(name), null, "Movie", 0, { suppressContinueWatching: true });
        playerDebugLog(`[open-with] play() succeeded on attempt ${attempt + 1} for "${trimmed}"`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        playerDebugLog(`[open-with] play() failed on attempt ${attempt + 1} for "${trimmed}": ${msg}`);
        if (cancelled || attempt >= RETRY_DELAYS_MS.length) return;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        await attemptPlay(trimmed, name, attempt + 1);
      }
    };

    const playRawFilePath = (filePath: string, source: "cold-start" | "open-file-path-event") => {
      const trimmed = filePath.trim();
      if (!trimmed || cancelled) return;
      const name = trimmed.split(/[\\/]/).pop() || trimmed;
      playerDebugLog(`[open-with] ${source}: playing "${trimmed}"`);
      void openPlayerWindow().catch(() => {});
      void attemptPlay(trimmed, name, 0);
    };

    void invoke<string | null>("take_pending_open_file_path")
      .then((path) => {
        playerDebugLog(`[open-with] take_pending_open_file_path -> ${path ?? "null"}`);
        if (path) playRawFilePath(path, "cold-start");
      })
      .catch((err) => {
        playerDebugLog(`[open-with] take_pending_open_file_path invoke failed: ${String(err)}`);
      });

    let unlisten: UnlistenFn | undefined;
    void listen<string>("open-file-path", (event) => playRawFilePath(event.payload, "open-file-path-event"))
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      void unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
