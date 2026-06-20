import { useCallback, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { getHistory } from "../api/history";
import { trustedResumeHeadFromRow, type HistoryResumeFields } from "../utils/trustedResume";
import { usePlayback, type PlayContext } from "./usePlayback";

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const sec = Math.floor(s % 60);
  const totalMin = Math.floor(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const ss = sec.toString().padStart(2, "0");
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, "/").toLowerCase();
}

type PlayArgs = {
  filePath: string;
  title: string;
  posterPath: string | null | undefined;
  mediaType: string;
  durationSeconds: number;
  context?: PlayContext;
};

type Pending = PlayArgs & { resumeSeconds: number };

/**
 * Wraps `play` with a centered "Resume from X:XX / Start Over" modal that
 * appears when the file has meaningful watch history (> 10s, < end). Replaces
 * `usePlayback().play` for routes that should ask before auto-resuming.
 */
export function useResumeBeforePlay() {
  const { play } = usePlayback();
  const [pending, setPending] = useState<Pending | null>(null);

  const requestPlay = useCallback(
    async (args: PlayArgs) => {
      let resumeSeconds = 0;
      try {
        const rows = (await getHistory(200, { includeSuppressed: true, lite: true })) as HistoryResumeFields[];
        const target = normalizePath(args.filePath);
        for (const row of rows) {
          if (normalizePath(row.filePath ?? "") !== target) continue;
          const head = trustedResumeHeadFromRow(row);
          if (head > resumeSeconds) resumeSeconds = head;
        }
      } catch {
        /* History lookup is optional; fall through to a fresh play. */
      }
      // If close to the end (< 30s left), treat as a re-watch and start over.
      const nearEnd =
        args.durationSeconds > 60 && args.durationSeconds - resumeSeconds < 30;
      if (resumeSeconds > 10 && !nearEnd) {
        setPending({ ...args, resumeSeconds });
        return;
      }
      await play(
        args.filePath,
        args.title,
        args.posterPath,
        args.mediaType,
        args.durationSeconds,
        args.context ?? {},
      );
    },
    [play],
  );

  const onResume = useCallback(() => {
    if (!pending) return;
    const p = pending;
    setPending(null);
    void play(
      p.filePath,
      p.title,
      p.posterPath,
      p.mediaType,
      p.durationSeconds,
      p.context ?? {},
      p.resumeSeconds,
    );
  }, [pending, play]);

  const onStartOver = useCallback(() => {
    if (!pending) return;
    const p = pending;
    setPending(null);
    void play(
      p.filePath,
      p.title,
      p.posterPath,
      p.mediaType,
      p.durationSeconds,
      { ...(p.context ?? {}) },
      0,
    );
  }, [pending, play]);

  const onCancel = useCallback(() => setPending(null), []);

  const ResumePromptModal = pending ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-6"
      onClick={onCancel}
    >
      <div
        className="relative w-[min(640px,92vw)] overflow-hidden rounded-2xl border border-pitflix-primary/30 bg-[#0f0f12]/95 p-8 shadow-2xl shadow-pitflix-primary/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[140%] -translate-x-1/2 rounded-full bg-pitflix-primary/25 blur-3xl" />
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-pitflix-light">
          Pick up where you left off
        </p>
        <h1 className="mb-2 text-3xl font-bold text-white">{pending.title}</h1>
        {pending.durationSeconds > 0 ? (
          <>
            <p className="mb-3 text-sm text-pitflix-muted">
              {fmtTime(pending.resumeSeconds)} of {fmtTime(pending.durationSeconds)} watched
              {" "}
              ({Math.min(100, Math.round((pending.resumeSeconds / pending.durationSeconds) * 100))}%).
            </p>
            <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-pitflix-primary to-pitflix-light"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round((pending.resumeSeconds / pending.durationSeconds) * 100),
                  )}%`,
                }}
              />
            </div>
          </>
        ) : (
          <p className="mb-6 text-sm text-pitflix-muted">
            You stopped at {fmtTime(pending.resumeSeconds)}.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            autoFocus
            onClick={onResume}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-pitflix-primary to-pitflix-light px-6 py-3 text-base font-semibold text-white shadow-lg transition-colors hover:from-pitflix-light hover:to-pitflix-accent"
          >
            <Play className="h-4 w-4" fill="currentColor" />
            Resume from {fmtTime(pending.resumeSeconds)}
          </button>
          <button
            type="button"
            onClick={onStartOver}
            className="flex items-center justify-center gap-2 rounded-full border border-pitflix-primary/20 bg-white/[0.04] px-6 py-3 text-base font-semibold text-white transition-colors hover:border-pitflix-primary/40 hover:bg-white/[0.08]"
          >
            <RotateCcw className="h-4 w-4" />
            Start Over
          </button>
        </div>
        <button
          type="button"
          className="mx-auto mt-4 block text-[11px] text-pitflix-muted hover:text-white"
          onClick={onCancel}
        >
          ✕ Cancel
        </button>
      </div>
    </div>
  ) : null;

  return { requestPlay, ResumePromptModal };
}
