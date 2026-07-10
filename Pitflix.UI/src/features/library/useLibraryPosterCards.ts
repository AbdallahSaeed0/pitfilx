import { useMemo } from "react";
import type { MediaCard } from "../../types/media";
import { lookupImdbRating, useImdbRatingsMap } from "../../hooks/useImdbRatingsMap";
import { useMediaContextMenu, type LibraryContextTarget } from "./useMediaContextMenu";

export function mediaTypeOf(card: MediaCard): "Movie" | "Series" {
  return card.tmdbMediaType === "Series" ? "Series" : "Movie";
}

export function libraryContextTarget(card: MediaCard): LibraryContextTarget {
  const mt = mediaTypeOf(card);
  return {
    kind: mt === "Movie" ? "movie" : "series",
    libraryId: card.id,
    tmdbId: card.tmdbId,
    title: card.title,
    watchStatus: card.watchStatus,
  };
}

/** IMDb ratings + right-click context menu for library poster grids. */
export function useLibraryPosterCards(items: MediaCard[]) {
  const ratingsInput = useMemo(
    () => items.filter((i) => i.tmdbId > 0).map((i) => ({ tmdbId: i.tmdbId, mediaType: mediaTypeOf(i) })),
    [items],
  );
  const imdbMap = useImdbRatingsMap(ratingsInput);
  const { menu, closeMenu, handleContextMenu, runAction } = useMediaContextMenu();

  const cardExtras = (item: MediaCard) => ({
    mediaType: mediaTypeOf(item),
    imdbRating: lookupImdbRating(imdbMap, item.tmdbId, mediaTypeOf(item)),
    onContextMenu: handleContextMenu(libraryContextTarget(item)),
  });

  return { menu, closeMenu, runAction, cardExtras, imdbMap };
}
