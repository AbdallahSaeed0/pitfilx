/**
 * Mirrors the Rust Playback Orchestration Layer (POL) payloads on the wire (serde camelCase + snake_case phase).
 * UI code should depend on these types — not on raw mpv property names.
 */

export type PlaybackPhase = "idle" | "loading" | "playing" | "paused" | "buffering" | "ended" | "error";

/** Externally-tagged JSON from serde (`{ "onPlay": null }`, etc.). */
export type PlaybackAppEventJson =
  | { onPlay: null }
  | { onPause: null }
  | { onProgress: { currentTime: number; duration: number; progressPct: number } }
  | { onEnded: null }
  | { onSeek: { from: number; to: number } }
  | { onBuffer: { active: boolean } }
  | {
      onNearEnd: {
        progressPct: number;
        remainingGateSeconds: number;
        remainingSeconds: number;
      };
    };

/** Normalized for in-app handlers (single `type` field). */
export type PlaybackAppEvent =
  | { type: "onPlay" }
  | { type: "onPause" }
  | { type: "onProgress"; currentTime: number; duration: number; progressPct: number }
  | { type: "onEnded" }
  | { type: "onSeek"; from: number; to: number }
  | { type: "onBuffer"; active: boolean }
  | {
      type: "onNearEnd";
      progressPct: number;
      remainingGateSeconds: number;
      remainingSeconds: number;
    };

export type EpisodeRef = {
  key: string;
  title?: string | null;
  mediaPath?: string | null;
  season?: number | null;
  episodeNumber?: number | null;
};

export type ResumeHints = {
  shouldOfferResume: boolean;
  resumeSeconds: number;
  reason: string;
};

export type TimelineModel = {
  logicalPosition: number;
  windowStart: number;
  windowEnd: number;
  source: string;
};

export type PlaybackStoreSnapshot = {
  phase: PlaybackPhase;
  currentTime: number;
  duration: number;
  progressPct: number;
  isPlaying: boolean;
  isBuffering: boolean;
  currentEpisode?: EpisodeRef | null;
  nextEpisode?: EpisodeRef | null;
  timeline: TimelineModel;
  resume?: ResumeHints | null;
  transport: {
    ipcHealthy: boolean;
    enginePaused: boolean;
    engineLoading: boolean;
    engineEnded: boolean;
  };
  extensions: {
    thumbnailTimeline?: unknown;
    skipIntro?: { windows: unknown[] } | null;
    autoplayNext: {
      enabled: boolean;
      countdownVisible: boolean;
      secondsRemaining?: number | null;
    };
  };
  nearEnd: {
    armed: boolean;
    progressPct: number;
  };
};

export type PlaybackPolEventPayload = {
  seq: number;
  snapshot: PlaybackStoreSnapshot;
  events: PlaybackAppEventJson[];
};
