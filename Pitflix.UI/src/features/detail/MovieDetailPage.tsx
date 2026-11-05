import { isTauri } from "@tauri-apps/api/core";
import { AmbientBackdrop, HeroBackdrop } from "../../components/detail/CinematicBackdrop";
import { ArrowLeft, ArrowRight, Check, FolderOpen, ImageIcon, Play, RefreshCw, RotateCcw, Star, Subtitles } from "lucide-react";
import { getRatingsAggregate, queueRatingsStaleSweep } from "../../api/ratings";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getMovie, getMovieVideos, type MediaVideoItem } from "../../api/movies";
import { getStreamImdbId } from "../../api/stream";
import { DetailToolbar } from "../../components/DetailToolbar";
import { ParentsGuideSection } from "../../components/ParentsGuideSection";
import { SubtitleDrawer } from "../../components/SubtitleDrawer";
import { useResumeBeforePlay } from "../../hooks/useResumeBeforePlay";
import { useLongPress } from "../../hooks/useLongPress";
import { PosterPickerModal } from "../../components/PosterPickerModal";
import { HorizontalDragScroll } from "../../components/ui/HorizontalDragScroll";
import { Lightbox } from "../../components/ui/Lightbox";
import { MediaImage } from "../../components/ui/MediaImage";
import { RewatchPopover } from "../../components/ui/RewatchPopover";
import { DetailSkeleton } from "../../components/ui/Skeleton";
import { setMovieRewatchCount } from "../../api/watch";
import type { MediaCard } from "../../types/media";
import { formatRating, formatYear } from "../../utils/format";
import { toPosterSrc } from "../../utils/posterSrc";
import { RatingsPanel } from "../../components/RatingsPanel";
import { MediaContextMenu } from "../library/MediaContextMenu";
import { useMediaContextMenu } from "../library/useMediaContextMenu";
import { useAppPrefsStore } from "../../store/appPrefsStore";
import { CinematicDetailLayout } from "./layouts/CinematicDetailLayout";
import { DossierDetailLayout } from "./layouts/DossierDetailLayout";
import type { DetailViewModel } from "./layouts/types";
import {
  CastCrewSection,
  ContentRatingBadge,
  CrewMember,
  detailHeroPosterClass,
  DetailHeroTitle,
  HeroActionIcons,
  openFolder,
  parentDir,
  TitleAwardsSection,
  TrailerButton,
  VideoExtrasSection,
} from "./detailComponents";

export function MovieDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { requestPlay, ResumePromptModal } = useResumeBeforePlay();
  const [showArtworkPicker, setShowArtworkPicker] = useState(false);
  const [showPosterLightbox, setShowPosterLightbox] = useState(false);
  const [subtitlesOpen, setSubtitlesOpen] = useState(false);
  const [showRewatchPopover, setShowRewatchPopover] = useState(false);
  const watchAgainButtonRef = useRef<HTMLButtonElement>(null);
  const mid = Number(id);
  const detailLayout = useAppPrefsStore((s) => s.detailLayout);
  const [ratingRefreshing, setRatingRefreshing] = useState(false);
  const { menu, closeMenu, handleContextMenu, runAction } = useMediaContextMenu();
  // Declared before any early return below (rules of hooks) — the callback
  // guards on `data` internally since `movie`/`durationSeconds` aren't derived
  // until after the loading check.
  const watchAgainLongPress = useLongPress(
    () => setShowRewatchPopover(true),
    () => {
      const m = data?.movie as
        | (MediaCard & { runtime?: number })
        | undefined;
      if (!m) return;
      const duration = (m.runtime ?? 0) > 0 ? (m.runtime as number) * 60 : 0;
      void requestPlay({
        filePath: m.mediaFilePath || m.filePath || "",
        title: m.title,
        posterPath: m.selectedPosterPath || m.posterLocalPath || null,
        mediaType: "Movie",
        durationSeconds: duration,
        context: { libraryMovieId: m.id },
      });
    },
  );
  const { data, isLoading } = useQuery({
    queryKey: ["movie", mid],
    queryFn: () => getMovie(mid),
    enabled: Number.isFinite(mid) && mid > 0,
    staleTime: 30 * 60_000,
    // The progress bar changes whenever you play the movie (either player) — cached data still paints
    // instantly, this re-checks the resume position each time the page opens.
    refetchOnMount: "always",
    gcTime: 60 * 60_000,
  });
  const videosQ = useQuery({
    queryKey: ["movie-videos", mid],
    queryFn: () => getMovieVideos(mid),
    enabled: Number.isFinite(mid) && mid > 0,
    staleTime: 60 * 60_000,
  });
  const movieTmdbId = (data?.movie as { tmdbId?: number } | undefined)?.tmdbId;
  const imdbQ = useQuery({
    queryKey: ["stream-imdb", movieTmdbId, "Movie"],
    queryFn: () => getStreamImdbId(movieTmdbId!, "Movie"),
    enabled: (movieTmdbId ?? 0) > 0,
    staleTime: 24 * 60 * 60_000,
  });
  const imdbId = imdbQ.data?.imdbId ?? null;

  if (!Number.isFinite(mid) || mid <= 0) return <p className="text-pitflix-muted">Invalid id</p>;
  if (isLoading || !data) {
    return (
      <DetailSkeleton />
    );
  }

  const movie = data.movie as MediaCard & {
    overview?: string;
    runtime?: number;
    genres?: string;
    tmdbId: number;
  };
  const cast = data.cast as {
    name: string;
    character?: string;
    personTmdbId: number;
    profileLocalPath?: string | null;
    profileRemoteUrl?: string | null;
  }[];
  const tmdbSimilar = (data.tmdbSimilar ?? []) as {
    tmdbId: number; title: string; posterUrl: string | null;
    year: string | null; voteAverage: number; mediaType: string;
    isInLibrary: boolean; libraryId: number | null;
    watchStatus?: string | null;
  }[];
  const collection = data.collection as { id: number; name: string } | null | undefined;
  const companies = (data.companies ?? []) as {
    id: number;
    name: string;
    logoUrl: string | null;
    kind: "network" | "company";
  }[];
  const contentRating = (data.contentRating ?? null) as string | null;
  const tvdbClearLogoUrl = (data.tvdbClearLogoUrl ?? null) as string | null;
  const extras = (videosQ.data?.videos ?? []) as MediaVideoItem[];
  const backdrop = toPosterSrc(movie.selectedBackdropPath || movie.backdropLocalPath || undefined);
  // Partly watched (from watch history) — drives the progress bar and the "Continue" label.
  const rawProgress = (data as { progress?: { resumeSeconds: number; durationSeconds: number; progressPercent: number | null } | null })
    .progress;
  const watchProgress =
    rawProgress?.progressPercent && movie.watchStatus !== "Completed"
      ? {
          progressPercent: rawProgress.progressPercent,
          leftLabel: (() => {
            const left = Math.round((rawProgress.durationSeconds - rawProgress.resumeSeconds) / 60);
            if (rawProgress.durationSeconds <= 0 || left <= 0) return null;
            return left >= 60 ? `${Math.floor(left / 60)}h ${left % 60}m` : `${left}m`;
          })(),
        }
      : null;
  const poster = toPosterSrc(
    movie.selectedPosterPath || movie.posterLocalPath || movie.posterRemoteUrl || undefined,
  );

  if (detailLayout !== "classic") {
    const moviePath = movie.mediaFilePath || movie.filePath || null;
    const watched = movie.watchStatus === "Completed";
    const refreshRatings = () => {
      setRatingRefreshing(true);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] === "mdblist-ratings" && q.queryKey[1] === movie.tmdbId });
      void queueRatingsStaleSweep().catch(() => {});
      void getRatingsAggregate(movie.tmdbId, "movie")
        .then((fresh) => { qc.setQueryData(["ratings-display", movie.tmdbId, "movie"], fresh); })
        .catch(() => { void qc.refetchQueries({ queryKey: ["ratings-display", movie.tmdbId, "movie"] }); })
        .finally(() => setRatingRefreshing(false));
    };
    const vm: DetailViewModel = {
      kind: "movie",
      libraryId: movie.id,
      tmdbId: movie.tmdbId,
      title: movie.title,
      year: movie.year,
      overview: movie.overview,
      genres: (movie.genres ?? movie.genresCsv ?? "").split(",").map((g) => g.trim()).filter(Boolean),
      contentRating,
      runtimeMinutes: movie.runtime ?? null,
      backdrop,
      poster,
      clearLogoUrl: tvdbClearLogoUrl,
      watchStatus: movie.watchStatus,
      imdbId,
      primary: moviePath
        ? {
            label: watched ? "Watch again" : watchProgress ? "Resume" : "Play",
            sub: watched
              ? (movie.rewatchCount ?? 0) > 0
                ? `Hold to adjust rewatch count (${movie.rewatchCount})`
                : "Hold to adjust rewatch count"
              : watchProgress
                ? `${watchProgress.progressPercent}% watched${watchProgress.leftLabel ? ` \u00b7 ${watchProgress.leftLabel} left` : ""}`
                : null,
            progressPercent: watchProgress?.progressPercent ?? null,
            again: watched,
            title: watched ? "Click to watch again \u2014 hold to view/adjust rewatch count" : undefined,
            buttonRef: watchAgainButtonRef,
            buttonProps: watchAgainLongPress,
            extra: watched ? (
              <RewatchPopover
                open={showRewatchPopover}
                onClose={() => setShowRewatchPopover(false)}
                anchorRef={watchAgainButtonRef}
                count={movie.rewatchCount ?? 0}
                onChange={(next) =>
                  void setMovieRewatchCount(movie.id, next).then(() => qc.invalidateQueries({ queryKey: ["movie", mid] }))
                }
              />
            ) : null,
          }
        : null,
      toolbar: {
        kind: "movie",
        libraryId: movie.id,
        tmdbId: movie.tmdbId,
        pickHint: movie.title,
        filePath: moviePath || undefined,
        onDeleted: () => navigate(-1),
        onMovieRematched: (newLibraryId) => {
          void qc.invalidateQueries({ queryKey: ["movie", mid] });
          void qc.invalidateQueries({ queryKey: ["movie", newLibraryId] });
          if (newLibraryId !== mid) navigate(`/movie/${newLibraryId}`, { replace: true });
        },
      },
      ratingsRefresh: { refreshing: ratingRefreshing, onRefresh: refreshRatings },
      deviceActions: [
        ...(isTauri() && moviePath
          ? [{ key: "folder", label: "Open folder", icon: FolderOpen, onClick: () => openFolder(parentDir(moviePath)) }]
          : []),
        ...(moviePath ? [{ key: "subtitles", label: "Subtitles\u2026", icon: Subtitles, onClick: () => setSubtitlesOpen(true) }] : []),
        { key: "artwork", label: "Change artwork\u2026", icon: ImageIcon, onClick: () => setShowArtworkPicker(true) },
      ],
      localPath: moviePath,
      cast: cast ?? [],
      crew: (data.crew ?? []) as CrewMember[],
      similar: tmdbSimilar,
      companies,
      collection: collection ?? null,
      extras,
      onPosterClick: () => poster && setShowPosterLightbox(true),
      onContextMenu: handleContextMenu({
        kind: "movie",
        libraryId: mid,
        tmdbId: movie.tmdbId,
        title: movie.title,
        watchStatus: movie.watchStatus,
      }),
      navigate,
      movie: {
        filePath: moviePath,
        rewatchCount: movie.rewatchCount ?? 0,
        onSubtitles: () => setSubtitlesOpen(true),
      },
    };

    return (
      <div className="isolate">
        <AmbientBackdrop src={backdrop} />
        {ResumePromptModal}
        {detailLayout === "cinematic" ? (
          <CinematicDetailLayout key={mid} vm={vm} />
        ) : (
          <DossierDetailLayout key={mid} vm={vm} />
        )}
        {showArtworkPicker ? (
          <PosterPickerModal
            libraryId={movie.id}
            tmdbId={movie.tmdbId}
            mediaType="Movie"
            initialTab="poster"
            onClose={() => setShowArtworkPicker(false)}
            onApplied={() => void qc.invalidateQueries({ queryKey: ["movie", mid] })}
          />
        ) : null}
        {showPosterLightbox && poster ? <Lightbox url={poster} onClose={() => setShowPosterLightbox(false)} /> : null}
        <SubtitleDrawer
          open={subtitlesOpen}
          onClose={() => setSubtitlesOpen(false)}
          title={movie.title}
          mode="movie"
          movieId={movie.id}
          movieTmdbId={movie.tmdbId}
          videoFilePath={moviePath ?? ""}
        />
        {menu ? (
          <MediaContextMenu
            target={menu.target}
            x={menu.x}
            y={menu.y}
            showRescan={menu.target.kind !== "streaming"}
            onAction={(action) => void runAction(action)}
            onClose={closeMenu}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="isolate">
      <AmbientBackdrop src={backdrop} />
      {ResumePromptModal}
      {/* Cinematic hero */}
      <div className="-mx-6 -mt-12">
        <div className="relative h-[560px] overflow-hidden">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="absolute left-6 top-6 z-20 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/[0.32] px-[18px] py-2 text-[13px] font-medium text-white shadow-lg backdrop-blur-xl transition hover:bg-black/55"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <HeroBackdrop src={backdrop} />
          <div
            className="absolute bottom-0 left-0 right-0 z-10 flex items-end gap-9 px-12 pb-9"
            onContextMenu={handleContextMenu({
              kind: "movie",
              libraryId: mid,
              tmdbId: movie.tmdbId,
              title: movie.title,
              watchStatus: movie.watchStatus,
            })}
          >
            <button
              type="button"
              className="block cursor-pointer text-left"
              onClick={() => poster && setShowPosterLightbox(true)}
            >
              <MediaImage
                src={poster}
                alt={movie.title}
                className={detailHeroPosterClass}
                fallbackText={movie.title}
              />
            </button>
            <div className="min-w-0 flex-1 pb-1">
              {movie.watchStatus === "Completed" ? (
                <div className="mb-3">
                  <span className="inline-flex items-center gap-1 rounded-full border border-green-400/[0.28] bg-green-500/10 px-[14px] py-1 text-[11px] font-semibold tracking-[0.06em] text-green-400">
                    <Check className="h-3 w-3" />
                    WATCHED
                  </span>
                </div>
              ) : null}
              <DetailHeroTitle title={movie.title} clearLogoUrl={tvdbClearLogoUrl} />
              <div className="mb-3 flex flex-wrap items-center gap-2.5 text-sm text-white/50">
                <span>{formatYear(movie.year)}</span>
                <span className="text-white/15" aria-hidden>
                  {"\u00b7"}
                </span>
                <span className="flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  <span>{formatRating(movie.voteAverage)}</span>
                </span>
                {movie.runtime ? (
                  <>
                    <span className="text-white/15" aria-hidden>
                      {"\u00b7"}
                    </span>
                    <span>{movie.runtime} min</span>
                  </>
                ) : null}
                {contentRating ? (
                  <>
                    <span className="text-white/15" aria-hidden>
                      {"\u00b7"}
                    </span>
                    <ContentRatingBadge rating={contentRating} />
                  </>
                ) : null}
              </div>
              {(movie.genres ?? movie.genresCsv) ? (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {(movie.genres ?? movie.genresCsv)!.split(",").map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => navigate(`/genre/${encodeURIComponent(g.trim())}`)}
                      className="rounded-2xl border border-violet-400/[0.22] bg-violet-500/[0.12] px-3 py-[3px] text-xs font-medium text-violet-300 transition hover:bg-violet-500/[0.22] hover:border-violet-400/[0.4]"
                    >
                      {g.trim()}
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="mb-6 line-clamp-3 max-w-[540px] text-sm leading-[1.68] text-white/[0.58]">
                {movie.overview}
              </p>
              {/* Same bar as Home's Continue Watching banner (ContinueWatchingHero). */}
              {watchProgress ? (
                <div className="mb-5 max-w-sm">
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-white/20"
                    role="progressbar"
                    aria-valuenow={watchProgress.progressPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${watchProgress.progressPercent}% watched`}
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-pitflix-primary to-violet-400 transition-[width] duration-700"
                      style={{ width: `${watchProgress.progressPercent}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-pitflix-muted">
                    {watchProgress.progressPercent}% watched
                    {watchProgress.leftLabel ? ` · ${watchProgress.leftLabel} left` : ""}
                  </p>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2.5">
                {(movie.mediaFilePath || movie.filePath) ? (
                  <>
                    <button
                      ref={watchAgainButtonRef}
                      type="button"
                      className="flex items-center gap-2.5 rounded-[9px] bg-[#7c3aed] px-[26px] py-[13px] text-sm font-semibold text-white shadow-[0_4px_24px_rgba(124,58,237,0.45)] transition hover:-translate-y-px hover:bg-[#6d28d9]"
                      title={
                        movie.watchStatus === "Completed"
                          ? "Click to watch again — hold to view/adjust rewatch count"
                          : undefined
                      }
                      {...watchAgainLongPress}
                    >
                      {movie.watchStatus === "Completed" ? (
                        <>
                          <RotateCcw className="h-4 w-4" />
                          Watch Again
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 fill-current" />
                          {watchProgress ? "Continue watching" : "Play"}
                        </>
                      )}
                    </button>
                    {movie.watchStatus === "Completed" ? (
                      <RewatchPopover
                        open={showRewatchPopover}
                        onClose={() => setShowRewatchPopover(false)}
                        anchorRef={watchAgainButtonRef}
                        count={movie.rewatchCount ?? 0}
                        onChange={(next) =>
                          void setMovieRewatchCount(movie.id, next).then(() =>
                            qc.invalidateQueries({ queryKey: ["movie", mid] }),
                          )
                        }
                      />
                    ) : null}
                  </>
                ) : null}
                {movie.tmdbId > 0 ? (
                  <TrailerButton tmdbId={movie.tmdbId} mediaType="Movie" title={movie.title} posterUrl={poster} />
                ) : null}
                {(movie.mediaFilePath || movie.filePath) ? (
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-[9px] border border-white/[0.11] bg-white/[0.07] px-5 py-[13px] text-sm font-medium text-white/[0.62] transition hover:bg-white/[0.14]"
                    onClick={() => setSubtitlesOpen(true)}
                  >
                    <Subtitles className="h-4 w-4" /> Subtitles
                  </button>
                ) : null}
                {isTauri() && (movie.mediaFilePath || movie.filePath) ? (
                  <button
                    type="button"
                    title="Open folder"
                    className="flex h-11 w-11 items-center justify-center rounded-[9px] border border-white/[0.11] bg-white/[0.07] text-white/70 transition hover:bg-white/[0.14]"
                    onClick={() => openFolder(parentDir(movie.mediaFilePath || movie.filePath || ""))}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  title="Change artwork"
                  className="flex h-11 w-11 items-center justify-center rounded-[9px] border border-white/[0.11] bg-white/[0.07] text-white/70 transition hover:bg-white/[0.14]"
                  onClick={() => setShowArtworkPicker(true)}
                >
                  <ImageIcon className="h-4 w-4" />
                </button>
                {movie.tmdbId > 0 ? (
                  <HeroActionIcons
                    tmdbId={movie.tmdbId}
                    mediaType="Movie"
                    watchStatus={movie.watchStatus}
                    kind="movie"
                    libraryId={movie.id}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Utility bar */}
      <div className="-mx-6">
        <DetailToolbar
          kind="movie"
          libraryId={movie.id}
          tmdbId={movie.tmdbId}
          pickHint={movie.title}
          filePath={movie.mediaFilePath || movie.filePath || undefined}
          onDeleted={() => navigate(-1)}
          onMovieRematched={(newLibraryId) => {
            void qc.invalidateQueries({ queryKey: ["movie", mid] });
            void qc.invalidateQueries({ queryKey: ["movie", newLibraryId] });
            if (newLibraryId !== mid) navigate(`/movie/${newLibraryId}`, { replace: true });
          }}
        />
      </div>

      {/* Ratings */}
      <div className="relative -mx-6 px-12 py-5 before:absolute before:inset-x-12 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/10 before:to-transparent">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/35">Ratings</span>
          <button
            type="button"
            title="Fetch fresh ratings from TMDB / IMDb / Rotten Tomatoes"
            disabled={ratingRefreshing}
            onClick={() => {
              setRatingRefreshing(true);
              qc.removeQueries({ predicate: (q) => q.queryKey[0] === "mdblist-ratings" && q.queryKey[1] === movie.tmdbId });
              void queueRatingsStaleSweep().catch(() => {});
              void getRatingsAggregate(movie.tmdbId, "movie")
                .then((fresh) => { qc.setQueryData(["ratings-display", movie.tmdbId, "movie"], fresh); })
                .catch(() => { void qc.refetchQueries({ queryKey: ["ratings-display", movie.tmdbId, "movie"] }); })
                .finally(() => setRatingRefreshing(false));
            }}
            className="flex items-center gap-1.5 rounded-[6px] border border-white/[0.07] bg-white/[0.03] px-3 py-[5px] text-[11.5px] text-white/35 transition hover:bg-white/[0.08] hover:text-white/70 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${ratingRefreshing ? "animate-spin" : ""}`} />
            {ratingRefreshing ? "Refreshing..." : "Refresh rating"}
          </button>
        </div>
        <RatingsPanel tmdbId={movie.tmdbId} mediaType="movie" thumbnailSrc={backdrop ?? poster ?? undefined} />
        <TitleAwardsSection tmdbId={movie.tmdbId} mediaType="movie" />
      </div>

      <ParentsGuideSection imdbId={imdbId} />

      {showArtworkPicker ? (
        <PosterPickerModal
          libraryId={movie.id}
          tmdbId={movie.tmdbId}
          mediaType="Movie"
          initialTab="poster"
          onClose={() => setShowArtworkPicker(false)}
          onApplied={() => void qc.invalidateQueries({ queryKey: ["movie", mid] })}
        />
      ) : null}

      {showPosterLightbox && poster ? (
        <Lightbox url={poster} onClose={() => setShowPosterLightbox(false)} />
      ) : null}

      <SubtitleDrawer
        open={subtitlesOpen}
        onClose={() => setSubtitlesOpen(false)}
        title={movie.title}
        mode="movie"
        movieId={movie.id}
        movieTmdbId={movie.tmdbId}
        videoFilePath={movie.mediaFilePath || movie.filePath || ""}
      />

      <CastCrewSection cast={cast ?? []} crew={(data.crew ?? []) as CrewMember[]} navigate={navigate} />

      {/* TMDB Similar */}
      {tmdbSimilar.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold">Similar Titles</h2>
          <HorizontalDragScroll className="pb-4">
            {tmdbSimilar.map((s) => (
              <button
                key={`tmdb-sim-${s.tmdbId}`}
                type="button"
                onClick={() => {
                  if (s.isInLibrary && s.libraryId) {
                    navigate(`/movie/${s.libraryId}`);
                  } else {
                    navigate("/stream-details", {
                      state: { tmdbId: s.tmdbId, mediaType: "Movie", title: s.title, posterUrl: s.posterUrl },
                    });
                  }
                }}
                className="group relative mr-3 w-[130px] shrink-0 text-left"
              >
                <div className="relative overflow-hidden rounded-xl border-2 border-transparent bg-pitflix-card transition-all group-hover:border-pitflix-primary/50 group-hover:shadow-lg">
                  {s.posterUrl ? (
                    <img src={toPosterSrc(s.posterUrl)} alt={s.title} className="aspect-[2/3] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[2/3] items-center justify-center bg-pitflix-card text-xs text-pitflix-muted px-2 text-center">
                      {s.title}
                    </div>
                  )}
                  {s.watchStatus === "Completed" ? (
                    <div className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 rounded-md bg-green-500/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow">
                      <Check className="h-2.5 w-2.5" />
                      Watched
                    </div>
                  ) : s.isInLibrary ? (
                    <div className="absolute left-1.5 top-1.5 rounded-full bg-pitflix-primary/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow">
                      In Library
                    </div>
                  ) : null}
                </div>
                <p className="mt-1.5 truncate text-xs font-medium text-white">{s.title}</p>
                <p className="text-[10px] text-pitflix-subtle">{s.year}</p>
              </button>
            ))}
          </HorizontalDragScroll>
        </section>
      )}

      {/* Collection */}
      {collection && (
        <section className="mt-8 rounded-xl border border-pitflix-card bg-pitflix-surface/40 p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-pitflix-primary">
            Part of a collection
          </p>
          <div className="flex items-center justify-between gap-4">
            <p className="text-base font-bold text-white">{collection.name}</p>
            <button
              type="button"
              onClick={() =>
                navigate("/stream-collection", {
                  state: { collectionId: collection.id, collectionName: collection.name },
                })
              }
              className="flex shrink-0 items-center gap-1 rounded-lg border border-pitflix-primary/50 px-3 py-1.5 text-xs font-medium text-pitflix-primary hover:bg-pitflix-primary/10"
            >
              View Collection
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>
      )}

      {/* Studio */}
      {companies.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-pitflix-muted">Studio</h2>
          <div className="flex flex-wrap gap-3">
            {companies.map((c) => (
              <button
                key={`${c.kind}-${c.id}`}
                type="button"
                onClick={() =>
                  navigate("/stream-studio", {
                    state: { studioId: c.id, kind: c.kind, name: c.name, logoUrl: c.logoUrl },
                  })
                }
                title={`See everything on ${c.name}`}
                className="flex h-14 min-w-[96px] items-center justify-center rounded-lg border border-pitflix-card bg-white/95 px-4 py-2 shadow transition hover:border-pitflix-primary/60 hover:-translate-y-0.5"
              >
                {c.logoUrl ? (
                  <img src={toPosterSrc(c.logoUrl)} alt={c.name} className="max-h-9 max-w-[110px] object-contain" />
                ) : (
                  <span className="text-xs font-semibold text-pitflix-bg">{c.name}</span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      <VideoExtrasSection videos={extras} />

      {menu ? (
        <MediaContextMenu
          target={menu.target}
          x={menu.x}
          y={menu.y}
          showRescan={menu.target.kind !== "streaming"}
          onAction={(action) => void runAction(action)}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}
