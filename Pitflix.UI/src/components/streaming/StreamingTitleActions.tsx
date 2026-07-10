import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Heart, ListPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getWatchedTmdbIds } from "../../api/history";
import { addListItem, getLists, listContains, removeListItem } from "../../api/lists";
import { markStreamingWatched, unmarkStreamingWatched } from "../../hooks/markStreamingWatched";
import { cn } from "../../utils/cn";
import { formatListMenuLabel, isFavoritesListName } from "../../utils/listMarks";

type Props = {
  tmdbId: number;
  mediaType: "Movie" | "Series";
  title: string;
  posterUrl?: string | null;
  imdbId?: string | null;
  season?: number;
  episode?: number;
  /** Compact icon-only row (detail hero). */
  variant?: "icons" | "buttons";
};

export function StreamingTitleActions({
  tmdbId,
  mediaType,
  title,
  posterUrl,
  imdbId,
  season,
  episode,
  variant = "icons",
}: Props) {
  const qc = useQueryClient();
  const [listOpen, setListOpen] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchOverride, setWatchOverride] = useState<boolean | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: lists } = useQuery({
    queryKey: ["lists"],
    queryFn: getLists,
    staleTime: 10 * 60_000,
  });
  const favoritesList = lists?.find((l) => isFavoritesListName(l.name));
  const { data: favState } = useQuery({
    queryKey: ["list-contains", favoritesList?.id, tmdbId, mediaType],
    queryFn: () => listContains(favoritesList!.id, { tmdbId, mediaType }),
    enabled: !!favoritesList && tmdbId > 0,
    staleTime: 5 * 60_000,
  });
  const isFavorite = favState?.inList === true;

  const { data: watchedIds } = useQuery({
    queryKey: ["watched-tmdb-ids", mediaType],
    queryFn: () => getWatchedTmdbIds(mediaType),
    staleTime: 5 * 60_000,
    enabled: tmdbId > 0,
  });
  const isWatched = watchOverride ?? watchedIds?.includes(tmdbId) === true;

  useEffect(() => {
    if (!listOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (listRef.current && !listRef.current.contains(e.target as Node)) setListOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [listOpen]);

  const toggleFavorite = () => {
    if (!favoritesList) return;
    const run = isFavorite
      ? removeListItem(favoritesList.id, tmdbId, mediaType)
      : addListItem(favoritesList.id, {
          tmdbId,
          mediaType,
          title,
          posterRemoteUrl: posterUrl ?? undefined,
          imdbId: imdbId ?? undefined,
        });
    void run.finally(() => {
      void qc.invalidateQueries({ queryKey: ["list-contains", favoritesList.id, tmdbId, mediaType] });
      void qc.invalidateQueries({ queryKey: ["list-tmdb-ids"] });
    });
  };

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
    const run = alreadyIn
      ? removeListItem(listId, tmdbId, mediaType)
      : addListItem(listId, {
          tmdbId,
          mediaType,
          title,
          posterRemoteUrl: posterUrl ?? undefined,
          imdbId: imdbId ?? undefined,
        });
    void run.then(() => {
      void qc.invalidateQueries({ queryKey: ["list-tmdb-ids"] });
      void qc.invalidateQueries({ queryKey: ["lists"] });
      void qc.invalidateQueries({ queryKey: ["list-contains", listId, tmdbId, mediaType] });
      if (!alreadyIn) {
        setAddedFlashListId(listId);
        window.setTimeout(() => setAddedFlashListId((cur) => (cur === listId ? null : cur)), 1200);
      }
    });
  };

  const onToggleWatched = () => {
    if (watchBusy) return;
    setWatchBusy(true);
    setWatchError(null);
    const input = { tmdbId, mediaType, title, posterUrl, imdbId, season, episode };
    const run = isWatched ? unmarkStreamingWatched(input, qc) : markStreamingWatched(input, qc);
    void run
      .then(() => {
        setWatchOverride(!isWatched);
        void qc.invalidateQueries({ queryKey: ["watched-tmdb-ids"] });
      })
      .catch((err: unknown) => {
        setWatchError(
          err instanceof Error ? err.message : `Could not ${isWatched ? "unmark" : "mark"} as watched.`,
        );
      })
      .finally(() => setWatchBusy(false));
  };

  const iconBtn =
    "flex h-11 w-11 items-center justify-center rounded-[9px] border border-white/[0.11] bg-white/[0.07] text-white/70 transition hover:bg-white/[0.14]";
  const textBtn =
    "flex items-center gap-2 rounded-[9px] border border-white/[0.11] bg-white/[0.07] px-5 py-[13px] text-sm font-medium text-white/[0.62] transition hover:bg-white/[0.14] disabled:opacity-50";

  const renderListRow = (l: NonNullable<typeof lists>[number]) => {
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
  };

  if (variant === "buttons") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={toggleFavorite} className={textBtn} title={isFavorite ? "Favorited" : "Favorite"}>
          <Heart className={cn("h-4 w-4", isFavorite && "fill-rose-400 text-rose-400")} />
          {isFavorite ? "Favorited" : "Favorite"}
        </button>
        <div ref={listRef} className="relative">
          <button type="button" onClick={() => setListOpen((o) => !o)} className={textBtn}>
            <ListPlus className="h-4 w-4" />
            Add to playlist
          </button>
          {listOpen && lists && lists.length > 0 ? (
            <div className="absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f1f] shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
              <div className="border-b border-white/[0.06] px-4 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">Add to playlist</p>
              </div>
              <div className="max-h-64 overflow-y-auto py-1.5">{lists.map(renderListRow)}</div>
            </div>
          ) : null}
        </div>
        <button type="button" disabled={watchBusy} onClick={onToggleWatched} className={cn(textBtn, isWatched && "border-green-400/30 text-green-400")}>
          <Check className="h-4 w-4" />
          {watchBusy ? "Saving…" : isWatched ? "Watched" : "Mark watched"}
        </button>
        {watchError ? <p className="w-full text-[11px] text-rose-400">{watchError}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        title={isFavorite ? "Favorited" : "Favorite"}
        onClick={toggleFavorite}
        className={cn(iconBtn, isFavorite && "border-pink-400/30 bg-pink-400/15 text-pink-400")}
      >
        <Heart className={cn("h-4 w-4", isFavorite && "fill-current")} />
      </button>
      <div ref={listRef} className="relative">
        <button type="button" title="Add to playlist" onClick={() => setListOpen((o) => !o)} className={iconBtn}>
          <ListPlus className="h-4 w-4" />
        </button>
        {listOpen && lists && lists.length > 0 ? (
          <div className="absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0f0f1f] shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
            <div className="border-b border-white/[0.06] px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">Add to playlist</p>
            </div>
            <div className="max-h-64 overflow-y-auto py-1.5">{lists.map(renderListRow)}</div>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        title={isWatched ? "Mark as unwatched" : "Mark as watched"}
        disabled={watchBusy}
        onClick={onToggleWatched}
        className={cn(iconBtn, isWatched && "border-green-400/30 bg-green-500/15 text-green-400")}
      >
        <Check className="h-4 w-4" />
      </button>
    </div>
  );
}
