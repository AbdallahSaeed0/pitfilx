import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { startPlaybackPolEventListener } from "./playback/playbackPolListener";
import { getSettings } from "./api/settings";
import { MainLayout } from "./components/layout/MainLayout";
import { SetupWizard } from "./components/setup/SetupWizard";
import { Spinner } from "./components/ui/Spinner";
import { HomePage } from "./pages/HomePage";
import { MoviesPage } from "./pages/MoviesPage";
import { SeriesPage } from "./pages/SeriesPage";
import { MovieDetailPage, ShowDetailPage } from "./pages/DetailPage";
import { UnmatchedPage } from "./pages/UnmatchedPage";
import { SettingsPage } from "./pages/SettingsPage";
import { MyListsPage } from "./pages/MyListsPage";
import { ListDetailPage } from "./pages/ListDetailPage";
import { PersonPage } from "./pages/PersonPage";
import { StatsPage } from "./pages/StatsPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";
import { AwardsPage } from "./pages/AwardsPage";
import { AwardHubPage } from "./pages/AwardHubPage";
import { AwardEditionPage } from "./pages/AwardEditionPage";
import { SeasonDetailPage } from "./pages/SeasonDetailPage";
import { TrailersPage } from "./pages/TrailersPage";
import { NextEpisodesPage } from "./pages/NextEpisodesPage";
import { PlayerPage } from "./pages/PlayerPage";

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
  const { data, isLoading, isError } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 15_000,
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
          Start the API (desktop app starts it automatically) or check your connection on port 5001.
        </p>
      </div>
    );

  if (!data.setupComplete) return <SetupWizard />;

  return (
    <BrowserRouter>
      <PlaybackPolListenerHost />
      <Routes>
        <Route path="/player" element={<PlayerPage />} />
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
          <Route path="next-episodes" element={<NextEpisodesPage />} />
          <Route path="awards" element={<AwardsPage />} />
          <Route path="awards/:awardId/:year" element={<AwardEditionPage />} />
          <Route path="awards/:awardId" element={<AwardHubPage />} />
          <Route path="unmatched" element={<UnmatchedPage />} />
          <Route path="lists" element={<MyListsPage />} />
          <Route path="lists/:id" element={<ListDetailPage />} />
          <Route path="stats" element={<StatsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="person/:tmdbId" element={<PersonPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
