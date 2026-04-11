import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useState } from "react";
import { Heart, ListPlus, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import {
  deleteMediaFromDevice,
  refreshMovieMetadata,
  refreshShowMetadata,
  rematchMovieFromFile,
  rematchSeriesFromFolder,
} from "../api/library";
import { addListItem, getLists, listContains, removeListItem } from "../api/lists";
import { PickTmdbTitleModal, type PickTmdbMatchTarget } from "./PickTmdbTitleModal";
import { setMovieWatchStatus, setShowWatchStatus } from "../api/watch";
import { cn } from "../utils/cn";
import { pitflixConfirm } from "../utils/pitflixDialog";

type DetailToolbarProps = {
  kind: "movie" | "series";
  libraryId: number;
  tmdbId: number;
  watchStatus: string | undefined;
  /** Shown in the manual pick-title modal for context. */
  pickHint?: string;
  filePath?: string;
  folderPath?: string;
  onDeleted?: () => void;
  /** Called after a successful file re-match with the new library row id. */
  onMovieRematched?: (newLibraryId: number) => void;
  /** Called after a successful series folder re-match with the new library row id. */
  onShowRematched?: (newLibraryId: number) => void;
};

export function DetailToolbar({
  kind,
  libraryId,
  tmdbId,
  watchStatus,
  pickHint,
  filePath,
  folderPath,
  onDeleted,
  onMovieRematched,
  onShowRematched,
}: DetailToolbarProps) {
  const qc = useQueryClient();
  const { data: lists } = useQuery({ queryKey: ["lists"], queryFn: getLists });
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pickTarget, setPickTarget] = useState<PickTmdbMatchTarget | null>(null);

  const mediaType = kind === "movie" ? "Movie" : "Series";

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: [kind === "movie" ? "movie" : "show", libraryId] });
    void qc.invalidateQueries({ queryKey: ["movies"] });
    void qc.invalidateQueries({ queryKey: ["series"] });
    void qc.invalidateQueries({ queryKey: ["stats"] });
    void qc.invalidateQueries({ queryKey: ["lists"] });
    void qc.invalidateQueries({ queryKey: ["list-contains"] });
    void qc.invalidateQueries({ queryKey: ["list-tmdb-ids"] });
  };

  const favoritesList = lists?.find((l) => l.name.includes("Favorites"));
  const isCompleted = watchStatus === "Completed";

  const { data: favState } = useQuery({
    queryKey: ["list-contains", favoritesList?.id, tmdbId, mediaType],
    queryFn: () => listContains(favoritesList!.id, { tmdbId, mediaType }),
    enabled: !!favoritesList && tmdbId > 0,
  });
  const isFavorite = favState?.inList === true;

  const showToast = (msg: string) => {
    setActionMsg(msg);
    window.setTimeout(() => setActionMsg(null), 4000);
  };

  const onToggleWatched = () => {
    const next = isCompleted ? "Unwatched" : "Completed";
    setBusy("watch");
    const req = kind === "movie" ? setMovieWatchStatus(libraryId, next) : setShowWatchStatus(libraryId, next);
    void req
      .then(() => {
        showToast(next === "Completed" ? "Marked as watched." : "Marked as not watched.");
        invalidate();
      })
      .catch(() => showToast("Could not update watch status."))
      .finally(() => setBusy(null));
  };

  const onFavorite = () => {
    if (!favoritesList) {
      showToast("Lists are still loading.");
      return;
    }
    setBusy("fav");
    const run = isFavorite
      ? removeListItem(favoritesList.id, tmdbId, mediaType).then(() => showToast("Removed from Favorites."))
      : addListItem(favoritesList.id, { tmdbId, mediaType }).then(() => showToast("Added to Favorites."));
    void run
      .catch(() => showToast(isFavorite ? "Could not remove from Favorites." : "Could not add to Favorites."))
      .finally(() => {
        setBusy(null);
        void qc.invalidateQueries({ queryKey: ["list-contains", favoritesList.id, tmdbId, mediaType] });
        void qc.invalidateQueries({ queryKey: ["list-tmdb-ids"] });
      });
  };

  const onAddToList = (listId: number) => {
    if (!listId) return;
    setBusy("list");
    void addListItem(listId, { tmdbId, mediaType })
      .then(() => {
        showToast("Added to list.");
        if (favoritesList && listId === favoritesList.id) {
          void qc.invalidateQueries({ queryKey: ["list-tmdb-ids"] });
          void qc.invalidateQueries({ queryKey: ["list-contains", favoritesList.id, tmdbId, mediaType] });
        }
      })
      .catch(() => showToast("Could not add to that list."))
      .finally(() => setBusy(null));
  };

  const onRefreshMetadata = () => {
    setBusy("refresh");
    const req = kind === "movie" ? refreshMovieMetadata(libraryId) : refreshShowMetadata(libraryId);
    void req
      .then((r) => {
        if (r && r.success === false) {
          showToast(r.error ?? "Refresh failed.");
          return;
        }
        showToast("Refreshed credits and details from TMDB.");
        invalidate();
      })
      .catch(() => showToast("Could not reach the API or TMDB."))
      .finally(() => setBusy(null));
  };

  const onDeleteFromDevice = async () => {
    const pathToDelete = kind === "movie" ? filePath : folderPath;
    if (!pathToDelete) {
      showToast("No file path available.");
      return;
    }

    setBusy("delete");
    setShowDeleteConfirm(false);

    try {
      await deleteMediaFromDevice({
        path: pathToDelete,
        mediaType,
        libraryId,
      });
      showToast("Deleted from device successfully.");
      invalidate();
      if (onDeleted) window.setTimeout(() => onDeleted(), 1500);
    } catch (error: unknown) {
      const msg = axios.isAxiosError(error)
        ? (error.response?.data as { error?: string } | undefined)?.error
        : undefined;
      showToast(msg || (error instanceof Error ? error.message : "Could not delete from device."));
    } finally {
      setBusy(null);
    }
  };

  const onRematchFromFile = async () => {
    if (kind !== "movie") return;
    const ok = await pitflixConfirm(
      "Remove this movie from the library and match the file again? Use this if the wrong TMDB title was chosen.",
    );
    if (!ok) return;
    setBusy("rematch");
    void rematchMovieFromFile(libraryId)
      .then((r) => {
        if (!r.success) {
          showToast(r.error ?? "Re-match failed.");
          return;
        }
        showToast("File matched again.");
        const nid = r.libraryId ?? libraryId;
        onMovieRematched?.(nid);
        invalidate();
      })
      .catch(() => showToast("Could not re-match (API or TMDB)."))
      .finally(() => setBusy(null));
  };

  const onRematchSeriesFromFolder = async () => {
    if (kind !== "series") return;
    const ok = await pitflixConfirm(
      "Remove this series from the library and match all video files in its folder again? Use this if the wrong TMDB show was chosen.",
    );
    if (!ok) return;
    setBusy("rematch-series");
    void rematchSeriesFromFolder(libraryId)
      .then((r) => {
        if (!r.success) {
          showToast(r.error ?? "Re-match failed.");
          return;
        }
        showToast("Series folder matched again.");
        const nid = r.libraryId ?? libraryId;
        onShowRematched?.(nid);
        invalidate();
      })
      .catch(() => showToast("Could not re-match (API or TMDB)."))
      .finally(() => setBusy(null));
  };

  const onPickMatched = (r: { libraryId?: number; showId?: number; episodeId?: number }) => {
    if (kind === "movie" && r.libraryId != null) {
      showToast("Linked file to the title you chose.");
      onMovieRematched?.(r.libraryId);
    } else if (kind === "series" && r.libraryId != null) {
      showToast("Linked folder to the series you chose.");
      onShowRematched?.(r.libraryId);
    }
    invalidate();
  };

  const scrollSimilar = () =>
    document.getElementById("detail-similar")?.scrollIntoView({ behavior: "smooth", block: "start" });

  const btnClass =
    "inline-flex items-center gap-1.5 rounded-lg border border-pitflix-card px-3 py-2.5 text-sm font-medium text-pitflix-muted transition-colors hover:border-pitflix-primary/50 hover:text-white disabled:opacity-45";

  const hasPath = kind === "movie" ? !!filePath : !!folderPath;

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            type="button"
            className={cn(btnClass, isCompleted && "border-green-600/50 text-green-400")}
            disabled={busy !== null}
            onClick={() => onToggleWatched()}
          >
            {isCompleted ? "Mark not watched" : "Mark as watched"}
          </button>
          <button
            type="button"
            className={cn(
              btnClass,
              isFavorite && "border-red-500/60 bg-red-500/10 text-red-300 hover:border-red-400 hover:text-red-200",
            )}
            disabled={busy !== null}
            onClick={() => void onFavorite()}
          >
            <Heart className={cn("h-4 w-4", isFavorite && "fill-current")} strokeWidth={2} />
            {isFavorite ? "In favorites" : "Favorite"}
          </button>
          <div className="inline-flex min-w-0 items-center gap-2">
            <ListPlus className="h-4 w-4 shrink-0 text-pitflix-subtle" strokeWidth={2} />
            <select
              className="max-w-[min(220px,100%)] rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2.5 text-sm text-white focus:border-pitflix-primary focus:outline-none disabled:opacity-45"
              disabled={busy !== null || !lists?.length}
              defaultValue=""
              onChange={(e) => {
                const id = Number(e.target.value);
                e.target.value = "";
                onAddToList(id);
              }}
            >
              <option value="">Add to list…</option>
              {(lists ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.itemCount})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button type="button" className={btnClass} disabled={busy !== null} onClick={() => void onRefreshMetadata()}>
            <RefreshCw className={cn("h-4 w-4", busy === "refresh" && "animate-spin")} strokeWidth={2} />
            Refresh from TMDB
          </button>
          {kind === "movie" && (filePath || libraryId > 0) ? (
            <>
              <button
                type="button"
                className={btnClass}
                disabled={busy !== null}
                onClick={() => void onRematchFromFile()}
              >
                <RefreshCw className={cn("h-4 w-4", busy === "rematch" && "animate-spin")} strokeWidth={2} />
                Re-match file
              </button>
              <button
                type="button"
                className={btnClass}
                disabled={busy !== null}
                onClick={() => setPickTarget({ kind: "movie", libraryId })}
              >
                <Search className="h-4 w-4" strokeWidth={2} />
                Pick correct title…
              </button>
            </>
          ) : null}
          {kind === "series" && (folderPath || libraryId > 0) ? (
            <>
              <button
                type="button"
                className={btnClass}
                disabled={busy !== null}
                onClick={() => void onRematchSeriesFromFolder()}
              >
                <RefreshCw
                  className={cn("h-4 w-4", busy === "rematch-series" && "animate-spin")}
                  strokeWidth={2}
                />
                Re-match folder
              </button>
              <button
                type="button"
                className={btnClass}
                disabled={busy !== null}
                onClick={() => setPickTarget({ kind: "series", libraryId })}
              >
                <Search className="h-4 w-4" strokeWidth={2} />
                Pick correct series…
              </button>
            </>
          ) : null}
          <button type="button" className={btnClass} onClick={() => scrollSimilar()}>
            <Sparkles className="h-4 w-4" strokeWidth={2} />
            More like this
          </button>
          {hasPath && (
            <button
              type="button"
              className={cn(btnClass, "border-red-600/50 text-red-400 hover:border-red-500 hover:text-red-300")}
              disabled={busy !== null}
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
              Delete from device
            </button>
          )}
        </div>
      </div>
      {actionMsg ? <p className="text-sm text-pitflix-muted">{actionMsg}</p> : null}
      
      <PickTmdbTitleModal
        open={pickTarget !== null}
        onClose={() => setPickTarget(null)}
        target={pickTarget}
        hintTitle={pickHint}
        onMatched={onPickMatched}
      />

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Delete from device?</h3>
            <p className="mt-2 text-sm text-zinc-400">
              This will permanently delete the {kind === "movie" ? "movie file" : "entire series folder"} from your device. This action cannot be undone.
            </p>
            {kind === "series" && folderPath && (
              <p className="mt-2 text-xs text-zinc-500">
                Folder: {folderPath}
              </p>
            )}
            {kind === "movie" && filePath && (
              <p className="mt-2 text-xs text-zinc-500">
                File: {filePath}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-lg border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={busy === "delete"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                onClick={() => void onDeleteFromDevice()}
                disabled={busy === "delete"}
              >
                {busy === "delete" ? "Deleting..." : "Yes, delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
