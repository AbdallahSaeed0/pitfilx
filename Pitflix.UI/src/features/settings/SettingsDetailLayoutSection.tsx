import { cn } from "../../utils/cn";
import { useAppPrefsStore, type DetailLayout } from "../../store/appPrefsStore";

const OPTIONS: { id: DetailLayout; title: string; description: string }[] = [
  {
    id: "classic",
    title: "Classic",
    description: "Poster + hero with every action in one row, management bar and full ratings panel below.",
  },
  {
    id: "cinematic",
    title: "Cinematic",
    description: "Full-bleed hero with rating chips. Series get Episodes / Cast / Details tabs; movies a “Your copy” panel.",
  },
  {
    id: "dossier",
    title: "Two-column",
    description: "Poster column with actions and facts on the left; story, ratings, episodes and cast on the right.",
  },
];

function Preview({ id }: { id: DetailLayout }) {
  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-lg border border-white/[0.08] bg-[#0a0912]">
      {id === "classic" ? (
        <>
          <div className="absolute inset-x-0 top-0 h-[55%] bg-gradient-to-b from-white/[0.10] to-transparent" />
          <span className="absolute left-[8%] top-[22%] h-[30%] w-[14%] rounded-sm bg-white/25" />
          <span className="absolute left-[26%] top-[30%] h-1.5 w-[30%] rounded-full bg-white/35" />
          <div className="absolute left-[26%] top-[42%] flex gap-0.5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={i === 0 ? "h-2 w-5 rounded-sm bg-violet-500/70" : "h-2 w-2 rounded-sm bg-white/20"} />
            ))}
          </div>
          <div className="absolute bottom-[10%] left-[8%] right-[8%] flex gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="h-4 flex-1 rounded-sm border border-white/15" />
            ))}
          </div>
        </>
      ) : null}
      {id === "cinematic" ? (
        <>
          <div className="absolute inset-x-0 top-0 h-[62%] bg-gradient-to-r from-white/[0.04] to-white/[0.14]" />
          <span className="absolute left-[8%] top-[18%] h-2.5 w-[38%] rounded-sm bg-white/45" />
          <div className="absolute left-[8%] top-[32%] flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-3 rounded-full bg-white/25" />
            ))}
          </div>
          <span className="absolute left-[8%] top-[44%] h-2.5 w-[18%] rounded-sm bg-violet-500/70" />
          <div className="absolute left-[8%] right-[8%] top-[68%] flex gap-2 border-b border-white/10 pb-0.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className={i === 0 ? "h-1 w-6 rounded-full bg-violet-400" : "h-1 w-6 rounded-full bg-white/20"} />
            ))}
          </div>
          <div className="absolute bottom-[6%] left-[8%] right-[8%] flex flex-col gap-0.5">
            {[0, 1].map((i) => (
              <span key={i} className="h-2 w-full rounded-sm bg-white/10" />
            ))}
          </div>
        </>
      ) : null}
      {id === "dossier" ? (
        <>
          <div className="absolute inset-x-0 top-0 h-[38%] bg-white/[0.10]" />
          <span className="absolute left-[8%] top-[18%] h-[44%] w-[22%] rounded-sm bg-white/25 ring-1 ring-black/40" />
          <span className="absolute left-[8%] top-[66%] h-2 w-[22%] rounded-sm bg-violet-500/70" />
          <div className="absolute left-[8%] top-[76%] flex w-[22%] flex-col gap-0.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1 w-full rounded-full bg-white/15" />
            ))}
          </div>
          <span className="absolute left-[36%] top-[26%] h-2 w-[34%] rounded-sm bg-white/45" />
          <div className="absolute left-[36%] right-[8%] top-[48%] flex gap-0.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-3 flex-1 rounded-sm border border-white/15" />
            ))}
          </div>
          <div className="absolute bottom-[8%] left-[36%] right-[8%] flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-4 flex-1 rounded-sm bg-white/10" />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function SettingsDetailLayoutSection() {
  const detailLayout = useAppPrefsStore((s) => s.detailLayout);
  const setDetailLayout = useAppPrefsStore((s) => s.setDetailLayout);

  return (
    <section
      id="settings-detail-layout"
      className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-5 shadow-xl shadow-black/30 backdrop-blur-sm sm:p-6"
    >
      <div className="mb-4">
        <h2 className="text-[15px] font-bold tracking-tight text-white">Movie &amp; series pages</h2>
        <p className="mt-1.5 max-w-xl text-[12px] leading-relaxed text-pitflix-muted">
          Choose how a movie or series page is laid out. Applies to titles in your library.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map(({ id, title, description }) => {
          const active = detailLayout === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => setDetailLayout(id)}
              className={cn(
                "flex flex-col gap-3 rounded-xl border p-3 text-left transition-all",
                active
                  ? "border-violet-400/50 bg-violet-500/10 shadow-[0_0_24px_rgba(124,58,237,0.15)]"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]",
              )}
            >
              <Preview id={id} />
              <div>
                <p className="text-[13px] font-semibold text-white">{title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-pitflix-subtle">{description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
