import {
  Captions,
  Clock,
  ListMusic,
  Pause,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume2,
  Wrench,
} from "lucide-react";
import { cn } from "../../../utils/cn";
import { getControlSizeClasses, resolveControlScale, TIME_LABEL_SIZE_CLASSES } from "../../player/playerLayoutSizes";
import { getSeekBarVisualStyle } from "../../player/playerSeekBarLayout";
import { groupControlsByZone } from "../../player/playerLayoutZones";
import type { PlayerLayoutControlId, PlayerLayoutEditorSelectionId, PlayerLayoutPrefs } from "../../player/playerLayoutTypes";
import { PLAYER_LAYOUT_CONTROL_LABELS, PLAYER_LAYOUT_SELECTION_LABELS } from "../../player/playerLayoutTypes";

type Props = {
  prefs: PlayerLayoutPrefs;
  selectedId: PlayerLayoutEditorSelectionId | null;
  onSelect: (id: PlayerLayoutEditorSelectionId | null) => void;
};

function Selectable({
  id,
  label,
  selected,
  visible = true,
  onSelect,
  children,
  className,
}: {
  id: PlayerLayoutEditorSelectionId;
  label: string;
  selected: boolean;
  visible?: boolean;
  onSelect: (id: PlayerLayoutEditorSelectionId) => void;
  children: React.ReactNode;
  className?: string;
}) {
  if (!visible) return null;
  return (
    <button
      type="button"
      title={label}
      aria-label={`Edit ${label}`}
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(id);
      }}
      className={cn(
        "relative rounded-xl p-1 transition-all duration-200",
        selected
          ? "z-10 ring-2 ring-emerald-400/90 ring-offset-2 ring-offset-black/80 shadow-[0_0_20px_rgba(52,211,153,0.35)]"
          : "hover:ring-1 hover:ring-white/25 hover:ring-offset-2 hover:ring-offset-black/60",
        className,
      )}
    >
      {children}
    </button>
  );
}

function MockControl({
  id,
  prefs,
  selectedId,
  onSelect,
}: {
  id: PlayerLayoutControlId;
  prefs: PlayerLayoutPrefs;
  selectedId: PlayerLayoutEditorSelectionId | null;
  onSelect: (id: PlayerLayoutEditorSelectionId) => void;
}) {
  const sizes = getControlSizeClasses(prefs, id);
  const scale = resolveControlScale(prefs, id);
  const label = PLAYER_LAYOUT_CONTROL_LABELS[id];
  const visible = prefs.visible[id];
  const selected = selectedId === id;

  const scaled = (node: React.ReactNode) =>
    scale !== 1 ? (
      <div className="flex items-center justify-center" style={{ transform: `scale(${scale})`, transformOrigin: "center" }}>
        {node}
      </div>
    ) : (
      node
    );

  switch (id) {
    case "prev":
      return (
        <Selectable id={id} label={label} selected={selected} visible={visible} onSelect={onSelect}>
          {scaled(
            <span className={cn("flex items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white", sizes.navBtn)}>
              <SkipBack className={sizes.navIcon} strokeWidth={2.25} />
            </span>,
          )}
        </Selectable>
      );
    case "next":
      return (
        <Selectable id={id} label={label} selected={selected} visible={visible} onSelect={onSelect}>
          {scaled(
            <span className={cn("flex items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white", sizes.navBtn)}>
              <SkipForward className={sizes.navIcon} strokeWidth={2.25} />
            </span>,
          )}
        </Selectable>
      );
    case "seekBack":
      return (
        <Selectable id={id} label={label} selected={selected} visible={visible} onSelect={onSelect}>
          {scaled(
            <span className={cn("flex flex-col items-center justify-center gap-0 rounded-md text-white bg-white/[0.06]", sizes.seekBtn)}>
              <RotateCcw className={sizes.seekIcon} strokeWidth={2} />
              <span className={cn("font-bold leading-none", sizes.seekLabel)}>5</span>
            </span>,
          )}
        </Selectable>
      );
    case "playPause":
      return (
        <Selectable id={id} label={label} selected={selected} visible={visible} onSelect={onSelect}>
          {scaled(
            <span
              className={cn(
                "flex items-center justify-center rounded-full border border-white/15 bg-white/12 text-white",
                sizes.playBtn,
              )}
              style={{ boxShadow: "0 0 24px rgba(124,58,237,0.28)" }}
            >
              <Pause className={sizes.playIcon} fill="currentColor" />
            </span>,
          )}
        </Selectable>
      );
    case "seekForward":
      return (
        <Selectable id={id} label={label} selected={selected} visible={visible} onSelect={onSelect}>
          {scaled(
            <span className={cn("flex flex-col items-center justify-center gap-0 rounded-md text-white bg-white/[0.06]", sizes.seekBtn)}>
              <RotateCw className={sizes.seekIcon} strokeWidth={2} />
              <span className={cn("font-bold leading-none", sizes.seekLabel)}>5</span>
            </span>,
          )}
        </Selectable>
      );
    case "subtitles":
      return (
        <Selectable id={id} label={label} selected={selected} visible={visible} onSelect={onSelect}>
          {scaled(
            <span className="flex h-9 items-center justify-center gap-1 rounded-[7px] border border-[rgba(124,58,237,0.32)] bg-[rgba(124,58,237,0.18)] px-[11px] text-[11px] font-bold text-[#c4b5fd]">
              <Captions className="h-3.5 w-3.5" strokeWidth={2.5} />
              CC
            </span>,
          )}
        </Selectable>
      );
    case "volume":
      return (
        <Selectable id={id} label={label} selected={selected} visible={visible} onSelect={onSelect} className="px-1">
          {scaled(
            <div className="flex items-center gap-2">
              <span className={cn("flex items-center justify-center rounded-md bg-white/10 text-white", sizes.secondaryBtn)}>
                <Volume2 className={sizes.secondaryIcon} />
              </span>
              <div className="hidden h-1 w-20 overflow-hidden rounded-full bg-white/15 sm:block">
                <div className="h-full w-[65%] rounded-full bg-gradient-to-r from-violet-600 to-violet-400" />
              </div>
            </div>,
          )}
        </Selectable>
      );
    case "speed":
      return (
        <Selectable id={id} label={label} selected={selected} visible={visible} onSelect={onSelect}>
          {scaled(
            <span className="flex h-9 min-w-[2.5rem] items-center justify-center rounded-[7px] border border-white/10 bg-white/[0.07] px-[11px] text-[12.5px] font-semibold tabular-nums text-white">
              1.0x
            </span>,
          )}
        </Selectable>
      );
    case "devtools":
      return (
        <Selectable id={id} label={label} selected={selected} visible={visible} onSelect={onSelect}>
          {scaled(
            <span className="flex h-8 items-center justify-center rounded-md bg-white/10 px-2 text-white">
              <Wrench className="h-3.5 w-3.5" />
            </span>,
          )}
        </Selectable>
      );
    case "audio":
      return (
        <Selectable id={id} label={label} selected={selected} visible={visible} onSelect={onSelect}>
          {scaled(
            <span className={cn("flex items-center justify-center rounded-md text-white bg-white/[0.07]", sizes.secondaryBtn)}>
              <ListMusic className={sizes.secondaryIcon} />
            </span>,
          )}
        </Selectable>
      );
    case "subDelay":
      return (
        <Selectable id={id} label={label} selected={selected} visible={visible} onSelect={onSelect}>
          {scaled(
            <span className={cn("flex items-center justify-center rounded-md text-white bg-white/[0.07]", sizes.secondaryBtn)}>
              <Clock className={sizes.secondaryIcon} />
            </span>,
          )}
        </Selectable>
      );
    default:
      return null;
  }
}

export function PlayerLayoutEditorPreview({ prefs, selectedId, onSelect }: Props) {
  const grouped = groupControlsByZone(prefs);
  const seek = prefs.seekBar;
  const seekStyle = getSeekBarVisualStyle(seek);
  const timeLabelClass = TIME_LABEL_SIZE_CLASSES[seek.timeLabelSize] ?? TIME_LABEL_SIZE_CLASSES.default;

  const renderZone = (zone: "left" | "center" | "right", justify: string) => (
    <div className={cn("flex min-h-[60px] flex-wrap content-center items-center gap-3 sm:gap-3.5", justify)}>
      {grouped[zone].map((id) => (
        <MockControl key={id} id={id} prefs={prefs} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );

  return (
    <div
      className="relative flex h-full min-h-[min(42vh,380px)] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#07060d] shadow-2xl shadow-black/60"
      onClick={() => onSelect(null)}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 20% 30%, rgba(59,130,246,0.18) 0%, transparent 55%), radial-gradient(ellipse 70% 50% at 85% 70%, rgba(124,58,237,0.14) 0%, transparent 50%), linear-gradient(180deg, #0a0912 0%, #050508 100%)",
        }}
      />
      <p className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none text-[clamp(2.5rem,8vw,5.5rem)] font-black tracking-[0.35em] text-white/[0.04]">
        PREVIEW
      </p>

      <div className="relative z-10 flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70">
            <SkipBack className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Sample Movie Title</p>
            <p className="text-[11px] text-white/45">Season 1 · Episode 3</p>
          </div>
        </div>
        <span className="hidden rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[10px] tabular-nums text-white/40 sm:inline">
          1296 × 809 · MID
        </span>
      </div>

      <div className="relative z-10 mt-auto">
        <div
          className="px-6 pb-2 pt-6 sm:px-8"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.99) 0%, rgba(0,0,0,0.88) 45%, transparent 100%)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {seek.visible ? (
          <div className={cn("mb-4 flex items-center gap-3 font-bold tabular-nums text-white", timeLabelClass)}>
            <Selectable
              id="timeCurrent"
              label={PLAYER_LAYOUT_SELECTION_LABELS.timeCurrent}
              selected={selectedId === "timeCurrent"}
              visible={seek.currentTimeVisible}
              onSelect={onSelect}
            >
              <span className="shrink-0 px-0.5">22:22</span>
            </Selectable>
            <Selectable
              id="seekBar"
              label={PLAYER_LAYOUT_SELECTION_LABELS.seekBar}
              selected={selectedId === "seekBar"}
              onSelect={onSelect}
              className="flex flex-1 px-1 py-2"
            >
              <div className="relative flex w-full items-center py-1">
                <div
                  className="w-full overflow-hidden rounded-full bg-white/[0.14]"
                  style={{ height: seekStyle.trackPx }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: "21%",
                      background: seekStyle.fillBackground,
                      boxShadow: seekStyle.fillShadow,
                    }}
                  />
                </div>
              </div>
            </Selectable>
            <Selectable
              id="timeRemaining"
              label={PLAYER_LAYOUT_SELECTION_LABELS.timeRemaining}
              selected={selectedId === "timeRemaining"}
              visible={seek.remainingTimeVisible}
              onSelect={onSelect}
            >
              <span className="shrink-0 px-0.5 text-white/55">1:47:00</span>
            </Selectable>
          </div>
          ) : null}

          <div className="grid grid-cols-3 items-end gap-x-6 gap-y-3 pb-5 sm:gap-x-10 md:gap-x-14">
            {renderZone("left", "justify-start")}
            {renderZone("center", "justify-center")}
            {renderZone("right", "justify-end")}
          </div>
        </div>
      </div>
    </div>
  );
}
