import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getListById, getListItems, removeListItem } from "../api/lists";
import { getWatchedTmdbIds } from "../api/history";
import { PosterCard } from "../components/ui/PosterCard";
import { LibraryPosterGrid } from "../components/ui/LibraryPosterGrid";
import { Spinner } from "../components/ui/Spinner";
import { LibraryContextMenuLayer } from "../features/library/LibraryContextMenuLayer";
import { lookupImdbRating, useImdbRatingsMap } from "../hooks/useImdbRatingsMap";
import { mediaTypeOf, useLibraryPosterCards } from "../features/library/useLibraryPosterCards";
import { useMediaContextMenu } from "../features/library/useMediaContextMenu";
import { formatRating } from "../utils/format";
import type { MediaCard } from "../types/media";
import { decodeListTitle, isWatchLaterListName } from "../utils/listMarks";
import type { StreamingDetailsLocationState } from "./StreamingDetailsPage";

function formatListTitle(name: string) {
  return decodeListTitle(name).title.trim();
}

function listItemMediaType(item: MediaCard): "Movie" | "Series" {
  const raw = item.tmdbMediaType ?? (item.mediaFilePath || item.filePath ? "Movie" : "Series");
  return raw === "Series" ? "Series" : "Movie";
}

type WatchLaterTab = "movies" | "series";

export function ListDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listId = Number(id);

  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [watchLaterTab, setWatchLaterTab] = useState<WatchLaterTab>("movies");

  const listMetaQ = useQuery({
    queryKey: ["list-meta", listId],
    queryFn: () => getListById(listId),
    enabled: Number.isFinite(listId) && listId > 0,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["list-items", listId],
    queryFn: () => getListItems(listId),
    enabled: Number.isFinite(listId) && listId > 0,
  });
  const isWatchLaterList = listMetaQ.data ? isWatchLaterListName(listMetaQ.data.name) : false;
  const watchedMovieIdsQ = useQuery({
    queryKey: ["watched-tmdb-ids", "Movie"],
    queryFn: () => getWatchedTmdbIds("Movie"),
    enabled: isWatchLaterList,
    staleTime: 60_000,
  });
  const watchedSeriesIdsQ = useQuery({
    queryKey: ["watched-tmdb-ids", "Series"],
    queryFn: () => getWatchedTmdbIds("Series"),
    enabled: isWatchLaterList,
    staleTime: 60_000,
  });

  const removeMut = useMutation({
    mutationFn: ({ tmdbId, mediaType }: { tmdbId: number; mediaType: string }) =>
      removeListItem(listId, tmdbId, mediaType),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["list-items", listId] });
      void qc.invalidateQueries({ queryKey: ["lists"] });
      setRemovingKey(null);
    },
    onError: () => setRemovingKey(null),
  });

  const allItems = (data ?? []) as MediaCard[];
  const watchedMovieIds = new Set(watchedMovieIdsQ.data ?? []);
  const watchedSeriesIds = new Set(watchedSeriesIdsQ.data ?? []);
  function isWatched(item: MediaCard): boolean {
    if (item.watchStatus === "Completed") return true;
    const mt = listItemMediaType(item);
    return mt === "Movie" ? watchedMovieIds.has(item.tmdbId) : watchedSeriesIds.has(item.tmdbId);
  }
  const items = isWatchLaterList ? allItems.filter((i) => !isWatched(i)) : allItems;
  const libraryItems = items.filter((i) => (i.id ?? 0) > 0);
  const { menu: libMenu, closeMenu: closeLibMenu, runAction: runLibAction, cardExtras } =
    useLibraryPosterCards(libraryItems);
  const { menu: streamMenu, closeMenu: closeStreamMenu, handleContextMenu, runAction: runStreamAction } =
    useMediaContextMenu();
  const imdbMap = useImdbRatingsMap(
    items.filter((i) => i.tmdbId > 0).map((i) => ({ tmdbId: i.tmdbId, mediaType: mediaTypeOf(i) })),
  );

  function handleRemove(tmdbId: number, mediaType: string) {
    const key = `${mediaType}-${tmdbId}`;
    setRemovingKey(key);
    removeMut.mutate({ tmdbId, mediaType });
  }

  if (!Number.isFinite(listId) || listId <= 0) return <p className="text-pitflix-muted">Invalid list</p>;
  if (isLoading || listMetaQ.isLoading)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  const meta = listMetaQ.data;
  const heading = meta ? formatListTitle(meta.name) : "List";
  const isWatchLater = meta ? isWatchLaterListName(meta.name) : false;
  const movieItems = isWatchLater ? items.filter((i) => listItemMediaType(i) === "Movie") : [];
  const seriesItems = isWatchLater ? items.filter((i) => listItemMediaType(i) === "Series") : [];
  const displayedItems = isWatchLater
    ? watchLaterTab === "movies"
      ? movieItems
      : seriesItems
    : items;
  const activeMenu = libMenu ?? streamMenu;
  const closeMenu = () => {
    closeLibMenu();
    closeStreamMenu();
  };
  const runAction = (action: "rescan" | "markWatched" | "markUnwatched") => {
    if (libMenu) void runLibAction(action);
    else if (streamMenu) void runStreamAction(action);
  };

  function renderListItem(item: MediaCard) {
    const mediaType = listItemMediaType(item);
    const isStreamingOnly = (item.id ?? 0) <= 0 && (item.tmdbId ?? 0) > 0;
    const itemKey = `${mediaType}-${item.tmdbId}`;
    const isRemoving = removingKey === itemKey;

    if (isStreamingOnly) {
      const state: StreamingDetailsLocationState = {
        tmdbId: item.tmdbId,
        mediaType,
        title: item.title,
        posterUrl: item.posterRemoteUrl ?? null,
        year: item.year != null ? String(item.year) : null,
        imdbId: item.imdbId ?? null,
      };
      const imdb = lookupImdbRating(imdbMap, item.tmdbId, mediaType);
      const rating = imdb != null && imdb > 0 ? imdb : (item.voteAverage ?? 0);
      const ratingIsImdb = imdb != null && imdb > 0;
      return (
        <div key={`stream-${mediaType}-${item.tmdbId}`} className="group relative min-w-0">
          <button
            type="button"
            onClick={() => navigate("/stream-details", { state })}
            onContextMenu={handleContextMenu({
              kind: "streaming",
              tmdbId: item.tmdbId,
              mediaType,
              title: item.title,
              posterUrl: item.posterRemoteUrl ?? null,
              imdbId: item.imdbId ?? null,
            })}
            className="w-full cursor-pointer rounded-xl text-left transition-[transform,filter] duration-200 hover:-translate-y-1"
          >
            <div className="relative overflow-hidden rounded-xl bg-pitflix-card ring-2 ring-transparent ring-offset-2 ring-offset-pitflix-bg transition-[transform,box-shadow,ring-color] duration-200 group-hover:scale-[1.04] group-hover:shadow-2xl group-hover:shadow-black/55 group-hover:ring-pitflix-primary/60">
              {rating > 0 ? (
                <span
                  className={`pointer-events-none absolute left-2 top-2 z-10 rounded-md px-1.5 py-0.5 text-[10px] font-semibold shadow-md ${
                    ratingIsImdb ? "bg-[#F5C518]/90 font-bold text-black" : "bg-black/75 text-white"
                  }`}
                >
                  {ratingIsImdb ? `IMDb ${formatRating(rating)}` : `★ ${formatRating(rating)}`}
                </span>
              ) : null}
              <img
                src={item.posterRemoteUrl ?? ""}
                alt={item.title}
                className="aspect-[2/3] w-full bg-gradient-to-b from-pitflix-card to-pitflix-surface object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            </div>
            <p className="mt-2 truncate text-sm font-medium text-white">{item.title}</p>
            <p className="truncate text-xs text-pitflix-subtle">
              {item.year ?? ""}
              {item.isArabic ? " · AR" : " · EN"}
            </p>
          </button>

          <button
            type="button"
            disabled={isRemoving}
            onClick={() => handleRemove(item.tmdbId, mediaType)}
            title="Remove from list"
            className="absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-red-600/80 group-hover:opacity-100 disabled:cursor-not-allowed"
          >
            {isRemoving ? (
              <span className="h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      );
    }

    return (
      <div key={`${item.id}-${item.tmdbId}`} className="group relative min-w-0">
        {(() => {
          const extras = cardExtras(item);
          return (
            <PosterCard
              item={item}
              mediaType={extras.mediaType}
              imdbRating={extras.imdbRating}
              onContextMenu={extras.onContextMenu}
            />
          );
        })()}
        <button
          type="button"
          disabled={isRemoving}
          onClick={() => handleRemove(item.tmdbId, mediaType)}
          title="Remove from list"
          className="absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-red-600/80 group-hover:opacity-100 disabled:cursor-not-allowed"
        >
          {isRemoving ? (
            <span className="h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 text-sm text-pitflix-muted hover:text-white"
      >
        ← Back
      </button>
      <h1 className="text-3xl font-bold text-white">{heading}</h1>
      {isWatchLater && items.length > 0 ? (
        <p className="mt-1 text-sm text-pitflix-muted">
          {movieItems.length > 0 && `${movieItems.length} movie${movieItems.length === 1 ? "" : "s"}`}
          {movieItems.length > 0 && seriesItems.length > 0 && " · "}
          {seriesItems.length > 0 && `${seriesItems.length} show${seriesItems.length === 1 ? "" : "s"}`}
        </p>
      ) : null}

      {isWatchLater && items.length > 0 ? (
        <div className="mb-6 mt-6 flex w-fit gap-1 rounded-xl border border-white/10 bg-pitflix-surface/60 p-1">
          {(
            [
              { id: "movies" as WatchLaterTab, label: `Movies (${movieItems.length})` },
              { id: "series" as WatchLaterTab, label: `Shows (${seriesItems.length})` },
            ]
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setWatchLaterTab(id)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                watchLaterTab === id
                  ? "bg-pitflix-primary text-white shadow-md shadow-pitflix-primary/30"
                  : "text-pitflix-muted hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {items.length === 0 && !isLoading && (
        <p className="mt-8 text-sm text-pitflix-muted">This list is empty.</p>
      )}

      {isWatchLater && items.length > 0 && displayedItems.length === 0 ? (
        <p className="mt-8 text-sm text-pitflix-muted">
          No {watchLaterTab === "movies" ? "movies" : "shows"} in this list yet.
        </p>
      ) : null}

      {displayedItems.length > 0 ? (
        <LibraryPosterGrid className={isWatchLater ? undefined : "mt-8"}>
          {displayedItems.map(renderListItem)}
        </LibraryPosterGrid>
      ) : null}
      <LibraryContextMenuLayer menu={activeMenu} onClose={closeMenu} onAction={runAction} />
    </div>
  );
}
