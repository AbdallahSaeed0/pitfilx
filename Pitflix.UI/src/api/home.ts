import api from "./client";
import type { MediaCard } from "../types/media";

export const getHomeTopRated = () =>
  api.get<MediaCard[]>("/home/top-rated").then((r) => r.data);

export const getHomeArabicPicks = () =>
  api.get<MediaCard[]>("/home/arabic-picks").then((r) => r.data);

export const getHomeBingeSeries = () =>
  api.get<MediaCard[]>("/home/binge-series").then((r) => r.data);

export const getHomeMovieNight = () =>
  api.get<MediaCard[]>("/home/movie-night").then((r) => r.data);
