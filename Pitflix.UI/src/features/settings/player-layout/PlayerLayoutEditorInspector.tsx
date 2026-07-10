import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Gauge,
} from "lucide-react";
import { cn } from "../../../utils/cn";
import { getControlIndexInZone, getControlsInZone } from "../../player/playerLayoutOrder";
import {
  CONTROL_SCALE_MAX,
  CONTROL_SCALE_MIN,
  CONTROL_SCALE_STEP,
  controlSizeScale,
  hasControlScaleOverride,
  resolveControlScale,
} from "../../player/playerLayoutSizes";
import type {
  PlayerControlSize,
  PlayerLayoutControlId,
  PlayerLayoutEditorSelectionId,
  PlayerLayoutPrefs,
  PlayerLayoutZone,
  PlayerSeekBarColor,
  PlayerSeekBarPrefs,
} from "../../player/playerLayoutTypes";
import {
  isLayoutControlId,
  PLAYER_LAYOUT_CONTROL_LABELS,
  PLAYER_LAYOUT_SELECTION_LABELS,
} from "../../player/playerLayoutTypes";

type Props = {
  prefs: PlayerLayoutPrefs;
  selectedId: PlayerLayoutEditorSelectionId;
  onZoneChange: (zone: PlayerLayoutZone) => void;
  onVisibleChange: (visible: boolean) => void;
  onGlobalControlSizeChange: (size: PlayerControlSize) => void;
  onControlScaleChange: (scale: number | null) => void;
  onMoveInZone: (direction: "earlier" | "later") => void;
  onSelect: (id: PlayerLayoutEditorSelectionId) => void;
  onReorderInZone: (id: PlayerLayoutControlId, direction: "earlier" | "later") => void;
  onSeekBarChange: (patch: Partial<PlayerSeekBarPrefs>) => void;
};

const ZONE_LABELS: Record<PlayerLayoutZone, string> = {
  left: "Left row",
  center: "Center row",
  right: "Right row",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">{children}</p>
  );
}

function SizePicker({
  value,
  onChange,
  label,
}: {
  value: PlayerControlSize;
  onChange: (size: PlayerControlSize) => void;
  label: string;
}) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="flex gap-1">
        {(["compact", "default", "large"] as const).map((size) => (
          <button
            key={size}
            type="button"
            onClick={() => onChange(size)}
            className={cn(
              "flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-semibold capitalize transition-all",
              value === size
                ? "border-violet-400/40 bg-violet-500/15 text-violet-200"
                : "border-white/[0.08] bg-white/[0.03] text-white/45 hover:text-white/75",
            )}
          >
            {size}
          </button>
        ))}
      </div>
    </div>
  );
}

function ButtonSizeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (scale: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <SectionLabel>Button size</SectionLabel>
        <span className="text-[11px] font-semibold tabular-nums text-violet-200">{pct}%</span>
      </div>
      <input
        type="range"
        min={Math.round(CONTROL_SCALE_MIN * 100)}
        max={Math.round(CONTROL_SCALE_MAX * 100)}
        step={Math.round(CONTROL_SCALE_STEP * 100)}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-violet-400 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-400 [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(167,139,250,0.5)]"
        aria-label="Button size"
      />
      <div className="mt-1 flex justify-between text-[9px] text-white/30">
        <span>65%</span>
        <span>100%</span>
        <span>145%</span>
      </div>
    </div>
  );
}

function ZoneChip({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof AlignLeft;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[9px] font-semibold transition-all",
        active
          ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-200"
          : "border-white/[0.08] bg-white/[0.03] text-white/50 hover:border-white/20 hover:text-white/80",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      {label}
    </button>
  );
}

function VisibilityToggle({ visible, onChange }: { visible: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!visible)}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all",
        visible
          ? "border-white/[0.12] bg-white/[0.05] text-white"
          : "border-red-400/30 bg-red-500/10 text-red-200",
      )}
    >
      {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      {visible ? "Visible" : "Hidden"}
    </button>
  );
}

export function PlayerLayoutEditorInspector({
  prefs,
  selectedId,
  onZoneChange,
  onVisibleChange,
  onGlobalControlSizeChange,
  onControlScaleChange,
  onMoveInZone,
  onSelect,
  onReorderInZone,
  onSeekBarChange,
}: Props) {
  const isControl = isLayoutControlId(selectedId);

  if (!isControl) {
    const seek = prefs.seekBar;
    const isSeekBar = selectedId === "seekBar";
    const isTime = selectedId === "timeCurrent" || selectedId === "timeRemaining";

    return (
      <aside className="px-4 py-3 md:px-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400/80">Selected</p>
            <h3 className="text-sm font-semibold text-white">{PLAYER_LAYOUT_SELECTION_LABELS[selectedId]}</h3>
          </div>
          {isSeekBar ? (
            <VisibilityToggle visible={seek.visible} onChange={(v) => onSeekBarChange({ visible: v })} />
          ) : isTime ? (
            <VisibilityToggle
              visible={selectedId === "timeCurrent" ? seek.currentTimeVisible : seek.remainingTimeVisible}
              onChange={(v) =>
                onSeekBarChange(
                  selectedId === "timeCurrent" ? { currentTimeVisible: v } : { remainingTimeVisible: v },
                )
              }
            />
          ) : null}
        </div>

        {isSeekBar ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <SectionLabel>Bar thickness</SectionLabel>
              <div className="flex gap-1">
                {(["thin", "default", "thick"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onSeekBarChange({ thickness: t })}
                    className={cn(
                      "flex-1 rounded-lg border py-1.5 text-[10px] font-semibold capitalize",
                      seek.thickness === t
                        ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                        : "border-white/[0.08] text-white/45",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <SectionLabel>Bar color</SectionLabel>
              <div className="flex gap-1">
                {(
                  [
                    ["violet", "Violet", "bg-violet-500"],
                    ["emerald", "Green", "bg-emerald-400"],
                    ["white", "White", "bg-white"],
                  ] as const
                ).map(([id, label, swatch]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onSeekBarChange({ color: id as PlayerSeekBarColor })}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-1 rounded-lg border py-1.5 text-[9px] font-semibold",
                      seek.color === id ? "border-white/30 text-white" : "border-white/[0.08] text-white/45",
                    )}
                  >
                    <span className={cn("h-2.5 w-2.5 rounded-full", swatch)} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col justify-end gap-2 sm:col-span-2">
              <label className="flex items-center justify-between rounded-lg border border-white/[0.08] px-3 py-2 text-[11px] text-white/75">
                Scrub thumb on hover
                <input
                  type="checkbox"
                  checked={seek.thumbVisible}
                  onChange={(e) => onSeekBarChange({ thumbVisible: e.target.checked })}
                  className="accent-emerald-400"
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-white/[0.08] px-3 py-2 text-[11px] text-white/75">
                Hover preview thumbnails
                <input
                  type="checkbox"
                  checked={seek.hoverPreviewVisible}
                  onChange={(e) => onSeekBarChange({ hoverPreviewVisible: e.target.checked })}
                  className="accent-emerald-400"
                />
              </label>
            </div>
          </div>
        ) : null}

        {isTime ? (
          <div className="max-w-xs">
            <SizePicker
              label="Time label size"
              value={seek.timeLabelSize}
              onChange={(size) => onSeekBarChange({ timeLabelSize: size })}
            />
          </div>
        ) : null}
      </aside>
    );
  }

  const zone = prefs.zones[selectedId];
  const visible = prefs.visible[selectedId];
  const zoneControls = getControlsInZone(prefs, zone, { visibleOnly: false });
  const indexInZone = getControlIndexInZone(prefs, selectedId);
  const resolvedScale = resolveControlScale(prefs, selectedId);
  const hasScaleOverride = hasControlScaleOverride(prefs, selectedId);
  const globalScalePct = Math.round(controlSizeScale(prefs.controlSize) * 100);

  return (
    <aside className="px-4 py-3 md:px-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400/80">Selected control</p>
          <h3 className="text-sm font-semibold text-white">{PLAYER_LAYOUT_CONTROL_LABELS[selectedId]}</h3>
        </div>
        <VisibilityToggle visible={visible} onChange={onVisibleChange} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-12 lg:gap-4">
        <div className="col-span-2 lg:col-span-4">
          <ButtonSizeSlider value={resolvedScale} onChange={onControlScaleChange} />
          {hasScaleOverride ? (
            <button
              type="button"
              onClick={() => onControlScaleChange(null)}
              className="mt-1.5 w-full text-[10px] text-white/40 hover:text-white/70"
            >
              Reset to global ({globalScalePct}%)
            </button>
          ) : (
            <p className="mt-1.5 text-[10px] text-white/35">
              100% matches global default ({globalScalePct}%)
            </p>
          )}
        </div>

        <div className="col-span-1 lg:col-span-3">
          <SectionLabel>
            <span className="inline-flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              Global default
            </span>
          </SectionLabel>
          <div className="flex gap-1">
            {(["compact", "default", "large"] as const).map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => onGlobalControlSizeChange(size)}
                className={cn(
                  "flex-1 rounded-lg border py-1.5 text-[10px] font-semibold capitalize",
                  prefs.controlSize === size
                    ? "border-white/25 bg-white/[0.06] text-white"
                    : "border-white/[0.08] text-white/45",
                )}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <div className="col-span-1 lg:col-span-3">
          <SectionLabel>Row position</SectionLabel>
          <div className="flex gap-1">
            <ZoneChip active={zone === "left"} onClick={() => onZoneChange("left")} icon={AlignLeft} label="Left" />
            <ZoneChip active={zone === "center"} onClick={() => onZoneChange("center")} icon={AlignCenter} label="Center" />
            <ZoneChip active={zone === "right"} onClick={() => onZoneChange("right")} icon={AlignRight} label="Right" />
          </div>
        </div>

        <div className="col-span-1 lg:col-span-3">
          <SectionLabel>Order in row</SectionLabel>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={indexInZone <= 0}
              onClick={() => onMoveInZone("earlier")}
              className="flex h-8 flex-1 items-center justify-center gap-0.5 rounded-lg border border-white/[0.1] bg-white/[0.04] text-[10px] text-white disabled:opacity-35"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Earlier
            </button>
            <span className="shrink-0 px-1 text-[10px] tabular-nums text-white/45">
              {indexInZone >= 0 ? `${indexInZone + 1}/${zoneControls.length}` : "—"}
            </span>
            <button
              type="button"
              disabled={indexInZone < 0 || indexInZone >= zoneControls.length - 1}
              onClick={() => onMoveInZone("later")}
              className="flex h-8 flex-1 items-center justify-center gap-0.5 rounded-lg border border-white/[0.1] bg-white/[0.04] text-[10px] text-white disabled:opacity-35"
            >
              Later
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="col-span-2 lg:col-span-12">
          <SectionLabel>{ZONE_LABELS[zone]} — tap to select, arrows to reorder</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {zoneControls.map((id, i) => {
              const isSelected = id === selectedId;
              const isHidden = !prefs.visible[id];
              return (
                <div
                  key={id}
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full border pl-2.5 pr-0.5",
                    isSelected
                      ? "border-emerald-400/50 bg-emerald-500/10"
                      : "border-white/[0.1] bg-white/[0.03]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(id)}
                    className={cn(
                      "max-w-[9rem] truncate py-1.5 text-left text-[10px]",
                      isHidden ? "text-white/35 line-through" : isSelected ? "font-semibold text-emerald-100" : "text-white/75",
                    )}
                  >
                    {PLAYER_LAYOUT_CONTROL_LABELS[id]}
                  </button>
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => onReorderInZone(id, "earlier")}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-white/50 hover:bg-white/10 disabled:opacity-25"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    disabled={i === zoneControls.length - 1}
                    onClick={() => onReorderInZone(id, "later")}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-white/50 hover:bg-white/10 disabled:opacity-25"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
