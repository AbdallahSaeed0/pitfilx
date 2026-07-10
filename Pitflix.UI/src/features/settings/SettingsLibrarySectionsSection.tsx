import { cn } from "../../utils/cn";
import { useAppPrefsStore, type LibrarySectionsStyle } from "../../store/appPrefsStore";

const STYLE_OPTIONS: {
  id: LibrarySectionsStyle;
  title: string;
  description: string;
}[] = [
  {
    id: "classic",
    title: "Classic",
    description: "Full-bleed hero + a separate Up Next carousel — the Pitflix default.",
  },
  {
    id: "1a",
    title: "Compact Spotlight",
    description: "Contained card with a landscape Up Next shelf, all in one panel.",
  },
  {
    id: "1b",
    title: "Ambient Immersion",
    description: "Full-bleed color wash hero with tall poster cards below.",
  },
  {
    id: "1c",
    title: "Watchlist Queue",
    description: "Inbox-style queue on the left, featured preview on the right.",
  },
  {
    id: "1d",
    title: "Split Wide",
    description: "60/40 hero split with an episode-first Up Next shelf.",
  },
];

function StylePreview({ style }: { style: LibrarySectionsStyle }) {
  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-lg border border-white/[0.08] bg-[#0a0912]">
      <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 via-transparent to-blue-500/10" />

      {style === "classic" ? (
        <>
          <div className="absolute inset-x-[6%] top-[10%] h-[52%] rounded-md bg-white/[0.06]" />
          <div className="absolute left-[8%] top-[16%] h-1.5 w-[30%] rounded-full bg-white/25" />
          <div className="absolute bottom-[8%] left-[6%] flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-[16%] w-[10%] rounded-sm bg-white/15" />
            ))}
          </div>
        </>
      ) : null}

      {style === "1a" ? (
        <>
          <div className="absolute inset-x-[6%] top-[10%] flex h-[38%] items-stretch overflow-hidden rounded-md border border-white/10 bg-white/[0.04]">
            <span className="w-[16%] shrink-0 bg-violet-500/50" />
            <span className="flex-1" />
            <span className="my-auto mr-2 h-[45%] w-[12%] rounded-full bg-violet-400/70" />
          </div>
          <div className="absolute bottom-[8%] left-[6%] flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-[22%] w-[16%] rounded-sm bg-white/15" />
            ))}
          </div>
        </>
      ) : null}

      {style === "1b" ? (
        <>
          <div className="absolute inset-x-[6%] top-[8%] h-[44%] overflow-hidden rounded-md bg-gradient-to-t from-violet-600/60 via-violet-800/30 to-transparent" />
          <div className="absolute left-[8%] top-[36%] h-2 w-[36%] rounded-full bg-white/30" />
          <div className="absolute bottom-[8%] left-[6%] flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-[24%] w-[13%] rounded-sm bg-white/15" />
            ))}
          </div>
        </>
      ) : null}

      {style === "1c" ? (
        <>
          <div className="absolute inset-x-[6%] top-[10%] flex h-[46%] overflow-hidden rounded-md border border-white/10">
            <span className="w-[40%] shrink-0 bg-violet-500/25" />
            <span className="flex-1 bg-white/[0.05]" />
          </div>
          <div className="absolute bottom-[8%] left-[6%] right-[6%] flex flex-col gap-1">
            {[0, 1].map((i) => (
              <span key={i} className="h-[14%] w-full rounded-sm bg-white/10" />
            ))}
          </div>
        </>
      ) : null}

      {style === "1d" ? (
        <>
          <div className="absolute inset-x-[6%] top-[10%] flex h-[40%] overflow-hidden rounded-md border border-white/10">
            <span className="w-[62%] shrink-0 bg-white/[0.06]" />
            <span className="flex-1 bg-violet-500/20" />
          </div>
          <div className="absolute bottom-[8%] left-[6%] right-[6%] flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-[24%] flex-1 rounded-sm bg-white/10" />
            ))}
          </div>
        </>
      ) : null}

      <div className="absolute inset-x-[34%] top-[28%] h-[10%] rounded-md border border-white/[0.06] bg-white/[0.03]" />
    </div>
  );
}

export function SettingsLibrarySectionsSection() {
  const librarySectionsStyle = useAppPrefsStore((s) => s.librarySectionsStyle);
  const setLibrarySectionsStyle = useAppPrefsStore((s) => s.setLibrarySectionsStyle);

  return (
    <section
      id="settings-library-sections"
      className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-5 shadow-xl shadow-black/30 backdrop-blur-sm sm:p-6"
    >
      <div className="mb-4">
        <h2 className="text-[15px] font-bold tracking-tight text-white">Library sections</h2>
        <p className="mt-1.5 max-w-xl text-[12px] leading-relaxed text-pitflix-muted">
          Choose how "Continue Watching" and "Up Next" look on Home.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {STYLE_OPTIONS.map(({ id, title, description }) => {
          const active = librarySectionsStyle === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setLibrarySectionsStyle(id)}
              className={cn(
                "flex flex-col gap-3 rounded-xl border p-3 text-left transition-all",
                active
                  ? "border-violet-400/50 bg-violet-500/10 shadow-[0_0_24px_rgba(124,58,237,0.15)]"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]",
              )}
            >
              <StylePreview style={id} />
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
