import { useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { cn } from "../../utils/cn";
import { fmtTime } from "./playerFormat";
import { fmtTimeForFilename, resolvePlayerExportSubtitleBurn, safePlayerExportFileName } from "./playerExport";
import type { MpvTrack } from "./playerTypes";

export type ClipAnchor = "center" | "start" | "end";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  filePath: string;
  currentSeconds: number;
  durationSeconds: number;
  subVisible: boolean;
  sid: number | null;
  subDelay: number;
  subMenuValue: string;
  subTracks: MpvTrack[];
  externalSubFiles: string[];
  onExportBusyChange?: (message: string | null) => void;
};

const DURATION_PRESETS = [10, 20, 30, 60] as const;

function computeClipRange(
  currentSeconds: number,
  durationSeconds: number,
  clipDuration: number,
  anchor: ClipAnchor,
): { start: number; duration: number } {
  const maxDur = durationSeconds > 0 ? durationSeconds : currentSeconds + clipDuration;
  const dur = Math.min(clipDuration, maxDur);
  let start = 0;
  if (anchor === "start") {
    start = currentSeconds;
  } else if (anchor === "end") {
    start = Math.max(0, currentSeconds - dur);
  } else {
    start = Math.max(0, currentSeconds - dur / 2);
  }
  if (durationSeconds > 0 && start + dur > durationSeconds) {
    start = Math.max(0, durationSeconds - dur);
  }
  return { start, duration: dur };
}

export function PlayerClipExportModal({
  open,
  onClose,
  title,
  filePath,
  currentSeconds,
  durationSeconds,
  subVisible,
  sid,
  subDelay,
  subMenuValue,
  subTracks,
  externalSubFiles,
  onExportBusyChange,
}: Props) {
  const [clipDuration, setClipDuration] = useState(30);
  const [anchor, setAnchor] = useState<ClipAnchor>("center");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(
    () => computeClipRange(currentSeconds, durationSeconds, clipDuration, anchor),
    [anchor, clipDuration, currentSeconds, durationSeconds],
  );

  if (!open) return null;

  const exportClip = async () => {
    if (!isTauri()) {
      setError("Clip export is only available in the desktop app.");
      return;
    }
    setError(null);
    try {
      const outputPath = await save({
        defaultPath: safePlayerExportFileName(
          title,
          `clip ${fmtTimeForFilename(range.start)}-${fmtTimeForFilename(range.start + range.duration)}`,
          "mp4",
        ),
        filters: [{ name: "Video", extensions: ["mp4", "mkv"] }],
      });
      if (!outputPath) return;

      setBusy(true);
      onExportBusyChange?.("Saving clip…");
      await invoke("player2_export_clip", {
        sourcePath: filePath,
        startSeconds: range.start,
        durationSeconds: range.duration,
        outputPath,
        subtitles: resolvePlayerExportSubtitleBurn({
          subVisible,
          sid,
          subDelay,
          subMenuValue,
          subTracks,
          externalSubFiles,
        }),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onExportBusyChange?.(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0f0f12] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pitflix-muted">Save clip</p>
            <h2 className="truncate text-lg font-semibold text-white">{title}</h2>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md text-white/70 hover:bg-white/10"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div>
            <p className="mb-2 text-xs font-medium text-pitflix-muted">Clip length</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                    clipDuration === preset
                      ? "border-pitflix-primary/50 bg-pitflix-primary/15 text-[#c4b5fd]"
                      : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
                  )}
                  onClick={() => setClipDuration(preset)}
                >
                  {preset}s
                </button>
              ))}
            </div>
            <input
              type="range"
              min={5}
              max={120}
              step={5}
              value={clipDuration}
              onChange={(e) => setClipDuration(Number(e.target.value))}
              className="w-full accent-pitflix-primary"
            />
            <p className="mt-1 text-xs text-pitflix-muted">{clipDuration} seconds</p>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-pitflix-muted">Anchor to playhead</p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["start", "Start here"],
                  ["center", "Centered"],
                  ["end", "End here"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    "rounded-lg border px-2 py-2 text-xs font-medium transition",
                    anchor === value
                      ? "border-pitflix-primary/50 bg-pitflix-primary/15 text-[#c4b5fd]"
                      : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
                  )}
                  onClick={() => setAnchor(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/85">
            <p>
              From <span className="font-semibold text-white">{fmtTime(range.start)}</span>
              {" "}to{" "}
              <span className="font-semibold text-white">{fmtTime(range.start + range.duration)}</span>
            </p>
            <p className="mt-1 text-xs text-pitflix-muted">
              Playhead at {fmtTime(currentSeconds)}
              {durationSeconds > 0 ? ` · Episode length ${fmtTime(durationSeconds)}` : ""}
            </p>
          </div>

          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/8 px-5 py-4">
          <button
            type="button"
            className="rounded-lg px-4 py-2 text-sm text-white/75 hover:bg-white/10"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-pitflix-primary px-4 py-2 text-sm font-semibold text-white hover:bg-pitflix-primary/90 disabled:opacity-50"
            onClick={() => void exportClip()}
            disabled={busy || !filePath}
          >
            {busy ? "Exporting…" : "Choose save location"}
          </button>
        </div>
      </div>
    </div>
  );
}
