import { Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { startPlaybackPolEventListener } from "./playback/playbackPolListener";
import { OpenFileListenerHost } from "./features/playback/OpenFileListenerHost";
import { FolderActionListenerHost } from "./features/playback/FolderActionListenerHost";
import { FollowedAirDateWatcher } from "./features/nextEpisodes/FollowedAirDateWatcher";
import { NewTrailerWatcher } from "./features/nextEpisodes/NewTrailerWatcher";
import { getSettings } from "./api/settings";
import { MainLayout } from "./components/layout/MainLayout";
import { PitflixConfirmHost } from "./components/layout/PitflixConfirmHost";
import { Sidebar } from "./components/layout/Sidebar";
import { TitleBar } from "./components/layout/TitleBar";
import { SetupWizard } from "./components/setup/SetupWizard";
import { Spinner } from "./components/ui/Spinner";
import { useAppPrefsStore } from "./store/appPrefsStore";
import { HomePage } from "./pages/HomePage";
import { MoviesPage } from "./pages/MoviesPage";
import { SeriesPage } from "./pages/SeriesPage";
import { PlaylistPopoutPage } from "./pages/PlaylistPopoutPage";
import { BackgroundTasksProvider } from "./context/BackgroundTasksContext";
import { GitHubUpdaterProvider } from "./context/GitHubUpdaterContext";
import { GitHubUpdaterHost } from "./components/updater/GitHubUpdaterHost";
import { NowPlayingBar } from "./components/NowPlayingBar";

import {
  AllCategoriesPage,
  AwardEditionPage,
  AwardHubPage,
  AwardsPage,
  BrowsePage,
  DecadeBrowsePage,
  DuplicatesPage,
  GenreBrowsePage,
  KeywordBrowsePage,
  ListDetailPage,
  LivePage,
  MovieDetailPage,
  MyDevicePage,
  MyListsPage,
  NextEpisodesPage,
  OnlineStreamPage,
  PersonPage,
  PlayerPage,
  RecommendationsPage,
  RemotePlayerPage,
  SeasonDetailPage,
  SettingsPage,
  ShowDetailPage,
  StatsPage,
  StreamingCollectionPage,
  StreamingDetailsPage,
  StreamPlayerPage,
  StreamGenrePage,
  StreamSeasonPage,
  StreamStudioPage,
  TrailersPage,
  TvTimeReviewPage,
  UnmatchedPage,
  warmAllRoutesWhenIdle,
} from "./routes/lazyPages";

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner />
    </div>
  );
}

/**
 * Shown while the initial `getSettings()` call is still connecting to the API sidecar on cold
 * launch (see the retry/retryDelay comment on that query below). The sidebar and title bar don't
 * actually need settings data to render — Sidebar fetches its own stats independently and just
 * shows 0s until they resolve, same as it would on any other slow network — so there's no reason
 * to hide them behind a bare full-screen spinner for the ~2-5s the API takes to come up. Only the
 * routed page content (which genuinely can't render without knowing what to show) waits.
 * Sidebar-layout only for now — topDock/floatingDock still fall back to the plain spinner below.
 */
function BootShell() {
  const navLayout = useAppPrefsStore((s) => s.navLayout);
  if (navLayout !== "sidebar") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-pitflix-bg">
        <Spinner />
      </div>
    );
  }
  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden bg-pitflix-bg">
        <TitleBar />
        <Sidebar />
        <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pb-6 pt-12">
          <Spinner />
        </main>
      </div>
    </BrowserRouter>
  );
}

function PlaybackPolListenerHost() {
  useEffect(() => startPlaybackPolEventListener(), []);
  return null;
}

/** Pulls every page chunk down on idle so opening a page never waits on its code. */
function RouteWarmHost() {
  useEffect(() => warmAllRoutesWhenIdle(), []);
  return null;
}

function LegacyShowRedirect() {
  const { id } = useParams();
  if (!id) return <Navigate to="/series" replace />;
  return <Navigate to={`/series/${id}`} replace />;
}

function App() {
  // Popout windows (e.g. the docked playlist) share the same React bundle but
  // shouldn't boot the full provider chain or wait on the settings query.
  if (
    typeof window !== "undefined" &&
    window.location.pathname === "/playlist-popout"
  ) {
    return (
      <div className="min-h-screen bg-pitflix-bg text-white">
        <PlaylistPopoutPage />
      </div>
    );
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 120_000,
    // This query doubles as the API-sidecar readiness probe on cold launch (see lib.rs — Tauri's
    // window paints immediately and leaves waiting for the API up to the frontend). The sidecar's
    // own cold start is ~2.1-2.5s, so early attempts here are *expected* connection-refused
    // failures, not real errors. React Query's default backoff (1s, then 2s) actively worked
    // against that: it jumps from the 1s retry straight to the 3s one, so it almost always missed
    // the ~2.5s window the API becomes reachable in and made the user wait for the 3s mark instead.
    // Poll fast and constantly so the app connects within ~200ms of the API actually being ready.
    retry: 25,
    retryDelay: 200,
  });

  if (isLoading && !data) return <BootShell />;

  if (isError || !data)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-pitflix-bg px-6 text-center">
        <p className="text-sm font-medium text-white">Could not reach Pitflix</p>
        <p className="max-w-sm text-xs text-pitflix-subtle">
          Start the API (desktop app starts it automatically) or check your connection on port 5280.
        </p>
      </div>
    );

  if (!data.setupComplete) return <SetupWizard />;

  return (
    <BrowserRouter>
      <PlaybackPolListenerHost />
      <OpenFileListenerHost />
      <FolderActionListenerHost />
      <FollowedAirDateWatcher />
      <NewTrailerWatcher />
      <RouteWarmHost />
      <PitflixConfirmHost />
      <GitHubUpdaterProvider>
        <GitHubUpdaterHost />
      <BackgroundTasksProvider>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
        <Route path="/player" element={<PlayerPage />} />
        <Route path="/playlist-popout" element={<PlaylistPopoutPage />} />
        <Route path="/player-remote" element={<RemotePlayerPage />} />
        <Route path="/stream-player" element={<StreamPlayerPage />} />
        <Route element={<MainLayout />}>
          <Route index element={<HomePage />} />
          <Route path="movies" element={<MoviesPage />} />
          <Route path="series" element={<SeriesPage />} />
          <Route path="series/:id/season/:seasonNumber" element={<SeasonDetailPage />} />
          <Route path="series/:id" element={<ShowDetailPage />} />
          <Route path="movie/:id" element={<MovieDetailPage />} />
          <Route path="show/:id" element={<LegacyShowRedirect />} />
          <Route path="recommendations" element={<RecommendationsPage />} />
          <Route path="trailers" element={<TrailersPage />} />
          <Route path="online-stream" element={<OnlineStreamPage />} />
          <Route path="browse" element={<BrowsePage />} />
          <Route path="stream-details" element={<StreamingDetailsPage />} />
          <Route path="stream-season" element={<StreamSeasonPage />} />
          <Route path="next-episodes" element={<NextEpisodesPage />} />
          <Route path="awards" element={<AwardsPage />} />
          <Route path="awards/:awardId/:year" element={<AwardEditionPage />} />
          <Route path="awards/:awardId" element={<AwardHubPage />} />
          <Route path="unmatched" element={<UnmatchedPage />} />
          <Route path="tvtime-review" element={<TvTimeReviewPage />} />
          <Route path="lists" element={<MyListsPage />} />
          <Route path="my-device" element={<MyDevicePage />} />
          <Route path="lists/:id" element={<ListDetailPage />} />
          <Route path="stats" element={<StatsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="person/:tmdbId" element={<PersonPage />} />
          <Route path="genre/:genreName" element={<GenreBrowsePage />} />
          <Route path="browse/decade/:decade" element={<DecadeBrowsePage />} />
          <Route path="browse/keyword/:keyword" element={<KeywordBrowsePage />} />
          <Route path="stream-collection" element={<StreamingCollectionPage />} />
          <Route path="stream-studio" element={<StreamStudioPage />} />
          <Route path="stream-genre" element={<StreamGenrePage />} />
          <Route path="categories" element={<AllCategoriesPage />} />
          <Route path="duplicates" element={<DuplicatesPage />} />
          <Route path="live" element={<LivePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        </Routes>
        </Suspense>
      </BackgroundTasksProvider>
      </GitHubUpdaterProvider>
      <NowPlayingBar />
    </BrowserRouter>
  );
}

export default App;
