import type { DraggableAttributes } from "@dnd-kit/core";
import type { ReactNode, CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { GripVertical, Pencil, RefreshCw, Eye, EyeOff } from "lucide-react";
import { Link } from "react-router-dom";
import { postHomeSectionQuery } from "../../api/homeLayout";
import { HorizontalScrollRow } from "../../components/ui/HorizontalScrollRow";
import { PosterCard } from "../../components/ui/PosterCard";
import { ScrollReveal } from "../../components/ui/ScrollReveal";
import { useHomeCustomizeStore } from "../../store/homeCustomizeStore";
import type { HomeSectionConfig, WatchHistoryRow } from "../../types/homeSection";
import type { MediaCard } from "../../types/media";
import { cn } from "../../utils/cn";
import { formatRating } from "../../utils/format";
import { LandscapeHomeCard } from "./LandscapeHomeCard";
import { posterMetaFromConfig } from "./posterMetaFromConfig";
import { sectionQueryKey, sectionToQueryBody } from "./homeQueryMapper";
import { ContinueWatchingRow } from "./ContinueWatchingRow";
import { ComingSoonSection } from "./ComingSoonSection";
import { NextEpisodesSection } from "./NextEpisodesSection";
import { LatestTrailersSection } from "./LatestTrailersSection";
import { ComingSoonTrailersSection } from "./ComingSoonTrailersSection";
function seeAllHref(section: HomeSectionConfig): string | null {
  if (section.sourceType === "watching_currently") return "/series";
  if (section.sourceType === "next_episodes") return "/next-episodes";
  if (section.sourceType === "next_episodes_all") return "/next-episodes";
  if (section.sourceType === "latest_trailers") return "/trailers?mode=latest";
  if (section.sourceType === "coming_soon_trailers" || section.sourceType === "upcoming_trending_trailers")
    return "/trailers?mode=upcoming";
  if (section.sourceType === "coming_soon") return null;
  if (section.mediaType === "series") return "/series";
  if (section.mediaType === "movie") return "/movies";
  if (section.sourceType === "unfinished_series" || section.sourceType === "binge_series") return "/series";
  return "/movies";
}

function isHomeDiscoverSpecial(st: HomeSectionConfig["sourceType"]): boolean {
  return (
    st === "coming_soon" ||
    st === "next_episodes" ||
    st === "next_episodes_all" ||
    st === "latest_trailers" ||
    st === "coming_soon_trailers" ||
    st === "upcoming_trending_trailers"
  );
}

function SectionChrome({
  section,
  isEditing,
  onEdit,
  onToggleEnabled,
  extraRight,
  dragHandle,
}: {
  section: HomeSectionConfig;
  isEditing: boolean;
  onEdit?: () => void;
  onToggleEnabled?: () => void;
  extraRight?: ReactNode;
  dragHandle?: { attributes: DraggableAttributes; listeners: Record<string, unknown> };
}) {
  const seeAll = seeAllHref(section);
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {isEditing ? (
            <span
              className="cursor-grab touch-none text-pitflix-muted hover:text-white"
              aria-hidden
              {...(dragHandle?.attributes ?? {})}
              {...(dragHandle?.listeners ?? {})}
            >
              <GripVertical className="h-5 w-5" />
            </span>
          ) : null}
          <div>
            <h2 className="text-lg font-bold text-white md:text-xl">{section.title}</h2>
            {section.subtitle ? (
              <p className="text-xs text-pitflix-subtle md:text-sm">{section.subtitle}</p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {extraRight}
        {isEditing ? (
          <>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-pitflix-muted hover:border-pitflix-primary/40 hover:text-white"
              onClick={onToggleEnabled}
            >
              {section.enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {section.enabled ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-pitflix-primary/40 bg-pitflix-primary/15 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-pitflix-primary/25"
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          </>
        ) : seeAll ? (
          <Link to={seeAll} className="text-sm text-pitflix-muted transition-colors hover:text-white">
            See all →
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function RowSkeleton({ count = 6, tall }: { count?: number; tall?: boolean }) {
  return (
    <div className="flex gap-4 pb-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "shrink-0 animate-pulse rounded-xl bg-pitflix-card",
            tall ? "h-[264px] w-44" : "h-[210px] w-36",
          )}
        />
      ))}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-[240px] animate-pulse rounded-xl bg-pitflix-card" />
      ))}
    </div>
  );
}

function mediaTypeOf(card: MediaCard): "Movie" | "Series" {
  return card.tmdbMediaType === "Series" ? "Series" : "Movie";
}

export function HomeSectionRenderer({
  section,
  isEditing,
  history,
  onEdit,
  onToggleEnabled,
  onContinueManage,
  dragHandle,
  wrapperStyle,
}: {
  section: HomeSectionConfig;
  isEditing: boolean;
  history: WatchHistoryRow[];
  onEdit?: () => void;
  onToggleEnabled?: () => void;
  onContinueManage?: (id: number) => void;
  dragHandle?: { attributes: DraggableAttributes; listeners: Record<string, unknown> };
  wrapperStyle?: CSSProperties;
}) {
  const bumpShuffle = useHomeCustomizeStore((s) => s.bumpShuffle);
  const shuffleN = useHomeCustomizeStore((s) => s.shuffleKeys[section.id] ?? 0);
  const shuffleSeed = shuffleN > 0 ? shuffleN * 7919 + section.id.length * 97 : undefined;

  const apiEnabled =
    section.enabled &&
    section.sourceType !== "continue_watching" &&
    !isHomeDiscoverSpecial(section.sourceType);

  const queryBody = sectionToQueryBody(section, shuffleSeed ?? null);
  const qKey = sectionQueryKey(section, shuffleSeed ?? null);

  const dataQ = useQuery({
    queryKey: qKey,
    queryFn: () => postHomeSectionQuery(queryBody),
    enabled: apiEnabled,
    staleTime: section.sourceType === "movie_night" ? 0 : 5 * 60_000,
  });

  const cards = (dataQ.data ?? []) as MediaCard[];
  const metaHints = posterMetaFromConfig(section);
  const size = section.cardVariant === "compact" || section.layoutStyle === "ranked-row" ? "sm" : "md";

  const refreshShuffle =
    section.sourceType === "movie_night" || section.sourceType === "genre_spotlight" ? (
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-pitflix-muted hover:border-pitflix-primary/40 hover:text-white"
        onClick={() => bumpShuffle(section.id)}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh
      </button>
    ) : null;

  if (!section.enabled && !isEditing) return null;

  const shell = (body: React.ReactNode) => (
    <section
      style={wrapperStyle}
      className={cn(
        "mb-10 rounded-2xl transition-colors",
        isEditing && !section.enabled ? "opacity-50 ring-1 ring-dashed ring-white/20" : "",
        isEditing ? "bg-pitflix-surface/40 p-4 ring-1 ring-white/5" : "",
      )}
    >
      <SectionChrome
        section={section}
        isEditing={isEditing}
        onEdit={onEdit}
        onToggleEnabled={onToggleEnabled}
        extraRight={!isEditing ? refreshShuffle : null}
        dragHandle={dragHandle}
      />
      <ScrollReveal>{body}</ScrollReveal>
    </section>
  );

  if (section.sourceType === "continue_watching") {
    return shell(
      <ContinueWatchingRow
        history={history}
        isEditing={isEditing}
        layoutStyle={section.layoutStyle}
        onManage={onContinueManage}
      />,
    );
  }

  if (section.sourceType === "watching_currently") return null;

  if (isHomeDiscoverSpecial(section.sourceType)) {
    const inner =
      section.sourceType === "coming_soon" ? (
        <ComingSoonSection embedded />
      ) : section.sourceType === "next_episodes" ? (
        <NextEpisodesSection embedded />
      ) : section.sourceType === "next_episodes_all" ? (
        <NextEpisodesSection embedded variant="all" />
      ) : section.sourceType === "latest_trailers" ? (
        <LatestTrailersSection embedded />
      ) : section.sourceType === "coming_soon_trailers" || section.sourceType === "upcoming_trending_trailers" ? (
        <ComingSoonTrailersSection embedded />
      ) : (
        <LatestTrailersSection embedded />
      );
    return shell(inner);
  }

  if (!section.enabled && isEditing) {
    return shell(<p className="text-sm text-pitflix-muted">Section hidden on home — enable to preview.</p>);
  }

  if (dataQ.isLoading) {
    return shell(
      section.layoutStyle === "grid" ? (
        <GridSkeleton />
      ) : section.layoutStyle === "landscape-row" ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[120px] w-72 shrink-0 animate-pulse rounded-xl bg-pitflix-card" />
          ))}
        </div>
      ) : (
        <RowSkeleton count={8} tall={section.cardVariant !== "compact"} />
      ),
    );
  }

  if (dataQ.isError) {
    return shell(
      <p className="text-sm text-red-300/90">Could not load this row. Is Pitflix.API running?</p>,
    );
  }

  if (section.layoutStyle === "grid") {
    return shell(
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((card, i) => (
          <div key={`${section.id}-${i}-${card.id}-${card.tmdbMediaType}`} className="relative">
            {section.metadata?.showRating !== false ? (
              <span className="absolute left-2 top-2 z-20 rounded-md bg-black/80 px-2 py-0.5 text-xs font-bold text-amber-300 ring-1 ring-amber-500/40">
                ★ {formatRating(card.voteAverage)}
              </span>
            ) : null}
            <PosterCard
              item={card}
              mediaType={mediaTypeOf(card)}
              className="!w-full"
              metaHints={metaHints}
              size={size}
            />
          </div>
        ))}
      </div>,
    );
  }

  if (section.layoutStyle === "landscape-row") {
    return shell(
      <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3">
        <>
          {cards.map((card, i) => (
            <LandscapeHomeCard
              key={`${section.id}-${i}-${card.id}`}
              item={card}
              mediaType={mediaTypeOf(card)}
            />
          ))}
        </>
      </HorizontalScrollRow>,
    );
  }

  if (section.layoutStyle === "ranked-row") {
    return shell(
      <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3">
        <>
          {cards.map((card, i) => (
            <PosterCard
              key={`${section.id}-${i}-${card.id}`}
              item={card}
              mediaType={mediaTypeOf(card)}
              rank={i + 1}
              className="!w-40"
              metaHints={metaHints}
              size="sm"
            />
          ))}
        </>
      </HorizontalScrollRow>,
    );
  }

  return shell(
    <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-4">
      <>
        {cards.map((card, i) => (
          <PosterCard
            key={`${section.id}-${i}-${card.id}-${card.tmdbMediaType}`}
            item={card}
            mediaType={mediaTypeOf(card)}
            className={section.cardVariant === "compact" ? "!w-36" : "!w-44"}
            metaHints={metaHints}
            size={size}
          />
        ))}
      </>
    </HorizontalScrollRow>,
  );
}
