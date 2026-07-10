import { isTauri } from "@tauri-apps/api/core";
import { ArrowLeft, Ban, Check, Download, FolderOpen, ImageIcon, Play, RefreshCw, Star } from "lucide-react";
import { getRatingsAggregate, queueRatingsStaleSweep } from "../../api/ratings";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getShow, getShowVideos, setShowDropped, type SeasonSummary } from "../../api/series";
import type { MediaVideoItem } from "../../api/movies";
import { getStreamImdbId } from "../../api/stream";
import { DetailToolbar } from "../../components/DetailToolbar";
import { WsmDownloadModal } from "../../components/WsmDownloadModal";
import { MediaContextMenu } from "../library/MediaContextMenu";
import { useMediaContextMenu } from "../library/useMediaContextMenu";
import { useResumeBeforePlay } from "../../hooks/useResumeBeforePlay";
import { PosterPickerModal } from "../../components/PosterPickerModal";
import { HorizontalDragScroll } from "../../components/ui/HorizontalDragScroll";
import { ImdbRatingBadge } from "../../components/ui/ImdbRatingBadge";
import { MediaImage } from "../../components/ui/MediaImage";
import { Spinner } from "../../components/ui/Spinner";
import type { MediaCard } from "../../types/media";
import { formatRating, formatYear } from "../../utils/format";
import { toPosterSrc } from "../../utils/posterSrc";
import { cn } from "../../utils/cn";
import { RatingsPanel } from "../../components/RatingsPanel";
import { ParentsGuideSection } from "../../components/ParentsGuideSection";
import {
  CastCrewSection,
  ContentRatingBadge,
  CrewMember,
  detailHeroPosterClass,
  DetailHeroTitle,
  HeroActionIcons,
  openFolder,
  TitleAwardsSection,
  TrailerButton,
  VideoExtrasSection,
} from "./detailComponents";
type EpisodeRow = {
  id: number;
  episodeNumber: number;
  title?: string | null;
  filePath: string;
  subtitlePath?: string | null;
  watchStatus?: string;
  stillLocalPath?: string | null;
};

type NextEpisodeDto = {
  id: number;
  season: number;
  episodeNumber: number;
  title: string;
  filePath: string;
};

export function ShowDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { requestPlay, ResumePromptModal } = useResumeBeforePlay();
  const [showArtworkPicker, setShowArtworkPicker] = useState(false);
  const [ratingRefreshing, setRatingRefreshing] = useState(false);
  const [wsmSeasonDownload, setWsmSeasonDownload] = useState<number | null>(null);
  const [dropBusy, setDropBusy] = useState(false);
  const sid = Number(id);
  const { menu, closeMenu, handleContextMenu, runAction } = useMediaContextMenu();
  const { data, isLoading } = useQuery({
    queryKey: ["show", sid],
    queryFn: () => getShow(sid),
    enabled: Number.isFinite(sid) && sid > 0,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    refetchInterval: (query) => {
      const seasons = (query.state.data?.seasonsSummary ?? []) as SeasonSummary[];
      const pending = seasons.some((s) => s.imdbVoteAverage == null || s.imdbVoteAverage <= 0);
      return pending ? 8000 : false;
    },
  });
  const showVideosQ = useQuery({
    queryKey: ["show-videos", sid],
    queryFn: () => getShowVideos(sid),
    enabled: Number.isFinite(sid) && sid > 0 && !!data,
    staleTime: 60 * 60_000,
  });

  const imdbQ = useQuery({
    queryKey: ["stream-imdb", data?.show?.tmdbId, "Series"],
    queryFn: () => getStreamImdbId((data!.show as { tmdbId: number }).tmdbId, "Series"),
    enabled: (data?.show as { tmdbId?: number } | undefined)?.tmdbId != null && (data!.show as { tmdbId: number }).tmdbId > 0,
    staleTime: 24 * 60 * 60_000,
  });
  const imdbId = imdbQ.data?.imdbId ?? null;

  const episodesGrouped = (data?.episodes ?? []) as { season: number; episodes: EpisodeRow[] }[];
  const seasonsSummary = (data?.seasonsSummary ?? []) as SeasonSummary[];
  const seasons = useMemo(
    () =>
      [...new Set(episodesGrouped.map((g) => g.season))].sort((a, b) => {
        if (a === 0 && b !== 0) return 1; // specials last
        if (b === 0 && a !== 0) return -1;
        return a - b;
      }),
    [episodesGrouped],
  );

  const nextEpisode = (data?.nextEpisode ?? null) as NextEpisodeDto | null;

  const firstEpisode = useMemo(() => {
    if (episodesGrouped.length === 0) return null;
    const sortedGroups = [...episodesGrouped].sort((a, b) => a.season - b.season);
    const g = sortedGroups[0];
    const eps = [...g.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
    if (eps.length === 0) return null;
    return { episode: eps[0], season: g.season };
  }, [episodesGrouped]);

  if (!Number.isFinite(sid) || sid <= 0) return <p className="text-pitflix-muted">Invalid id</p>;
  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );
  }

  const show = data.show as MediaCard & { overview?: string; genres?: string; tmdbId: number };
  const isDropped = data.isDropped === true;

  const toggleDropped = () => {
    if (dropBusy) return;
    setDropBusy(true);
    void setShowDropped(sid, !isDropped)
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["show", sid] });
        void qc.invalidateQueries({ queryKey: ["home-watching-currently"] });
      })
      .finally(() => setDropBusy(false));
  };
  const cast = data.cast as {
    name: string;
    character?: string;
    personTmdbId: number;
    profileLocalPath?: string | null;
    profileRemoteUrl?: string | null;
  }[];
  const tmdbSimilarShow = (data.tmdbSimilar ?? []) as {
    tmdbId: number; title: string; posterUrl: string | null;
    year: string | null; voteAverage: number; mediaType: string;
    isInLibrary: boolean; libraryId: number | null;
    watchStatus?: string | null;
  }[];
  const contentRatingShow = (data.contentRating ?? null) as string | null;
  const tvdbClearLogoUrl = (data.tvdbClearLogoUrl ?? null) as string | null;
  const showExtras = (showVideosQ.data?.videos ?? []) as MediaVideoItem[];

  const backdrop = toPosterSrc(show.selectedBackdropPath || show.backdropLocalPath || undefined);
  const poster = toPosterSrc(
    show.selectedPosterPath || show.posterLocalPath || show.posterRemoteUrl || undefined,
  );

  return (
    <div>
      {ResumePromptModal}
      {/* Cinematic hero */}
      <div className="-mx-6 -mt-12">
        <div className="relative h-[560px] overflow-hidden bg-pitflix-card">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="absolute left-6 top-6 z-20 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/[0.32] px-[18px] py-2 text-[13px] font-medium text-white shadow-lg backdrop-blur-xl transition hover:bg-black/55"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="pointer-events-none absolute inset-0">
            {backdrop ? (
              <div className="absolute inset-0 [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_img]:object-top [&_img]:opacity-75">
                <MediaImage src={backdrop} alt="" className="h-full w-full bg-pitflix-card" fallbackText="" />
              </div>
            ) : (
              <div className="absolute inset-0 bg-pitflix-card" />
            )}
            {/* Left fade so text stays readable */}
            <div className="absolute inset-0 bg-gradient-to-r from-pitflix-bg via-pitflix-bg/55 to-transparent" />
            {/* Bottom fade merges into the page */}
            <div className="absolute bottom-0 left-0 right-0 h-2/3 bg-gradient-to-t from-pitflix-bg via-pitflix-bg/60 to-transparent" />
          </div>
          <div
            className="absolute bottom-0 left-0 right-0 z-10 flex items-end gap-9 px-12 pb-9"
            onContextMenu={handleContextMenu({
              kind: "series",
              libraryId: sid,
              tmdbId: show.tmdbId,
              title: show.title,
              watchStatus: show.watchStatus,
            })}
          >
            <MediaImage
              src={poster}
              alt={show.title}
              className={detailHeroPosterClass}
              fallbackText={show.title}
            />
            <div className="min-w-0 flex-1 pb-1">
              {show.watchStatus === "Completed" ? (
                <div className="mb-3">
                  <span className="inline-flex items-center gap-1 rounded-full border border-green-400/[0.28] bg-green-500/10 px-[14px] py-1 text-[11px] font-semibold tracking-[0.06em] text-green-400">
                    <Check className="h-3 w-3" />
                    WATCHED
                  </span>
                </div>
              ) : null}
              <DetailHeroTitle title={show.title} clearLogoUrl={tvdbClearLogoUrl} />
              <div className="mb-3 flex flex-wrap items-center gap-2.5 text-sm text-white/50">
                <span>{formatYear(show.year)}</span>
                <span className="text-white/15" aria-hidden>
                  {"\u00b7"}
                </span>
                <span className="flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  <span>{formatRating(show.voteAverage)}</span>
                </span>
                {contentRatingShow ? (
                  <>
                    <span className="text-white/15" aria-hidden>
                      {"\u00b7"}
                    </span>
                    <ContentRatingBadge rating={contentRatingShow} />
                  </>
                ) : null}
              </div>
              {(show.genres ?? show.genresCsv) ? (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {(show.genres ?? show.genresCsv)!.split(",").map((g) => (
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
                {show.overview}
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                {nextEpisode ? (
                  <button
                    type="button"
                    className="flex items-center gap-2.5 rounded-[9px] bg-[#7c3aed] px-[26px] py-[13px] text-sm font-semibold text-white shadow-[0_4px_24px_rgba(124,58,237,0.45)] transition hover:-translate-y-px hover:bg-[#6d28d9]"
                    onClick={() =>
                      void requestPlay({
                        filePath: nextEpisode.filePath,
                        title: `${show.title} \u00b7 S${nextEpisode.season}E${nextEpisode.episodeNumber}`,
                        posterPath: show.selectedPosterPath || show.posterLocalPath || null,
                        mediaType: "Series",
                        durationSeconds: 0,
                        context: {
                          libraryShowId: show.id,
                          libraryEpisodeId: nextEpisode.id,
                          season: nextEpisode.season,
                          episodeNumber: nextEpisode.episodeNumber,
                        },
                      })
                    }
                  >
                    <Play className="h-4 w-4 fill-current" />
                    Continue - S{nextEpisode.season}E{nextEpisode.episodeNumber}
                    {nextEpisode.title ? ` (${nextEpisode.title})` : ""}
                  </button>
                ) : firstEpisode ? (
                  <button
                    type="button"
                    className="flex items-center gap-2.5 rounded-[9px] bg-[#7c3aed] px-[26px] py-[13px] text-sm font-semibold text-white shadow-[0_4px_24px_rgba(124,58,237,0.45)] transition hover:-translate-y-px hover:bg-[#6d28d9]"
                    onClick={() =>
                      void requestPlay({
                        filePath: firstEpisode.episode.filePath,
                        title: `${show.title} \u00b7 S${firstEpisode.season}E${firstEpisode.episode.episodeNumber}`,
                        posterPath: show.selectedPosterPath || show.posterLocalPath || null,
                        mediaType: "Series",
                        durationSeconds: 0,
                        context: {
                          libraryShowId: show.id,
                          libraryEpisodeId: firstEpisode.episode.id,
                          season: firstEpisode.season,
                          episodeNumber: firstEpisode.episode.episodeNumber,
                        },
                      })
                    }
                  >
                    <Play className="h-4 w-4 fill-current" />
                    Watch Again {"\u00b7"} S{firstEpisode.season}E{firstEpisode.episode.episodeNumber}
                  </button>
                ) : null}
                {show.tmdbId > 0 ? (
                  <TrailerButton tmdbId={show.tmdbId} mediaType="Series" title={show.title} posterUrl={poster} />
                ) : null}
                {isTauri() && show.folderPath ? (
                  <button
                    type="button"
                    title="Open folder"
                    className="flex h-11 w-11 items-center justify-center rounded-[9px] border border-white/[0.11] bg-white/[0.07] text-white/70 transition hover:bg-white/[0.14]"
                    onClick={() => openFolder(show.folderPath!)}
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
                <button
                  type="button"
                  disabled={dropBusy}
                  title={
                    isDropped
                      ? "Resume tracking — bring this back into Up Next"
                      : "Drop — stop showing this in Up Next (keeps your watch progress)"
                  }
                  className={cn(
                    "flex items-center gap-2 rounded-[9px] border px-4 py-[13px] text-sm font-medium transition disabled:opacity-50",
                    isDropped
                      ? "border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25"
                      : "border-white/[0.11] bg-white/[0.07] text-white/[0.62] hover:bg-white/[0.14]",
                  )}
                  onClick={toggleDropped}
                >
                  <Ban className="h-4 w-4" />
                  {isDropped ? "Dropped" : "Drop"}
                </button>
                {show.tmdbId > 0 ? (
                  <HeroActionIcons
                    tmdbId={show.tmdbId}
                    mediaType="Series"
                    watchStatus={show.watchStatus}
                    kind="series"
                    libraryId={show.id}
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
          kind="series"
          libraryId={show.id}
          tmdbId={show.tmdbId}
          pickHint={show.title}
          folderPath={show.folderPath || undefined}
          onDeleted={() => navigate(-1)}
          onShowRematched={(newLibraryId) => {
            void qc.invalidateQueries({ queryKey: ["show", sid] });
            void qc.invalidateQueries({ queryKey: ["show", newLibraryId] });
            if (newLibraryId !== sid) navigate(`/series/${newLibraryId}`, { replace: true });
          }}
        />
      </div>

      {/* Ratings */}
      <div className="-mx-6 border-t border-white/5 px-12 py-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/35">Ratings</span>
          <button
            type="button"
            title="Fetch fresh ratings from TMDB / IMDb / Rotten Tomatoes"
            disabled={ratingRefreshing}
            onClick={() => {
              setRatingRefreshing(true);
              qc.removeQueries({ predicate: (q) => q.queryKey[0] === "mdblist-ratings" && q.queryKey[1] === show.tmdbId });
              void queueRatingsStaleSweep().catch(() => {});
              void getRatingsAggregate(show.tmdbId, "tv")
                .then((fresh) => { qc.setQueryData(["ratings-display", show.tmdbId, "tv"], fresh); })
                .catch(() => { void qc.refetchQueries({ queryKey: ["ratings-display", show.tmdbId, "tv"] }); })
                .finally(() => setRatingRefreshing(false));
            }}
            className="flex items-center gap-1.5 rounded-[6px] border border-white/[0.07] bg-white/[0.03] px-3 py-[5px] text-[11.5px] text-white/35 transition hover:bg-white/[0.08] hover:text-white/70 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${ratingRefreshing ? "animate-spin" : ""}`} />
            {ratingRefreshing ? "Refreshing..." : "Refresh rating"}
          </button>
        </div>
        <RatingsPanel tmdbId={show.tmdbId} mediaType="tv" thumbnailSrc={backdrop ?? poster ?? undefined} />
        <TitleAwardsSection tmdbId={show.tmdbId} mediaType="tv" />
      </div>

      <ParentsGuideSection imdbId={imdbId} />

      {showArtworkPicker ? (
        <PosterPickerModal
          libraryId={show.id}
          tmdbId={show.tmdbId}
          mediaType="Series"
          initialTab="poster"
          onClose={() => setShowArtworkPicker(false)}
          onApplied={() => void qc.invalidateQueries({ queryKey: ["show", sid] })}
        />
      ) : null}

      {seasonsSummary.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 text-xl font-bold">Seasons</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {seasonsSummary.map((s) => {
              const inLibrary = s.inLibrary !== false;
              const inner = (
                <>
                  <div className="relative aspect-[2/3] w-full overflow-hidden">
                    {!inLibrary ? (
                      <button
                        type="button"
                        title={`Download ${s.name}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setWsmSeasonDownload(s.seasonNumber);
                        }}
                        className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-pitflix-primary/90"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <MediaImage
                      src={s.posterUrl ?? undefined}
                      alt=""
                      className={cn(
                        "h-full w-full object-cover transition-transform duration-300",
                        inLibrary ? "group-hover:scale-[1.03]" : "opacity-70 saturate-[0.7]",
                      )}
                      fallbackText={s.name.slice(0, 2)}
                    />
                    {!inLibrary ? (
                      <div className="absolute left-1.5 top-1.5">
                        <span className="rounded border border-amber-500/60 bg-amber-950/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-200">
                          Missing
                        </span>
                      </div>
                    ) : null}
                    {s.imdbVoteAverage != null && s.imdbVoteAverage > 0 ? (
                      <div className="absolute left-1.5 top-1.5 z-10">
                        <ImdbRatingBadge value={s.imdbVoteAverage} size="xs" />
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-0.5 px-1.5 py-2">
                    <p className="line-clamp-1 text-[11px] font-semibold text-white">{s.name}</p>
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-[10px] text-pitflix-muted">
                        {inLibrary
                          ? `${s.episodeCount}${s.tmdbEpisodeCount > 0 ? ` / ${s.tmdbEpisodeCount}` : ""} eps`
                          : "Not in library"}
                      </p>
                    </div>
                  </div>
                </>
              );
              return (
                <Link
                  key={s.seasonNumber}
                  to={`/series/${sid}/season/${s.seasonNumber}`}
                  onContextMenu={handleContextMenu({
                    kind: "season",
                    libraryId: sid,
                    tmdbId: show.tmdbId,
                    title: `${show.title} · ${s.name}`,
                    seasonNumber: s.seasonNumber,
                    watchStatus: show.watchStatus,
                  })}
                  className={cn(
                    "group overflow-hidden rounded-xl border transition-all",
                    inLibrary
                      ? "border-pitflix-card/70 bg-pitflix-surface/40 hover:border-pitflix-primary/50 hover:shadow-lg hover:shadow-pitflix-primary/10"
                      : "border-amber-500/25 bg-pitflix-surface/30 hover:border-amber-400/50 hover:shadow-lg hover:shadow-amber-500/10",
                  )}
                >
                  {inner}
                </Link>
              );
            })}
          </div>
        </section>
      ) : seasons.length === 0 ? (
        <section className="mt-10">
          <h2 className="mb-2 text-xl font-bold">Seasons</h2>
          <p className="text-sm text-pitflix-muted">No episodes in the library yet.</p>
        </section>
      ) : null}

      <CastCrewSection cast={cast ?? []} crew={(data.crew ?? []) as CrewMember[]} navigate={navigate} />

      {/* TMDB Similar */}
      {tmdbSimilarShow.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold">Similar Titles</h2>
          <HorizontalDragScroll className="pb-4">
            {tmdbSimilarShow.map((s) => (
              <button
                key={`tmdb-sim-${s.tmdbId}`}
                type="button"
                onClick={() => {
                  if (s.isInLibrary && s.libraryId) {
                    navigate(`/series/${s.libraryId}`);
                  } else {
                    navigate("/stream-details", {
                      state: { tmdbId: s.tmdbId, mediaType: "Series", title: s.title, posterUrl: s.posterUrl },
                    });
                  }
                }}
                className="group relative mr-3 w-[130px] shrink-0 text-left"
              >
                <div className="relative overflow-hidden rounded-xl border-2 border-transparent bg-pitflix-card transition-all group-hover:border-pitflix-primary/50 group-hover:shadow-lg">
                  {s.posterUrl ? (
                    <img src={s.posterUrl} alt={s.title} className="aspect-[2/3] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[2/3] items-center justify-center bg-pitflix-card px-2 text-center text-xs text-pitflix-muted">
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

      <VideoExtrasSection videos={showExtras} />

      <WsmDownloadModal
        isOpen={wsmSeasonDownload != null}
        onClose={() => setWsmSeasonDownload(null)}
        mode="season"
        tmdbId={show.tmdbId ?? 0}
        imdbId={imdbId}
        title={show.title ?? "Series"}
        season={wsmSeasonDownload ?? undefined}
        episodeLabel={wsmSeasonDownload != null ? `Season ${wsmSeasonDownload}` : undefined}
      />
      {menu ? (
        <MediaContextMenu
          label={menu.target.title}
          x={menu.x}
          y={menu.y}
          watchStatus={"watchStatus" in menu.target ? menu.target.watchStatus : undefined}
          showRescan={menu.target.kind !== "streaming"}
          onAction={(action) => void runAction(action)}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}