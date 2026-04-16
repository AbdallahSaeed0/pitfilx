/**
 * Product-level playback API. Internally maps to `player2_*` transport + `playback_pol_*` orchestration.
 * Keep UI and routing code on this surface instead of ad-hoc `invoke("player2_send", …)` for transport.
 */

import { invoke } from "@tauri-apps/api/core";
import type { PlaybackLaunchState } from "../types/playback";
import type { EpisodeRef, ResumeHints, PlaybackStoreSnapshot } from "./playbackTypes";

/** Stable POL episode key (matches typical `EpisodeRef.key` usage). */
export function playbackEpisodeKey(launch: Pick<PlaybackLaunchState, "libraryEpisodeId" | "filePath">): string {
  if (launch.libraryEpisodeId != null && launch.libraryEpisodeId > 0) {
    return `ep:${launch.libraryEpisodeId}`;
  }
  return `file:${launch.filePath}`;
}

/** Mirrors `player::commands::PlayerCommand` (tagged JSON for `player2_send`). */
export type PlayerCommand =
  | { type: "Play" }
  | { type: "Pause" }
  | { type: "SetPaused"; payload: boolean }
  | { type: "SeekRelative"; payload: number }
  | { type: "SeekAbsolute"; payload: number }
  | { type: "SetMute"; payload: boolean }
  | { type: "SetVolume"; payload: number }
  | { type: "SetSubVisibility"; payload: boolean }
  | { type: "SetSid"; payload: number }
  | { type: "SetAid"; payload: number }
  | { type: "AddSubDelay"; payload: number }
  | { type: "SubAddSelect"; payload: string }
  | { type: "Stop" };

export type LoadEpisodePolRequest = {
  current: EpisodeRef;
  next?: EpisodeRef | null;
  autoplayNext?: boolean;
};

/** Register current / next episode metadata and receive resume hints from local POL store. */
export async function playbackLoadEpisodeContext(req: LoadEpisodePolRequest): Promise<ResumeHints> {
  return invoke<ResumeHints>("playback_pol_load_episode_context", { req });
}

export async function playbackGetSnapshot(): Promise<PlaybackStoreSnapshot> {
  return invoke<PlaybackStoreSnapshot>("playback_pol_get_snapshot");
}

export async function playbackResumeHintsForKey(key: string): Promise<ResumeHints> {
  return invoke<ResumeHints>("playback_pol_resume_hints_for_key", { key });
}

export async function playbackSetNextAutoplay(enabled: boolean): Promise<void> {
  await invoke("playback_pol_set_next_autoplay", { enabled });
}

export async function playbackCancelNextCountdown(): Promise<void> {
  await invoke("playback_pol_cancel_next_countdown");
}

export async function playbackShowNextCountdown(seconds: number): Promise<void> {
  await invoke("playback_pol_show_next_countdown", { seconds });
}

export async function playbackTickNextCountdown(): Promise<number | null> {
  return invoke<number | null>("playback_pol_tick_next_countdown");
}

export async function playbackPersistProgress(): Promise<void> {
  await invoke("playback_pol_persist_progress");
}

export async function playbackSetExtensionThumbnails(descriptor: unknown | null): Promise<void> {
  await invoke("playback_pol_set_extension_thumbnails", { req: { descriptor } });
}

export async function playbackSetExtensionSkipIntro(windows: unknown[]): Promise<void> {
  await invoke("playback_pol_set_extension_skip_intro", { req: { windows } });
}

// --- Transport (mpv engine) — thin wrappers; POL receives mirrored state via `emit_state`. ---

export async function playbackPlay(): Promise<void> {
  await invoke("player2_resume");
}

export async function playbackPause(): Promise<void> {
  await invoke("player2_pause");
}

export async function playbackSeekAbsolute(seconds: number): Promise<void> {
  const cmd: PlayerCommand = { type: "SeekAbsolute", payload: seconds };
  await invoke("player2_send", { cmd });
}

export async function playbackSeekRelative(deltaSeconds: number): Promise<void> {
  const cmd: PlayerCommand = { type: "SeekRelative", payload: deltaSeconds };
  await invoke("player2_send", { cmd });
}

export type PlayerOpenPayload = { path: string; startSeconds?: number | null };

/** Opens the native player session; pair with `playbackLoadEpisodeContext` for POL metadata. */
export async function playbackOpenFile(payload: PlayerOpenPayload): Promise<void> {
  await invoke("player2_open", {
    payload: {
      path: payload.path,
      start_seconds: payload.startSeconds ?? null,
    },
  });
}

export async function playbackClose(): Promise<void> {
  await invoke("player2_close");
}
