import type { HomeSectionConfig, HomeSectionQueryBody, HomeSourceType } from "../../types/homeSection";

function mapLanguageCategory(f: HomeSectionConfig["filters"]): string {
  const cats = f?.categories ?? f?.languages ?? [];
  const lower = cats.map((c) => c.toLowerCase());
  if (lower.includes("arabic") || lower.includes("ar")) return "ar";
  if (lower.includes("english") || lower.includes("en")) return "en";
  return "all";
}

function mapWatchFilter(f: HomeSectionConfig["filters"]): string {
  const w = f?.watched ?? "all";
  if (w === "watched") return "watched";
  return w;
}

function backendSourceType(st: HomeSourceType): string {
  switch (st) {
    case "top_rated":
    case "top_rated_library":
      return "top_rated_library";
    case "favorites_list":
      return "favorites";
    default:
      return st;
  }
}

export function sectionToQueryBody(
  section: HomeSectionConfig,
  shuffleSeed?: number | null,
): HomeSectionQueryBody {
  const f = section.filters;
  const limit = Math.max(1, section.limit ?? 20);
  const genres = f?.genres?.filter(Boolean) ?? [];
  const tags = f?.tags?.filter(Boolean) ?? [];

  return {
    sourceType: backendSourceType(section.sourceType),
    mediaType: section.mediaType ?? "all",
    limit,
    sortBy: section.sortBy ?? "dateadded",
    shuffleSeed: shuffleSeed ?? null,
    genres,
    languageCategory: mapLanguageCategory(f),
    watchFilter: mapWatchFilter(f),
    minRating: f?.minRating ?? null,
    minRuntimeMinutes: f?.runtimeMin ?? null,
    maxRuntimeMinutes: f?.runtimeMax ?? null,
    yearFrom: f?.yearFrom ?? null,
    yearTo: f?.yearTo ?? null,
    tags,
    listId: f?.customListId ?? null,
    spotlightGenre: f?.spotlightGenre?.trim() || null,
  };
}

export function sectionQueryKey(section: HomeSectionConfig, shuffleSeed?: number | null) {
  return [
    "home-section",
    section.id,
    section.sourceType,
    section.limit,
    section.sortBy,
    section.mediaType,
    shuffleSeed ?? null,
    JSON.stringify(section.filters ?? {}),
  ] as const;
}
