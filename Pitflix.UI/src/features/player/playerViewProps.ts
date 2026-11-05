import type { RefObject, Dispatch, SetStateAction } from "react";
import type { NextLibraryEpisode } from "../../api/series";
import type { CompanionEpisodeRow } from "./PlayerCompanionEpisodeList";
import type { PlaybackLaunchState } from "../../types/playback";
import type { PlaybackStatus } from "../../utils/playbackStatus";
import type { ActiveSkipSegment } from "../../components/player/SkipSegmentOverlay";
import type { PlaybackStoreSnapshot } from "../../playback/playbackTypes";
import type {
  DeviceFsEntry,
  MpvTrack,
  Player2NativeState,
  PlayerSubtitlePrefs,
  PlaylistEpisodeMeta,
} from "./playerTypes";
import type { PlayerLayoutPrefs } from "./playerLayoutTypes";

/** Shared media / session context for companion layout. */
export interface PlayerCompanionMediaProps {
  state: PlaybackLaunchState;
  ctxLabel: string | null;
  seriesDisplayTitle: string;
  episodeTitle: string | null;
  backdropPath: string | null;
  uiPct: number;
  uiTimePos: number;
  uiDuration: number;
  resumeMarkerSec: number | null | undefined;
}

/** Season episode list + prev/next navigation for series companion mode. */
export interface PlayerCompanionSeriesProps {
  seasonEpisodes: CompanionEpisodeRow[];
  seasonEpisodesLoading: boolean;
  seasonName: string | null;
  prevEp: NextLibraryEpisode | null | undefined;
  nextEp: NextLibraryEpisode | null | undefined;
  playPrevious: () => void | Promise<void>;
  playNext: () => void | Promise<void>;
  onSelectEpisode: (ep: CompanionEpisodeRow) => void;
}

/** Playback status + POL snapshot for external companion sync. */
export interface PlayerCompanionPlaybackProps {
  playbackStatusMapped: PlaybackStatus;
  polSeq: number;
  polSnap: PlaybackStoreSnapshot;
  effectiveEnded: boolean;
  effectiveSessionDead: boolean;
}

/** Transport error recovery on the companion shell. */
export interface PlayerCompanionTransportProps {
  transportError: string | null;
  setTransportError: Dispatch<SetStateAction<string | null>>;
  setResumeOptimistic: Dispatch<SetStateAction<boolean>>;
}

/** Native backend + navigation actions for companion mode. */
export interface PlayerCompanionNativeProps {
  nativeState: Player2NativeState | null;
  nativeStateRef: RefObject<Player2NativeState | null>;
  playerRootRef: RefObject<HTMLDivElement | null>;
  browseWhilePlaying: () => void | Promise<void>;
  exitAndClose: () => void | Promise<void>;
}

/** Arabic subtitle generation controls (companion hero actions). */
export interface PlayerCompanionArabicSubtitleProps {
  generateArabicSubtitle: () => void | Promise<void>;
  arabicSubtitleGenerating: boolean;
  arabicSubtitleProgress: { current: number; total: number } | null;
  arabicSubtitleError: string | null;
}

export type PlayerCompanionViewProps = PlayerCompanionMediaProps &
  PlayerCompanionSeriesProps &
  PlayerCompanionPlaybackProps &
  PlayerCompanionTransportProps &
  PlayerCompanionNativeProps &
  PlayerCompanionArabicSubtitleProps &
  PlayerEmbeddedSpeedProps;

/** Launch state + labels for embedded chrome. */
export interface PlayerEmbeddedMediaProps {
  state: PlaybackLaunchState;
  /** Movie's backdrop path (landscape, ~1280px) for the pause info screen — the episode
   * counterpart comes from playlistEpisodeMetaByPath's stills instead. Null for series/unresolved. */
  moviePauseBackdropPath: string | null;
}

/** DOM refs wired by PlayerPage effects (bounds, focus, seek). */
export interface PlayerEmbeddedRefsProps {
  videoAreaRef: RefObject<HTMLDivElement | null>;
  playerHeaderChromeRef: RefObject<HTMLElement | null>;
  playerFooterChromeRef: RefObject<HTMLDivElement | null>;
  volumeWheelRef: RefObject<HTMLElement | null>;
  seekDraggingRef: RefObject<boolean>;
  volumeDraggingRef: RefObject<boolean>;
  seekBarHoveringRef: RefObject<boolean>;
  seekHoverDebounceRef: RefObject<ReturnType<typeof setTimeout> | null>;
  launchStateRef: RefObject<PlaybackLaunchState | undefined>;
}

/** Which overlay bar(s) the last pointer activity woke ("none" = cursor only, no bars). */
export type PlayerChromeZone = "all" | "top" | "bottom" | "none";

/** Fullscreen auto-hide chrome + toggle. */
export interface PlayerEmbeddedFullscreenProps {
  isFullscreen: boolean;
  isMaximized: boolean;
  fsControlsVisible: boolean;
  chromeZone: PlayerChromeZone;
  onFullscreenPointerActivity: () => void;
  /** Pointer moved over the player; `zone` null keeps the current zone. */
  onChromePointerActivity: (zone: PlayerChromeZone | null) => void;
  /** Right-click anywhere on the player surface (open options menu). */
  onPlayerRightClick: (clientX: number, clientY: number) => void;
  onFullscreen: () => void | Promise<void>;
  onToggleMaximize: () => void | Promise<void>;
}

/** Video surface settling / engine flags. */
export interface VideoLetterboxInsets {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface PlayerEmbeddedVideoSurfaceProps {
  videoSettling: boolean;
  loading: boolean;
  useLibMpv: boolean;
  embedReady: boolean;
  letterboxInsets: VideoLetterboxInsets;
}

/** Series prev/next episode controls. */
export interface PlayerEmbeddedEpisodeNavProps {
  prevEp: NextLibraryEpisode | null | undefined;
  nextEp: NextLibraryEpisode | null | undefined;
  playPrevious: () => void | Promise<void>;
  playNext: () => void | Promise<void>;
}

/** Folder sibling prev/next (My Device / loose files). */
export interface PlayerEmbeddedFolderNavProps {
  prevSibling: DeviceFsEntry | null;
  nextSibling: DeviceFsEntry | null;
  hasFolderNav: boolean;
}

/** Skip intro/outro overlay. */
export interface PlayerEmbeddedSkipProps {
  activeSkipSegment: ActiveSkipSegment | null;
  skipActiveSegment: () => void;
  dismissActiveSkipSegment: () => void;
}

/** Folder playlist sidebar. */
export interface PlayerEmbeddedPlaylistProps {
  currentFolderForPlaylist: string | null;
  folderPlaylistOpen: boolean;
  folderPlaylistPinned: boolean;
  folderPlaylistBusy: boolean;
  folderPlaylistEntries: DeviceFsEntry[];
  setFolderPlaylistEntries: Dispatch<SetStateAction<DeviceFsEntry[]>>;
  setFolderPlaylistOpen: Dispatch<SetStateAction<boolean>>;
  setFolderPlaylistPinned: Dispatch<SetStateAction<boolean>>;
  navigateToSiblingFile: (entry: DeviceFsEntry) => void | Promise<void>;
  exitAndClose: () => void | Promise<void>;
  /** Library episode metadata for rows that match a season episode, keyed by
   * `normalizeMediaPathKey(filePath)` — lets the folder playlist render
   * episode cards (title/IMDb/runtime/synopsis) instead of raw filenames. */
  playlistEpisodeMetaByPath: Map<string, PlaylistEpisodeMeta>;
}

/** Seek bar, play/pause, and transport error UI. */
export interface PlayerEmbeddedTransportProps {
  sessionBlocksTransport: boolean;
  timePos: number;
  duration: number;
  pct: number;
  remaining: number;
  ended: boolean;
  sessionDead: boolean;
  displayPaused: boolean;
  playbackTransportPending: boolean;
  transportError: string | null;
  setTransportError: Dispatch<SetStateAction<string | null>>;
  setResumeOptimistic: Dispatch<SetStateAction<boolean>>;
  handlePrimaryTransport: () => void | Promise<void>;
  seekRel: (seconds: number) => void;
  send: (cmd: unknown) => Promise<void>;
  setTimePos: Dispatch<SetStateAction<number>>;
  seekToAbsolute: (seconds: number) => void;
  uiTimePos: number;
  /** Keyboard-arrow skip readout shown by the mini progress bar (null = hidden). */
  seekHud: SeekHudState | null;
  /** Shows/extends the skip readout for a relative skip (arrow keys or the skip buttons). */
  bumpSeekHud: (deltaSeconds: number) => void;
  abLoop: AbLoopState;
  onClearAbLoop: () => void;
  uiDuration: number;
}

/** Seek hover preview thumbnails. */
export interface PlayerEmbeddedSeekHoverProps {
  seekHover: {
    pixelX: number;
    seconds: number;
    dataUrl: string | null;
    loading: boolean;
  } | null;
  setSeekHover: Dispatch<
    SetStateAction<{
      pixelX: number;
      seconds: number;
      dataUrl: string | null;
      loading: boolean;
    } | null>
  >;
  scheduleHoverThumb: (filePath: string, seconds: number) => void;
  /** Exact (non-bucketed) frame fetch — used on an actual seek-bar click so the shown preview
   * matches exactly where the video lands, instead of the ~2.5s-rounded hover-sweep preview. */
  scheduleExactHoverThumb: (filePath: string, seconds: number) => void;
}

/** Subtitle tracks, appearance, and Arabic generation. */
export interface PlayerEmbeddedSubtitlesProps {
  subVisible: boolean;
  subTracks: MpvTrack[];
  externalSubFiles: string[];
  subMenuValue: string;
  /** Second (dual) subtitle, same value format as `subMenuValue`: "" | "e:<id>" | "x:<encoded path>". */
  secondaryMenuValue: string;
  onPickSecondary: (value: string) => void;
  toggleSub: () => void;
  subAppearanceOpen: boolean;
  setSubAppearanceOpen: Dispatch<SetStateAction<boolean>>;
  subtitlePrefs: PlayerSubtitlePrefs;
  setSubtitlePref: <K extends keyof PlayerSubtitlePrefs>(key: K, value: PlayerSubtitlePrefs[K]) => void;
  setSubtitlePrefs: Dispatch<SetStateAction<PlayerSubtitlePrefs>>;
  subDelay: number;
  generateArabicSubtitle: () => void | Promise<void>;
  arabicSubtitleGenerating: boolean;
  arabicSubtitleError: string | null;
  /** Opens the online subtitle search drawer (OpenSubtitles / SubDL). */
  onOpenSubtitleSearch: () => void;
}

/** Volume / mute controls. */
export interface PlayerEmbeddedVolumeProps {
  volume: number;
  mute: boolean;
  toggleMute: () => void;
  setVolumePct: (pct: number) => void;
  volumeHudVisible: boolean;
}

/** A-B loop points in seconds. `a` set + `b` null = waiting for the end point. */
export type AbLoopState = { a: number | null; b: number | null };

export type SeekHudState = {
  /** Estimated landing point (seconds) while mpv is still seeking — lets rapid presses stack
   *  instantly instead of showing a stale position. */
  target: number;
  /** Total skipped in this burst (seconds, signed). Exact once `settled`. */
  delta: number;
  /** mpv reported where the seek actually landed (keyframe seeks rarely hit `target` exactly):
   *  from here the readout follows the real playhead instead of the estimate. */
  settled: boolean;
};

/** Playback speed (mpv `speed` property). */
export interface PlayerEmbeddedSpeedProps {
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  skipSeconds: number;
}

/** Audio track picker. */
export interface PlayerEmbeddedAudioProps {
  aid: number | null;
  audioTracks: MpvTrack[];
}

/** Always-on-top and player settings popup. */
export interface PlayerEmbeddedSettingsProps {
  alwaysOnTop: boolean;
  toggleAlwaysOnTop: () => void;
  layoutPrefs: PlayerLayoutPrefs;
  /** Picture-in-Picture (mini player) — shrinks this window into a small always-on-top corner
   * overlay with chrome hidden, rather than a separate floating window/session. */
  isPip: boolean;
  togglePip: () => void;
  /** In-app mini player — the player shrinks into a corner of the main window while the app is browsed. */
  inAppMini: boolean;
  onEnterInAppMini: () => void;
  onExpandInAppMini: () => void;
}

/** Dev-only IPC diagnostics panel. */
export interface PlayerEmbeddedDevToolsProps {
  nativeState: Player2NativeState | null;
  embeddedSafeMode: boolean;
  setEmbeddedSafeMode: Dispatch<SetStateAction<boolean>>;
  lastMpvCrashLog: string | null;
  setLastMpvCrashLog: Dispatch<SetStateAction<string | null>>;
  effectiveStart: number | null | undefined;
}

/** Episode details modal from header. */
export interface PlayerEmbeddedEpisodeInfoProps {
  episodeInfoOpen: boolean;
  setEpisodeInfoOpen: Dispatch<SetStateAction<boolean>>;
}

/** Close player / window exit from embedded header. */
export interface PlayerEmbeddedNavigationProps {
  exitAndClose: () => void | Promise<void>;
}

export type PlayerEmbeddedViewProps = PlayerEmbeddedMediaProps &
  PlayerEmbeddedRefsProps &
  PlayerEmbeddedFullscreenProps &
  PlayerEmbeddedVideoSurfaceProps &
  PlayerEmbeddedEpisodeNavProps &
  PlayerEmbeddedFolderNavProps &
  PlayerEmbeddedSkipProps &
  PlayerEmbeddedPlaylistProps &
  PlayerEmbeddedTransportProps &
  PlayerEmbeddedSeekHoverProps &
  PlayerEmbeddedSubtitlesProps &
  PlayerEmbeddedVolumeProps &
  PlayerEmbeddedSpeedProps &
  PlayerEmbeddedAudioProps &
  PlayerEmbeddedSettingsProps &
  PlayerEmbeddedDevToolsProps &
  PlayerEmbeddedEpisodeInfoProps &
  PlayerEmbeddedNavigationProps;
