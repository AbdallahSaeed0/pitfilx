import api from "./client";
import type { MediaCard } from "../types/media";

export type BrowseResult = { items: MediaCard[]; total: number };

export const browseByDecade = (decade: number, mediaType = "all") =>
  api
    .get<BrowseResult & { decade: number }>("/library/browse/decade", {
      params: { decade, mediaType },
    })
    .then((r) => r.data);

export const browseByKeyword = (keyword: string, mediaType = "all") =>
  api
    .get<BrowseResult & { keyword: string }>("/library/browse/keyword", {
      params: { keyword, mediaType },
    })
    .then((r) => r.data);

export type CollectionPart = {
  tmdbId: number;
  title: string;
  posterUrl: string | null;
  releaseDate: string | null;
  year: string | null;
  voteAverage: number;
};

export type StreamCollection = {
  id: number;
  name: string;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  parts: CollectionPart[];
};

export const getStreamCollection = (collectionId: number) =>
  api
    .get<StreamCollection>(`/stream/collection/${collectionId}`)
    .then((r) => r.data);
