import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { rematchMovieFromFile, rematchSeriesFromFolder } from "../../api/library";
import { setMovieWatchStatus, setShowWatchStatus } from "../../api/watch";
import type { MediaContextMenuAction } from "./MediaContextMenu";
import { markStreamingWatched } from "../../hooks/markStreamingWatched";

export type LibraryContextTarget = {
  kind: "movie" | "series";
  libraryId: number;
  tmdbId: number;
  title: string;
  watchStatus?: string;
};

export type StreamingContextTarget = {
  kind: "streaming";
  tmdbId: number;
  mediaType: "Movie" | "Series";
  title: string;
  posterUrl?: string | null;
  imdbId?: string | null;
  seasonNumber?: number;
  episodeNumber?: number;
};

export type SeasonContextTarget = {
  kind: "season";
  libraryId: number;
  tmdbId: number;
  title: string;
  seasonNumber: number;
  watchStatus?: string;
};

export type MediaContextTarget = LibraryContextTarget | StreamingContextTarget | SeasonContextTarget;

export function useMediaContextMenu() {
  const qc = useQueryClient();
  const [menu, setMenu] = useState<{ target: MediaContextTarget; x: number; y: number } | null>(null);

  const openMenu = useCallback((target: MediaContextTarget, x: number, y: number) => {
    setMenu({ target, x, y });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleContextMenu = useCallback(
    (target: MediaContextTarget) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openMenu(target, e.clientX, e.clientY);
    },
    [openMenu],
  );

  const runAction = useCallback(
    async (action: MediaContextMenuAction) => {
      if (!menu) return;
      const t = menu.target;

      if (action === "rescan") {
        if (t.kind === "movie") {
          if (!window.confirm(`Re-scan "${t.title}" from its file?`)) return;
          await rematchMovieFromFile(t.libraryId);
        } else if (t.kind === "series" || t.kind === "season") {
          const showId = t.libraryId;
          if (!window.confirm(`Re-scan "${t.title}" from its folder?`)) return;
          await rematchSeriesFromFolder(showId);
        }
        void qc.invalidateQueries({ queryKey: ["movies"] });
        void qc.invalidateQueries({ queryKey: ["series"] });
        void qc.invalidateQueries({ queryKey: ["unmatched"] });
        return;
      }

      const markCompleted = action === "markWatched";

      if (t.kind === "movie") {
        await setMovieWatchStatus(t.libraryId, markCompleted ? "Completed" : "Unwatched");
        void qc.invalidateQueries({ queryKey: ["movie", t.libraryId] });
        void qc.invalidateQueries({ queryKey: ["movies"] });
      } else if (t.kind === "series" || t.kind === "season") {
        await setShowWatchStatus(t.libraryId, markCompleted ? "Completed" : "Unwatched");
        void qc.invalidateQueries({ queryKey: ["show", t.libraryId] });
        void qc.invalidateQueries({ queryKey: ["series"] });
      } else if (t.kind === "streaming") {
        if (markCompleted) {
          await markStreamingWatched(
            {
              tmdbId: t.tmdbId,
              mediaType: t.mediaType,
              title: t.title,
              posterUrl: t.posterUrl,
              imdbId: t.imdbId,
              season: t.seasonNumber,
              episode: t.episodeNumber,
            },
            qc,
          );
        }
      }

      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["watch-stats"] });
    },
    [menu, qc],
  );

  return { menu, closeMenu, handleContextMenu, runAction };
}
