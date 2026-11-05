import { lazy, type ComponentType, type LazyExoticComponent } from "react";

type Loader = () => Promise<{ default: ComponentType<unknown> }>;

/** A `React.lazy` component that can also be fetched ahead of time, before anything renders it. */
export type PreloadableComponent = LazyExoticComponent<ComponentType<unknown>> & {
  preload: Loader;
};

/** Every page loader, so we can warm them on idle instead of waiting for a click. */
const allLoaders: Loader[] = [];

function lazyPage(loader: Loader): PreloadableComponent {
  // React.lazy already caches the promise, so repeat calls are free after the first.
  const component = lazy(loader) as PreloadableComponent;
  component.preload = loader;
  allLoaders.push(loader);
  return component;
}

// Rendered by PersistentPlayerHost (not a route element); kept here so it is warmed on idle too.
export const PlayerPage = lazyPage(() => import("../pages/PlayerPage").then((m) => ({ default: m.PlayerPage as ComponentType<unknown> })));
export const MovieDetailPage = lazyPage(() => import("../pages/DetailPage").then((m) => ({ default: m.MovieDetailPage })));
export const ShowDetailPage = lazyPage(() => import("../pages/DetailPage").then((m) => ({ default: m.ShowDetailPage })));
export const UnmatchedPage = lazyPage(() => import("../pages/UnmatchedPage").then((m) => ({ default: m.UnmatchedPage })));
export const SettingsPage = lazyPage(() => import("../pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
export const MyListsPage = lazyPage(() => import("../pages/MyListsPage").then((m) => ({ default: m.MyListsPage })));
export const MyDevicePage = lazyPage(() => import("../pages/MyDevicePage").then((m) => ({ default: m.MyDevicePage })));
export const ListDetailPage = lazyPage(() => import("../pages/ListDetailPage").then((m) => ({ default: m.ListDetailPage })));
export const PersonPage = lazyPage(() => import("../pages/PersonPage").then((m) => ({ default: m.PersonPage })));
export const StatsPage = lazyPage(() => import("../pages/StatsPage").then((m) => ({ default: m.StatsPage })));
export const RecommendationsPage = lazyPage(() =>
  import("../pages/RecommendationsPage").then((m) => ({ default: m.RecommendationsPage })),
);
export const AwardsPage = lazyPage(() => import("../pages/AwardsPage").then((m) => ({ default: m.AwardsPage })));
export const AwardHubPage = lazyPage(() => import("../pages/AwardHubPage").then((m) => ({ default: m.AwardHubPage })));
export const AwardEditionPage = lazyPage(() => import("../pages/AwardEditionPage").then((m) => ({ default: m.AwardEditionPage })));
export const SeasonDetailPage = lazyPage(() => import("../pages/SeasonDetailPage").then((m) => ({ default: m.SeasonDetailPage })));
export const TrailersPage = lazyPage(() => import("../pages/TrailersPage").then((m) => ({ default: m.TrailersPage })));
export const NextEpisodesPage = lazyPage(() => import("../pages/NextEpisodesPage").then((m) => ({ default: m.NextEpisodesPage })));
export const RemotePlayerPage = lazyPage(() => import("../pages/RemotePlayerPage").then((m) => ({ default: m.RemotePlayerPage })));
export const OnlineStreamPage = lazyPage(() => import("../pages/OnlineStreamPage").then((m) => ({ default: m.OnlineStreamPage })));
export const StreamPlayerPage = lazyPage(() => import("../pages/StreamPlayerPage").then((m) => ({ default: m.StreamPlayerPage })));
export const StreamingDetailsPage = lazyPage(() =>
  import("../pages/StreamingDetailsPage").then((m) => ({ default: m.StreamingDetailsPage })),
);
export const GenreBrowsePage = lazyPage(() => import("../pages/GenreBrowsePage").then((m) => ({ default: m.GenreBrowsePage })));
export const AllCategoriesPage = lazyPage(() => import("../pages/AllCategoriesPage").then((m) => ({ default: m.AllCategoriesPage })));
export const DecadeBrowsePage = lazyPage(() => import("../pages/DecadeBrowsePage").then((m) => ({ default: m.DecadeBrowsePage })));
export const KeywordBrowsePage = lazyPage(() => import("../pages/KeywordBrowsePage").then((m) => ({ default: m.KeywordBrowsePage })));
export const StreamingCollectionPage = lazyPage(() =>
  import("../pages/StreamingCollectionPage").then((m) => ({ default: m.StreamingCollectionPage })),
);
export const StreamStudioPage = lazyPage(() =>
  import("../pages/StreamStudioPage").then((m) => ({ default: m.StreamStudioPage })),
);
export const StreamGenrePage = lazyPage(() =>
  import("../pages/StreamGenrePage").then((m) => ({ default: m.StreamGenrePage })),
);
export const StreamSeasonPage = lazyPage(() => import("../pages/StreamSeasonPage").then((m) => ({ default: m.StreamSeasonPage })));
export const DuplicatesPage = lazyPage(() => import("../pages/DuplicatesPage").then((m) => ({ default: m.DuplicatesPage })));
export const LivePage = lazyPage(() => import("../pages/LivePage").then((m) => ({ default: m.LivePage })));
export const TvTimeReviewPage = lazyPage(() =>
  import("../pages/TvTimeReviewPage").then((m) => ({ default: m.TvTimeReviewPage })),
); // TEMPORARY -- remove once the TV Time import review is done
export const BrowsePage = lazyPage(() => import("../pages/Browse/BrowsePage").then((m) => ({ default: m.BrowsePage })));
export const CinemasSchedulePage = lazyPage(() =>
  import("../pages/CinemasSchedulePage").then((m) => ({ default: m.CinemasSchedulePage })),
);

/**
 * Static nav destinations → their page chunk. Hovering a nav item warms the chunk so the click
 * itself has nothing left to download. `/`, `/movies` and `/series` are eagerly imported by
 * App.tsx, so they have nothing to warm and are absent here.
 */
const PATH_LOADERS: Record<string, Loader> = {
  "/recommendations": RecommendationsPage.preload,
  "/trailers": TrailersPage.preload,
  "/online-stream": OnlineStreamPage.preload,
  "/browse": BrowsePage.preload,
  "/cinemas": CinemasSchedulePage.preload,
  "/live": LivePage.preload,
  "/next-episodes": NextEpisodesPage.preload,
  "/awards": AwardsPage.preload,
  "/unmatched": UnmatchedPage.preload,
  "/lists": MyListsPage.preload,
  "/my-device": MyDevicePage.preload,
  "/stats": StatsPage.preload,
  "/settings": SettingsPage.preload,
};

/** Warm the chunk behind a nav destination. Safe to call repeatedly and on every hover. */
export function preloadRoute(path: string) {
  void PATH_LOADERS[path]?.().catch(() => {
    /* best-effort — the real navigation will surface any genuine load error */
  });
}

let idleWarmStarted = false;

/** Let the initial render and its first burst of poster traffic finish before we start. */
const WARM_START_DELAY_MS = 1_200;
/** Gap between chunks, so warming stays in the background rather than saturating the connection. */
const WARM_STEP_DELAY_MS = 120;

/**
 * Fetches every page chunk shortly after startup, so the first visit to a page doesn't pay for its
 * code and the Suspense fallback never gets a chance to appear.
 *
 * Deliberately plain timers rather than `requestIdleCallback`: idle callbacks don't fire at all
 * while the window is hidden, which would leave a minimised app permanently un-warmed — exactly
 * the state it's most likely to be in before the user comes back and starts clicking around.
 */
export function warmAllRoutesWhenIdle() {
  if (idleWarmStarted) return;
  idleWarmStarted = true;

  let i = 0;
  const next = () => {
    if (i >= allLoaders.length) return;
    const loader = allLoaders[i++];
    void loader()
      .catch(() => {
        /* best-effort — a real navigation will surface any genuine load error */
      })
      .finally(() => setTimeout(next, WARM_STEP_DELAY_MS));
  };

  setTimeout(next, WARM_START_DELAY_MS);
}
