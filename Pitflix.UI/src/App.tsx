import { lazy, Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { startPlaybackPolEventListener } from "./playback/playbackPolListener";
import { getSettings } from "./api/settings";
import { MainLayout } from "./components/layout/MainLayout";
import { PitflixConfirmHost } from "./components/layout/PitflixConfirmHost";
import { SetupWizard } from "./components/setup/SetupWizard";
import { Spinner } from "./components/ui/Spinner";
import { HomePage } from "./pages/HomePage";
import { MoviesPage } from "./pages/MoviesPage";
import { SeriesPage } from "./pages/SeriesPage";
import { PlaylistPopoutPage } from "./pages/PlaylistPopoutPage";
import { BackgroundTasksProvider } from "./context/BackgroundTasksContext";
import { GitHubUpdaterProvider } from "./context/GitHubUpdaterContext";
import { GitHubUpdaterHost } from "./components/updater/GitHubUpdaterHost";
import { NowPlayingBar } from "./components/NowPlayingBar";

const PlayerPage = lazy(() => import("./pages/PlayerPage").then((m) => ({ default: m.PlayerPage })));
const MovieDetailPage = lazy(() => import("./pages/DetailPage").then((m) => ({ default: m.MovieDetailPage })));
const ShowDetailPage = lazy(() => import("./pages/DetailPage").then((m) => ({ default: m.ShowDetailPage })));
const UnmatchedPage = lazy(() => import("./pages/UnmatchedPage").then((m) => ({ default: m.UnmatchedPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const MyListsPage = lazy(() => import("./pages/MyListsPage").then((m) => ({ default: m.MyListsPage })));
const MyDevicePage = lazy(() => import("./pages/MyDevicePage").then((m) => ({ default: m.MyDevicePage })));
const ListDetailPage = lazy(() => import("./pages/ListDetailPage").then((m) => ({ default: m.ListDetailPage })));
const PersonPage = lazy(() => import("./pages/PersonPage").then((m) => ({ default: m.PersonPage })));
const StatsPage = lazy(() => import("./pages/StatsPage").then((m) => ({ default: m.StatsPage })));
const RecommendationsPage = lazy(() =>
  import("./pages/RecommendationsPage").then((m) => ({ default: m.RecommendationsPage })),
);
const AwardsPage = lazy(() => import("./pages/AwardsPage").then((m) => ({ default: m.AwardsPage })));
const AwardHubPage = lazy(() => import("./pages/AwardHubPage").then((m) => ({ default: m.AwardHubPage })));
const AwardEditionPage = lazy(() => import("./pages/AwardEditionPage").then((m) => ({ default: m.AwardEditionPage })));
const SeasonDetailPage = lazy(() => import("./pages/SeasonDetailPage").then((m) => ({ default: m.SeasonDetailPage })));
const TrailersPage = lazy(() => import("./pages/TrailersPage").then((m) => ({ default: m.TrailersPage })));
const NextEpisodesPage = lazy(() => import("./pages/NextEpisodesPage").then((m) => ({ default: m.NextEpisodesPage })));
const RemotePlayerPage = lazy(() => import("./pages/RemotePlayerPage").then((m) => ({ default: m.RemotePlayerPage })));
const OnlineStreamPage = lazy(() => import("./pages/OnlineStreamPage").then((m) => ({ default: m.OnlineStreamPage })));
const StreamPlayerPage = lazy(() => import("./pages/StreamPlayerPage").then((m) => ({ default: m.StreamPlayerPage })));
const StreamingDetailsPage = lazy(() =>
  import("./pages/StreamingDetailsPage").then((m) => ({ default: m.StreamingDetailsPage })),
);
const GenreBrowsePage = lazy(() => import("./pages/GenreBrowsePage").then((m) => ({ default: m.GenreBrowsePage })));
const AllCategoriesPage = lazy(() => import("./pages/AllCategoriesPage").then((m) => ({ default: m.AllCategoriesPage })));
const DecadeBrowsePage = lazy(() => import("./pages/DecadeBrowsePage").then((m) => ({ default: m.DecadeBrowsePage })));
const KeywordBrowsePage = lazy(() => import("./pages/KeywordBrowsePage").then((m) => ({ default: m.KeywordBrowsePage })));
const StreamingCollectionPage = lazy(() =>
  import("./pages/StreamingCollectionPage").then((m) => ({ default: m.StreamingCollectionPage })),
);
const StreamSeasonPage = lazy(() => import("./pages/StreamSeasonPage").then((m) => ({ default: m.StreamSeasonPage })));
const DuplicatesPage = lazy(() => import("./pages/DuplicatesPage").then((m) => ({ default: m.DuplicatesPage })));
const LivePage = lazy(() => import("./pages/LivePage").then((m) => ({ default: m.LivePage })));
const TvTimeReviewPage = lazy(() =>
  import("./pages/TvTimeReviewPage").then((m) => ({ default: m.TvTimeReviewPage })),
); // TEMPORARY -- remove once the TV Time import review is done
const BrowsePage = lazy(() => import("./pages/Browse/BrowsePage").then((m) => ({ default: m.BrowsePage })));

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner />
    </div>
  );
}

function PlaybackPolListenerHost() {
  useEffect(() => startPlaybackPolEventListener(), []);
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
    retry: 2,
  });

  if (isLoading && !data)
    return (
      <div className="flex min-h-screen items-center justify-center bg-pitflix-bg">
        <Spinner />
      </div>
    );

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
