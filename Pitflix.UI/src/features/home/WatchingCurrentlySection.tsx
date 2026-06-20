import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Play } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { getWatchingCurrently, type WatchingCurrentlyCard } from "../../api/homeDiscover";
import { HorizontalScrollRow } from "../../components/ui/HorizontalScrollRow";
import { MediaImage } from "../../components/ui/MediaImage";
import { Spinner } from "../../components/ui/Spinner";
import { toPosterSrc } from "../../utils/posterSrc";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function continueSeasonRoute(card: WatchingCurrentlyCard): string {
  let s = card.nextSeason;
  if (!Number.isFinite(s) || s <= 0) {
    const m = /^S(\d+)/i.exec((card.nextLabel ?? "").trim());
    if (m) s = parseInt(m[1]!, 10);
  }
  if (Number.isFinite(s) && s > 0) return `/series/${card.libraryShowId}/season/${s}`;
  return `/series/${card.libraryShowId}`;
}

function episodeBadge(card: WatchingCurrentlyCard): string | null {
  const m = /S(\d+)\s*E(\d+)/i.exec(card.nextLabel ?? "");
  if (m) return `S${m[1]}E${m[2]}`;
  return null;
}

// ─── Individual card ─────────────────────────────────────────────────────────

function UpNextCard({ card }: { card: WatchingCurrentlyCard }) {
  const navigate = useNavigate();
  const pct = Math.min(100, Math.max(0, (card.progressFraction ?? 0) * 100));
  const poster = toPosterSrc(card.posterUrl ?? undefined);
  const badge = episodeBadge(card);
  const continueTo = continueSeasonRoute(card);

  return (
    <button
      type="button"
      aria-label={`Continue watching ${card.showTitle}`}
      onClick={() => navigate(continueTo)}
      className="group relative w-[130px] shrink-0 rounded-xl text-left transition-transform duration-200 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitflix-primary/60"
    >
      {/* Poster container */}
      <div className="relative overflow-hidden rounded-xl bg-pitflix-card shadow-md ring-1 ring-white/10 transition-shadow duration-200 group-hover:shadow-xl group-hover:shadow-black/50 group-hover:ring-pitflix-primary/50">
        {/* Poster image */}
        <div className="aspect-[2/3] w-full">
          <MediaImage
            src={poster}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            fallbackText={card.showTitle.slice(0, 3)}
            loading="lazy"
          />
        </div>

        {/* Hover overlay with play icon */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/65 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pitflix-primary/90 shadow-lg shadow-black/40">
            <Play className="h-5 w-5 fill-white text-white" />
          </div>
        </div>

        {/* Episode badge — top right */}
        {badge ? (
          <div className="pointer-events-none absolute right-1.5 top-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white ring-1 ring-white/10 backdrop-blur-sm">
            {badge}
          </div>
        ) : null}

        {/* Progress bar — bottom of poster */}
        {pct > 0 ? (
          <div
            className="pointer-events-none absolute bottom-0 left-0 right-0 h-[3px] overflow-hidden bg-white/15"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-pitflix-primary to-violet-400"
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
      </div>

      {/* Text below poster */}
      <div className="mt-2 space-y-0.5 px-0.5">
        <p className="line-clamp-2 text-[11px] font-semibold leading-tight text-white group-hover:text-pitflix-primary">
          {card.showTitle}
        </p>
        <p className="text-[10px] tabular-nums text-pitflix-muted">
          {card.watchedEpisodes ?? 0}
          <span className="text-pitflix-subtle"> / </span>
          {card.totalEpisodes ?? 0}
          <span className="text-pitflix-subtle"> eps</span>
        </p>
      </div>
    </button>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

type Props = { embedded?: boolean };

export function WatchingCurrentlySection({ embedded = false }: Props) {
  const q = useQuery({
    queryKey: ["home-watching-currently"],
    queryFn: getWatchingCurrently,
    staleTime: 45_000,
  });

  if (q.isLoading)
    return (
      <div className={embedded ? "py-2" : ""}>
        <div className="flex items-center gap-2 text-sm text-pitflix-subtle">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      </div>
    );

  if (q.isError) return null; // don't block home page on error

  const list = q.data ?? [];
  if (list.length === 0) return null; // hide entirely when nothing in progress

  return (
    <section className="mb-8" aria-label="Up Next">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-bold text-white">Up Next</h2>
        <span className="text-xs text-pitflix-subtle">Shows you're still watching</span>
        <Link
          to="/series"
          className="ml-auto inline-flex items-center gap-0.5 text-xs font-semibold text-pitflix-primary hover:underline"
        >
          Browse series
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Carousel */}
      <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3 pb-2">
        {list.map((card) => (
          <UpNextCard key={card.libraryShowId} card={card} />
        ))}
      </HorizontalScrollRow>
    </section>
  );
}
