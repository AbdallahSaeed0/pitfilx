import api, { API_ORIGIN } from "./client";
import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";

export type PlayPayload = {
  filePath: string;
  mediaId: number;
  episodeId?: number;
  startPosition: number;
  subtitleTrack?: string;
  /** Which WPF companion to launch: "pitflix" (default) or "pitflix2" */
  player?: string;
};

export type PlayerSession = {
  sessionId: string;
  mediaId: number;
  episodeId?: number;
  filePath: string;
  position: number;
  duration: number;
  isPaused: boolean;
  isStopped: boolean;
  subtitleTrack?: string;
  startedAt: string;
  lastUpdatedAt: string;
  pipeName: string;
};

/** ws:// (or wss://) URL derived from the same origin as all other API calls. */
export const PLAYER_WS_URL =
  API_ORIGIN.replace(/^http/, "ws") + "/api/player/ws";

export const playMedia = (payload: PlayPayload): Promise<PlayerSession> =>
  api.post<PlayerSession>("/player/play", payload).then((r) => r.data);

export const sendCommand = (command: string, value?: number): Promise<void> =>
  api.post("/player/command", { command, value }).then(() => undefined);

export const getSession = async (): Promise<PlayerSession | null> => {
  try {
    return await api.get<PlayerSession>("/player/session").then((r) => r.data);
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw e;
  }
};

export const stopPlayer = (): Promise<void> =>
  api.post("/player/stop").then(() => undefined);

/**
 * Opens the WPF companion player (PitflixPlayer.exe) for the current active session.
 * The WPF app connects to the backend on its own — no payload needed.
 * Falls back silently when not running inside Tauri.
 */
export const openPlayerWindow = async (): Promise<void> => {
  if (!isTauri()) return;
  await invoke("player3_open", {});
};

/**
 * Shows/hides the Windows taskbar thumbnail toolbar (Previous / Play-Pause /
 * Next) and reflects play/pause state. No-op outside Tauri.
 */
export const taskbarSetPlaying = async (
  hasSession: boolean,
  isPlaying: boolean,
): Promise<void> => {
  if (!isTauri()) return;
  try {
    await invoke("taskbar_set_playing", { hasSession, isPlaying });
  } catch (err) {
    console.error("[pitflix-player] taskbar_set_playing failed", err);
    void invoke("player2_debug_log", {
      line: `taskbar_set_playing invoke failed: ${err instanceof Error ? err.message : String(err)}`,
    }).catch(() => {});
  }
};

/**
 * Draws/clears a PotPlayer-style playback-progress line on the main window's
 * taskbar icon. `fraction` is 0..1 through the current file. No-op outside Tauri.
 */
export const taskbarSetProgress = async (
  hasSession: boolean,
  fraction: number,
  isPaused: boolean,
): Promise<void> => {
  if (!isTauri()) return;
  try {
    await invoke("taskbar_set_progress", { hasSession, fraction, isPaused });
  } catch (err) {
    console.error("[pitflix-player] taskbar_set_progress failed", err);
  }
};
