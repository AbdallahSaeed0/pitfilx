import { BarChart3 } from "lucide-react";
import type { SettingsPageModel } from "./useSettingsPageModel";

type Props = { model: SettingsPageModel };

export function SettingsStatsTab({ model }: Props) {
  const {
    data,
    watchNotStarted,
    watchProgress,
    watchDone,
  } = model;

  return (
    <>
<section
            id="settings-stats"
            className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
          >
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <BarChart3 className="h-4 w-4 text-sky-400" strokeWidth={2} />
              Library stats
            </h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-gradient-to-br from-sky-950/60 to-pitflix-card p-4 text-center ring-1 ring-sky-500/10">
                <p className="text-2xl font-bold tabular-nums text-white md:text-3xl">{data?.matchedMovies ?? "—"}</p>
                <p className="mt-1 text-[11px] font-medium text-sky-300/70">Movies</p>
              </div>
              <div className="rounded-xl bg-gradient-to-br from-violet-950/60 to-pitflix-card p-4 text-center ring-1 ring-violet-500/10">
                <p className="text-2xl font-bold tabular-nums text-white md:text-3xl">{data?.matchedSeries ?? "—"}</p>
                <p className="mt-1 text-[11px] font-medium text-violet-300/70">Series</p>
              </div>
              <div className="rounded-xl bg-gradient-to-br from-amber-950/60 to-pitflix-card p-4 text-center ring-1 ring-amber-500/10">
                <p className="text-2xl font-bold tabular-nums text-white md:text-3xl">{data?.unmatchedCount ?? "—"}</p>
                <p className="mt-1 text-[11px] font-medium text-amber-300/70">Unmatched</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm">
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <BarChart3 className="h-4 w-4 text-sky-400" strokeWidth={2} />
              Watch overview
            </h2>
            <p className="mb-3 text-[10px] text-pitflix-subtle">Matched library titles only.</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl border border-white/[0.06] bg-pitflix-bg/80 py-3">
                <p className="text-lg font-bold text-white">{watchNotStarted}</p>
                <p className="mt-0.5 text-[10px] text-pitflix-muted">Not watched</p>
              </div>
              <div className="rounded-xl border border-amber-500/10 bg-amber-950/20 py-3">
                <p className="text-lg font-bold text-amber-100">{watchProgress}</p>
                <p className="mt-0.5 text-[10px] text-amber-300/60">In progress</p>
              </div>
              <div className="rounded-xl border border-emerald-500/10 bg-emerald-950/20 py-3">
                <p className="text-lg font-bold text-emerald-100">{watchDone}</p>
                <p className="mt-0.5 text-[10px] text-emerald-300/60">Watched</p>
              </div>
            </div>
          </section>
    </>
  );
}
