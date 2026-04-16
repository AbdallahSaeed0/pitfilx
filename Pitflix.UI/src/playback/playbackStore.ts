import { create } from "zustand";
import type { PlaybackAppEvent, PlaybackPolEventPayload, PlaybackStoreSnapshot } from "./playbackTypes";
import { normalizePlaybackAppEvent } from "./normalizePolEvent";

const idleSnapshot = (): PlaybackStoreSnapshot => ({
  phase: "idle",
  currentTime: 0,
  duration: 0,
  progressPct: 0,
  isPlaying: false,
  isBuffering: false,
  timeline: {
    logicalPosition: 0,
    windowStart: 0,
    windowEnd: 0,
    source: "engine_polled",
  },
  transport: {
    ipcHealthy: true,
    enginePaused: false,
    engineLoading: false,
    engineEnded: false,
  },
  extensions: {
    autoplayNext: {
      enabled: false,
      countdownVisible: false,
      secondsRemaining: undefined,
    },
  },
  nearEnd: { armed: false, progressPct: 0 },
});

type PlaybackPolState = {
  seq: number;
  snapshot: PlaybackStoreSnapshot;
  /** Last batch only — edge-triggered consumers read once per `playback-pol-event`. */
  lastNormalizedEvents: PlaybackAppEvent[];
  applyPayload: (payload: PlaybackPolEventPayload) => void;
  reset: () => void;
};

export const usePlaybackPolStore = create<PlaybackPolState>((set) => ({
  seq: 0,
  snapshot: idleSnapshot(),
  lastNormalizedEvents: [],
  applyPayload: (payload) =>
    set({
      seq: payload.seq,
      snapshot: payload.snapshot,
      lastNormalizedEvents: payload.events
        .map((e) => normalizePlaybackAppEvent(e))
        .filter((e): e is PlaybackAppEvent => e != null),
    }),
  reset: () =>
    set({
      seq: 0,
      snapshot: idleSnapshot(),
      lastNormalizedEvents: [],
    }),
}));
