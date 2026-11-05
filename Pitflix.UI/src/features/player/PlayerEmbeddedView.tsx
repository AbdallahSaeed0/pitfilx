import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Clock,
  ListMusic,
  Maximize2,
  Minus,
  Pause as PauseIcon,
  PictureInPicture2,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { toPosterSrc, upscaleTmdbImageUrl } from "../../utils/posterSrc";
import { isNativeBackendEmbeddedLibmpv } from "../../utils/playerNativeBackend";
import { EpisodeNavigationOverlay } from "../../components/player/EpisodeNavigationOverlay";
import { PlayerPauseInfoOverlay } from "../../components/player/PlayerPauseInfoOverlay";
import { SkipSegmentOverlay } from "../../components/player/SkipSegmentOverlay";
import { SKIP_OVERLAY_DISABLED } from "./playerConstants";
import { getControlSizeClasses, getPlayerLayoutSizeClasses, resolveControlScale, TIME_LABEL_SIZE_CLASSES } from "./playerLayoutSizes";
import { getSeekBarVisualStyle } from "./playerSeekBarLayout";
import { pointerXOnTrack, seekSecondsFromPointer } from "./playerSeekBar";
import {
  getSeekHoverCached,
  getSeekHoverExact,
  getSeekHoverFrameTime,
  seekHoverExactSecond,
  seekHoverPreviewSecond,
} from "../../utils/seekHoverThumbCache";
import { groupControlsByZone } from "./playerLayoutZones";
import type { PlayerLayoutControlId } from "./playerLayoutTypes";
import { logPlayer2InvokeFailure } from "./playerDebug";
import { fmtSubDelayLabel, fmtTime, normalizeMediaPathKey } from "./playerFormat";
import { PlayerEmbeddedFolderPlaylist } from "./PlayerEmbeddedFolderPlaylist";
import { PlayerEmbeddedSubtitleMenu } from "./PlayerEmbeddedSubtitleMenu";
import { PlayerEmbeddedVolumeControl } from "./PlayerEmbeddedVolumeControl";
import { PlayerSpeedControl } from "./PlayerSpeedControl";
import { PlayerEmbeddedVolumeHud } from "./PlayerEmbeddedVolumeHud";
import { PlayerEmbeddedDevTools } from "./PlayerEmbeddedDevTools";
import { PlayerEmbeddedEpisodeInfoModal } from "./PlayerEmbeddedEpisodeInfoModal";
import { PlayerSeekSkipButton } from "./PlayerSeekSkipButton";

const SHOW_TOTAL_DURATION_KEY = "pitflix.player.showTotalDuration.v1";
/** A classic mouse-wheel notch reports ~100px (120 at some DPI settings); smaller deltas accumulate. */
const WHEEL_NOTCH_PX = 80;
import { PlayerWindowChrome } from "./PlayerWindowChrome";
import type { PlayerChromeZone, PlayerEmbeddedViewProps } from "./playerViewProps";
import { previewMiniPlayerPos, useMiniPlayerStore } from "../../store/miniPlayerStore";

export function PlayerEmbeddedView(props: PlayerEmbeddedViewProps) {
  const {
    state,
    videoAreaRef,
    playerHeaderChromeRef,
    playerFooterChromeRef,
    volumeWheelRef,
    seekDraggingRef,
    volumeDraggingRef,
    seekBarHoveringRef,
    seekHoverDebounceRef,
    launchStateRef,
    isFullscreen,
    isMaximized,
    fsControlsVisible,
    chromeZone,
    onFullscreenPointerActivity,
    onChromePointerActivity,
    onPlayerRightClick,
    onFullscreen,
    onToggleMaximize,
    useLibMpv,
    embedReady,
    prevEp,
    nextEp,
    prevSibling,
    nextSibling,
    hasFolderNav,
    playPrevious,
    playNext,
    activeSkipSegment,
    skipActiveSegment,
    dismissActiveSkipSegment,
    currentFolderForPlaylist,
    folderPlaylistOpen,
    folderPlaylistPinned,
    folderPlaylistBusy,
    folderPlaylistEntries,
    setFolderPlaylistEntries,
    setFolderPlaylistOpen,
    setFolderPlaylistPinned,
    navigateToSiblingFile,
    playlistEpisodeMetaByPath,
    moviePauseBackdropPath,
    sessionBlocksTransport,
    timePos,
    duration,
    pct,
    remaining,
    ended,
    sessionDead,
    displayPaused,
    playbackTransportPending,
    transportError,
    setTransportError,
    setResumeOptimistic,
    handlePrimaryTransport,
    seekRel,
    send,
    seekToAbsolute,
    uiTimePos,
    uiDuration,
    seekHover,
    setSeekHover,
    scheduleHoverThumb,
    scheduleExactHoverThumb,
    subVisible,
    subTracks,
    externalSubFiles,
    subMenuValue,
    secondaryMenuValue,
    onPickSecondary,
    toggleSub,
    subAppearanceOpen,
    setSubAppearanceOpen,
    subtitlePrefs,
    setSubtitlePref,
    setSubtitlePrefs,
    subDelay,
    generateArabicSubtitle,
    arabicSubtitleGenerating,
    arabicSubtitleError,
    onOpenSubtitleSearch,
    volume,
    mute,
    toggleMute,
    setVolumePct,
    volumeHudVisible,
    seekHud,
    bumpSeekHud,
    abLoop,
    onClearAbLoop,
    playbackSpeed,
    setPlaybackSpeed,
    skipSeconds,
    aid,
    audioTracks,
    alwaysOnTop,
    toggleAlwaysOnTop,
    isPip,
    togglePip,
    inAppMini,
    onEnterInAppMini,
    onExpandInAppMini,
    layoutPrefs,
    nativeState,
    embeddedSafeMode,
    setEmbeddedSafeMode,
    lastMpvCrashLog,
    setLastMpvCrashLog,
    effectiveStart,
    episodeInfoOpen,
    setEpisodeInfoOpen,
    exitAndClose,
    letterboxInsets,
  } = props;

  const showLetterbox =
    !isFullscreen &&
    (letterboxInsets.top > 0 ||
      letterboxInsets.left > 0 ||
      letterboxInsets.right > 0 ||
      letterboxInsets.bottom > 0);

  const chromeVisible = fsControlsVisible;
  /** PiP and the in-app mini player are both too small for the full chrome. */
  const compact = isPip || inAppMini;
  /** Header and footer wake independently: hovering near the top shows only the header, near the
   * bottom only the footer, the middle neither. Compact players keep showing both together. */
  const headerVisible = chromeVisible && (compact || chromeZone === "all" || chromeZone === "top");
  const footerVisible = chromeVisible && (compact || chromeZone === "all" || chromeZone === "bottom");

  /** How far past each bar's own height still counts as "near" it, so it wakes slightly early. */
  const CHROME_ZONE_SLACK_PX = 48;
  const chromeZoneForPointer = (e: React.PointerEvent<HTMLElement>): PlayerChromeZone | null => {
    if (compact) return "all";
    const target = e.target as Node;
    const header = playerHeaderChromeRef.current;
    const footer = playerFooterChromeRef.current;
    // Anything inside a bar (incl. its popup menus, which can reach into the middle) keeps that bar.
    if (footer?.contains(target)) return "bottom";
    if (header?.contains(target)) return "top";
    // Other floating UI (playlist, volume HUD, …) leaves the current zone alone.
    if (target !== e.currentTarget && !videoAreaRef.current?.contains(target)) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y <= (header?.offsetHeight ?? 72) + CHROME_ZONE_SLACK_PX) return "top";
    if (rect.height - y <= (footer?.offsetHeight ?? 130) + CHROME_ZONE_SLACK_PX) return "bottom";
    return "none";
  };

  /** The "You're watching" pause screen only after a minute paused — a quick pause shouldn't cover
   * the picture (user request). Resets the moment playback resumes. */
  const PAUSE_INFO_DELAY_MS = 60_000;
  const [pausedLong, setPausedLong] = useState(false);
  useEffect(() => {
    if (!displayPaused) {
      setPausedLong(false);
      return;
    }
    const t = window.setTimeout(() => setPausedLong(true), PAUSE_INFO_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [displayPaused]);

  /**
   * Resize the in-app mini player from its top-left corner (the bottom-right stays put). Height
   * follows at 16:9; whichever axis was dragged further sets the new width. Same per-frame DOM
   * preview + commit-on-release scheme as the move below.
   */
  const startMiniResize = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const { pos: startPos, setPos } = useMiniPlayerStore.getState();
    const startX = e.clientX;
    const startY = e.clientY;
    const posAt = (ev: PointerEvent) => {
      const growX = startX - ev.clientX;
      const growY = ((startY - ev.clientY) * 16) / 9;
      const grow = Math.abs(growX) >= Math.abs(growY) ? growX : growY;
      return { ...startPos, width: startPos.width + grow };
    };
    let frame = 0;
    let latest: PointerEvent | null = null;
    const onMove = (ev: PointerEvent) => {
      latest = ev;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (latest) previewMiniPlayerPos(posAt(latest));
      });
    };
    const onUp = (ev: PointerEvent) => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      onFullscreenPointerActivity();
      setPos(posAt(ev), true);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  /** Drag the in-app mini player around by its title. Offsets are from the bottom-right corner. */
  const startMiniDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const { pos: startPos, setPos } = useMiniPlayerStore.getState();
    const startX = e.clientX;
    const startY = e.clientY;
    const posAt = (ev: PointerEvent) => ({
      ...startPos,
      right: startPos.right - (ev.clientX - startX),
      bottom: startPos.bottom - (ev.clientY - startY),
    });
    // One DOM update per frame, however fast the pointer reports.
    let frame = 0;
    let latest: PointerEvent | null = null;
    const onMove = (ev: PointerEvent) => {
      latest = ev;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (latest) previewMiniPlayerPos(posAt(latest));
      });
    };
    const onUp = (ev: PointerEvent) => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      onFullscreenPointerActivity();
      setPos(posAt(ev), true);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const openPlayerContextMenuFromEvent = (e?: React.SyntheticEvent) => {
    // Some controls (playlist rows, seek-skip buttons) own their own right-click menu. The
    // outermost wrapper's onPointerDownCapture fires on the CAPTURE phase — before any
    // descendant's own handlers run at all — so a descendant calling stopPropagation() can't
    // preempt it. Bail out here instead, once, for every call site that funnels through this fn.
    const owned = Boolean(e && (e.target as HTMLElement | null)?.closest?.('[data-own-context-menu="true"]'));
    console.info(`[pitflix-player] [ctxmenu:embedded-view] target=${e ? (e.target as HTMLElement)?.tagName : "none"}${owned ? " OWNED->skip" : " ->open-main"}`);
    if (owned) return;
    e?.preventDefault();
    e?.stopPropagation();
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    if (e && "clientX" in e && "clientY" in e && typeof e.clientX === "number" && typeof e.clientY === "number") {
      x = e.clientX;
      y = e.clientY;
    }
    onPlayerRightClick(x, y);
  };

  const onVideoPointerDownCapture = (e: React.PointerEvent) => {
    if (e.button === 2) openPlayerContextMenuFromEvent(e);
  };

  const transportNavBtn =
    "flex shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white shadow-[0_0_12px_rgba(124,58,237,0.12)] transition-all duration-150 enabled:hover:scale-[1.05] enabled:hover:border-white/25 enabled:hover:bg-white/[0.18] disabled:border-white/5 disabled:bg-white/[0.04] disabled:opacity-40";

  const controlVisible = layoutPrefs.visible;
  const seekBarPrefs = layoutPrefs.seekBar;
  const seekBarStyle = getSeekBarVisualStyle(seekBarPrefs);
  const timeLabelClass = TIME_LABEL_SIZE_CLASSES[seekBarPrefs.timeLabelSize] ?? TIME_LABEL_SIZE_CLASSES.default;
  const seekBarTrackRef = useRef<HTMLDivElement>(null);

  // Right-hand time label: "-52:10" remaining (default) or the total length — click to switch.
  const [showTotalDuration, setShowTotalDuration] = useState<boolean>(() => {
    try { return localStorage.getItem(SHOW_TOTAL_DURATION_KEY) === "1"; } catch { return false; }
  });
  const toggleShowTotalDuration = useCallback(() => {
    setShowTotalDuration((prev) => {
      const next = !prev;
      try { localStorage.setItem(SHOW_TOTAL_DURATION_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const wheelSeekAccRef = useRef({ px: 0, at: 0 });
  const skipWithHud = useCallback((delta: number) => {
    seekRel(delta);
    bumpSeekHud(delta);
  }, [seekRel, bumpSeekHud]);
  // A-B loop overlay: amber band between A and B (or a lone A tick while waiting for B).
  const loopPct = (sec: number) => (uiDuration > 0 ? Math.min(100, Math.max(0, (sec / uiDuration) * 100)) : 0);
  const abLoopOverlay =
    abLoop.a != null && uiDuration > 0 ? (
      <>
        {abLoop.b != null ? (
          <div
            className="pointer-events-none absolute inset-y-0 z-[1]"
            style={{
              left: `${loopPct(abLoop.a)}%`,
              width: `${Math.max(0.3, loopPct(abLoop.b) - loopPct(abLoop.a))}%`,
              background: "rgba(251,191,36,0.55)",
            }}
            aria-hidden
          />
        ) : null}
        {[abLoop.a, abLoop.b].map((sec, i) =>
          sec == null ? null : (
            <div
              key={i}
              className="pointer-events-none absolute z-[2] w-[2px] -translate-x-1/2 rounded-full bg-amber-300"
              style={{ left: `${loopPct(sec)}%`, top: -3, bottom: -3 }}
              aria-hidden
            />
          ),
        )}
      </>
    ) : null;

  // Once mpv reports the landing spot, follow the live playhead (same value as the left time label)
  // rather than freezing on the landing time while the video keeps playing.
  const seekHudTime = seekHud ? (seekHud.settled ? timePos : seekHud.target) : 0;
  const seekHudPct = seekHud && uiDuration > 0 ? Math.min(100, Math.max(0, (seekHudTime / uiDuration) * 100)) : 0;
  const seekHudPill = seekHud ? (
    <div
      className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-white/10 px-2.5 py-1.5 text-[13px] font-semibold tabular-nums text-white animate-volume-osd-in [text-shadow:none]"
      style={{
        background: "rgba(12,9,28,0.86)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,58,237,0.18)",
      }}
    >
      {seekHud.delta !== 0 ? (
        <span className="rounded-md bg-pitflix-primary/80 px-1.5 py-0.5 text-[11px] font-bold">
          {seekHud.delta > 0 ? "+" : "−"}{fmtTime(Math.abs(Math.round(seekHud.delta)))}
        </span>
      ) : null}
      <span>
        {fmtTime(seekHudTime)}
        {uiDuration > 0 ? <span className="text-white/55"> / {fmtTime(Math.round(uiDuration))}</span> : null}
      </span>
    </div>
  ) : null;

  const updateSeekHover = (clientX: number) => {
    if (!state?.filePath || duration <= 0 || !seekBarTrackRef.current) return;
    const track = seekBarTrackRef.current;
    const x = pointerXOnTrack(clientX, track);
    const seconds = seekSecondsFromPointer(clientX, track, duration);
    const exact = getSeekHoverExact(state.filePath, seekHoverExactSecond(seconds));
    const cached = exact ?? getSeekHoverCached(state.filePath, seekHoverPreviewSecond(seconds));
    setSeekHover((prev) => ({
      pixelX: x,
      seconds,
      // Keep the last good frame visible (dimmed) only when nothing is saved for this spot yet; a
      // nearby saved frame shows at full brightness and the exact one replaces it if fetched.
      dataUrl: cached ?? prev?.dataUrl ?? null,
      loading: !cached,
    }));
    scheduleHoverThumb(state.filePath, seconds);
  };

  const seekFromPointer = (clientX: number) => {
    if (sessionBlocksTransport || duration <= 0 || !seekBarTrackRef.current) return;
    const seconds = seekSecondsFromPointer(clientX, seekBarTrackRef.current, duration);
    seekToAbsolute(seconds);
  };

  /** Real time of the frame the preview is showing right now (settled, not a stale one kept while
   * loading) — undefined when unknown. */
  const shownPreviewTime =
    seekHover?.dataUrl && !seekHover.loading ? getSeekHoverFrameTime(seekHover.dataUrl) : undefined;

  /**
   * A click lands on exactly the frame the preview showed: the swept preview is the nearest saved
   * keyframe, which can be seconds from the cursor, so seeking to the cursor time showed a different
   * scene than the one the user clicked on. Only for a settled preview of this same spot (within
   * the ±20 s the nearest-frame lookup searches); otherwise it seeks to the cursor as before.
   * Returns true when it snapped.
   */
  const seekToShownPreview = (clientX: number): boolean => {
    if (sessionBlocksTransport || duration <= 0 || !seekBarTrackRef.current) return false;
    const cursor = seekSecondsFromPointer(clientX, seekBarTrackRef.current, duration);
    if (
      shownPreviewTime == null ||
      !seekHover ||
      Math.abs(seekHover.seconds - cursor) > 1 ||
      Math.abs(shownPreviewTime - cursor) > 21
    ) {
      return false;
    }
    seekToAbsolute(shownPreviewTime);
    return true;
  };
  const groupedControls = groupControlsByZone(layoutPrefs);

  const hasEpisodeOrFolderNav =
    (state.libraryShowId && prevEp !== undefined) || hasFolderNav;

  const renderLayoutControl = (id: PlayerLayoutControlId) => {
    if (!controlVisible[id]) return null;
    const layoutSizes = getControlSizeClasses(layoutPrefs, id);
    const controlScale = resolveControlScale(layoutPrefs, id);
    const wrapControl = (node: ReactNode) => (
      <div
        key={id}
        className="flex items-center"
        style={
          controlScale !== 1
            ? { transform: `scale(${controlScale})`, transformOrigin: "center" }
            : undefined
        }
      >
        {node}
      </div>
    );

    switch (id) {
      case "prev":
        if (!hasEpisodeOrFolderNav) return null;
        return wrapControl(
          <button
            type="button"
            title={state.libraryShowId ? "Previous episode" : "Previous file"}
            aria-label={state.libraryShowId ? "Previous episode" : "Previous file"}
            disabled={state.libraryShowId ? !prevEp : !prevSibling}
            className={cn(transportNavBtn, layoutSizes.navBtn)}
            onClick={() => void playPrevious()}
          >
            <SkipBack className={layoutSizes.navIcon} strokeWidth={2.25} />
          </button>,
        );
      case "next":
        if (!hasEpisodeOrFolderNav) return null;
        return wrapControl(
          <button
            type="button"
            title={state.libraryShowId ? "Next episode" : "Next file"}
            aria-label={state.libraryShowId ? "Next episode" : "Next file"}
            disabled={state.libraryShowId ? !nextEp : !nextSibling}
            className={cn(transportNavBtn, layoutSizes.navBtn)}
            onClick={() => void playNext()}
          >
            <SkipForward className={layoutSizes.navIcon} strokeWidth={2.25} />
          </button>,
        );
      case "seekBack":
        return wrapControl(
          <PlayerSeekSkipButton
            deltaSeconds={-skipSeconds}
            title={`Back ${skipSeconds}s (hold to keep skipping)`}
            disabled={sessionBlocksTransport || duration <= 0}
            className={cn(
              "flex flex-col items-center justify-center gap-0 rounded-md text-white enabled:hover:bg-white/[0.09] disabled:opacity-40",
              layoutSizes.seekBtn,
            )}
            onSeek={skipWithHud}
          >
            <RotateCcw className={layoutSizes.seekIcon} strokeWidth={2} />
            <span className={cn("font-bold leading-none", layoutSizes.seekLabel)}>{skipSeconds}</span>
          </PlayerSeekSkipButton>,
        );
      case "playPause":
        return wrapControl(
          <button
            type="button"
            title={ended || sessionDead ? "Replay" : displayPaused ? "Play" : "Pause"}
            disabled={playbackTransportPending && !ended && !sessionDead}
            className={cn(
              "flex items-center justify-center rounded-full border border-white/15 bg-white/12 text-white transition-transform duration-150 hover:scale-[1.06] hover:bg-white/[0.2] disabled:opacity-50",
              layoutSizes.playBtn,
            )}
            style={{ boxShadow: "0 0 24px rgba(124,58,237,0.28)" }}
            onClick={() => void handlePrimaryTransport()}
          >
            {ended || sessionDead ? (
              <Play className={cn("ml-0.5", layoutSizes.playIcon)} fill="currentColor" />
            ) : displayPaused ? (
              <Play className={cn("ml-0.5", layoutSizes.playIcon)} fill="currentColor" />
            ) : (
              <PauseIcon className={layoutSizes.playIcon} fill="currentColor" />
            )}
          </button>,
        );
      case "seekForward":
        return wrapControl(
          <PlayerSeekSkipButton
            deltaSeconds={skipSeconds}
            title={`Forward ${skipSeconds}s (hold to keep skipping)`}
            disabled={sessionBlocksTransport || duration <= 0}
            className={cn(
              "flex flex-col items-center justify-center gap-0 rounded-md text-white enabled:hover:bg-white/[0.09] disabled:opacity-40",
              layoutSizes.seekBtn,
            )}
            onSeek={skipWithHud}
          >
            <RotateCw className={layoutSizes.seekIcon} strokeWidth={2} />
            <span className={cn("font-bold leading-none", layoutSizes.seekLabel)}>{skipSeconds}</span>
          </PlayerSeekSkipButton>,
        );
      case "subtitles":
        return wrapControl(
          <PlayerEmbeddedSubtitleMenu
            subVisible={subVisible}
            subTracks={subTracks}
            externalSubFiles={externalSubFiles}
            subMenuValue={subMenuValue}
            secondaryMenuValue={secondaryMenuValue}
            onPickSecondary={onPickSecondary}
            toggleSub={toggleSub}
            subAppearanceOpen={subAppearanceOpen}
            setSubAppearanceOpen={setSubAppearanceOpen}
            subtitlePrefs={subtitlePrefs}
            setSubtitlePref={setSubtitlePref}
            setSubtitlePrefs={setSubtitlePrefs}
            generateArabicSubtitle={generateArabicSubtitle}
            arabicSubtitleGenerating={arabicSubtitleGenerating}
            arabicSubtitleError={arabicSubtitleError}
            subDelay={subDelay}
            sessionBlocksTransport={sessionBlocksTransport}
            launchStateRef={launchStateRef}
            send={send}
            onFullscreenPointerActivity={onFullscreenPointerActivity}
            onOpenSubtitleSearch={onOpenSubtitleSearch}
          />,
        );
      case "volume":
        return wrapControl(
          <PlayerEmbeddedVolumeControl
            volume={volume}
            mute={mute}
            toggleMute={toggleMute}
            setVolumePct={setVolumePct}
            volumeHudVisible={volumeHudVisible}
            sessionBlocksTransport={sessionBlocksTransport}
            volumeDraggingRef={volumeDraggingRef}
            volumeWheelRef={volumeWheelRef}
            onFullscreenPointerActivity={onFullscreenPointerActivity}
          />,
        );
      case "speed":
        return wrapControl(
          <PlayerSpeedControl
            speed={playbackSpeed}
            onSpeedChange={setPlaybackSpeed}
            disabled={sessionBlocksTransport}
            onPointerActivity={onFullscreenPointerActivity}
          />,
        );
      case "devtools":
        return wrapControl(
          <PlayerEmbeddedDevTools
            filePath={state.filePath}
            useLibMpv={useLibMpv}
            embedReady={embedReady}
            nativeState={nativeState}
            embeddedSafeMode={embeddedSafeMode}
            setEmbeddedSafeMode={setEmbeddedSafeMode}
            lastMpvCrashLog={lastMpvCrashLog}
            setLastMpvCrashLog={setLastMpvCrashLog}
            effectiveStart={effectiveStart}
            onFullscreenPointerActivity={onFullscreenPointerActivity}
            setTransportError={setTransportError}
          />,
        );
      case "audio":
        return wrapControl(
          // open:z-[70]: promotes trigger+popup above row siblings while open — see the same
          // comment in PlayerSpeedControl.tsx for why this matters for a bottom-full popup.
          <details className="group relative open:z-[70]">
            <summary
              className={cn(
                "flex cursor-pointer list-none items-center justify-center rounded-md text-white marker:content-none hover:bg-white/[0.09] [&::-webkit-details-marker]:hidden",
                layoutSizes.secondaryBtn,
              )}
              title="Audio tracks"
              onClick={() => onFullscreenPointerActivity()}
            >
              <ListMusic className={layoutSizes.secondaryIcon} />
            </summary>
            <div className="absolute bottom-full right-0 z-[60] mb-2 max-h-[70vh] min-w-[220px] overflow-y-auto rounded-lg border border-white/10 bg-black/95 p-2 shadow-xl backdrop-blur">
              <label className="block text-[9px] uppercase tracking-wide text-pitflix-muted">
                Audio
                <select
                  className="mt-1 w-full rounded border border-white/10 bg-black/60 px-2 py-1 text-[11px] text-white"
                  value={aid ?? ""}
                  disabled={sessionBlocksTransport}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    void send({ type: "SetAid", payload: v });
                  }}
                >
                  {audioTracks.map((t) => (
                    <option key={`a-${t.id ?? ""}`} value={t.id ?? ""}>
                      {t.lang || t.title || `Track ${t.id}`}
                      {t.selected ? " (current)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>,
        );
      case "subDelay":
        return wrapControl(
          // open:z-[70]: promotes trigger+popup above row siblings while open — see the same
          // comment in PlayerSpeedControl.tsx for why this matters for a bottom-full popup.
          <details className="group relative open:z-[70]">
            <summary
              className={cn(
                "flex cursor-pointer list-none items-center justify-center rounded-md text-white marker:content-none hover:bg-white/[0.09] [&::-webkit-details-marker]:hidden",
                layoutSizes.secondaryBtn,
              )}
              title={`Subtitle delay (${fmtSubDelayLabel(subDelay)})`}
              onClick={() => onFullscreenPointerActivity()}
            >
              <Clock className={layoutSizes.secondaryIcon} />
            </summary>
            <div className="absolute bottom-full right-0 z-[60] mb-2 flex items-center gap-1 rounded-lg border border-white/10 bg-black/95 p-1.5 shadow-xl backdrop-blur">
              <button
                type="button"
                title="−0.5s"
                disabled={sessionBlocksTransport}
                className="flex h-7 w-7 items-center justify-center rounded text-white hover:bg-white/15 disabled:opacity-40"
                onClick={() => void send({ type: "AddSubDelay", payload: -0.5 })}
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[5.5rem] select-none text-center text-[10px] tabular-nums text-pitflix-muted">
                {fmtSubDelayLabel(subDelay)}
              </span>
              <button
                type="button"
                title="+0.5s"
                disabled={sessionBlocksTransport}
                className="flex h-7 w-7 items-center justify-center rounded text-white hover:bg-white/15 disabled:opacity-40"
                onClick={() => void send({ type: "AddSubDelay", payload: 0.5 })}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </details>,
        );
      default:
        return null;
    }
  };

  // Fixed (non-configurable) mini-player toggle, docked at the end of the right control cluster —
  // moved here from the top-right window chrome so it sits next to CC / speed / etc.
  const fixedSizes = getPlayerLayoutSizeClasses(layoutPrefs.controlSize);
  const renderZone = (zone: "left" | "center" | "right", justify: string) => (
    <div className={cn("flex flex-wrap content-center items-center gap-1", justify)}>
      {groupedControls[zone].map((id) => renderLayoutControl(id))}
      {zone === "right" ? (
        <button
          type="button"
          title={isPip ? "Exit mini player" : "Mini player (picture-in-picture)"}
          aria-label={isPip ? "Exit mini player" : "Mini player"}
          aria-pressed={isPip}
          className={cn(
            "flex items-center justify-center rounded-md text-white hover:bg-white/[0.09]",
            isPip && "bg-white/15 text-pitflix-primary",
            fixedSizes.secondaryBtn,
          )}
          onClick={() => {
            onFullscreenPointerActivity();
            togglePip();
          }}
        >
          <PictureInPicture2 className={fixedSizes.secondaryIcon} />
        </button>
      ) : null}
    </div>
  );

  // Pause info screen data — episode overview only, since that's the only place a synopsis is
  // currently piped into this component (see playlistEpisodeMetaByPath, populated per-season for
  // library episodes). `state.title` is normally the episode's own title and `state.seriesName`
  // the show name (see PlaybackLaunchState) — for movies seriesName is unset, so the movie title
  // becomes the big headline and the separate episode-title line is skipped.
  const pauseEpisodeMeta = playlistEpisodeMetaByPath.get(normalizeMediaPathKey(state.filePath));
  const pauseInfoTitle = state.seriesName ?? state.title;
  const pauseInfoEpisodeTitle = state.seriesName ? state.title : null;
  const pauseInfoOverview = pauseEpisodeMeta?.overview ?? null;
  // stillUrl is a TMDB URL hardcoded to w300 server-side (fine for a small playlist row, pixelated
  // full-bleed) — upscale it since, unlike stillLocalPath's already-small cached file, the full-res
  // source is one URL edit away. Movies have no still — moviePauseBackdropPath is the movie's own
  // landscape backdrop (~1280px), fetched separately in PlayerPage since state.posterPath alone is
  // a portrait ~500px poster that reads as pixelated once stretched full-bleed across the player.
  // state.posterPath (portrait) is the last-resort fallback, not the primary movie source.
  const pauseInfoBackdropSrc =
    upscaleTmdbImageUrl(pauseEpisodeMeta?.stillUrl) ||
    pauseEpisodeMeta?.stillLocalPath ||
    toPosterSrc(moviePauseBackdropPath) ||
    toPosterSrc(state.posterPath) ||
    null;

  return (
    <>
<div
  className={cn(
    "relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden",
    !chromeVisible ? "cursor-none" : "cursor-default",
  )}
  onPointerMove={(e) => onChromePointerActivity(chromeZoneForPointer(e))}
  onPointerDownCapture={(e) => {
    onChromePointerActivity(chromeZoneForPointer(e));
    onVideoPointerDownCapture(e);
  }}
  onContextMenu={openPlayerContextMenuFromEvent}
  onAuxClick={(e) => {
    if (e.button === 2) openPlayerContextMenuFromEvent(e);
  }}
  onPointerDown={(e) => {
    if (e.button === 2) {
      openPlayerContextMenuFromEvent(e);
      return;
    }
    onChromePointerActivity(chromeZoneForPointer(e));
    void getCurrentWindow().setFocus().catch(() => {});
    e.currentTarget.focus({ preventScroll: true });
  }}
>
  {/* Always-on drag strip — stays interactive even when chrome auto-hides. Not in the in-app
      mini player: dragging there would move the whole app window. */}
  {inAppMini ? null : (
    <div
      data-tauri-drag-region
      className="absolute inset-x-0 top-0 z-[30] h-5 cursor-move right-[13.5rem]"
      title="Drag to move window"
      aria-label="Drag to move window"
    />
  )}

  {inAppMini ? (
    // The box is anchored at its bottom-right, so the free corner to resize from is the top-left.
    <div
      role="separator"
      aria-label="Resize mini player"
      title="Drag to resize"
      className="absolute left-0 top-0 z-[40] h-5 w-5 cursor-nwse-resize touch-none"
      onPointerDown={startMiniResize}
    >
      <svg viewBox="0 0 16 16" className="h-full w-full p-0.5 text-white/45">
        <path d="M2 14 14 2M2 8 8 2M2 2v0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  ) : null}
  {isPip ? (
    <div
      role="separator"
      aria-label="Resize mini player"
      title="Drag to resize"
      className="absolute bottom-0 right-0 z-[40] h-5 w-5 cursor-nwse-resize"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void getCurrentWindow().startResizeDragging("SouthEast").catch(() => {});
      }}
    >
      <svg viewBox="0 0 16 16" className="h-full w-full p-0.5 text-white/45">
        <path d="M14 2 2 14M14 8 8 14M14 14v0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  ) : null}
  <div className="relative flex min-h-0 flex-1 flex-row overflow-hidden">
  <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
  <div className="relative min-h-0 flex-1">
  <header
    ref={playerHeaderChromeRef}
    className={cn(
      "absolute left-0 right-0 top-0 z-10 flex items-center justify-between gap-3 px-6 py-[18px] transition-[opacity,transform] duration-[450ms] ease-out",
      headerVisible
        ? "translate-y-0 opacity-100"
        : "pointer-events-none -translate-y-2.5 opacity-0 [&_*]:pointer-events-none",
    )}
    style={{
      background:
        "linear-gradient(to bottom, rgba(0,0,0,0.84) 0%, rgba(0,0,0,0.36) 58%, transparent 100%)",
    }}
    inert={headerVisible ? undefined : true}
    aria-hidden={headerVisible ? undefined : true}
  >
    {inAppMini ? (
      <>
        <div
          className="min-w-0 flex-1 cursor-move touch-none select-none self-stretch truncate py-2 text-xs font-semibold text-white/90"
          title="Drag to move"
          onPointerDown={startMiniDrag}
        >
          {state.title}
        </div>
        <button
          type="button"
          title="Back to full player"
          onClick={onExpandInAppMini}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/85 transition hover:bg-white/15 hover:text-white"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Close player"
          onClick={() => void exitAndClose()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/85 transition hover:bg-red-500/25 hover:text-red-200"
        >
          <X className="h-4 w-4" />
        </button>
      </>
    ) : isPip ? (
      // Same overlap problem as the footer control grid — title text + all six chrome buttons
      // don't fit at ~384px width. Only a way back out of PiP is essential here.
      <>
        <div
          className="min-h-8 flex-1 self-stretch rounded-md"
          data-tauri-drag-region
          title="Drag to move window"
          aria-hidden
        />
        <button
          type="button"
          title="Exit mini player"
          onClick={togglePip}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/15 text-pitflix-primary transition hover:bg-white/25"
        >
          <PictureInPicture2 className="h-4 w-4" />
        </button>
      </>
    ) : (
      <>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={() => setEpisodeInfoOpen(true)}
            title="Show details"
            className="max-w-[min(60vw,28rem)] whitespace-normal break-words text-left text-sm font-semibold leading-snug text-white transition-colors hover:text-pitflix-primary"
          >
            {state.title}
          </button>
          <div
            className="min-h-8 min-w-8 flex-1 self-stretch rounded-md"
            data-tauri-drag-region
            title="Drag to move window"
            aria-hidden
          />
        </div>
        <PlayerWindowChrome
          alwaysOnTop={alwaysOnTop}
          onToggleAlwaysOnTop={toggleAlwaysOnTop}
          hasPlaylist={Boolean(currentFolderForPlaylist)}
          playlistOpen={folderPlaylistOpen || folderPlaylistPinned}
          onTogglePlaylist={() => setFolderPlaylistOpen((v) => !v)}
          onMinimize={() => void getCurrentWindow().minimize().catch(() => {})}
          isMaximized={isMaximized}
          onToggleMaximize={() => void onToggleMaximize()}
          onMiniInApp={onEnterInAppMini}
          onClose={() => void exitAndClose()}
        />
      </>
    )}
  </header>

  <div
    ref={videoAreaRef}
    data-video-surface
    className="absolute inset-0 z-[6]"
    style={{ backgroundColor: "rgba(0,0,0,0.001)" }}
    onContextMenu={openPlayerContextMenuFromEvent}
    onPointerDownCapture={onVideoPointerDownCapture}
    onAuxClick={(e) => {
      if (e.button === 2) openPlayerContextMenuFromEvent(e);
    }}
    onDoubleClick={(e) => {
      e.preventDefault();
      onFullscreenPointerActivity();
      void onFullscreen();
    }}
  >
    {!useLibMpv && state.posterPath ? (
      <img
        src={toPosterSrc(state.posterPath)}
        alt=""
        className="pointer-events-none absolute inset-0 z-[1] h-full w-full bg-black object-contain"
      />
    ) : null}
    {/* The opening title/thumbnail card (PlayerIntroOverlay) was removed at the user's request —
        the video now shows as soon as mpv has the first frame. */}
    
    <PlayerPauseInfoOverlay
      visible={displayPaused && pausedLong && !compact}
      title={pauseInfoTitle}
      season={state.season}
      episodeNumber={state.episodeNumber}
      episodeTitle={pauseInfoEpisodeTitle}
      overview={pauseInfoOverview}
      backdropSrc={pauseInfoBackdropSrc}
    />

    {/* Episode Navigation Overlay - hidden in libmpv mode (duplicates the bottom buttons). */}
    {!useLibMpv && (
      <EpisodeNavigationOverlay
        prevEpisode={prevEp}
        nextEpisode={nextEp}
        onPrevious={playPrevious}
        onNext={playNext}
        visible={footerVisible}
      />
    )}

    <SkipSegmentOverlay
      active={SKIP_OVERLAY_DISABLED ? null : activeSkipSegment}
      onSkip={skipActiveSegment}
      onDismiss={dismissActiveSkipSegment}
    />
  </div>

  {showLetterbox ? (
    <>
      {letterboxInsets.top > 0 ? (
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 z-[1] bg-black"
          style={{ height: letterboxInsets.top }}
          aria-hidden
        />
      ) : null}
      {letterboxInsets.bottom > 0 ? (
        <div
          className="pointer-events-none absolute bottom-0 left-0 right-0 z-[1] bg-black"
          style={{ height: letterboxInsets.bottom }}
          aria-hidden
        />
      ) : null}
      {letterboxInsets.left > 0 ? (
        <div
          className="pointer-events-none absolute left-0 z-[1] bg-black"
          style={{
            top: letterboxInsets.top,
            bottom: letterboxInsets.bottom,
            width: letterboxInsets.left,
          }}
          aria-hidden
        />
      ) : null}
      {letterboxInsets.right > 0 ? (
        <div
          className="pointer-events-none absolute right-0 z-[1] bg-black"
          style={{
            top: letterboxInsets.top,
            bottom: letterboxInsets.bottom,
            width: letterboxInsets.right,
          }}
          aria-hidden
        />
      ) : null}
    </>
  ) : null}

  <PlayerEmbeddedVolumeHud
    volume={volume}
    mute={mute}
    visible={volumeHudVisible}
    sessionBlocksTransport={sessionBlocksTransport}
    setVolumePct={setVolumePct}
    toggleMute={toggleMute}
    compact={compact}
  />

  {/* Mini progress bar — shown only while chrome is hidden. During an arrow-key skip it follows
      the skip target so the bar and the time readout above it always agree. */}
  {!footerVisible && seekBarPrefs.visible ? (
    <div
      className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 bg-white/10"
      style={{ height: Math.max(2, seekBarStyle.trackPx) }}
      aria-hidden
    >
      <div
        className="h-full"
        style={{
          width: `${Math.min(100, Math.max(0, uiDuration > 0 ? ((seekHud && !seekHud.settled ? seekHud.target : uiTimePos) / uiDuration) * 100 : 0))}%`,
          background: seekBarStyle.miniFillBackground,
        }}
      />
      {abLoopOverlay}
    </div>
  ) : null}

  {/* Skip readout (arrow keys / skip buttons) while chrome is hidden — rides above the mini bar. */}
  {!footerVisible && seekHudPill ? (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2"
      style={{
        left: `clamp(92px, ${seekHudPct}%, calc(100% - 92px))`,
        bottom: Math.max(2, seekBarStyle.trackPx) + 10,
      }}
      aria-live="polite"
    >
      {seekHudPill}
    </div>
  ) : null}

  <div
    ref={playerFooterChromeRef}
    className={cn(
      "absolute bottom-0 left-0 right-0 z-10 overflow-x-clip overflow-y-visible px-7 pb-[26px] pt-6 transition-[opacity,transform] duration-[450ms] ease-out",
      footerVisible
        ? "translate-y-0 opacity-100"
        : "pointer-events-none translate-y-2.5 opacity-0 [&_*]:pointer-events-none",
    )}
    style={{
      background:
        "linear-gradient(to top, rgba(0,0,0,0.99) 0%, rgba(0,0,0,0.95) 35%, rgba(0,0,0,0.78) 65%, transparent 100%)",
    }}
    inert={footerVisible ? undefined : true}
    aria-hidden={footerVisible ? undefined : true}
  >
  {abLoop.a != null ? (
    <div className="absolute left-7 top-0 z-20 flex items-center gap-1.5 rounded-md border border-amber-300/30 bg-black/75 py-1 pl-2 pr-1 text-[11px] font-semibold tabular-nums text-amber-200 backdrop-blur-sm">
      <Repeat className="h-3 w-3" strokeWidth={2.4} />
      {abLoop.b != null ? (
        <span>Loop {fmtTime(Math.round(abLoop.a))} – {fmtTime(Math.round(abLoop.b))}</span>
      ) : (
        <span>Loop start {fmtTime(Math.round(abLoop.a))} · press B at the end point</span>
      )}
      <button
        type="button"
        onClick={onClearAbLoop}
        title="Clear A-B loop"
        className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-amber-200/80 hover:bg-white/10 hover:text-white"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  ) : null}
  <div className="w-full space-y-1.5">
    {seekBarPrefs.visible ? (
    <div className={cn("flex items-center gap-2 font-bold tabular-nums text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]", timeLabelClass)}>
      {seekBarPrefs.currentTimeVisible ? (
        <span className="shrink-0 tabular-nums">{fmtTime(timePos)}</span>
      ) : (
        <span className="w-0 shrink-0" aria-hidden />
      )}
      <div
        ref={seekBarTrackRef}
        className="group relative flex flex-1 cursor-pointer items-center py-2.5"
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, duration)}
        aria-valuenow={timePos}
        aria-disabled={sessionBlocksTransport || duration <= 0}
        tabIndex={sessionBlocksTransport || duration <= 0 ? -1 : 0}
        onKeyDown={(e) => {
          if (sessionBlocksTransport || duration <= 0) return;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            seekRel(e.shiftKey ? -1 : -5);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            seekRel(e.shiftKey ? 1 : 5);
          }
        }}
        onPointerDown={(e) => {
          if (sessionBlocksTransport || duration <= 0) return;
          if (e.button !== 0) return;
          seekDraggingRef.current = true;
          onFullscreenPointerActivity();
          e.currentTarget.setPointerCapture(e.pointerId);
          // Clicked on a spot whose preview is showing: go to exactly that frame (it's already
          // what the preview shows, so no exact-frame fetch needed).
          if (seekToShownPreview(e.clientX)) return;
          seekFromPointer(e.clientX);
          updateSeekHover(e.clientX);
          // Otherwise the click deserves a frame-exact preview of the second it seeked to.
          if (state?.filePath && seekBarTrackRef.current) {
            const exactSeconds = seekSecondsFromPointer(e.clientX, seekBarTrackRef.current, duration);
            scheduleExactHoverThumb(state.filePath, exactSeconds);
          }
        }}
        onPointerMove={(e) => {
          onFullscreenPointerActivity();
          if (seekDraggingRef.current) {
            seekFromPointer(e.clientX);
          }
          updateSeekHover(e.clientX);
        }}
        onPointerEnter={(e) => {
          seekBarHoveringRef.current = true;
          onFullscreenPointerActivity();
          if (state?.filePath && duration > 0) {
            scheduleHoverThumb(state.filePath, timePos);
            updateSeekHover(e.clientX);
          }
        }}
        onPointerLeave={() => {
          seekBarHoveringRef.current = false;
          if (seekHoverDebounceRef.current) {
            clearTimeout(seekHoverDebounceRef.current);
            seekHoverDebounceRef.current = null;
          }
          setSeekHover(null);
          onFullscreenPointerActivity();
        }}
        onWheel={(e) => {
          if (sessionBlocksTransport || duration <= 0) return;
          // One skip (the user's skip amount, same as ← →) per wheel notch. Smooth-scrolling mice
          // and touchpads split a notch into many small events, which used to each skip 5s.
          const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
          const now = performance.now();
          const acc = wheelSeekAccRef.current;
          if (now - acc.at > 250 || Math.sign(px) !== Math.sign(acc.px)) acc.px = 0;
          acc.at = now;
          acc.px += px;
          if (Math.abs(acc.px) < WHEEL_NOTCH_PX) return;
          acc.px = 0;
          skipWithHud(px < 0 ? skipSeconds : -skipSeconds);
        }}
      >
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 overflow-visible rounded-[4px] bg-white/[0.14] transition-[height] duration-150 ease-out",
            seekBarPrefs.thickness === "thin"
              ? "group-hover:h-1"
              : seekBarPrefs.thickness === "thick"
                ? "group-hover:h-2.5"
                : "group-hover:h-1.5",
          )}
          style={{ height: seekBarStyle.trackPx }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-[4px] transition-[height] duration-150 group-hover:opacity-100"
            style={{
              width: `${Math.min(100, Math.max(0, pct))}%`,
              background: seekBarStyle.fillBackground,
              boxShadow: seekBarStyle.fillShadow,
              height: "100%",
            }}
          />
          {abLoopOverlay}
          {seekBarPrefs.thumbVisible ? (
            <div
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              style={{
                left: `${Math.min(100, Math.max(0, pct))}%`,
                width: seekBarStyle.thumbPx,
                height: seekBarStyle.thumbPx,
                boxShadow: "0 0 0 3px rgba(124,58,237,0.28), 0 2px 10px rgba(0,0,0,0.5)",
              }}
            />
          ) : null}
        </div>
        {/* Skip readout while the controls are showing — above the bar at the skip target. Yields to
            the hover preview, which occupies the same spot. */}
        {footerVisible && seekHudPill && !seekHover ? (
          <div
            className="pointer-events-none absolute bottom-full z-30 mb-1 -translate-x-1/2"
            style={{ left: `clamp(80px, ${seekHudPct}%, calc(100% - 80px))` }}
            aria-live="polite"
          >
            {seekHudPill}
          </div>
        ) : null}
        {seekBarPrefs.hoverPreviewVisible && seekHover && (() => {
          const TOOLTIP_HALF = 80;
          const rectW =
            typeof window !== "undefined"
              ? Math.max(0, Math.min(window.innerWidth, document.documentElement.clientWidth || 0))
              : 1920;
          const left = Math.max(TOOLTIP_HALF, Math.min(rectW - TOOLTIP_HALF, seekHover.pixelX));
          return (
          <div
            className="pointer-events-none absolute -top-2 z-[70] flex -translate-x-1/2 -translate-y-full flex-col items-center transition-transform duration-150 ease-out"
            style={{ left: `${left}px` }}
          >
            {seekHover.dataUrl ? (
              <div className="relative h-[90px] w-[160px] overflow-hidden rounded border border-white/30 bg-black/40 shadow-xl">
                <img
                  key={seekHover.dataUrl}
                  src={seekHover.dataUrl}
                  alt=""
                  className={`absolute inset-0 h-full w-full object-cover transition-[filter,opacity] duration-150 ease-out ${
                    seekHover.loading ? "opacity-70 blur-[0.5px]" : "opacity-100"
                  }`}
                />
              </div>
            ) : null}
            <span className="mt-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] tabular-nums text-white transition-opacity duration-150">
              {/* The shown frame's real time when known — that's where a click goes. */}
              {fmtTime(Math.round(shownPreviewTime ?? seekHover.seconds))}
            </span>
          </div>
          );
        })()}
      </div>
      {seekBarPrefs.remainingTimeVisible ? (
        <button
          type="button"
          onClick={toggleShowTotalDuration}
          title={showTotalDuration ? "Total length — click to show time remaining" : "Time remaining — click to show total length"}
          className="shrink-0 cursor-pointer rounded px-1 text-right tabular-nums transition-colors hover:bg-white/10"
        >
          {showTotalDuration ? fmtTime(Math.round(duration)) : `-${fmtTime(remaining)}`}
        </button>
      ) : (
        <span className="w-0 shrink-0" aria-hidden />
      )}
    </div>
    ) : null}

    {transportError ? (
      <div className="flex flex-col items-center gap-1 text-center" role="alert">
        <p className="text-[10px] text-red-300/95">{transportError}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="rounded border border-white/20 px-2 py-0.5 text-[10px] text-pitflix-muted hover:bg-white/10"
            onClick={() => setTransportError(null)}
          >
            Dismiss
          </button>
          <button
            type="button"
            className="rounded border border-white/20 px-2 py-0.5 text-[10px] text-white hover:bg-white/10"
            disabled={isNativeBackendEmbeddedLibmpv(nativeState?.backend)}
            onClick={() => {
              setTransportError(null);
              setResumeOptimistic(false);
              void invoke("player2_recover").catch((e) => {
                logPlayer2InvokeFailure("player2_recover", e);
                setTransportError(e instanceof Error ? e.message : String(e));
              });
            }}
          >
            Reopen current
          </button>
          <button
            type="button"
            className="rounded border border-red-400/50 px-2 py-0.5 text-[10px] text-red-200 hover:bg-white/10"
            onClick={() => {
              setTransportError(null);
              void handlePrimaryTransport();
            }}
          >
            Retry
          </button>
        </div>
      </div>
    ) : null}
    {compact ? (
      // The normal 3-column control-zone grid below packs many buttons (volume, subtitles,
      // speed, playlist, clock, etc.) side by side — at PiP's ~384px width they wrap onto each
      // other instead of fitting in a row. Only play/pause is essential for "keep watching in a
      // corner while doing something else", so that's all PiP shows.
      <div className="flex w-full items-center justify-center">
        <button
          type="button"
          onClick={() => void handlePrimaryTransport()}
          aria-label={displayPaused ? "Play" : "Pause"}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
        >
          {displayPaused ? <Play className="h-4 w-4 fill-current" /> : <PauseIcon className="h-4 w-4 fill-current" />}
        </button>
      </div>
    ) : (
      <div className="grid w-full grid-cols-3 items-start gap-x-1 gap-y-1">
        {renderZone("left", "justify-start")}
        {renderZone("center", "justify-center")}
        {renderZone("right", "justify-end")}
      </div>
    )}

  </div>{/* end w-full space-y */}
  </div>{/* end footer chrome */}
  </div>{/* end video surface host */}
  </div>{/* end video column */}

  <PlayerEmbeddedFolderPlaylist
    currentFolderForPlaylist={currentFolderForPlaylist}
    folderPlaylistOpen={folderPlaylistOpen}
    folderPlaylistPinned={folderPlaylistPinned}
    folderPlaylistBusy={folderPlaylistBusy}
    folderPlaylistEntries={folderPlaylistEntries}
    setFolderPlaylistEntries={setFolderPlaylistEntries}
    setFolderPlaylistOpen={setFolderPlaylistOpen}
    setFolderPlaylistPinned={setFolderPlaylistPinned}
    navigateToSiblingFile={navigateToSiblingFile}
    exitAndClose={exitAndClose}
    playlistEpisodeMetaByPath={playlistEpisodeMetaByPath}
    activeFilePath={state.filePath}
    isFullscreen={isFullscreen}
    fsControlsVisible={fsControlsVisible}
  />
  </div>{/* end content row */}
</div>{/* end player shell */}
{/* Episode info popup — opens when the user clicks the title in the header. */}
{state ? (
  <PlayerEmbeddedEpisodeInfoModal
    open={episodeInfoOpen}
    onClose={() => setEpisodeInfoOpen(false)}
    state={state}
    timePos={timePos}
    duration={duration}
    onExitPlayer={exitAndClose}
  />
) : null}
    </>
  );
}
