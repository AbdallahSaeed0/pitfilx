import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Settings, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { getAwardsCatalog } from "../api/awards";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../utils/cn";
import { getAwardBrandingFallbackSrc, getAwardBrandingImageSrc } from "../utils/awardBranding";
import { toPosterSrc } from "../utils/posterSrc";

type FilterId = "all" | "film" | "television";

const FILTER_OPTIONS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "film", label: "Film" },
  { id: "television", label: "Television" },
];

/** Media-category tags per award ID — drives the filter tabs and card badges. */
const AWARD_CATEGORIES: Partial<Record<string, FilterId[]>> = {
  "academy-awards": ["film"],
  "primetime-emmys": ["television"],
  bafta: ["film"],
  "golden-globes": ["film", "television"],
};

/** Fallback accent colors when the API returns null. */
const ACCENT_FALLBACKS: Partial<Record<string, string>> = {
  "academy-awards": "#c9a227",  // Oscars gold
  "primetime-emmys": "#3b82f6", // Emmy blue
  bafta: "#f97316",              // BAFTA orange
  "golden-globes": "#eab308",   // Globes amber
};

/** Convert a 6-digit hex accent to an rgba background string at the given opacity (0–1). */
function accentBg(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function AwardsPage() {
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");

  const q = useQuery({
    queryKey: ["awards-catalog"],
    queryFn: getAwardsCatalog,
    staleTime: 600_000,
    gcTime: 3_600_000,
  });

  if (q.isLoading)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  if (q.isError)
    return <p className="text-sm text-rose-200/90">Could not load awards catalog.</p>;

  const list = q.data ?? [];

  const filteredList =
    activeFilter === "all"
      ? list
      : list.filter((a) => {
          const cats = AWARD_CATEGORIES[a.id];
          // If no mapping exists, show the award in all filters
          return !cats || cats.includes(activeFilter);
        });

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-white sm:text-3xl">
          <Trophy className="h-7 w-7 text-amber-400 sm:h-8 sm:w-8" />
          Awards
        </h1>
        <p className="mt-1.5 max-w-xl text-sm text-pitflix-subtle">
          Browse nominees and winners from the world's top film and television ceremonies.
        </p>
      </div>

      {/* ── Filter tabs ─────────────────────────────────────────────── */}
      <div
        className="flex w-fit gap-0.5 rounded-xl p-1"
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {FILTER_OPTIONS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setActiveFilter(f.id)}
            className={cn(
              "rounded-lg px-4 py-1.5 text-sm font-medium transition-all duration-150",
              activeFilter === f.id
                ? "bg-white/10 text-white shadow-sm"
                : "text-pitflix-muted hover:text-white/80",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Empty state (no data downloaded yet) ─────────────────────── */}
      {list.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <span className="text-5xl">🏆</span>
          <p className="text-lg font-semibold text-white">Awards data not loaded yet</p>
          <p className="max-w-sm text-sm text-pitflix-subtle">
            Go to Settings → Maintenance and click "Update awards cache" to download nominees for
            Oscar, Emmy, BAFTA, and Golden Globe ceremonies.
          </p>
          <Link
            to="/settings"
            className="mt-2 inline-flex items-center gap-2 rounded-lg bg-pitflix-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-pitflix-light"
          >
            <Settings className="h-4 w-4" />
            Open Settings
          </Link>
        </div>
      )}

      {/* ── No results for active filter ─────────────────────────────── */}
      {list.length > 0 && filteredList.length === 0 && (
        <p className="py-10 text-center text-sm text-pitflix-subtle">
          No {activeFilter} ceremonies found.
        </p>
      )}

      {/* ── Card grid ────────────────────────────────────────────────── */}
      {filteredList.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filteredList.map((a) => {
            const accent = a.accent ?? ACCENT_FALLBACKS[a.id] ?? "#c9a227";
            const branding = getAwardBrandingImageSrc(a.id);
            const brandFallback = toPosterSrc(getAwardBrandingFallbackSrc(a.id));
            const poster = toPosterSrc(branding ?? a.eventPosterUrl ?? undefined);
            const cats = AWARD_CATEGORIES[a.id] ?? [];

            return (
              <Link
                key={a.id}
                to={`/awards/${encodeURIComponent(a.id)}`}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] transition-all duration-300 hover:border-white/[0.14]"
                style={{
                  background: "linear-gradient(145deg, #161616 0%, #111111 100%)",
                  borderLeftWidth: 3,
                  borderLeftColor: accent,
                  boxShadow: "0 2px 16px rgba(0,0,0,0.5)",
                }}
              >
                {/* Ambient accent glow — blooms on hover */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute -left-12 -top-12 h-48 w-48 rounded-full blur-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-[0.18]"
                  style={{ backgroundColor: accent }}
                />

                {/* Logo + name row */}
                <div className="relative z-10 flex items-start gap-4 p-5 pb-3">
                  {/* Ceremony logo */}
                  <div
                    className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl border border-white/[0.08] shadow-md"
                    style={{ background: "rgba(0,0,0,0.55)" }}
                  >
                    <MediaImage
                      src={poster}
                      fallbackSrc={brandFallback}
                      alt={a.name}
                      className="h-full w-full object-cover"
                      fallbackText={a.name.slice(0, 2)}
                    />
                  </div>

                  {/* Name + category badges */}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
                    {cats.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {cats.map((cat) => (
                          <span
                            key={cat}
                            className="rounded-full px-2 py-px text-[10px] font-semibold uppercase tracking-wider"
                            style={{
                              background: accentBg(accent, 0.12),
                              color: accent,
                              border: `1px solid ${accentBg(accent, 0.25)}`,
                            }}
                          >
                            {cat}
                          </span>
                        ))}
                      </div>
                    )}
                    <h2 className="text-base font-bold leading-snug text-white sm:text-[17px]">
                      {a.name}
                    </h2>
                  </div>
                </div>

                {/* Organizing body (subtitle) */}
                {a.subtitle && (
                  <p className="relative z-10 px-5 pb-4 text-sm leading-relaxed text-pitflix-muted/80">
                    {a.subtitle}
                  </p>
                )}

                {/* Footer CTA */}
                <div
                  className="relative z-10 mt-auto flex items-center justify-between px-5 py-3"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <span className="text-xs text-pitflix-subtle">Browse all editions</span>
                  <span
                    className="flex items-center gap-1 text-sm font-semibold transition-all duration-150 group-hover:gap-1.5"
                    style={{ color: accent }}
                  >
                    Browse
                    <ChevronRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
