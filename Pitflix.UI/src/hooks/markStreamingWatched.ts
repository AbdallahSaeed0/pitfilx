import type { QueryClient } from "@tanstack/react-query";
import { setEpisodeWatchStatus } from "../api/episodes";
import { markWatchedEntry, unmarkWatchedEntry } from "../api/history";
import { getLibraryWatchTarget } from "../api/library";
import { setMovieWatchStatus, setShowWatchStatus } from "../api/watch";

export type MarkStreamingWatchedInput = {
  tmdbId: number;
  mediaType: "Movie" | "Series";
  title: string;
  posterUrl?: string | null;
  imdbId?: string | null;
  season?: number;
  episode?: number;
};

export type MarkStreamingWatchedResult = {
  markedInLibrary: boolean;
};

/** Mark a streaming title watched in library (if matched) and always record in stats history. */
export async function markStreamingWatched(
  input: MarkStreamingWatchedInput,
  qc?: QueryClient,
): Promise<MarkStreamingWatchedResult> {
  if (input.tmdbId <= 0) {
    throw new Error("Missing TMDB id for this title.");
  }

  let markedInLibrary = false;
  let libraryMovieId: number | undefined;
  let libraryShowId: number | undefined;

  try {
    const target = await getLibraryWatchTarget({
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
      season: input.season,
      episode: input.episode,
    });
    if (target.matched) {
      if (input.mediaType === "Movie" && target.movieId != null) {
        await setMovieWatchStatus(target.movieId, "Completed");
        libraryMovieId = target.movieId;
        markedInLibrary = true;
      } else if (input.mediaType === "Series") {
        if (target.episodeId != null) {
          await setEpisodeWatchStatus(target.episodeId, "Completed");
          if (target.showId != null) libraryShowId = target.showId;
          markedInLibrary = true;
        } else if (target.showId != null) {
          await setShowWatchStatus(target.showId, "Completed");
          libraryShowId = target.showId;
          markedInLibrary = true;
        }
      }
    }
  } catch (err) {
    console.warn("[markStreamingWatched] library update failed", err);
    /* still record in unified history */
  }

  await markWatchedEntry({
    tmdbId: input.tmdbId,
    imdbId: input.imdbId,
    mediaType: input.mediaType,
    title: input.title,
    posterUrl: input.posterUrl,
    source: "streaming",
    seasonNumber: input.season ?? null,
    episodeNumber: input.episode ?? null,
  });

  if (qc) {
    void qc.invalidateQueries({ queryKey: ["watch-stats"] });
    void qc.invalidateQueries({ queryKey: ["stats"] });
    void qc.invalidateQueries({ queryKey: ["home-history"] });
    if (markedInLibrary) {
      void qc.invalidateQueries({ queryKey: ["movies"] });
      void qc.invalidateQueries({ queryKey: ["series"] });
      if (libraryMovieId != null) {
        void qc.invalidateQueries({ queryKey: ["movie", libraryMovieId] });
      }
      if (libraryShowId != null) {
        void qc.invalidateQueries({ queryKey: ["show", libraryShowId] });
      }
    }
  }

  return { markedInLibrary };
}

/** Reverses `markStreamingWatched`: clears the library watch status (if matched) and the unified history entry. */
export async function unmarkStreamingWatched(
  input: MarkStreamingWatchedInput,
  qc?: QueryClient,
): Promise<void> {
  if (input.tmdbId <= 0) {
    throw new Error("Missing TMDB id for this title.");
  }

  let libraryMovieId: number | undefined;
  let libraryShowId: number | undefined;

  try {
    const target = await getLibraryWatchTarget({
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
      season: input.season,
      episode: input.episode,
    });
    if (target.matched) {
      if (input.mediaType === "Movie" && target.movieId != null) {
        await setMovieWatchStatus(target.movieId, "Unwatched");
        libraryMovieId = target.movieId;
      } else if (input.mediaType === "Series") {
        if (target.episodeId != null) {
          await setEpisodeWatchStatus(target.episodeId, "Unwatched");
          if (target.showId != null) libraryShowId = target.showId;
        } else if (target.showId != null) {
          await setShowWatchStatus(target.showId, "Unwatched");
          libraryShowId = target.showId;
        }
      }
    }
  } catch (err) {
    console.warn("[unmarkStreamingWatched] library update failed", err);
    /* still clear the unified history entry */
  }

  await unmarkWatchedEntry({
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    seasonNumber: input.season ?? null,
    episodeNumber: input.episode ?? null,
  });

  if (qc) {
    void qc.invalidateQueries({ queryKey: ["watch-stats"] });
    void qc.invalidateQueries({ queryKey: ["stats"] });
    void qc.invalidateQueries({ queryKey: ["home-history"] });
    void qc.invalidateQueries({ queryKey: ["movies"] });
    void qc.invalidateQueries({ queryKey: ["series"] });
    if (libraryMovieId != null) void qc.invalidateQueries({ queryKey: ["movie", libraryMovieId] });
    if (libraryShowId != null) void qc.invalidateQueries({ queryKey: ["show", libraryShowId] });
  }
}
