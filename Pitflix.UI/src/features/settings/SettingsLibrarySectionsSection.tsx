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
    id: "billboard",
    title: "Cinematic Billboard",
    description: "Full-bleed hero with a thumbnail rail and wide episode cards below.",
  },
  {
    id: "preview",
    title: "Preview Window",
    description: "Wide drifting backdrop, title underneath, labelled tiles (stills or posters).",
  },
  {
    id: "backdropRow",
    title: "Backdrop Row",
    description: "Up Next laid on the backdrop — pick a card to swap the whole hero.",
  },
  {
    id: "posterShelf",
    title: "Poster Shelf",
    description: "Tall posters; the picked one opens into a wide card with the next episodes.",
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

      {style === "billboard" ? (
        <>
          <div className="absolute inset-x-[6%] top-[8%] h-[54%] rounded-md bg-gradient-to-r from-white/[0.10] to-white/[0.03]" />
          <div className="absolute left-[10%] top-[40%] h-1.5 w-[32%] rounded-full bg-white/35" />
          <div className="absolute left-[10%] top-[50%] h-[7%] w-[14%] rounded-sm bg-violet-500/70" />
          <div className="absolute right-[10%] top-[12%] flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className={i === 0 ? "h-2 w-3 rounded-[2px] ring-1 ring-white/70" : "h-2 w-3 rounded-[2px] bg-white/20"} />
            ))}
          </div>
          <div className="absolute bottom-[8%] left-[6%] right-[6%] flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-[20%] flex-1 rounded-sm bg-white/15" />
            ))}
          </div>
        </>
      ) : null}

      {style === "preview" ? (
        <>
          <div className="absolute inset-x-[6%] top-[8%] h-[40%] rounded-md bg-white/[0.10]" />
          <div className="absolute left-[6%] top-[54%] h-1.5 w-[30%] rounded-full bg-white/35" />
          <div className="absolute right-[6%] top-[52%] h-[7%] w-[13%] rounded-sm bg-white/70" />
          <div className="absolute bottom-[8%] left-[6%] right-[6%] flex gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="relative h-[20%] flex-1 rounded-sm bg-white/15">
                {i < 2 ? <span className="absolute bottom-0.5 left-0 h-1 w-[60%] bg-red-600/80" /> : null}
              </span>
            ))}
          </div>
        </>
      ) : null}

      {style === "backdropRow" ? (
        <>
          <div className="absolute inset-[6%] rounded-md bg-gradient-to-t from-white/[0.03] to-white/[0.11]" />
          <div className="absolute left-[11%] top-[18%] h-2 w-[36%] rounded-full bg-white/35" />
          <div className="absolute left-[11%] top-[30%] h-[7%] w-[14%] rounded-sm bg-violet-500/70" />
          <div className="absolute bottom-[12%] left-[11%] right-[11%] flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={i === 0 ? "h-4 flex-[2] rounded-sm ring-1 ring-white/70" : "h-4 flex-1 rounded-sm bg-white/15"}
              />
            ))}
          </div>
        </>
      ) : null}

      {style === "posterShelf" ? (
        <>
          <div className="absolute bottom-[26%] left-[6%] right-[6%] top-[10%] flex gap-1">
            <span className="relative flex-[3] rounded-md bg-white/[0.11] ring-1 ring-white/60">
              <span className="absolute bottom-[18%] left-[10%] h-1.5 w-[50%] rounded-full bg-white/40" />
            </span>
            {[0, 1, 2].map((i) => (
              <span key={i} className="flex-1 rounded-md bg-white/15" />
            ))}
          </div>
          <div className="absolute bottom-[8%] left-[6%] right-[6%] flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-2 flex-1 rounded-sm bg-white/10" />
            ))}
          </div>
        </>
      ) : null}

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
