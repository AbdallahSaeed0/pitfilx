import type { HomeSectionConfig } from "../../types/homeSection";

const meta = {
  showTitle: true,
  showYear: true,
  showRating: true,
  showGenres: false,
  showLang: true,
  showWatchBadge: true,
};

/** Built-in TMDB-driven rows merged into saved layouts when missing (persisted order survives across versions). */
export const DEFAULT_HOME_SPECIAL_SECTIONS: HomeSectionConfig[] = [
  {
    id: "home_coming_soon",
    title: "Coming soon",
    subtitle: "Upcoming releases only — future dates",
    enabled: true,
    order: -3,
    sourceType: "coming_soon",
    layoutStyle: "poster-row",
  },
  {
    id: "home_next_episodes",
    title: "Next episodes",
    subtitle: "From your library — air dates ahead",
    enabled: true,
    order: -2,
    sourceType: "next_episodes",
    layoutStyle: "poster-row",
  },
  {
    id: "home_upcoming_trailers",
    title: "Upcoming trailers",
    subtitle: "Trending upcoming movies & series with a trailer",
    enabled: true,
    order: -1,
    sourceType: "upcoming_trending_trailers",
    layoutStyle: "poster-row",
  },
];

const DEFAULT_HOME_LIBRARY_SECTIONS: HomeSectionConfig[] = [
  {
    id: "continue",
    title: "Continue Watching",
    subtitle: "Pick up where you left off",
    enabled: true,
    order: 0,
    sourceType: "continue_watching",
    layoutStyle: "poster-row",
    limit: 20,
    cardVariant: "default",
    metadata: meta,
  },
  {
    id: "recent",
    title: "Recently Added",
    subtitle: "Newest titles in your library",
    enabled: true,
    order: 1,
    sourceType: "recently_added",
    mediaType: "all",
    sortBy: "dateadded",
    limit: 24,
    layoutStyle: "poster-row",
    cardVariant: "default",
    metadata: meta,
  },
  {
    id: "top_rated",
    title: "Top Rated in Your Library",
    subtitle: "Highest audience scores you own",
    enabled: true,
    order: 2,
    sourceType: "top_rated",
    mediaType: "all",
    limit: 8,
    layoutStyle: "grid",
    cardVariant: "default",
    metadata: { ...meta, showGenres: true },
  },
  {
    id: "unfinished",
    title: "Unfinished Series",
    subtitle: "Shows still in progress",
    enabled: true,
    order: 3,
    sourceType: "unfinished_series",
    mediaType: "series",
    limit: 20,
    layoutStyle: "poster-row",
    cardVariant: "compact",
    metadata: meta,
  },
  {
    id: "movie_night",
    title: "Movie Night",
    subtitle: "Shuffle-friendly picks for tonight",
    enabled: true,
    order: 4,
    sourceType: "movie_night",
    mediaType: "movie",
    limit: 10,
    layoutStyle: "landscape-row",
    cardVariant: "landscape",
    metadata: { ...meta, showGenres: true },
  },
  {
    id: "genre_spotlight",
    title: "Genre Spotlight",
    subtitle: "A rotating slice of one genre",
    enabled: true,
    order: 5,
    sourceType: "genre_spotlight",
    mediaType: "all",
    limit: 16,
    layoutStyle: "ranked-row",
    cardVariant: "ranked",
    metadata: meta,
  },
  {
    id: "hidden_gems",
    title: "Hidden Gems",
    subtitle: "Highly rated titles you have not started",
    enabled: true,
    order: 6,
    sourceType: "hidden_gems",
    mediaType: "all",
    limit: 12,
    sortBy: "rating",
    layoutStyle: "poster-row",
    cardVariant: "default",
    metadata: { ...meta, showGenres: true },
  },
  {
    id: "favorites_spotlight",
    title: "Favorites",
    subtitle: "From your ❤️ Favorites list",
    enabled: true,
    order: 7,
    sourceType: "favorites_list",
    mediaType: "all",
    limit: 20,
    layoutStyle: "poster-row",
    cardVariant: "default",
    metadata: meta,
  },
];

/** Full default home page (special rows + library sections). Used for layout merge and first-run API fallback. */
export const DEFAULT_HOME_SECTIONS: HomeSectionConfig[] = [
  ...DEFAULT_HOME_SPECIAL_SECTIONS,
  ...DEFAULT_HOME_LIBRARY_SECTIONS,
];

export function mergeHomeLayoutWithDefaults(saved: HomeSectionConfig[]): HomeSectionConfig[] {
  const merged: HomeSectionConfig[] = [];
  for (const row of DEFAULT_HOME_SECTIONS) {
    const o = saved.find((s) => s.id === row.id);
    if (!o) {
      merged.push(row);
      continue;
    }
    merged.push({
      ...row,
      ...o,
      id: row.id,
      sourceType: row.sourceType,
    });
  }
  for (const s of saved) {
    if (!DEFAULT_HOME_SECTIONS.some((c) => c.id === s.id)) merged.push(s);
  }
  return normalizeSectionOrders(merged);
}

export function normalizeSectionOrders(sections: HomeSectionConfig[]): HomeSectionConfig[] {
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({ ...s, order: i }));
}
