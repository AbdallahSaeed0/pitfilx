import { isTauri } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { Check, Heart, ListPlus, Play, Star } from "lucide-react";
import { getTitleNominations, type TitleNomination } from "../../api/awards";
import { CeremonyIcon, ceremonyAccent, ceremonyShortName } from "../../components/awards/CeremonyBadge";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getTrailerEmbedUrl } from "../../api/trailers";
import { HorizontalDragScroll } from "../../components/ui/HorizontalDragScroll";
import { MediaImage } from "../../components/ui/MediaImage";
import { toPosterSrc } from "../../utils/posterSrc";
import { cn } from "../../utils/cn";
import { addListItem, getLists, listContains, removeListItem } from "../../api/lists";
import { setMovieWatchStatus, setShowWatchStatus } from "../../api/watch";
import { formatListMenuLabel, isFavoritesListName } from "../../utils/listMarks";
import { getLetterboxdFilmData, type LetterboxdFriendReview } from "../../api/letterboxd";
import type { MediaVideoItem } from "../../api/movies";
import type { StreamPlayerLocationState } from "../../pages/StreamPlayerPage";
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

function HalfStars({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span className="inline-flex items-center gap-0.5 text-[#00C030]" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => {
        const filled = i < full;
        const isHalf = !filled && i === full && half;
        return (
          <Star
            key={i}
            className={cn("h-3.5 w-3.5", filled || isHalf ? "fill-current" : "text-white/15")}
            strokeWidth={1.5}
          />
        );
      })}
    </span>
  );
}

function FriendReviewCard({ review }: { review: LetterboxdFriendReview }) {
  const [expanded, setExpanded] = useState(false);
  const text = review.reviewText ?? "";
  const isLong = text.length > 180;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-white/10">
          {review.reviewerAvatarUrl ? (
            <img src={review.reviewerAvatarUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold text-white">
            {review.reviewerDisplayName ?? review.reviewerUsername}
          </p>
          {review.watchedDate ? <p className="text-[10px] text-pitflix-subtle">{review.watchedDate}</p> : null}
        </div>
      </div>
      {review.rating != null ? (
        <div className="mt-2">
          <HalfStars rating={review.rating} />
        </div>
      ) : null}
      {text ? (
        <p className={cn("mt-2 text-[11px] leading-relaxed text-pitflix-muted", !expanded && isLong && "line-clamp-3")}>
          {text}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-3">
        {isLong ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] font-semibold text-pitflix-primary hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
        {review.logEntryUrl ? (
          <a
            href={review.logEntryUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-pitflix-subtle hover:text-white"
          >
            View on Letterboxd ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

function LetterboxdSection({ tmdbId }: { tmdbId: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["letterboxd", tmdbId],
    queryFn: () => getLetterboxdFilmData(tmdbId),
    enabled: tmdbId > 0,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <section className="mt-10 space-y-4">
        <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
        <div className="h-20 animate-pulse rounded-xl bg-white/[0.04]" />
        <div className="h-32 animate-pulse rounded-xl bg-white/[0.04]" />
      </section>
    );
  }

  if (isError) {
    return (
      <section className="mt-10">
        <p className="text-[11px] text-pitflix-subtle">Could not load Letterboxd data.</p>
      </section>
    );
  }

  if (!data) return null;

  const hasActivity = data.userRating != null || data.userDiaryEntries.length > 0;

  return (
    <section className="mt-10 space-y-6">
      {hasActivity ? (
        <div>
          <h3 className="mb-2 text-[13px] font-bold text-white">Your Activity</h3>
          {data.userRating != null ? <HalfStars rating={data.userRating} /> : null}
          {data.userDiaryEntries.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {data.userDiaryEntries.map((entry, i) => (
                <li key={i} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-white/80">{entry.date ?? "Unknown date"}</span>
                    {entry.rating != null ? <HalfStars rating={entry.rating} /> : null}
                  </div>
                  {entry.reviewText ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-pitflix-muted">{entry.reviewText}</p>
                  ) : null}
                  {entry.logEntryUrl ? (
                    <a
                      href={entry.logEntryUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-[10px] text-pitflix-subtle hover:text-white"
                    >
                      View on Letterboxd ↗
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <span className="text-2xl font-black text-[#00C030]">●●●</span>
        <div>
          <p className="text-xl font-bold text-white">
            {data.communityRating != null ? data.communityRating.toFixed(1) : "—"}
          </p>
          <p className="text-[10px] text-pitflix-subtle">
            {data.ratingCount != null ? `from ${data.ratingCount.toLocaleString()} ratings` : "Letterboxd community rating"}
          </p>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[13px] font-bold text-white">From people you follow</h3>
        {!data.configured ? (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-center">
            <p className="mb-2 text-[11px] text-pitflix-subtle">Set your Letterboxd username in Settings to see this.</p>
            <Link
              to="/settings?tab=providers"
              className="inline-block rounded-xl bg-[#00C030] px-3.5 py-1.5 text-[11px] font-semibold text-white hover:brightness-110"
            >
              Go to Settings
            </Link>
          </div>
        ) : data.friendReviews.length === 0 ? (
          <p className="text-[11px] text-pitflix-subtle">None of the people you follow have logged this film</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {data.friendReviews.map((r, i) => (
              <FriendReviewCard key={`${r.reviewerUsername}-${i}`} review={r} />
            ))}
          </div>
        )}
      </div>
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

function DetailHeroTitle({
  title,
  clearLogoUrl,
}: {
  title: string;
  clearLogoUrl?: string | null;
}) {
  if (clearLogoUrl) {
    return (
      <div className="mb-2.5">
        <img
          src={clearLogoUrl}
          alt={title}
          className="max-h-[88px] max-w-[min(520px,100%)] object-contain object-left drop-shadow-[0_2px_20px_rgba(0,0,0,0.55)]"
        />
      </div>
    );
  }

  return (
    <h1 className="mb-2.5 text-[42px] font-semibold leading-[1.05] tracking-tight text-white [text-shadow:0_2px_20px_rgba(0,0,0,0.55)]">
      {title}
    </h1>
  );
}

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
      title: trailerTitle?.trim() ? trailerTitle : `${title} - Trailer`,
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
        {loading ? "Loading..." : trailers && trailers.length > 1 ? `Trailers (${trailers.length})` : "Trailer"}
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

  // Favorite
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

  // Add to list mini-dropdown
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
  // Whether this title is already in each list — drives the checkmark and add/remove toggle.
  // Without this, clicking a list did something (silently) but the dropdown looked identical
  // before and after, so it read as "doesn't work".
  const containsResults = useQueries({
    queries: (lists ?? []).map((l) => ({
      queryKey: ["list-contains", l.id, tmdbId, mediaType],
      queryFn: () => listContains(l.id, { tmdbId, mediaType }),
      enabled: listOpen && tmdbId > 0,
      staleTime: 30_000,
    })),
  });
  const listContainsMap = new Map((lists ?? []).map((l, i) => [l.id, containsResults[i]?.data?.inList === true]));
  const [addedFlashListId, setAddedFlashListId] = useState<number | null>(null);
  const onAddToList = (listId: number, alreadyIn: boolean) => {
    const run = alreadyIn ? removeListItem(listId, tmdbId, mediaType) : addListItem(listId, { tmdbId, mediaType });
    void run.then(() => {
      void qc.invalidateQueries({ queryKey: ["list-contains", listId, tmdbId, mediaType] });
      void qc.invalidateQueries({ queryKey: ["list-tmdb-ids"] });
      void qc.invalidateQueries({ queryKey: ["lists"] });
      if (!alreadyIn) {
        setAddedFlashListId(listId);
        window.setTimeout(() => setAddedFlashListId((cur) => (cur === listId ? null : cur)), 1200);
      }
    });
  };

  // Watch status
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
        className={cn(iconBtn, isFavorite && "border-pink-400/30 bg-pink-400/15 text-pink-400")}
      >
        <Heart className={cn("h-4 w-4", isFavorite && "fill-current")} />
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
            <div className="max-h-64 overflow-y-auto py-1.5">
              {lists.map((l) => {
                const inThisList = listContainsMap.get(l.id) === true;
                const justAdded = addedFlashListId === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => onAddToList(l.id, inThisList)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.05]"
                  >
                    <span className="flex items-center gap-2 text-[13px] font-medium text-white/75">
                      {inThisList ? <Check className="h-3.5 w-3.5 shrink-0 text-pitflix-primary" /> : null}
                      {formatListMenuLabel(l.name)}
                    </span>
                    {justAdded ? (
                      <span className="shrink-0 text-[10px] font-semibold text-pitflix-primary">Added</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] text-white/30">{l.itemCount}</span>
                    )}
                  </button>
                );
              })}
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

type TitleAwardGroup = {
  awardId: string;
  awardName: string;
  wins: number;
  noms: number;
  entries: TitleNomination[];
};

function groupTitleNominations(nominations: TitleNomination[]): TitleAwardGroup[] {
  const map = new Map<string, TitleAwardGroup>();
  for (const n of nominations) {
    if (!map.has(n.awardId))
      map.set(n.awardId, { awardId: n.awardId, awardName: n.awardName, wins: 0, noms: 0, entries: [] });
    const g = map.get(n.awardId)!;
    if (n.winner) g.wins++;
    else g.noms++;
    g.entries.push(n);
  }
  return [...map.values()].sort((a, b) => b.wins - a.wins || b.noms - a.noms);
}

/** Same compact list style as the actor page's award accordion — just category + year, no per-entry poster. */
function TitleAwardAccordionPanel({ group }: { group: TitleAwardGroup }) {
  const accent = ceremonyAccent(group.awardId);
  const byYear = new Map<number, TitleNomination[]>();
  for (const n of group.entries) {
    if (!byYear.has(n.year)) byYear.set(n.year, []);
    byYear.get(n.year)!.push(n);
  }
  return (
    <div
      className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#141414] shadow-xl shadow-black/50"
      style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
    >
      <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.05] p-3">
        {[...byYear.entries()]
          .sort(([a], [b]) => b - a)
          .map(([year, noms]) => (
            <div key={year} className="py-2 first:pt-0">
              <p className="mb-1.5 text-[10px] font-semibold text-pitflix-muted">{year}</p>
              <div className="flex flex-col gap-1">
                {noms.map((n) => (
                  <div key={n.categoryId} className="flex items-center gap-2">
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider",
                        n.winner ? "bg-amber-500/20 text-amber-300" : "bg-white/[0.07] text-pitflix-subtle",
                      )}
                    >
                      {n.winner ? "WON" : "NOM"}
                    </span>
                    <p className="line-clamp-1 text-[12px] text-white">{n.categoryName}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function TitleAwardsSection({ tmdbId, mediaType, imdbId }: { tmdbId: number; mediaType: "movie" | "tv"; imdbId?: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: nominations, isSuccess } = useQuery({
    queryKey: ["title-nominations", tmdbId, mediaType],
    queryFn: () => getTitleNominations(tmdbId, mediaType, imdbId),
    enabled: tmdbId > 0,
    staleTime: 24 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });

  if (!isSuccess) return null;
  if (nominations.length === 0) return null;

  const groups = groupTitleNominations(nominations);
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
      <div className="relative">
        <div className="flex flex-wrap gap-2.5">
          {groups.map((g) => {
            const accent = ceremonyAccent(g.awardId);
            const short = ceremonyShortName(g.awardId, g.awardName);
            const isOpen = openId === g.awardId;
            return (
              <button
                key={g.awardId}
                type="button"
                onClick={() => setOpenId(isOpen ? null : g.awardId)}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 transition",
                  isOpen
                    ? "border-white/20 bg-white/[0.09]"
                    : "border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.07]",
                )}
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                  style={{ background: `${accent}18` }}
                >
                  <CeremonyIcon id={g.awardId} color={accent} />
                </div>
                <div className="text-left">
                  <p className="text-[12px] font-bold leading-none text-white">
                    {g.wins > 0 && <span style={{ color: accent }}>{g.wins} win{g.wins > 1 ? "s" : ""}</span>}
                    {g.wins > 0 && g.noms > 0 && <span className="text-pitflix-muted"> · </span>}
                    {g.noms > 0 && <span className="text-pitflix-muted">{g.noms} nom{g.noms > 1 ? "s" : ""}</span>}
                  </p>
                  <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-pitflix-subtle">{short}</p>
                </div>
                <span className={cn("ml-1 text-[10px] text-pitflix-subtle transition-transform", isOpen && "rotate-180")}>▾</span>
              </button>
            );
          })}
        </div>

        {openId && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpenId(null)} aria-hidden />
            {groups.map((g) =>
              openId === g.awardId ? (
                <div key={g.awardId} className="absolute left-0 right-0 top-full z-50 mt-1.5 max-w-sm">
                  <TitleAwardAccordionPanel group={g} />
                </div>
              ) : null,
            )}
          </>
        )}
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
                  <Play className="h-4 w-4 fill-current" />
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
export type { CrewMember, CastPerson };
export {
  parentDir,
  openFolder,
  CastCrewSection,
  LetterboxdSection,
  TrailerButton,
  ContentRatingBadge,
  HeroActionIcons,
  TitleAwardsSection,
  VideoExtrasSection,
  detailHeroPosterClass,
  DetailHeroTitle,
};