import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Gauge,
  ListMusic,
  Maximize,
  MessageSquare,
  Pause,
  Pin,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Subtitles,
  Timer,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PassthroughStatusBadge } from "../../components/player/PassthroughStatusBadge";
import { cn } from "../../utils/cn";
import { PLAYER_SKIP_SECONDS_MAX, PLAYER_SKIP_SECONDS_MIN } from "./playerConstants";
import type { MpvTrack } from "./playerTypes";
import { formatPlaybackSpeed, PLAYBACK_SPEED_PRESETS } from "./PlayerSpeedControl";

const SKIP_SECONDS_PRESETS = [1, 2, 3, 5, 10, 15, 30, 60];

type Panel = "main" | "speed" | "audio" | "skip";

type Props = {
  x: number;
  y: number;
  title: string;
  onClose: () => void;
  displayPaused: boolean;
  ended: boolean;
  sessionDead: boolean;
  subVisible: boolean;
  playbackSpeed: number;
  skipSeconds: number;
  alwaysOnTop: boolean;
  isFullscreen: boolean;
  hasPlaylist: boolean;
  playlistCount: number;
  hasNext: boolean;
  hasPrev: boolean;
  hasEpisodeDetails: boolean;
  audioTracks: MpvTrack[];
  activeAid: number | null;
  onPlayPause: () => void;
  onToggleSubtitles: () => void;
  onSearchSubtitles: () => void;
  onOpenPlaylist: () => void;
  onSetSpeed: (speed: number) => void;
  onSetSkipSeconds: (seconds: number) => void;
  onSetAudioTrack: (id: number) => void;
  onToggleAlwaysOnTop: () => void;
  onToggleFullscreen: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onOpenEpisodeDetails: () => void;
  onScreenshot: () => void;
  onSaveClip: () => void;
  onClosePlayer: () => void;
};

function MenuRow({
  label,
  icon: Icon,
  onClick,
  checked,
  disabled,
  trailing,
}: {
  label: string;
  icon: typeof Play;
  onClick: () => void;
  checked?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-white/90 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40",
        checked && "text-[#c4b5fd]",
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-white/65" strokeWidth={2} />
      <span className="min-w-0 flex-1 truncate">{checked ? `✓ ${label}` : label}</span>
      {trailing}
    </button>
  );
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-white/8" />;
}

export function PlayerContextMenu({
  x,
  y,
  title,
  onClose,
  displayPaused,
  ended,
  sessionDead,
  subVisible,
  playbackSpeed,
  skipSeconds,
  alwaysOnTop,
  isFullscreen,
  hasPlaylist,
  playlistCount,
  hasNext,
  hasPrev,
  hasEpisodeDetails,
  audioTracks,
  activeAid,
  onPlayPause,
  onToggleSubtitles,
  onSearchSubtitles,
  onOpenPlaylist,
  onSetSpeed,
  onSetSkipSeconds,
  onSetAudioTrack,
  onToggleAlwaysOnTop,
  onToggleFullscreen,
  onNext,
  onPrevious,
  onOpenEpisodeDetails,
  onScreenshot,
  onSaveClip,
  onClosePlayer,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [panel, setPanel] = useState<Panel>("main");
  const [customSkipInput, setCustomSkipInput] = useState(String(skipSeconds));
  const transportDisabled = ended || sessionDead;

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    setPos({ x: left, y: top });
  }, [x, y, panel]);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const run = (fn: () => void) => {
    onClose();
    fn();
  };

  const speedLabel =
    Math.abs(playbackSpeed - 1) < 0.01
      ? "Playback speed"
      : `Playback speed (${formatPlaybackSpeed(playbackSpeed)})`;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Player menu"
      className="fixed z-[120] min-w-[13.5rem] overflow-hidden rounded-xl border border-white/10 bg-[rgba(14,12,26,0.97)] py-1 shadow-2xl backdrop-blur-xl"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {panel === "main" ? (
        <>
          <p className="truncate border-b border-white/8 px-3 py-2 text-[11px] font-medium text-pitflix-muted">
            {title}
          </p>
          <MenuRow
            label={ended || sessionDead ? "Replay" : displayPaused ? "Play" : "Pause"}
            icon={ended || sessionDead || displayPaused ? Play : Pause}
            onClick={() => run(onPlayPause)}
          />
          <MenuSeparator />
          <MenuRow
            label="Subtitles"
            icon={Subtitles}
            checked={subVisible}
            disabled={transportDisabled}
            onClick={() => run(onToggleSubtitles)}
          />
          <MenuRow
            label="Search subtitles"
            icon={Search}
            disabled={transportDisabled}
            onClick={() => run(onSearchSubtitles)}
          />
          {hasPlaylist ? (
            <MenuRow
              label={playlistCount > 0 ? `Playlist (${playlistCount})` : "Playlist"}
              icon={ListMusic}
              onClick={() => run(onOpenPlaylist)}
            />
          ) : null}
          {audioTracks.length > 1 ? (
            <MenuRow
              label="Audio tracks"
              icon={Volume2}
              trailing={<ChevronRight className="h-3.5 w-3.5 text-white/40" />}
              onClick={() => setPanel("audio")}
            />
          ) : null}
          <MenuRow
            label={speedLabel}
            icon={Gauge}
            disabled={transportDisabled}
            trailing={<ChevronRight className="h-3.5 w-3.5 text-white/40" />}
            onClick={() => setPanel("speed")}
          />
          <MenuRow
            label={`Skip amount (${skipSeconds}s)`}
            icon={Timer}
            disabled={transportDisabled}
            trailing={<ChevronRight className="h-3.5 w-3.5 text-white/40" />}
            onClick={() => { setCustomSkipInput(String(skipSeconds)); setPanel("skip"); }}
          />
          <MenuSeparator />
          <MenuRow
            label="Always on top"
            icon={Pin}
            checked={alwaysOnTop}
            onClick={() => run(onToggleAlwaysOnTop)}
          />
          <MenuRow
            label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            icon={Maximize}
            onClick={() => run(onToggleFullscreen)}
          />
          {hasPrev ? (
            <MenuRow
              label="Previous episode"
              icon={SkipBack}
              onClick={() => run(onPrevious)}
            />
          ) : null}
          {hasNext ? (
            <MenuRow
              label="Next episode"
              icon={SkipForward}
              onClick={() => run(onNext)}
            />
          ) : null}
          {hasEpisodeDetails ? (
            <MenuRow
              label="Episode details"
              icon={MessageSquare}
              onClick={() => run(onOpenEpisodeDetails)}
            />
          ) : null}
          <MenuSeparator />
          <MenuRow
            label="Screenshot"
            icon={Camera}
            disabled={transportDisabled}
            onClick={() => run(onScreenshot)}
          />
          <MenuRow
            label="Save clip…"
            icon={Clapperboard}
            disabled={transportDisabled}
            onClick={() => run(onSaveClip)}
          />
          <MenuSeparator />
          <MenuRow label="Close player" icon={X} onClick={() => run(onClosePlayer)} />
        </>
      ) : null}

      {panel === "speed" ? (
        <>
          <button
            type="button"
            className="flex w-full items-center gap-2 border-b border-white/8 px-3 py-2 text-left text-[12px] font-medium text-white/70 hover:bg-white/5"
            onClick={() => setPanel("main")}
          >
            <ChevronLeft className="h-4 w-4" />
            Playback speed
          </button>
          {PLAYBACK_SPEED_PRESETS.map((preset) => {
            const active = Math.abs(playbackSpeed - preset) < 0.01;
            return (
              <button
                key={preset}
                type="button"
                role="menuitem"
                disabled={transportDisabled}
                onClick={() => run(() => onSetSpeed(preset))}
                className={cn(
                  "flex w-full px-3 py-2 text-left text-[13px] tabular-nums transition hover:bg-white/10 disabled:opacity-40",
                  active ? "font-semibold text-[#c4b5fd]" : "text-white/90",
                )}
              >
                {active ? `✓ ${formatPlaybackSpeed(preset)}` : formatPlaybackSpeed(preset)}
              </button>
            );
          })}
        </>
      ) : null}

      {panel === "skip" ? (
        <>
          <button
            type="button"
            className="flex w-full items-center gap-2 border-b border-white/8 px-3 py-2 text-left text-[12px] font-medium text-white/70 hover:bg-white/5"
            onClick={() => setPanel("main")}
          >
            <ChevronLeft className="h-4 w-4" />
            Skip amount
          </button>
          <div className="grid grid-cols-4 gap-1.5 p-2.5">
            {SKIP_SECONDS_PRESETS.map((preset) => {
              const active = skipSeconds === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  disabled={transportDisabled}
                  onClick={() => onSetSkipSeconds(preset)}
                  className={cn(
                    "rounded-md py-1.5 text-[12.5px] font-semibold tabular-nums transition disabled:opacity-40",
                    active ? "bg-[#7c3aed] text-white" : "bg-white/[0.06] text-white/80 hover:bg-white/[0.12]",
                  )}
                >
                  {preset}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 px-2.5 pb-2.5">
            <input
              type="number"
              min={PLAYER_SKIP_SECONDS_MIN}
              max={PLAYER_SKIP_SECONDS_MAX}
              value={customSkipInput}
              disabled={transportDisabled}
              onChange={(e) => setCustomSkipInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const n = Math.round(Number(customSkipInput));
                if (!Number.isFinite(n)) return;
                onSetSkipSeconds(Math.min(PLAYER_SKIP_SECONDS_MAX, Math.max(PLAYER_SKIP_SECONDS_MIN, n)));
              }}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1.5 text-[12.5px] text-white outline-none focus:border-[#7c3aed] disabled:opacity-40"
              aria-label="Custom skip seconds"
            />
            <button
              type="button"
              disabled={transportDisabled}
              onClick={() => {
                const n = Math.round(Number(customSkipInput));
                if (!Number.isFinite(n)) return;
                onSetSkipSeconds(Math.min(PLAYER_SKIP_SECONDS_MAX, Math.max(PLAYER_SKIP_SECONDS_MIN, n)));
              }}
              className="shrink-0 rounded-md bg-white/[0.1] px-2.5 py-1.5 text-[12px] font-semibold text-white/90 transition hover:bg-white/[0.18] disabled:opacity-40"
            >
              Set
            </button>
          </div>
        </>
      ) : null}

      {panel === "audio" ? (
        <>
          <button
            type="button"
            className="flex w-full items-center gap-2 border-b border-white/8 px-3 py-2 text-left text-[12px] font-medium text-white/70 hover:bg-white/5"
            onClick={() => setPanel("main")}
          >
            <ChevronLeft className="h-4 w-4" />
            Audio tracks
            <PassthroughStatusBadge />
          </button>
          {audioTracks.map((track) => {
            const id = track.id ?? -1;
            if (id < 0) return null;
            const label = track.title || track.lang || `Track ${id}`;
            const active = activeAid === id;
            return (
              <button
                key={id}
                type="button"
                role="menuitem"
                disabled={transportDisabled}
                onClick={() => run(() => onSetAudioTrack(id))}
                className={cn(
                  "flex w-full px-3 py-2 text-left text-[13px] transition hover:bg-white/10 disabled:opacity-40",
                  active ? "font-semibold text-[#c4b5fd]" : "text-white/90",
                )}
              >
                {active ? `✓ ${label}` : label}
              </button>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
