import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check, Download, Play, RotateCcw } from "lucide-react";
import { getShowSeason } from "../../../api/series";
import { useRatingSources } from "../../../components/RatingsPanel";
import { HorizontalDragScroll } from "../../../components/ui/HorizontalDragScroll";
import { MediaImage } from "../../../components/ui/MediaImage";
import { useAppPrefsStore } from "../../../store/appPrefsStore";
import { cn } from "../../../utils/cn";
import { POSTER_WIDTHS, toPosterSrc } from "../../../utils/posterSrc";
import { episodeTitleVisible } from "../../../utils/episodeSpoiler";
import type { DetailViewModel } from "./types";

export type SeasonEpisode = {
  id?: number | null;
  episodeNumber: number;
  title?: string | null;
  overview?: string | null;
  filePath?: string | null;
  watchStatus?: string;
  stillLocalPath?: string | null;
  stillUrl?: string | null;
  imdbVoteAverage?: number | null;
  inLibrary?: boolean;
  isAired?: boolean;
  runtimeMinutes?: number | null;
  resumeSeconds?: number | null;
  progressPercent?: number | null;
};

/** One season's episodes — same query key as SeasonDetailPage, so both pages share the cache. */
export function useSeasonEpisodes(showId: number, season: number | null) {
  const q = useQuery({
    queryKey: ["show-season", showId, season],
    queryFn: () => getShowSeason(showId, season!),
    enabled: showId > 0 && season != null && Number.isFinite(season),
    staleTime: 10 * 60_000,
    refetchOnMount: "always",
    gcTime: 60 * 60_000,
  });
  const episodes = ((q.data?.episodes ?? []) as SeasonEpisode[])
    .filter((e) => e.inLibrary !== false || e.isAired)
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
  return { episodes, isLoading: q.isLoading };
}

// ─── Meta line + ratings ────────────────────────────────────────────────────

export function MetaLine({ vm, extra }: { vm: DetailViewModel; extra?: (string | null | undefined)[] }) {
  const parts: ReactNode[] = [];
  if (vm.year) parts.push(<span key="y">{vm.year}</span>);
  for (const [i, x] of (extra ?? []).entries()) if (x) parts.push(<span key={`x${i}`}>{x}</span>);
  if (vm.runtimeMinutes) {
    const h = Math.floor(vm.runtimeMinutes / 60);
    const m = vm.runtimeMinutes % 60;
    parts.push(<span key="rt">{h > 0 ? `${h}h ${m}m` : `${m}m`}</span>);
  }
  if (vm.contentRating)
    parts.push(
      <span key="cr" className="rounded border border-white/35 px-1.5 py-px text-[11.5px] font-bold">
        {vm.contentRating}
      </span>,
    );
  for (const g of vm.genres.slice(0, 3))
    parts.push(
      <button
        key={`g-${g}`}
        type="button"
        onClick={() => vm.navigate(`/genre/${encodeURIComponent(g)}`)}
        className="hover:text-white hover:underline"
      >
        {g}
      </button>,
    );
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px] text-white/80">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-2.5">
          {i > 0 ? <span className="text-white/30" aria-hidden>•</span> : null}
          {p}
        </span>
      ))}
    </div>
  );
}

/** Small brand chips for the hero ("IMDb 8.1 · RT 87% · MC 80 · TMDB 7.8"). */
export function RatingChips({ tmdbId, mediaType }: { tmdbId: number; mediaType: "movie" | "tv" }) {
  const { sources } = useRatingSources(tmdbId, mediaType);
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((s) => (
        <span
          key={s.key}
          title={s.sub ? `${s.longLabel} · ${s.sub}` : s.longLabel}
          className="flex items-center gap-1.5 rounded-lg bg-black/50 px-2.5 py-1 text-[13px] backdrop-blur-sm"
        >
          {s.key === "imdb" ? (
            <b className="rounded-[3px] bg-[#f5c518] px-1 text-[10px] font-black text-black">IMDb</b>
          ) : (
            <b style={{ color: s.color }}>{s.label}</b>
          )}
          <b className="text-white">{s.score}</b>
        </span>
      ))}
    </div>
  );
}

/** One bordered row, a cell per source (two-column layout). */
export function RatingsStrip({ tmdbId, mediaType }: { tmdbId: number; mediaType: "movie" | "tv" }) {
  const { sources, loading } = useRatingSources(tmdbId, mediaType);
  if (sources.length === 0) {
    return loading ? <p className="text-[13px] text-pitflix-subtle">Loading ratings…</p> : null;
  }
  return (
    <div className="grid overflow-hidden rounded-2xl border border-white/[0.09]" style={{ gridTemplateColumns: `repeat(${sources.length}, minmax(0, 1fr))` }}>
      {sources.map((s, i) => (
        <div key={s.key} className={cn("flex flex-col gap-1 px-4 py-3.5", i > 0 && "border-l border-white/[0.09]")}>
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.08em]" style={{ color: s.color }}>
            {s.longLabel}
          </span>
          <span className="text-[24px] font-extrabold leading-none text-white">{s.score}</span>
          {s.sub ? <span className="truncate text-[11.5px] text-pitflix-subtle">{s.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** Label / value rows for a side panel, with the refresh action at the bottom. */
export function RatingsList({
  tmdbId,
  mediaType,
  refreshing,
  onRefresh,
}: {
  tmdbId: number;
  mediaType: "movie" | "tv";
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { sources, fetchedAtUtc, loading } = useRatingSources(tmdbId, mediaType);
  return (
    <div className="flex flex-col">
      {sources.length === 0 ? (
        <p className="py-2 text-[13px] text-pitflix-subtle">{loading ? "Loading ratings…" : "No ratings yet."}</p>
      ) : (
        sources.map((s) => (
          <div key={s.key} className="flex items-center justify-between border-b border-white/[0.07] py-2">
            <span className="text-[13px] font-bold" style={{ color: s.color }}>
              {s.longLabel}
            </span>
            <span className="text-[15px] font-extrabold text-white">{s.score}</span>
          </div>
        ))
      )}
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="mt-2.5 self-start text-[12px] text-pitflix-subtle hover:text-white disabled:opacity-50"
      >
        {fetchedAtUtc
          ? `Updated ${new Date(fetchedAtUtc).toLocaleDateString(undefined, { dateStyle: "medium" })} · `
          : ""}
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}

// ─── Companies, similar ─────────────────────────────────────────────────────

export function CompanyChips({ vm }: { vm: DetailViewModel }) {
  if (vm.companies.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {vm.companies.map((c) => (
        <button
          key={`${c.kind}-${c.id}`}
          type="button"
          title={`See everything on ${c.name}`}
          onClick={() =>
            vm.navigate("/stream-studio", { state: { studioId: c.id, kind: c.kind, name: c.name, logoUrl: c.logoUrl } })
          }
          className="rounded-lg bg-white/[0.08] px-3 py-1.5 text-[13px] font-semibold text-white/90 transition hover:bg-white/[0.16]"
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

export function SimilarRow({ vm, title = "More like this" }: { vm: DetailViewModel; title?: string }) {
  if (vm.similar.length === 0) return null;
  const mediaType = vm.kind === "movie" ? "Movie" : "Series";
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[20px] font-extrabold text-white">{title}</h2>
      <HorizontalDragScroll className="pb-2">
        {vm.similar.map((s) => (
          <button
            key={s.tmdbId}
            type="button"
            onClick={() => {
              if (s.isInLibrary && s.libraryId) vm.navigate(vm.kind === "movie" ? `/movie/${s.libraryId}` : `/series/${s.libraryId}`);
              else vm.navigate("/stream-details", { state: { tmdbId: s.tmdbId, mediaType, title: s.title, posterUrl: s.posterUrl } });
            }}
            className="group mr-3.5 w-[150px] shrink-0 text-left"
          >
            <div className="relative overflow-hidden rounded-xl bg-pitflix-card ring-1 ring-white/[0.08] transition group-hover:ring-pitflix-primary/60">
              <MediaImage
                src={toPosterSrc(s.posterUrl ?? undefined, POSTER_WIDTHS.card)}
                alt={s.title}
                className="aspect-[2/3] w-full object-cover"
                fallbackText={s.title}
              />
              {s.watchStatus === "Completed" ? (
                <span className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 rounded-md bg-green-600/90 px-1.5 py-0.5 text-[9px] font-bold text-white">
                  <Check className="h-2.5 w-2.5" /> Watched
                </span>
              ) : s.isInLibrary ? (
                <span className="absolute left-1.5 top-1.5 rounded-full bg-pitflix-primary/90 px-1.5 py-0.5 text-[9px] font-bold text-white">
                  In Library
                </span>
              ) : null}
            </div>
            <p className="mt-2 truncate text-[13px] font-semibold text-white">{s.title}</p>
            {s.year ? <p className="text-[11.5px] text-pitflix-subtle">{s.year}</p> : null}
          </button>
        ))}
      </HorizontalDragScroll>
    </section>
  );
}

// ─── Primary button ─────────────────────────────────────────────────────────

/** Two-line play button with the progress line along its bottom edge. */
export function PrimaryPlayButton({ vm, className }: { vm: DetailViewModel; className?: string }) {
  const p = vm.primary;
  if (!p) return null;
  const Icon = p.again ? RotateCcw : Play;
  return (
    <>
      <button
        ref={p.buttonRef}
        type="button"
        title={p.title}
        onClick={p.onClick}
        {...p.buttonProps}
        className={cn(
          "relative flex h-14 items-center gap-3 overflow-hidden rounded-xl bg-pitflix-primary px-6 text-left text-white shadow-[0_4px_24px_rgba(124,58,237,0.45)] transition hover:bg-[#6d28d9]",
          className,
        )}
      >
        <Icon className={cn("h-[18px] w-[18px] shrink-0", !p.again && "fill-current")} />
        <span className="flex min-w-0 flex-col leading-tight">
          <b className="truncate text-[15px]">{p.label}</b>
          {p.sub ? <span className="truncate text-[12px] text-white/85">{p.sub}</span> : null}
        </span>
        {p.progressPercent ? (
          <>
            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25" />
            <span className="absolute bottom-0 left-0 h-1 bg-white" style={{ width: `${p.progressPercent}%` }} />
          </>
        ) : null}
      </button>
      {p.extra}
    </>
  );
}

// ─── Episodes ───────────────────────────────────────────────────────────────

export function SeasonPicker({
  vm,
  season,
  onChange,
}: {
  vm: DetailViewModel;
  season: number | null;
  onChange: (s: number) => void;
}) {
  const seasons = vm.series?.seasonsSummary ?? [];
  if (seasons.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {seasons.map((s) => (
        <button
          key={s.seasonNumber}
          type="button"
          aria-pressed={s.seasonNumber === season}
          onClick={() => onChange(s.seasonNumber)}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition",
            s.seasonNumber === season
              ? "bg-white text-[#121214]"
              : s.inLibrary === false
                ? "border border-dashed border-white/20 text-white/45 hover:text-white/80"
                : "bg-white/[0.08] text-white/80 hover:bg-white/[0.14]",
          )}
        >
          {s.seasonNumber === 0 ? "Specials" : `Season ${s.seasonNumber}`}
        </button>
      ))}
    </div>
  );
}

function episodeLeft(ep: SeasonEpisode): string | null {
  if (!ep.progressPercent) return null;
  const total = ep.runtimeMinutes ?? 0;
  if (total > 0 && ep.resumeSeconds) return `${Math.max(1, Math.round(total - ep.resumeSeconds / 60))} min left`;
  return `${ep.progressPercent}% watched`;
}

/** Wide episode rows (cinematic layout) or a compact still grid (two-column layout). */
export function EpisodeList({
  vm,
  season,
  episodes,
  variant,
}: {
  vm: DetailViewModel;
  season: number;
  episodes: SeasonEpisode[];
  variant: "rows" | "grid";
}) {
  const spoilers = useAppPrefsStore((s) => s.defaultSpoilerProtection);
  const seasonInfo = vm.series?.seasonsSummary.find((s) => s.seasonNumber === season);
  const seasonRoute = `/series/${vm.libraryId}/season/${season}`;

  if (seasonInfo && seasonInfo.inLibrary === false) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-white/15 p-5">
        <p className="text-[14px] text-white/70">No episodes of {seasonInfo.name} in your library yet.</p>
        <button
          type="button"
          onClick={() => vm.series?.onDownloadSeason(season)}
          className="flex items-center gap-2 rounded-lg bg-white/[0.1] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-white/[0.18]"
        >
          <Download className="h-4 w-4" /> Download season
        </button>
      </div>
    );
  }

  const open = (ep: SeasonEpisode) => {
    if (ep.id != null && ep.filePath && ep.inLibrary !== false)
      vm.series?.playEpisode({ id: ep.id, filePath: ep.filePath, episodeNumber: ep.episodeNumber, title: ep.title }, season);
    else vm.navigate(seasonRoute);
  };

  if (variant === "grid") {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3.5">
        {episodes.map((ep) => {
          const watched = ep.watchStatus === "Completed";
          const showTitle = episodeTitleVisible(spoilers, ep.inLibrary !== false, ep);
          const missing = ep.inLibrary === false;
          return (
            <button key={ep.episodeNumber} type="button" onClick={() => open(ep)} className="group flex flex-col gap-2 text-left">
              <span
                className={cn(
                  "relative block aspect-video overflow-hidden rounded-[10px] bg-pitflix-card ring-1 transition",
                  ep.progressPercent ? "ring-2 ring-pitflix-primary" : "ring-white/[0.08] group-hover:ring-white/40",
                  missing && "opacity-50",
                )}
              >
                <MediaImage
                  src={toPosterSrc(ep.stillLocalPath ?? ep.stillUrl ?? undefined, 640)}
                  alt=""
                  className={cn("h-full w-full object-cover", spoilers && !watched && "blur-md")}
                  fallbackText={`E${ep.episodeNumber}`}
                />
                <span className="absolute left-2 top-1.5 text-[12px] font-extrabold text-white [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">
                  E{ep.episodeNumber}
                </span>
                {watched ? (
                  <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-green-600">
                    <Check className="h-3 w-3 text-white" />
                  </span>
                ) : null}
                <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/15">
                  <span className="block h-full bg-pitflix-primary" style={{ width: `${watched ? 100 : (ep.progressPercent ?? 0)}%` }} />
                </span>
              </span>
              <span className="truncate text-[13px] font-bold text-white">
                {showTitle ? ep.title?.trim() || `Episode ${ep.episodeNumber}` : `Episode ${ep.episodeNumber}`}
              </span>
              <span className="-mt-1.5 text-[12px] text-pitflix-subtle">
                {missing ? "Not downloaded" : watched ? "Watched" : (episodeLeft(ep) ?? (ep.runtimeMinutes ? `${ep.runtimeMinutes} min` : ""))}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {episodes.map((ep) => {
        const watched = ep.watchStatus === "Completed";
        const showTitle = episodeTitleVisible(spoilers, ep.inLibrary !== false, ep);
        const missing = ep.inLibrary === false;
        const left = episodeLeft(ep);
        return (
          <button
            key={ep.episodeNumber}
            type="button"
            onClick={() => open(ep)}
            className={cn(
              "group grid grid-cols-[36px_200px_minmax(0,1fr)_auto] items-center gap-5 rounded-2xl p-3 text-left transition hover:bg-white/[0.04]",
              ep.progressPercent ? "bg-white/[0.04]" : "",
            )}
          >
            <span className="text-center text-[22px] font-extrabold text-white/35">{ep.episodeNumber}</span>
            <span className={cn("relative block aspect-video overflow-hidden rounded-[10px] bg-pitflix-card", missing && "opacity-50")}>
              <MediaImage
                src={toPosterSrc(ep.stillLocalPath ?? ep.stillUrl ?? undefined, 640)}
                alt=""
                className={cn("h-full w-full object-cover", spoilers && !watched && "blur-md")}
                fallbackText={`E${ep.episodeNumber}`}
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
                <Play className="h-7 w-7 fill-white text-white" />
              </span>
              {watched ? (
                <span className="absolute right-1.5 top-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-green-600">
                  <Check className="h-3 w-3 text-white" />
                </span>
              ) : null}
              <span className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                <span className="block h-full bg-pitflix-primary" style={{ width: `${watched ? 100 : (ep.progressPercent ?? 0)}%` }} />
              </span>
            </span>
            <span className="flex min-w-0 flex-col gap-1.5">
              <span className="flex flex-wrap items-baseline gap-x-2.5">
                <b className="text-[16px] text-white">
                  {showTitle ? ep.title?.trim() || `Episode ${ep.episodeNumber}` : `Episode ${ep.episodeNumber}`}
                </b>
                <span className="text-[12px] text-pitflix-subtle">
                  S{season} E{ep.episodeNumber}
                  {missing ? " · Not downloaded" : left ? ` · ${left}` : ep.runtimeMinutes ? ` · ${ep.runtimeMinutes} min` : ""}
                </span>
              </span>
              {ep.overview ? (
                <span className={cn("line-clamp-2 text-[13px] leading-relaxed text-white/55", spoilers && !watched && "blur-[5px]")}>
                  {ep.overview}
                </span>
              ) : null}
            </span>
            <span className="pr-1 text-[13px] font-bold text-white/55">
              {ep.imdbVoteAverage && ep.imdbVoteAverage > 0 ? `IMDb ${ep.imdbVoteAverage.toFixed(1)}` : ""}
            </span>
          </button>
        );
      })}
      <Link to={seasonRoute} className="mt-2 self-start text-[13px] font-semibold text-pitflix-light hover:underline">
        Open season page ›
      </Link>
    </div>
  );
}

/** Thin per-episode segments: watched / in progress / not yet. */
export function SeasonProgressSegments({ episodes }: { episodes: SeasonEpisode[] }) {
  const local = episodes.filter((e) => e.inLibrary !== false);
  if (local.length === 0) return null;
  const watched = local.filter((e) => e.watchStatus === "Completed").length;
  const remainingMin = local
    .filter((e) => e.watchStatus !== "Completed")
    .reduce((sum, e) => {
      const rt = e.runtimeMinutes ?? 0;
      return sum + (e.resumeSeconds ? Math.max(0, rt - e.resumeSeconds / 60) : rt);
    }, 0);
  const h = Math.floor(remainingMin / 60);
  const m = Math.round(remainingMin % 60);
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-white/75">Your progress</p>
      <div className="flex gap-1">
        {local.map((e) => (
          <span
            key={e.episodeNumber}
            title={`E${e.episodeNumber}`}
            className={cn(
              "h-2 flex-1 rounded-[3px]",
              e.watchStatus === "Completed" ? "bg-pitflix-primary" : e.progressPercent ? "bg-violet-300" : "bg-white/20",
            )}
          />
        ))}
      </div>
      <p className="text-[13px] text-white/75">
        {watched} of {local.length} watched
        {remainingMin > 0 ? ` · ${h > 0 ? `${h}h ${m}m` : `${m}m`} left` : ""}
      </p>
    </div>
  );
}
