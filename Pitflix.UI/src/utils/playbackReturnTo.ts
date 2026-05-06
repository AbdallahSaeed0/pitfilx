import type { PlayerReturnTo } from "../types/playback";

/** Library season list route (library show id + season number). */
export function pickReturnToAfterLibraryNavigation(
  existing: PlayerReturnTo | undefined,
  mediaType: string,
  libraryMovieId?: number,
  libraryShowId?: number,
  season?: number,
): PlayerReturnTo | undefined {
  if (mediaType === "Series" && libraryShowId != null && libraryShowId > 0) {
    const s = season;
    if (s != null && s > 0) {
      return { pathname: `/series/${libraryShowId}/season/${s}` };
    }
  }
  if (mediaType === "Movie" && libraryMovieId != null && libraryMovieId > 0) {
    return { pathname: `/movie/${libraryMovieId}` };
  }
  return existing;
}
