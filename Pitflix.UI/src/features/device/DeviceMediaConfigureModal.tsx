import { ChevronDown, ChevronUp, ImageIcon, Play, RefreshCw, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DEFAULT_DEVICE_MEDIA_SETTINGS,
  normalizeDeviceMediaSettings,
  type DeviceMediaSettings,
} from "./deviceMediaSettings";

type Props = {
  open: boolean;
  settings: DeviceMediaSettings;
  onClose: () => void;
  onSave: (settings: DeviceMediaSettings) => void;
  onRegenerateThumbnails: (settings: DeviceMediaSettings) => void;
};

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ImageIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent">
      <div className="flex items-center gap-2.5 border-b border-white/8 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div className="space-y-5 p-4">{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div>
        <div className="text-sm font-medium text-white">{label}</div>
        {hint ? <div className="mt-1 text-xs leading-relaxed text-pitflix-muted">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function NumberInput({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const commit = (raw: number) => onChange(clampValue(raw, min, max));

  return (
    <div className="flex h-10 overflow-hidden rounded-xl border border-white/10 bg-black/50 transition focus-within:border-violet-500/50 focus-within:ring-2 focus-within:ring-violet-500/20">
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => commit(Number(e.target.value))}
        className="device-number-input min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none"
      />

      <div className="flex shrink-0 flex-col border-l border-white/10">
        <button
          type="button"
          aria-label="Increase"
          disabled={value >= max}
          onClick={() => commit(value + step)}
          className="flex h-5 w-8 items-center justify-center text-pitflix-muted transition hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label="Decrease"
          disabled={value <= min}
          onClick={() => commit(value - step)}
          className="flex h-5 w-8 items-center justify-center border-t border-white/10 text-pitflix-muted transition hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {suffix ? (
        <div className="flex shrink-0 items-center border-l border-white/10 bg-white/[0.03] px-2.5 text-[11px] font-semibold uppercase tracking-wide text-pitflix-muted">
          {suffix}
        </div>
      ) : null}
    </div>
  );
}

function RangePair({
  fromLabel,
  toLabel,
  fromValue,
  toValue,
  fromMin,
  fromMax,
  toMin,
  toMax,
  suffix,
  formatHint,
  onFromChange,
  onToChange,
}: {
  fromLabel: string;
  toLabel: string;
  fromValue: number;
  toValue: number;
  fromMin: number;
  fromMax: number;
  toMin: number;
  toMax: number;
  suffix: string;
  formatHint?: (v: number) => string;
  onFromChange: (v: number) => void;
  onToChange: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="mb-1.5 text-[11px] font-medium text-pitflix-muted">{fromLabel}</div>
        <NumberInput value={fromValue} min={fromMin} max={fromMax} suffix={suffix} onChange={onFromChange} />
        {formatHint ? (
          <div className="mt-1 text-[10px] text-pitflix-muted/80">{formatHint(fromValue)}</div>
        ) : null}
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-medium text-pitflix-muted">{toLabel}</div>
        <NumberInput value={toValue} min={toMin} max={toMax} suffix={suffix} onChange={onToChange} />
        {formatHint ? (
          <div className="mt-1 text-[10px] text-pitflix-muted/80">{formatHint(toValue)}</div>
        ) : null}
      </div>
    </div>
  );
}

function ThumbnailRangePreview({ minPct, maxPct }: { minPct: number; maxPct: number }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/30 p-3">
      <div className="mb-2 flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-pitflix-muted">
        <span>Start</span>
        <span>End</span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-white/8">
        <div
          className="absolute inset-y-0 rounded-full bg-gradient-to-r from-violet-600/70 to-violet-400/90"
          style={{ left: `${minPct}%`, right: `${100 - maxPct}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-pitflix-muted">
        <span>{minPct}%</span>
        <span className="text-violet-300">Random frame in this range</span>
        <span>{maxPct}%</span>
      </div>
    </div>
  );
}

export function DeviceMediaConfigureModal({
  open,
  settings,
  onClose,
  onSave,
  onRegenerateThumbnails,
}: Props) {
  const [draft, setDraft] = useState<DeviceMediaSettings>(settings);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const update = (patch: Partial<DeviceMediaSettings>) => {
    setDraft((prev) => normalizeDeviceMediaSettings({ ...prev, ...patch }));
  };

  const handleRegenerate = () => {
    setRegenerating(true);
    onRegenerateThumbnails(normalizeDeviceMediaSettings(draft));
    window.setTimeout(() => setRegenerating(false), 1200);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[min(90vh,760px)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-white/8 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
                <Settings2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Configure thumbnails & preview</h2>
                <p className="mt-1 text-sm text-pitflix-muted">
                  Adjust where frames are captured and how hover previews move through videos.
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-pitflix-muted transition hover:bg-white/10 hover:text-white"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <SectionCard icon={ImageIcon} title="Thumbnails">
            <FieldRow
              label="Frame range in video"
              hint="A random frame is picked between these positions. Example: 35–65% uses the middle third."
            >
              <ThumbnailRangePreview minPct={draft.thumbMinPct} maxPct={draft.thumbMaxPct} />
              <RangePair
                fromLabel="From"
                toLabel="To"
                fromValue={draft.thumbMinPct}
                toValue={draft.thumbMaxPct}
                fromMin={0}
                fromMax={98}
                toMin={1}
                toMax={100}
                suffix="%"
                onFromChange={(v) => update({ thumbMinPct: v })}
                onToChange={(v) => update({ thumbMaxPct: v })}
              />
            </FieldRow>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-white">Regenerate thumbnails</div>
                <div className="mt-0.5 text-xs text-pitflix-muted">
                  Applies the range above and captures fresh frames for all videos in this folder.
                </div>
              </div>
              <button
                type="button"
                disabled={regenerating}
                onClick={handleRegenerate}
                className="flex shrink-0 items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3.5 py-2 text-sm font-medium text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`} />
                {regenerating ? "Resetting…" : "Reset thumbnails"}
              </button>
            </div>
          </SectionCard>

          <SectionCard icon={Play} title="Hover preview">
            <FieldRow
              label="First preview position"
              hint="When you hover a video, playback starts at a random time in this range."
            >
              <RangePair
                fromLabel="From"
                toLabel="To"
                fromValue={draft.previewStartMinSec}
                toValue={draft.previewStartMaxSec}
                fromMin={0}
                fromMax={7200}
                toMin={0}
                toMax={7200}
                suffix="sec"
                formatHint={formatDuration}
                onFromChange={(v) => update({ previewStartMinSec: v })}
                onToChange={(v) => update({ previewStartMaxSec: v })}
              />
            </FieldRow>

            <FieldRow
              label="Jump to next part"
              hint="Each new hover — or auto-advance while holding — moves forward by a random amount in this range."
            >
              <RangePair
                fromLabel="Min jump"
                toLabel="Max jump"
                fromValue={draft.previewStepMinSec}
                toValue={draft.previewStepMaxSec}
                fromMin={1}
                fromMax={7200}
                toMin={1}
                toMax={7200}
                suffix="sec"
                formatHint={formatDuration}
                onFromChange={(v) => update({ previewStepMinSec: v })}
                onToChange={(v) => update({ previewStepMaxSec: v })}
              />
            </FieldRow>

            <FieldRow
              label="Auto-advance while hovering"
              hint="If you keep the mouse on a video, it jumps to the next part after this many seconds."
            >
              <div className="max-w-xs">
                <NumberInput
                  value={draft.previewAutoAdvanceSec}
                  min={1}
                  max={120}
                  suffix="sec"
                  onChange={(v) => update({ previewAutoAdvanceSec: v })}
                />
                <div className="mt-1 text-[10px] text-pitflix-muted/80">
                  ≈ {formatDuration(draft.previewAutoAdvanceSec)} between jumps
                </div>
              </div>
            </FieldRow>
          </SectionCard>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 px-6 py-4">
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm text-pitflix-muted transition hover:bg-white/5 hover:text-white"
            onClick={() => setDraft({ ...DEFAULT_DEVICE_MEDIA_SETTINGS })}
          >
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg px-4 py-2.5 text-sm text-pitflix-muted transition hover:bg-white/5 hover:text-white"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-pitflix-primary px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-900/30 transition hover:brightness-110"
              onClick={() => onSave(normalizeDeviceMediaSettings(draft))}
            >
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
