export type NomineeMediaKind = "movie" | "tv";

/** Normalize award edition JSON `mediaType` to recommendation / trailer params. */
export function nomineeMediaKind(raw: string): NomineeMediaKind {
  const x = raw.trim().toLowerCase();
  if (x === "tv" || x === "series") return "tv";
  return "movie";
}

/** Library + images API expect `"Movie"` | `"Series"`. */
export function nomineeMediaTypeLabel(raw: string): "Movie" | "Series" {
  return nomineeMediaKind(raw) === "tv" ? "Series" : "Movie";
}

export function tmdbWebPath(kind: NomineeMediaKind, tmdbId: number) {
  return kind === "tv" ? `https://www.themoviedb.org/tv/${tmdbId}` : `https://www.themoviedb.org/movie/${tmdbId}`;
}
