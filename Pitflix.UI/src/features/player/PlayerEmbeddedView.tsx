import type { ReactNode } from "react";
import { useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Clock,
  ListMusic,
  Minus,
  Pause as PauseIcon,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { toPosterSrc } from "../../utils/posterSrc";
import { isNativeBackendEmbeddedLibmpv } from "../../utils/playerNativeBackend";
import { EpisodeNavigationOverlay } from "../../components/player/EpisodeNavigationOverlay";
import { SkipSegmentOverlay } from "../../components/player/SkipSegmentOverlay";
import { SKIP_OVERLAY_DISABLED } from "./playerConstants";
import { getControlSizeClasses, resolveControlScale, TIME_LABEL_SIZE_CLASSES } from "./playerLayoutSizes";
import { getSeekBarVisualStyle } from "./playerSeekBarLayout";
import { pointerXOnTrack, seekSecondsFromPointer } from "./playerSeekBar";
import { getSeekHoverCached, seekHoverPreviewSecond } from "../../utils/seekHoverThumbCache";
import { groupControlsByZone } from "./playerLayoutZones";
import type { PlayerLayoutControlId } from "./playerLayoutTypes";
import { logPlayer2InvokeFailure } from "./playerDebug";
import { fmtSubDelayLabel, fmtTime } from "./playerFormat";
import { PlayerEmbeddedFolderPlaylist } from "./PlayerEmbeddedFolderPlaylist";
import { PlayerEmbeddedSubtitleMenu } from "./PlayerEmbeddedSubtitleMenu";
import { PlayerEmbeddedVolumeControl } from "./PlayerEmbeddedVolumeControl";
import { PlayerSpeedControl } from "./PlayerSpeedControl";
import { PlayerEmbeddedVolumeHud } from "./PlayerEmbeddedVolumeHud";
import { PlayerEmbeddedDevTools } from "./PlayerEmbeddedDevTools";
import { PlayerEmbeddedEpisodeInfoModal } from "./PlayerEmbeddedEpisodeInfoModal";
import { PlayerSeekSkipButton } from "./PlayerSeekSkipButton";
import { PlayerWindowChrome } from "./PlayerWindowChrome";
import type { PlayerEmbeddedViewProps } from "./playerViewProps";

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
    onFullscreenPointerActivity,
    onPlayerRightClick,
    onFullscreen,
    onToggleMaximize,
    videoSettling,
    loading,
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
    subVisible,
    subTracks,
    externalSubFiles,
    subMenuValue,
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
    playbackSpeed,
    setPlaybackSpeed,
    skipSeconds,
    aid,
    audioTracks,
    alwaysOnTop,
    toggleAlwaysOnTop,
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

  const updateSeekHover = (clientX: number) => {
    if (!state?.filePath || duration <= 0 || !seekBarTrackRef.current) return;
    const track = seekBarTrackRef.current;
    const x = pointerXOnTrack(clientX, track);
    const seconds = seekSecondsFromPointer(clientX, track, duration);
    const previewSecond = seekHoverPreviewSecond(seconds);
    const cached = getSeekHoverCached(state.filePath, previewSecond);
    setSeekHover((prev) => ({
      pixelX: x,
      seconds,
      // Keep the last good frame visible (dimmed) until the new one arrives.
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
            onSeek={seekRel}
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
            onSeek={seekRel}
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
          <details className="group relative">
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
          <details className="group relative">
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

  const renderZone = (zone: "left" | "center" | "right", justify: string) => (
    <div className={cn("flex flex-wrap content-center items-center gap-1", justify)}>
      {groupedControls[zone].map((id) => renderLayoutControl(id))}
    </div>
  );

  return (
    <>
<div
  className={cn(
    "relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden",
    !chromeVisible ? "cursor-none" : "cursor-default",
  )}
  onPointerMove={() => onFullscreenPointerActivity()}
  onPointerDownCapture={(e) => {
    onFullscreenPointerActivity();
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
    onFullscreenPointerActivity();
    void getCurrentWindow().setFocus().catch(() => {});
    e.currentTarget.focus({ preventScroll: true });
  }}
>
  {/* Always-on drag strip — stays interactive even when chrome auto-hides. */}
  <div
    data-tauri-drag-region
    className="absolute inset-x-0 top-0 z-[30] h-5 cursor-move right-[13.5rem]"
    title="Drag to move window"
    aria-label="Drag to move window"
  />
  <div className="relative flex min-h-0 flex-1 flex-row overflow-hidden">
  <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
  <div className="relative min-h-0 flex-1">
  <header
    ref={playerHeaderChromeRef}
    className={cn(
      "absolute left-0 right-0 top-0 z-10 flex items-center justify-between gap-3 px-6 py-[18px] transition-[opacity,transform] duration-[450ms] ease-out",
      chromeVisible
        ? "translate-y-0 opacity-100"
        : "pointer-events-none -translate-y-2.5 opacity-0 [&_*]:pointer-events-none",
    )}
    style={{
      background:
        "linear-gradient(to bottom, rgba(0,0,0,0.84) 0%, rgba(0,0,0,0.36) 58%, transparent 100%)",
    }}
    inert={chromeVisible ? undefined : true}
    aria-hidden={chromeVisible ? undefined : true}
  >
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
      isMaximized={isMaximized}
      onToggleMaximize={() => void onToggleMaximize()}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => void onFullscreen()}
      onClose={() => void exitAndClose()}
    />
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
    {useLibMpv && videoSettling ? (
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black">
        {loading ? <span className="text-sm text-white/70">Loading…</span> : null}
      </div>
    ) : null}
    
    {/* Episode Navigation Overlay - hidden in libmpv mode (duplicates the bottom buttons). */}
    {!useLibMpv && (
      <EpisodeNavigationOverlay
        prevEpisode={prevEp}
        nextEpisode={nextEp}
        onPrevious={playPrevious}
        onNext={playNext}
        visible={chromeVisible}
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
  />

  {/* Mini progress bar — shown only while chrome is hidden */}
  {!chromeVisible && seekBarPrefs.visible ? (
    <div
      className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 bg-white/10"
      style={{ height: Math.max(2, seekBarStyle.trackPx) }}
      aria-hidden
    >
      <div
        className="h-full"
        style={{
          width: `${Math.min(100, Math.max(0, uiDuration > 0 ? (uiTimePos / uiDuration) * 100 : 0))}%`,
          background: seekBarStyle.miniFillBackground,
        }}
      />
    </div>
  ) : null}

  <div
    ref={playerFooterChromeRef}
    className={cn(
      "absolute bottom-0 left-0 right-0 z-10 overflow-x-clip overflow-y-visible px-7 pb-[26px] pt-6 transition-[opacity,transform] duration-[450ms] ease-out",
      chromeVisible
        ? "translate-y-0 opacity-100"
        : "pointer-events-none translate-y-2.5 opacity-0 [&_*]:pointer-events-none",
    )}
    style={{
      background:
        "linear-gradient(to top, rgba(0,0,0,0.99) 0%, rgba(0,0,0,0.95) 35%, rgba(0,0,0,0.78) 65%, transparent 100%)",
    }}
    inert={chromeVisible ? undefined : true}
    aria-hidden={chromeVisible ? undefined : true}
  >
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
          seekFromPointer(e.clientX);
          updateSeekHover(e.clientX);
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
          e.preventDefault();
          const step = e.deltaY < 0 ? 5 : -5;
          seekRel(step);
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
              {fmtTime(Math.round(seekHover.seconds))}
            </span>
          </div>
          );
        })()}
      </div>
      {seekBarPrefs.remainingTimeVisible ? (
        <span className="shrink-0 tabular-nums text-right">-{fmtTime(remaining)}</span>
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
    <div className="grid w-full grid-cols-3 items-start gap-x-1 gap-y-1">
      {renderZone("left", "justify-start")}
      {renderZone("center", "justify-center")}
      {renderZone("right", "justify-end")}
    </div>

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
  />
) : null}
    </>
  );
}
