import api from "./client";
import type { HomeSectionConfig, HomeSectionQueryBody, FeaturedFallbackResponse } from "../types/homeSection";
import type { MediaCard } from "../types/media";
import { mergeHomeLayoutWithDefaults, normalizeSectionOrders } from "../features/home/defaultHomeLayout";

function coerceSavedRows(data: unknown): HomeSectionConfig[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (x): x is HomeSectionConfig =>
      typeof x === "object" &&
      x !== null &&
      "id" in x &&
      "sourceType" in x &&
      typeof (x as HomeSectionConfig).id === "string",
  ) as HomeSectionConfig[];
}

export async function fetchHomeLayout(): Promise<HomeSectionConfig[]> {
  try {
    const { data } = await api.get<unknown>("/home/layout");
    const rows = coerceSavedRows(data);
    return normalizeSectionOrders(mergeHomeLayoutWithDefaults(rows));
  } catch {
    return normalizeSectionOrders(mergeHomeLayoutWithDefaults([]));
  }
}

export async function saveHomeLayout(sections: HomeSectionConfig[]): Promise<void> {
  const normalized = normalizeSectionOrders(sections);
  await api.post("/home/layout", normalized);
}

export async function postHomeSectionQuery(body: HomeSectionQueryBody): Promise<MediaCard[]> {
  const { data } = await api.post<MediaCard[]>("/home/section/query", body);
  return Array.isArray(data) ? data : [];
}

export async function fetchFeaturedFallback(): Promise<MediaCard | null> {
  const { data } = await api.get<FeaturedFallbackResponse>("/home/featured-fallback");
  return data?.card ?? null;
}
