import { isTauri } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { Check, FolderOpen, ImageIcon, ListPlus, Play, RefreshCw, Subtitles } from "lucide-react";
import { getRatingsAggregate, queueRatingsStaleSweep } from "../api/ratings";
import { getTitleNominations, type TitleNomination } from "../api/awards";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getMovie, getMovieVideos, type MediaVideoItem } from "../api/movies";
import { getShow, getShowVideos, type SeasonSummary } from "../api/series";
import { getTrailerEmbedUrl } from "../api/trailers";
import { DetailToolbar } from "../components/DetailToolbar";
import { SubtitleDrawer } from "../components/SubtitleDrawer";
import { useResumeBeforePlay } from "../hooks/useResumeBeforePlay";
import { PosterPickerModal } from "../components/PosterPickerModal";
import { HorizontalDragScroll } from "../components/ui/HorizontalDragScroll";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import type { MediaCard } from "../types/media";
import { formatRating, formatYear } from "../utils/format";
import { toPosterSrc } from "../utils/posterSrc";
import { cn } from "../utils/cn";
import { RatingsPanel } from "../components/RatingsPanel";
import { TvdbArtworkSection } from "../components/TvdbArtworkSection";
import type { StreamPlayerLocationState } from "./StreamPlayerPage";
import { addListItem, getLists, listContains, removeListItem } from "../api/lists";
import { setMovieWatchStatus, setShowWatchStatus } from "../api/watch";
import { formatListMenuLabel, isFavoritesListName } from "../utils/listMarks";

/** Returns the parent directory of a file path (works with both / and \ separators). */
function parentDir(filePath: string): string {
  const s = filePath.replace(/[/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i > 0 ? s.slice(0, i) : s;
}

function openFolder(path: string) {
  if (!isTauri() || !path) return;
  void openPath(path).catch(() => {});
}

type CrewMember = {
  id: number;
  name: string;
  job: string;
  profilePath?: string;
  profileLocalPath?: string | null;
  profileRemoteUrl?: string | null;
};


type CastPerson = { name: string; character?: string; personTmdbId: number; profileLocalPath?: string | null; profileRemoteUrl?: string | null };

function PersonPortraitCard({ name, role, imgSrc, fallbackSrc, onClick }: {
  name: string; role?: string; imgSrc?: string; fallbackSrc?: string; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="w-[110px] shrink-0 text-left focus:outline-none">
      <div className="aspect-[2/3] overflow-hidden rounded-xl bg-pitflix-surface ring-1 ring-white/[0.08] transition group-hover:ring-pitflix-primary/50">
        <MediaImage
          src={imgSrc}
          fallbackSrc={fallbackSrc}
          alt={name}
          className="h-full w-full object-cover object-top transition-transform duration-300 hover:scale-105"
          fallbackText={name.slice(0, 2)}
        />
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] font-semibold leading-snug text-white">{name}</p>
      {role ? <p className="mt-0.5 line-clamp-1 text-[10px] text-pitflix-subtle">{role}</p> : null}
    </button>
  );
}

type CastTabKey = "cast" | "directors" | "writers" | "crew";

function CastCrewSection({ cast, crew, navigate }: {
  cast: CastPerson[];
  crew: CrewMember[];
  navigate: (to: string) => void;
}) {
  const [tab, setTab] = useState<CastTabKey>("cast");

  const directors = crew.filter((c) => c.job.toLowerCase() === "director");
  const writers = crew.filter((c) => {
    const j = c.job.toLowerCase();
    return j === "writer" || j === "screenplay" || j === "story" || j === "co-writer" || j.includes("writer");
  });
  const otherCrew = crew.filter((c) => {
    const j = c.job.toLowerCase();
    return j !== "director" && !j.includes("writer") && j !== "screenplay" && j !== "story";
  });

  const tabs: { key: CastTabKey; label: string; count: number }[] = (
    [
      { key: "cast",      label: "Cast",       count: cast.length },
      { key: "directors", label: "Directors",  count: directors.length },
      { key: "writers",   label: "Writers",    count: writers.length },
      { key: "crew",      label: "Crew",       count: otherCrew.length },
    ] as { key: CastTabKey; label: string; count: number }[]
  ).filter((t) => t.count > 0);

  const items: { name: string; role?: string; imgSrc?: string; fallbackSrc?: string; id: number; key: string }[] =
    tab === "cast"
      ? cast.map((c) => ({
          name: c.name,
          role: c.character,
          imgSrc: toPosterSrc(c.profileLocalPath ?? undefined) || c.profileRemoteUrl?.trim() || undefined,
          fallbackSrc: c.profileRemoteUrl?.trim() || undefined,
          id: c.personTmdbId,
          key: `${c.personTmdbId}-${c.name}`,
        }))
      : tab === "directors"
      ? directors.map((c) => ({ name: c.name, role: c.job, imgSrc: crewAvatarSrc(c), id: c.id, key: `${c.id}-${c.job}` }))
      : tab === "writers"
      ? writers.map((c) => ({ name: c.name, role: c.job, imgSrc: crewAvatarSrc(c), id: c.id, key: `${c.id}-${c.job}` }))
      : otherCrew.map((c) => ({ name: c.name, role: c.job, imgSrc: crewAvatarSrc(c), id: c.id, key: `${c.id}-${c.job}` }));

  if (tabs.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center gap-4">
        <h2 className="text-xl font-bold">Credits</h2>
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-semibold transition-all",
                tab === t.key
                  ? "bg-pitflix-primary text-white shadow-sm"
                  : "border border-white/10 text-pitflix-muted hover:border-white/25 hover:text-white",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <HorizontalDragScroll className="gap-3 pb-2">
        {items.map((item) => (
          <PersonPortraitCard
            key={item.key}
            name={item.name}
            role={item.role}
            imgSrc={item.imgSrc}
            onClick={() => item.id > 0 ? navigate(`/person/${item.id}`) : undefined}
          />
        ))}
      </HorizontalDragScroll>
    </section>
  );
}

function crewAvatarSrc(c: CrewMember) {
  const local = toPosterSrc(c.profileLocalPath ?? undefined);
  if (local) return local;
  const remote = c.profileRemoteUrl?.trim();
  if (remote) return remote;
  if (c.profilePath) return `https://image.tmdb.org/t/p/w185${c.profilePath}`;
  return undefined;
}


/** Hero poster: tall cinematic 2:3 pinned at the bottom of the hero. */
const detailHeroPosterClass =
  "h-[228px] w-[152px] shrink-0 overflow-hidden rounded-[9px] object-cover object-center shadow-[0_20px_60px_rgba(0,0,0,0.75)] ring-1 ring-white/[0.08]";



/**
 * Trailer button for local library detail pages.
 * Fetches the YouTube embed URL on demand. When multiple trailers are found,
 * shows a compact pick-list so the user can choose which to watch.
 */
function TrailerButton({ tmdbId, mediaType, title, posterUrl }: {
  tmdbId: number;
  mediaType: "Movie" | "Series";
  title: string;
  posterUrl?: string | null;
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [trailers, setTrailers] = useState<{ embedUrl: string; title?: string | null; type?: string | null }[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  // Close the trailer picker when user clicks outside
  useEffect(() => {
    if (!pickerOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setPickerOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [pickerOpen]);

  function playTrailer(embedUrl: string, trailerTitle?: string | null) {
    const state: StreamPlayerLocationState = {
      streamUrl: embedUrl,
      title: trailerTitle?.trim() ? trailerTitle : `${title} — Trailer`,
      posterUrl,
    };
    navigate("/stream-player", { state });
  }

  async function handleClick() {
    if (loading) return;
    // Already fetched — just open picker or play if only 1
    if (trailers !== null) {
      if (trailers.length === 1) playTrailer(trailers[0].embedUrl, trailers[0].title);
      else setPickerOpen((o) => !o);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getTrailerEmbedUrl(tmdbId, mediaType);
      const list = (res.trailers ?? []).filter((t) => !!t.embedUrl) as { embedUrl: string; title?: string | null; type?: string | null }[];
      if (list.length === 0 && res.embedUrl) list.push({ embedUrl: res.embedUrl, title: res.title });
      if (list.length === 0) { setError("No trailer available yet."); return; }
      setTrailers(list);
      if (list.length === 1) playTrailer(list[0].embedUrl, list[0].title);
      else setPickerOpen(true);
    } catch {
      setError("Could not load trailers.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span ref={containerRef} className="relative inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={loading}
        onClick={() => void handleClick()}
        className="flex items-center gap-2 rounded-[9px] border border-white/[0.11] bg-white/[0.07] px-5 py-[13px] text-sm font-medium text-white/[0.62] transition hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Play className="h-4 w-4 fill-current" />
        {loading ? "Loading…" : trailers && trailers.length > 1 ? `Trailers (${trailers.length})` : "Trailer"}
      </button>
      {error ? <span className="text-xs text-rose-300">{error}</span> : null}
      {pickerOpen && trailers && trailers.length > 1 ? (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-white/10 bg-pitflix-card shadow-2xl">
          {trailers.map((t, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setPickerOpen(false); playTrailer(t.embedUrl, t.title); }}
              className="flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm hover:bg-pitflix-surface"
            >
              <Play className="mt-0.5 h-4 w-4 shrink-0 text-pitflix-primary" />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-white">{t.title?.trim() || "Trailer"}</span>
                {t.type ? <span className="text-[11px] text-pitflix-muted">{t.type}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/** Age/content rating pill shown in the hero metadata line. */
function ContentRatingBadge({ rating }: { rating: string }) {
  return (
    <span className="inline-flex items-center rounded border border-white/20 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-pitflix-muted">
      {rating}
    </span>
  );
}

/** Icon-only action buttons (favorite, add-to-list, watched) in the hero primary row. */
function HeroActionIcons({
  tmdbId,
  mediaType,
  watchStatus,
  kind,
  libraryId,
}: {
  tmdbId: number;
  mediaType: "Movie" | "Series";
  watchStatus?: string;
  kind: "movie" | "series";
  libraryId: number;
}) {
  const qc = useQueryClient();

  // ── Favorite ──
  const { data: lists } = useQuery({
    queryKey: ["lists"],
    queryFn: getLists,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
  const favoritesList = lists?.find((l) => isFavoritesListName(l.name));
  const { data: favState } = useQuery({
    queryKey: ["list-contains", favoritesList?.id, tmdbId, mediaType],
    queryFn: () => listContains(favoritesList!.id, { tmdbId, mediaType }),
    enabled: !!favoritesList && tmdbId > 0,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
  });
  const isFavorite = favState?.inList === true;
  const toggleFavorite = () => {
    if (!favoritesList) return;
    const run = isFavorite
      ? removeListItem(favoritesList.id, tmdbId, mediaType)
      : addListItem(favoritesList.id, { tmdbId, mediaType });
    void run.finally(() => {
      void qc.invalidateQueries({ queryKey: ["list-contains", favoritesList.id, tmdbId, mediaType] });
      void qc.invalidateQueries({ queryKey: ["list-tmdb-ids"] });
    });
  };

  // ── Add to list mini-dropdown ──
  const [listOpen, setListOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!listOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (listRef.current && !listRef.current.contains(e.target as Node)) setListOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [listOpen]);
  const onAddToList = (listId: number) => {
    setListOpen(false);
    void addListItem(listId, { tmdbId, mediaType }).then(() => {
      void qc.invalidateQueries({ queryKey: ["list-tmdb-ids"] });
      void qc.invalidateQueries({ queryKey: ["lists"] });
    });
  };

  // ── Watch status ──
  const isWatched = watchStatus === "Completed";
  const [watchBusy, setWatchBusy] = useState(false);
  const toggleWatched = () => {
    setWatchBusy(true);
    const next = isWatched ? "Unwatched" : "Completed";
    const req = kind === "movie" ? setMovieWatchStatus(libraryId, next) : setShowWatchStatus(libraryId, next);
    void req.finally(() => {
      setWatchBusy(false);
      void qc.invalidateQueries({ queryKey: [kind === "movie" ? "movie" : "show", libraryId] });
      void qc.invalidateQueries({ queryKey: ["movies"] });
      void qc.invalidateQueries({ queryKey: ["series"] });
    });
  };

  const iconBtn =
    "flex h-11 w-11 items-center justify-center rounded-[9px] border border-white/[0.11] bg-white/[0.07] text-white/70 transition hover:bg-white/[0.14]";

  return (
    <div className="flex gap-1.5">
      {/* Favorite */}
      <button
        type="button"
        title={isFavorite ? "Favorited" : "Favorite"}
        onClick={toggleFavorite}
        className={cn(iconBtn, "text-[17px]", isFavorite && "border-pink-400/30 bg-pink-400/15 text-pink-400")}
      >
        {isFavorite ? "♥" : "♡"}
      </button>

      {/* Add to list */}
      <div ref={listRef} className="relative">
        <button
          type="button"
          title="Add to list"
          onClick={() => setListOpen((o) => !o)}
          className={iconBtn}
        >
          <ListPlus className="h-4 w-4" />
        </button>
        {listOpen && lists && lists.length > 0 ? (
          <div className="absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f1f] shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
            <div className="border-b border-white/[0.06] px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">Add to list</p>
            </div>
            <div className="py-1.5">
              {lists.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onAddToList(l.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.05]"
                >
                  <span className="text-[13px] font-medium text-white/75">{formatListMenuLabel(l.name)}</span>
                  <span className="shrink-0 rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] text-white/30">{l.itemCount}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Mark as watched */}
      <button
        type="button"
        title={isWatched ? "Mark as not watched" : "Mark as watched"}
        onClick={toggleWatched}
        disabled={watchBusy}
        className={cn(iconBtn, isWatched && "border-green-400/30 bg-green-500/15 text-green-400")}
      >
        <Check className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Video type label colour. */
function videoTypeBadgeClass(type: string): string {
  const t = type.toLowerCase();
  if (t === "featurette") return "bg-sky-900/50 text-sky-300";
  if (t.includes("behind")) return "bg-violet-900/50 text-violet-300";
  if (t === "clip") return "bg-emerald-900/50 text-emerald-300";
  if (t.includes("bloopers") || t.includes("gag")) return "bg-amber-900/50 text-amber-300";
  return "bg-white/10 text-pitflix-muted";
}

const AWARD_ACCENT: Record<string, string> = {
  "academy-awards": "#c9a227",
  bafta: "#f97316",
  "golden-globes": "#eab308",
  "primetime-emmys": "#3b82f6",
};

function TitleAwardsSection({ tmdbId, mediaType, imdbId }: { tmdbId: number; mediaType: "movie" | "tv"; imdbId?: string | null }) {
  const { data: nominations, isSuccess } = useQuery({
    queryKey: ["title-nominations", tmdbId, mediaType],
    queryFn: () => getTitleNominations(tmdbId, mediaType, imdbId),
    enabled: tmdbId > 0,
    staleTime: 24 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });

  if (!isSuccess) return null;
  if (nominations.length === 0) return null;

  // Group by award, then by year
  const byAward = new Map<string, { awardName: string; accent: string; years: Map<number, TitleNomination[]> }>();
  for (const n of nominations) {
    if (!byAward.has(n.awardId)) {
      byAward.set(n.awardId, {
        awardName: n.awardName,
        accent: AWARD_ACCENT[n.awardId] ?? "#6366f1",
        years: new Map(),
      });
    }
    const award = byAward.get(n.awardId)!;
    if (!award.years.has(n.year)) award.years.set(n.year, []);
    award.years.get(n.year)!.push(n);
  }

  const winners = nominations.filter((n) => n.winner);
  const totalNoms = nominations.length;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold text-white">Awards</h2>
        <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
          {winners.length > 0 ? `${winners.length}W / ${totalNoms}N` : `${totalNoms} Nominations`}
        </span>
      </div>
      <div className="flex flex-col gap-4">
        {[...byAward.entries()].map(([awardId, award]) => (
          <div
            key={awardId}
            className="rounded-xl border border-white/[0.07] bg-pitflix-surface/40 px-4 py-3"
            style={{ borderLeftColor: award.accent, borderLeftWidth: 3 }}
          >
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: award.accent }}>
              {award.awardName}
            </p>
            <div className="flex flex-col gap-2">
              {[...award.years.entries()]
                .sort(([a], [b]) => b - a)
                .map(([year, noms]) => (
                  <div key={year}>
                    <p className="mb-1 text-[10px] font-semibold text-pitflix-muted">{year}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {noms.map((n) => (
                        <span
                          key={n.categoryId}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
                            n.winner
                              ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40"
                              : "bg-white/[0.05] text-pitflix-muted ring-1 ring-white/[0.07]",
                          )}
                        >
                          {n.winner && <span className="text-amber-400">★</span>}
                          {n.categoryName}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Scrollable row of YouTube video extras (featurettes, BTS, clips, bloopers). */
function VideoExtrasSection({ videos }: { videos: MediaVideoItem[] }) {
  if (videos.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-semibold text-white">Videos & Extras</h2>
      <HorizontalDragScroll className="flex gap-3 pb-3">
        {videos.map((v) => (
          <a
            key={v.key}
            href={`https://www.youtube.com/watch?v=${v.key}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex w-[220px] shrink-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-pitflix-card transition hover:border-pitflix-primary/40"
          >
            <div className="relative h-[124px] w-full overflow-hidden bg-pitflix-surface">
              <img
                src={v.thumbnailUrl}
                alt={v.name}
                loading="lazy"
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
              {/* play overlay */}
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition group-hover:opacity-100">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
                  ▶
                </span>
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-1 p-2.5">
              <span className={cn("w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold", videoTypeBadgeClass(v.type))}>
                {v.type}
              </span>
              <p className="line-clamp-2 text-xs text-white">{v.name}</p>
            </div>
          </a>
        ))}
      </HorizontalDragScroll>
    </section>
  );
}

export function MovieDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { requestPlay, ResumePromptModal } = useResumeBeforePlay();
  const [showArtworkPicker, setShowArtworkPicker] = useState(false);
  const [subtitlesOpen, setSubtitlesOpen] = useState(false);
  const mid = Number(id);
  const [ratingRefreshing, setRatingRefreshing] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["movie", mid],
    queryFn: () => getMovie(mid),
    enabled: Number.isFinite(mid) && mid > 0,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });
  const videosQ = useQuery({
    queryKey: ["movie-videos", mid],
    queryFn: () => getMovieVideos(mid),
    enabled: Number.isFinite(mid) && mid > 0 && !!data,
    staleTime: 60 * 60_000,
  });

  if (!Number.isFinite(mid) || mid <= 0) return <p className="text-pitflix-muted">Invalid id</p>;
  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );
  }

  const movie = data.movie as MediaCard & {
    overview?: string;
    runtime?: number;
    genres?: string;
    tmdbId: number;
  };
  const cast = data.cast as {
    name: string;
    character?: string;
    personTmdbId: number;
    profileLocalPath?: string | null;
    profileRemoteUrl?: string | null;
  }[];
  const tmdbSimilar = (data.tmdbSimilar ?? []) as {
    tmdbId: number; title: string; posterUrl: string | null;
    year: string | null; voteAverage: number; mediaType: string;
    isInLibrary: boolean; libraryId: number | null;
    watchStatus?: string | null;
  }[];
  const keywords = (data.keywords ?? []) as { id: number; name: string }[];
  const collection = data.collection as { id: number; name: string } | null | undefined;
  const contentRating = (data.contentRating ?? null) as string | null;
  const extras = (videosQ.data?.videos ?? []) as MediaVideoItem[];
  const durationSeconds = (movie.runtime ?? 0) > 0 ? (movie.runtime as number) * 60 : 0;
  const backdrop = toPosterSrc(movie.selectedBackdropPath || movie.backdropLocalPath || undefined);
  const poster = toPosterSrc(
    movie.selectedPosterPath || movie.posterLocalPath || movie.posterRemoteUrl || undefined,
  );

  return (
    <div>
      {ResumePromptModal}
      {/* ── CINEMATIC HERO ── */}
      <div className="-mx-6 -mt-3">
        <div className="relative h-[560px] overflow-hidden bg-pitflix-card">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="absolute left-6 top-6 z-20 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/[0.32] px-[18px] py-2 text-[13px] font-medium text-white shadow-lg backdrop-blur-xl transition hover:bg-black/55"
          >
            ← Back
          </button>
          <div className="pointer-events-none absolute inset-0">
            {backdrop ? (
              <div className="absolute inset-0 [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_img]:object-top [&_img]:opacity-75">
                <MediaImage src={backdrop} alt="" className="h-full w-full bg-pitflix-card" fallbackText="" />
              </div>
            ) : (
              <div className="absolute inset-0 bg-pitflix-card" />
            )}
            {/* Left fade so text stays readable */}
            <div className="absolute inset-0 bg-gradient-to-r from-pitflix-bg via-pitflix-bg/55 to-transparent" />
            {/* Bottom fade merges into the page */}
            <div className="absolute bottom-0 left-0 right-0 h-2/3 bg-gradient-to-t from-pitflix-bg via-pitflix-bg/60 to-transparent" />
          </div>
          <div className="absolute bottom-0 left-0 right-0 z-10 flex items-end gap-9 px-12 pb-9">
            <MediaImage
              src={poster}
              alt={movie.title}
              className={detailHeroPosterClass}
              fallbackText={movie.title}
            />
            <div className="min-w-0 flex-1 pb-1">
              {movie.watchStatus === "Completed" ? (
                <div className="mb-3">
                  <span className="inline-flex items-center rounded-full border border-green-400/[0.28] bg-green-500/10 px-[14px] py-1 text-[11px] font-semibold tracking-[0.06em] text-green-400">
                    ✓ WATCHED
                  </span>
                </div>
              ) : null}
              <h1 className="mb-2.5 text-[42px] font-semibold leading-[1.05] tracking-tight text-white [text-shadow:0_2px_20px_rgba(0,0,0,0.55)]">
                {movie.title}
              </h1>
              <div className="mb-3 flex flex-wrap items-center gap-2.5 text-sm text-white/50">
                <span>{formatYear(movie.year)}</span>
                <span className="text-white/15">·</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-amber-400">★</span>
                  <span>{formatRating(movie.voteAverage)}</span>
                </span>
                {movie.runtime ? (
                  <>
                    <span className="text-white/15">·</span>
                    <span>{movie.runtime} min</span>
                  </>
                ) : null}
                {contentRating ? (
                  <>
                    <span className="text-white/15">·</span>
                    <ContentRatingBadge rating={contentRating} />
                  </>
                ) : null}
              </div>
              {(movie.genres ?? movie.genresCsv) ? (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {(movie.genres ?? movie.genresCsv)!.split(",").map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => navigate(`/genre/${encodeURIComponent(g.trim())}`)}
                      className="rounded-2xl border border-violet-400/[0.22] bg-violet-500/[0.12] px-3 py-[3px] text-xs font-medium text-violet-300 transition hover:bg-violet-500/[0.22] hover:border-violet-400/[0.4]"
                    >
                      {g.trim()}
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="mb-6 line-clamp-3 max-w-[540px] text-sm leading-[1.68] text-white/[0.58]">
                {movie.overview}
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                {(movie.mediaFilePath || movie.filePath) ? (
                  <button
                    type="button"
                    className="flex items-center gap-2.5 rounded-[9px] bg-[#7c3aed] px-[26px] py-[13px] text-sm font-semibold text-white shadow-[0_4px_24px_rgba(124,58,237,0.45)] transition hover:-translate-y-px hover:bg-[#6d28d9]"
                    onClick={() =>
                      void requestPlay({
                        filePath: movie.mediaFilePath || movie.filePath || "",
                        title: movie.title,
                        posterPath: movie.selectedPosterPath || movie.posterLocalPath || null,
                        mediaType: "Movie",
                        durationSeconds,
                        context: { libraryMovieId: movie.id },
                      })
                    }
                  >
                    {movie.watchStatus === "Completed" ? "↺ Watch Again" : "▶ Play"}
                  </button>
                ) : null}
                {movie.tmdbId > 0 ? (
                  <TrailerButton tmdbId={movie.tmdbId} mediaType="Movie" title={movie.title} posterUrl={poster} />
                ) : null}
                {(movie.mediaFilePath || movie.filePath) ? (
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-[9px] border border-white/[0.11] bg-white/[0.07] px-5 py-[13px] text-sm font-medium text-white/[0.62] transition hover:bg-white/[0.14]"
                    onClick={() => setSubtitlesOpen(true)}
                  >
                    <Subtitles className="h-4 w-4" /> Subtitles
                  </button>
                ) : null}
                {isTauri() && (movie.mediaFilePath || movie.filePath) ? (
                  <button
                    type="button"
                    title="Open folder"
                    className="flex h-11 w-11 items-center justify-center rounded-[9px] border border-white/[0.11] bg-white/[0.07] text-white/70 transition hover:bg-white/[0.14]"
                    onClick={() => openFolder(parentDir(movie.mediaFilePath || movie.filePath || ""))}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  title="Change artwork"
                  className="flex h-11 w-11 items-center justify-center rounded-[9px] border border-white/[0.11] bg-white/[0.07] text-white/70 transition hover:bg-white/[0.14]"
                  onClick={() => setShowArtworkPicker(true)}
                >
                  <ImageIcon className="h-4 w-4" />
                </button>
                {movie.tmdbId > 0 ? (
                  <HeroActionIcons
                    tmdbId={movie.tmdbId}
                    mediaType="Movie"
                    watchStatus={movie.watchStatus}
                    kind="movie"
                    libraryId={movie.id}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── UTILITY BAR ── */}
      <div className="-mx-6">
        <DetailToolbar
          kind="movie"
          libraryId={movie.id}
          tmdbId={movie.tmdbId}
          pickHint={movie.title}
          filePath={movie.mediaFilePath || movie.filePath || undefined}
          onDeleted={() => navigate(-1)}
          onMovieRematched={(newLibraryId) => {
            void qc.invalidateQueries({ queryKey: ["movie", mid] });
            void qc.invalidateQueries({ queryKey: ["movie", newLibraryId] });
            if (newLibraryId !== mid) navigate(`/movie/${newLibraryId}`, { replace: true });
          }}
        />
      </div>

      {/* ── RATINGS ── */}
      <div className="-mx-6 border-t border-white/5 px-12 py-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/35">Ratings</span>
          <button
            type="button"
            title="Fetch fresh ratings from TMDB / IMDb / Rotten Tomatoes"
            disabled={ratingRefreshing}
            onClick={() => {
              setRatingRefreshing(true);
              qc.removeQueries({ predicate: (q) => q.queryKey[0] === "mdblist-ratings" && q.queryKey[1] === movie.tmdbId });
              void queueRatingsStaleSweep().catch(() => {});
              void getRatingsAggregate(movie.tmdbId, "movie")
                .then((fresh) => { qc.setQueryData(["ratings-display", movie.tmdbId, "movie"], fresh); })
                .catch(() => { void qc.refetchQueries({ queryKey: ["ratings-display", movie.tmdbId, "movie"] }); })
                .finally(() => setRatingRefreshing(false));
            }}
            className="flex items-center gap-1.5 rounded-[6px] border border-white/[0.07] bg-white/[0.03] px-3 py-[5px] text-[11.5px] text-white/35 transition hover:bg-white/[0.08] hover:text-white/70 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${ratingRefreshing ? "animate-spin" : ""}`} />
            {ratingRefreshing ? "Refreshing…" : "Refresh rating"}
          </button>
        </div>
        <RatingsPanel tmdbId={movie.tmdbId} mediaType="movie" thumbnailSrc={backdrop ?? poster ?? undefined} />
        <TitleAwardsSection tmdbId={movie.tmdbId} mediaType="movie" />
      </div>

      {showArtworkPicker ? (
        <PosterPickerModal
          libraryId={movie.id}
          tmdbId={movie.tmdbId}
          mediaType="Movie"
          initialTab="poster"
          onClose={() => setShowArtworkPicker(false)}
          onApplied={() => void qc.invalidateQueries({ queryKey: ["movie", mid] })}
        />
      ) : null}

      <SubtitleDrawer
        open={subtitlesOpen}
        onClose={() => setSubtitlesOpen(false)}
        title={movie.title}
        mode="movie"
        movieId={movie.id}
        movieTmdbId={movie.tmdbId}
        videoFilePath={movie.mediaFilePath || movie.filePath || ""}
      />

      <CastCrewSection cast={cast ?? []} crew={(data.crew ?? []) as CrewMember[]} navigate={navigate} />

      {/* TMDB Similar */}
      {tmdbSimilar.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold">Similar Titles</h2>
          <HorizontalDragScroll className="pb-4">
            {tmdbSimilar.map((s) => (
              <button
                key={`tmdb-sim-${s.tmdbId}`}
                type="button"
                onClick={() => {
                  if (s.isInLibrary && s.libraryId) {
                    navigate(`/movie/${s.libraryId}`);
                  } else {
                    navigate("/stream-details", {
                      state: { tmdbId: s.tmdbId, mediaType: "Movie", title: s.title, posterUrl: s.posterUrl },
                    });
                  }
                }}
                className="group relative mr-3 w-[130px] shrink-0 text-left"
              >
                <div className="relative overflow-hidden rounded-xl border-2 border-transparent bg-pitflix-card transition-all group-hover:border-pitflix-primary/50 group-hover:shadow-lg">
                  {s.posterUrl ? (
                    <img src={s.posterUrl} alt={s.title} className="aspect-[2/3] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[2/3] items-center justify-center bg-pitflix-card text-xs text-pitflix-muted px-2 text-center">
                      {s.title}
                    </div>
                  )}
                  {s.watchStatus === "Completed" ? (
                    <div className="absolute bottom-1.5 left-1.5 rounded-md bg-green-500/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow">
                      ✓ Watched
                    </div>
                  ) : s.isInLibrary ? (
                    <div className="absolute left-1.5 top-1.5 rounded-full bg-pitflix-primary/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow">
                      In Library
                    </div>
                  ) : null}
                </div>
                <p className="mt-1.5 truncate text-xs font-medium text-white">{s.title}</p>
                <p className="text-[10px] text-pitflix-subtle">{s.year}</p>
              </button>
            ))}
          </HorizontalDragScroll>
        </section>
      )}

      {/* Keywords */}
      {keywords.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-pitflix-muted">Keywords</h2>
          <div className="flex flex-wrap gap-2">
            {keywords.map((kw) => (
              <button
                key={kw.id}
                type="button"
                onClick={() => navigate(`/browse/keyword/${encodeURIComponent(kw.name)}`)}
                className="rounded-full border border-pitflix-card bg-pitflix-surface/60 px-3 py-1 text-xs font-medium text-pitflix-muted capitalize transition hover:border-pitflix-primary/50 hover:text-white"
              >
                {kw.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Collection */}
      {collection && (
        <section className="mt-8 rounded-xl border border-pitflix-card bg-pitflix-surface/40 p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-pitflix-primary">
            Part of a collection
          </p>
          <div className="flex items-center justify-between gap-4">
            <p className="text-base font-bold text-white">{collection.name}</p>
            <button
              type="button"
              onClick={() =>
                navigate("/stream-collection", {
                  state: { collectionId: collection.id, collectionName: collection.name },
                })
              }
              className="shrink-0 rounded-lg border border-pitflix-primary/50 px-3 py-1.5 text-xs font-medium text-pitflix-primary hover:bg-pitflix-primary/10"
            >
              View Collection →
            </button>
          </div>
        </section>
      )}

      <VideoExtrasSection videos={extras} />
      {movie.tmdbId > 0 && (
        <TvdbArtworkSection tmdbId={movie.tmdbId} mediaType="movie" />
      )}
    </div>
  );
}

type EpisodeRow = {
  id: number;
  episodeNumber: number;
  title?: string | null;
  filePath: string;
  subtitlePath?: string | null;
  watchStatus?: string;
  stillLocalPath?: string | null;
};

type NextEpisodeDto = {
  id: number;
  season: number;
  episodeNumber: number;
  title: string;
  filePath: string;
};

export function ShowDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { requestPlay, ResumePromptModal } = useResumeBeforePlay();
  const [showArtworkPicker, setShowArtworkPicker] = useState(false);
  const [ratingRefreshing, setRatingRefreshing] = useState(false);
  const sid = Number(id);
  const { data, isLoading } = useQuery({
    queryKey: ["show", sid],
    queryFn: () => getShow(sid),
    enabled: Number.isFinite(sid) && sid > 0,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });
  const showVideosQ = useQuery({
    queryKey: ["show-videos", sid],
    queryFn: () => getShowVideos(sid),
    enabled: Number.isFinite(sid) && sid > 0 && !!data,
    staleTime: 60 * 60_000,
  });

  const episodesGrouped = (data?.episodes ?? []) as { season: number; episodes: EpisodeRow[] }[];
  const seasonsSummary = (data?.seasonsSummary ?? []) as SeasonSummary[];
  const seasons = useMemo(
    () =>
      [...new Set(episodesGrouped.map((g) => g.season))].sort((a, b) => {
        if (a === 0 && b !== 0) return 1; // specials last
        if (b === 0 && a !== 0) return -1;
        return a - b;
      }),
    [episodesGrouped],
  );

  const nextEpisode = (data?.nextEpisode ?? null) as NextEpisodeDto | null;

  const firstEpisode = useMemo(() => {
    if (episodesGrouped.length === 0) return null;
    const sortedGroups = [...episodesGrouped].sort((a, b) => a.season - b.season);
    const g = sortedGroups[0];
    const eps = [...g.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
    if (eps.length === 0) return null;
    return { episode: eps[0], season: g.season };
  }, [episodesGrouped]);

  if (!Number.isFinite(sid) || sid <= 0) return <p className="text-pitflix-muted">Invalid id</p>;
  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );
  }

  const show = data.show as MediaCard & { overview?: string; genres?: string; tmdbId: number };
  const cast = data.cast as {
    name: string;
    character?: string;
    personTmdbId: number;
    profileLocalPath?: string | null;
    profileRemoteUrl?: string | null;
  }[];
  const tmdbSimilarShow = (data.tmdbSimilar ?? []) as {
    tmdbId: number; title: string; posterUrl: string | null;
    year: string | null; voteAverage: number; mediaType: string;
    isInLibrary: boolean; libraryId: number | null;
    watchStatus?: string | null;
  }[];
  const keywordsShow = (data.keywords ?? []) as { id: number; name: string }[];
  const contentRatingShow = (data.contentRating ?? null) as string | null;
  const showExtras = (showVideosQ.data?.videos ?? []) as MediaVideoItem[];

  const backdrop = toPosterSrc(show.selectedBackdropPath || show.backdropLocalPath || undefined);
  const poster = toPosterSrc(
    show.selectedPosterPath || show.posterLocalPath || show.posterRemoteUrl || undefined,
  );

  return (
    <div>
      {ResumePromptModal}
      {/* ── CINEMATIC HERO ── */}
      <div className="-mx-6 -mt-3">
        <div className="relative h-[560px] overflow-hidden bg-pitflix-card">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="absolute left-6 top-6 z-20 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/[0.32] px-[18px] py-2 text-[13px] font-medium text-white shadow-lg backdrop-blur-xl transition hover:bg-black/55"
          >
            ← Back
          </button>
          <div className="pointer-events-none absolute inset-0">
            {backdrop ? (
              <div className="absolute inset-0 [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_img]:object-top [&_img]:opacity-75">
                <MediaImage src={backdrop} alt="" className="h-full w-full bg-pitflix-card" fallbackText="" />
              </div>
            ) : (
              <div className="absolute inset-0 bg-pitflix-card" />
            )}
            {/* Left fade so text stays readable */}
            <div className="absolute inset-0 bg-gradient-to-r from-pitflix-bg via-pitflix-bg/55 to-transparent" />
            {/* Bottom fade merges into the page */}
            <div className="absolute bottom-0 left-0 right-0 h-2/3 bg-gradient-to-t from-pitflix-bg via-pitflix-bg/60 to-transparent" />
          </div>
          <div className="absolute bottom-0 left-0 right-0 z-10 flex items-end gap-9 px-12 pb-9">
            <MediaImage
              src={poster}
              alt={show.title}
              className={detailHeroPosterClass}
              fallbackText={show.title}
            />
            <div className="min-w-0 flex-1 pb-1">
              {show.watchStatus === "Completed" ? (
                <div className="mb-3">
                  <span className="inline-flex items-center rounded-full border border-green-400/[0.28] bg-green-500/10 px-[14px] py-1 text-[11px] font-semibold tracking-[0.06em] text-green-400">
                    ✓ WATCHED
                  </span>
                </div>
              ) : null}
              <h1 className="mb-2.5 text-[42px] font-semibold leading-[1.05] tracking-tight text-white [text-shadow:0_2px_20px_rgba(0,0,0,0.55)]">
                {show.title}
              </h1>
              <div className="mb-3 flex flex-wrap items-center gap-2.5 text-sm text-white/50">
                <span>{formatYear(show.year)}</span>
                <span className="text-white/15">·</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-amber-400">★</span>
                  <span>{formatRating(show.voteAverage)}</span>
                </span>
                {contentRatingShow ? (
                  <>
                    <span className="text-white/15">·</span>
                    <ContentRatingBadge rating={contentRatingShow} />
                  </>
                ) : null}
              </div>
              {(show.genres ?? show.genresCsv) ? (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {(show.genres ?? show.genresCsv)!.split(",").map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => navigate(`/genre/${encodeURIComponent(g.trim())}`)}
                      className="rounded-2xl border border-violet-400/[0.22] bg-violet-500/[0.12] px-3 py-[3px] text-xs font-medium text-violet-300 transition hover:bg-violet-500/[0.22] hover:border-violet-400/[0.4]"
                    >
                      {g.trim()}
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="mb-6 line-clamp-3 max-w-[540px] text-sm leading-[1.68] text-white/[0.58]">
                {show.overview}
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                {nextEpisode ? (
                  <button
                    type="button"
                    className="flex items-center gap-2.5 rounded-[9px] bg-[#7c3aed] px-[26px] py-[13px] text-sm font-semibold text-white shadow-[0_4px_24px_rgba(124,58,237,0.45)] transition hover:-translate-y-px hover:bg-[#6d28d9]"
                    onClick={() =>
                      void requestPlay({
                        filePath: nextEpisode.filePath,
                        title: `${show.title} · S${nextEpisode.season}E${nextEpisode.episodeNumber}`,
                        posterPath: show.selectedPosterPath || show.posterLocalPath || null,
                        mediaType: "Series",
                        durationSeconds: 0,
                        context: {
                          libraryShowId: show.id,
                          libraryEpisodeId: nextEpisode.id,
                          season: nextEpisode.season,
                          episodeNumber: nextEpisode.episodeNumber,
                        },
                      })
                    }
                  >
                    ▶ Continue — S{nextEpisode.season}E{nextEpisode.episodeNumber}{nextEpisode.title ? ` (${nextEpisode.title})` : ""}
                  </button>
                ) : firstEpisode ? (
                  <button
                    type="button"
                    className="flex items-center gap-2.5 rounded-[9px] bg-[#7c3aed] px-[26px] py-[13px] text-sm font-semibold text-white shadow-[0_4px_24px_rgba(124,58,237,0.45)] transition hover:-translate-y-px hover:bg-[#6d28d9]"
                    onClick={() =>
                      void requestPlay({
                        filePath: firstEpisode.episode.filePath,
                        title: `${show.title} · S${firstEpisode.season}E${firstEpisode.episode.episodeNumber}`,
                        posterPath: show.selectedPosterPath || show.posterLocalPath || null,
                        mediaType: "Series",
                        durationSeconds: 0,
                        context: {
                          libraryShowId: show.id,
                          libraryEpisodeId: firstEpisode.episode.id,
                          season: firstEpisode.season,
                          episodeNumber: firstEpisode.episode.episodeNumber,
                        },
                      })
                    }
                  >
                    ▶ Watch Again · S{firstEpisode.season}E{firstEpisode.episode.episodeNumber}
                  </button>
                ) : null}
                {show.tmdbId > 0 ? (
                  <TrailerButton tmdbId={show.tmdbId} mediaType="Series" title={show.title} posterUrl={poster} />
                ) : null}
                {isTauri() && show.folderPath ? (
                  <button
                    type="button"
                    title="Open folder"
                    className="flex h-11 w-11 items-center justify-center rounded-[9px] border border-white/[0.11] bg-white/[0.07] text-white/70 transition hover:bg-white/[0.14]"
                    onClick={() => openFolder(show.folderPath!)}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  title="Change artwork"
                  className="flex h-11 w-11 items-center justify-center rounded-[9px] border border-white/[0.11] bg-white/[0.07] text-white/70 transition hover:bg-white/[0.14]"
                  onClick={() => setShowArtworkPicker(true)}
                >
                  <ImageIcon className="h-4 w-4" />
                </button>
                {show.tmdbId > 0 ? (
                  <HeroActionIcons
                    tmdbId={show.tmdbId}
                    mediaType="Series"
                    watchStatus={show.watchStatus}
                    kind="series"
                    libraryId={show.id}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── UTILITY BAR ── */}
      <div className="-mx-6">
        <DetailToolbar
          kind="series"
          libraryId={show.id}
          tmdbId={show.tmdbId}
          pickHint={show.title}
          folderPath={show.folderPath || undefined}
          onDeleted={() => navigate(-1)}
          onShowRematched={(newLibraryId) => {
            void qc.invalidateQueries({ queryKey: ["show", sid] });
            void qc.invalidateQueries({ queryKey: ["show", newLibraryId] });
            if (newLibraryId !== sid) navigate(`/series/${newLibraryId}`, { replace: true });
          }}
        />
      </div>

      {/* ── RATINGS ── */}
      <div className="-mx-6 border-t border-white/5 px-12 py-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/35">Ratings</span>
          <button
            type="button"
            title="Fetch fresh ratings from TMDB / IMDb / Rotten Tomatoes"
            disabled={ratingRefreshing}
            onClick={() => {
              setRatingRefreshing(true);
              qc.removeQueries({ predicate: (q) => q.queryKey[0] === "mdblist-ratings" && q.queryKey[1] === show.tmdbId });
              void queueRatingsStaleSweep().catch(() => {});
              void getRatingsAggregate(show.tmdbId, "tv")
                .then((fresh) => { qc.setQueryData(["ratings-display", show.tmdbId, "tv"], fresh); })
                .catch(() => { void qc.refetchQueries({ queryKey: ["ratings-display", show.tmdbId, "tv"] }); })
                .finally(() => setRatingRefreshing(false));
            }}
            className="flex items-center gap-1.5 rounded-[6px] border border-white/[0.07] bg-white/[0.03] px-3 py-[5px] text-[11.5px] text-white/35 transition hover:bg-white/[0.08] hover:text-white/70 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${ratingRefreshing ? "animate-spin" : ""}`} />
            {ratingRefreshing ? "Refreshing…" : "Refresh rating"}
          </button>
        </div>
        <RatingsPanel tmdbId={show.tmdbId} mediaType="tv" thumbnailSrc={backdrop ?? poster ?? undefined} />
        <TitleAwardsSection tmdbId={show.tmdbId} mediaType="tv" />
      </div>

      {showArtworkPicker ? (
        <PosterPickerModal
          libraryId={show.id}
          tmdbId={show.tmdbId}
          mediaType="Series"
          initialTab="poster"
          onClose={() => setShowArtworkPicker(false)}
          onApplied={() => void qc.invalidateQueries({ queryKey: ["show", sid] })}
        />
      ) : null}

      {seasonsSummary.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 text-xl font-bold">Seasons</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {seasonsSummary.map((s) => {
              const inLibrary = s.inLibrary !== false;
              const inner = (
                <>
                  <div className="relative aspect-[2/3] w-full overflow-hidden">
                    <MediaImage
                      src={s.posterUrl ?? undefined}
                      alt=""
                      className={cn(
                        "h-full w-full object-cover transition-transform duration-300",
                        inLibrary ? "group-hover:scale-[1.03]" : "opacity-70 saturate-[0.7]",
                      )}
                      fallbackText={s.name.slice(0, 2)}
                    />
                    {!inLibrary ? (
                      <div className="absolute right-1.5 top-1.5">
                        <span className="rounded border border-amber-500/60 bg-amber-950/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-200">
                          Missing
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-0.5 px-1.5 py-2">
                    <p className="line-clamp-1 text-[11px] font-semibold text-white">{s.name}</p>
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-[10px] text-pitflix-muted">
                        {inLibrary
                          ? `${s.episodeCount}${s.tmdbEpisodeCount > 0 ? ` / ${s.tmdbEpisodeCount}` : ""} eps`
                          : "Not in library"}
                      </p>
                      {s.voteAverage != null && s.voteAverage > 0 && (
                        <span className="shrink-0 text-[9px] font-semibold text-amber-400">★{s.voteAverage.toFixed(1)}</span>
                      )}
                    </div>
                  </div>
                </>
              );
              return inLibrary ? (
                <Link
                  key={s.seasonNumber}
                  to={`/series/${sid}/season/${s.seasonNumber}`}
                  className="group overflow-hidden rounded-xl border border-pitflix-card/70 bg-pitflix-surface/40 transition-all hover:border-pitflix-primary/50 hover:shadow-lg hover:shadow-pitflix-primary/10"
                >
                  {inner}
                </Link>
              ) : (
                <div
                  key={s.seasonNumber}
                  className="group overflow-hidden rounded-xl border border-amber-500/25 bg-pitflix-surface/30"
                >
                  {inner}
                </div>
              );
            })}
          </div>
        </section>
      ) : seasons.length === 0 ? (
        <section className="mt-10">
          <h2 className="mb-2 text-xl font-bold">Seasons</h2>
          <p className="text-sm text-pitflix-muted">No episodes in the library yet.</p>
        </section>
      ) : null}

      <CastCrewSection cast={cast ?? []} crew={(data.crew ?? []) as CrewMember[]} navigate={navigate} />

      {/* TMDB Similar */}
      {tmdbSimilarShow.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold">Similar Titles</h2>
          <HorizontalDragScroll className="pb-4">
            {tmdbSimilarShow.map((s) => (
              <button
                key={`tmdb-sim-${s.tmdbId}`}
                type="button"
                onClick={() => {
                  if (s.isInLibrary && s.libraryId) {
                    navigate(`/series/${s.libraryId}`);
                  } else {
                    navigate("/stream-details", {
                      state: { tmdbId: s.tmdbId, mediaType: "Series", title: s.title, posterUrl: s.posterUrl },
                    });
                  }
                }}
                className="group relative mr-3 w-[130px] shrink-0 text-left"
              >
                <div className="relative overflow-hidden rounded-xl border-2 border-transparent bg-pitflix-card transition-all group-hover:border-pitflix-primary/50 group-hover:shadow-lg">
                  {s.posterUrl ? (
                    <img src={s.posterUrl} alt={s.title} className="aspect-[2/3] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[2/3] items-center justify-center bg-pitflix-card px-2 text-center text-xs text-pitflix-muted">
                      {s.title}
                    </div>
                  )}
                  {s.watchStatus === "Completed" ? (
                    <div className="absolute bottom-1.5 left-1.5 rounded-md bg-green-500/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow">
                      ✓ Watched
                    </div>
                  ) : s.isInLibrary ? (
                    <div className="absolute left-1.5 top-1.5 rounded-full bg-pitflix-primary/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow">
                      In Library
                    </div>
                  ) : null}
                </div>
                <p className="mt-1.5 truncate text-xs font-medium text-white">{s.title}</p>
                <p className="text-[10px] text-pitflix-subtle">{s.year}</p>
              </button>
            ))}
          </HorizontalDragScroll>
        </section>
      )}

      {/* Keywords */}
      {keywordsShow.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-pitflix-muted">Keywords</h2>
          <div className="flex flex-wrap gap-2">
            {keywordsShow.map((kw) => (
              <button
                key={kw.id}
                type="button"
                onClick={() => navigate(`/browse/keyword/${encodeURIComponent(kw.name)}`)}
                className="rounded-full border border-pitflix-card bg-pitflix-surface/60 px-3 py-1 text-xs font-medium capitalize text-pitflix-muted transition hover:border-pitflix-primary/50 hover:text-white"
              >
                {kw.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <VideoExtrasSection videos={showExtras} />
      {show.tmdbId > 0 && (
        <TvdbArtworkSection tmdbId={show.tmdbId} mediaType="series" />
      )}
    </div>
  );
}
