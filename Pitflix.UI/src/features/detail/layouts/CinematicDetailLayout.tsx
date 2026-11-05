import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, FolderOpen, Subtitles } from "lucide-react";
import { DetailToolbar } from "../../../components/DetailToolbar";
import { ParentsGuideSection } from "../../../components/ParentsGuideSection";
import { cn } from "../../../utils/cn";
import { Art } from "../../home/librarySections/Art";
import {
  CastCrewSection,
  HeroActionIcons,
  TitleAwardsSection,
  TrailerButton,
  VideoExtrasSection,
} from "../detailComponents";
import {
  CompanyChips,
  EpisodeList,
  MetaLine,
  PrimaryPlayButton,
  RatingChips,
  RatingsList,
  SeasonPicker,
  SeasonProgressSegments,
  SimilarRow,
  useSeasonEpisodes,
} from "./DetailLayoutParts";
import type { DetailViewModel } from "./types";

const heroBtn =
  "flex h-14 items-center gap-2 rounded-xl border border-white/25 bg-white/[0.08] px-5 text-[15px] font-semibold text-white transition hover:bg-white/[0.16] disabled:opacity-60";

function HeroTitle({ vm }: { vm: DetailViewModel }) {
  if (vm.clearLogoUrl)
    return (
      <img
        src={vm.clearLogoUrl}
        alt={vm.title}
        className="max-h-[120px] max-w-[min(560px,100%)] object-contain object-left drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]"
      />
    );
  return (
    <h1 className="text-5xl font-black leading-[0.95] tracking-tight text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.6)] md:text-[72px]">
      {vm.title}
    </h1>
  );
}

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5", className)}>
      <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-white/45">{title}</h3>
      {children}
    </section>
  );
}

type SeriesTab = "episodes" | "cast" | "details";

/**
 * Cinematic layout — full-bleed hero (title, meta, rating chips, labelled actions, ⋯ menu). Series
 * continue with Episodes / Cast & crew / Details tabs; movies with a main column plus a side
 * "Your copy" / ratings / parents-guide panel.
 */
export function CinematicDetailLayout({ vm }: { vm: DetailViewModel }) {
  const isSeries = vm.kind === "series";
  const [tab, setTab] = useState<SeriesTab>("episodes");
  const [season, setSeason] = useState<number | null>(vm.series?.focusSeason ?? null);
  const { episodes } = useSeasonEpisodes(isSeries ? vm.libraryId : 0, season);

  const seasonsInLibrary = (vm.series?.seasonsSummary ?? []).filter((s) => s.inLibrary !== false && s.seasonNumber > 0);
  const totalEpisodes = seasonsInLibrary.reduce((n, s) => n + s.episodeCount, 0);
  const metaExtra = isSeries
    ? [
        seasonsInLibrary.length === 1 ? null : `${seasonsInLibrary.length} seasons`,
        totalEpisodes > 0 ? `${totalEpisodes} episodes` : null,
        vm.companies.find((c) => c.kind === "network")?.name,
      ]
    : [];

  const toolbarMenu = <DetailToolbar {...vm.toolbar} variant="menu" extraItems={vm.deviceActions} />;

  return (
    <>
      <div className="-mx-6 -mt-12">
        <section className="relative h-[640px] overflow-visible">
          <div className="absolute inset-0 overflow-hidden">
            <Art src={vm.backdrop} fallbackPosterSrc={vm.poster} posterAlign="right" eager />
            <div className="absolute inset-0 bg-gradient-to-r from-[#121214]/95 via-[#121214]/65 via-40% to-transparent to-75%" />
            <div className="absolute inset-0 bg-gradient-to-t from-pitflix-bg via-transparent via-45% to-transparent" />
          </div>

          <button
            type="button"
            onClick={() => vm.navigate(-1)}
            className="absolute left-6 top-6 z-20 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/[0.35] px-[18px] py-2 text-[13px] font-medium text-white backdrop-blur-xl transition hover:bg-black/55"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <div className="absolute bottom-14 left-6 right-6 z-40 flex max-w-[700px] flex-col gap-4 sm:left-14" onContextMenu={vm.onContextMenu}>
            {vm.watchStatus === "Completed" ? (
              <span className="inline-flex w-fit items-center gap-1 rounded-full border border-green-400/30 bg-green-500/15 px-3 py-1 text-[11px] font-semibold tracking-[0.06em] text-green-300">
                <Check className="h-3 w-3" /> WATCHED
              </span>
            ) : null}
            <HeroTitle vm={vm} />
            <MetaLine vm={vm} extra={metaExtra} />
            {vm.tmdbId > 0 ? <RatingChips tmdbId={vm.tmdbId} mediaType={isSeries ? "tv" : "movie"} /> : null}
            {vm.overview ? <p className="line-clamp-3 text-[16px] leading-relaxed text-white/80">{vm.overview}</p> : null}
            <div className="mt-1.5 flex flex-wrap items-start gap-2.5">
              <PrimaryPlayButton vm={vm} />
              {vm.tmdbId > 0 ? (
                <TrailerButton
                  tmdbId={vm.tmdbId}
                  mediaType={isSeries ? "Series" : "Movie"}
                  title={vm.title}
                  posterUrl={vm.poster}
                  className={heroBtn}
                />
              ) : null}
              {vm.tmdbId > 0 ? (
                <HeroActionIcons
                  tmdbId={vm.tmdbId}
                  mediaType={isSeries ? "Series" : "Movie"}
                  watchStatus={vm.watchStatus}
                  kind={vm.kind}
                  libraryId={vm.libraryId}
                  variant="labeled"
                />
              ) : null}
              {toolbarMenu}
            </div>
          </div>

          {isSeries && episodes.length > 0 ? (
            <div className="absolute bottom-16 right-14 z-10 hidden w-[300px] xl:block">
              <SeasonProgressSegments episodes={episodes} />
            </div>
          ) : null}
        </section>
      </div>

      {isSeries ? (
        <>
          <nav
            aria-label="Sections"
            className="sticky top-0 z-30 -mx-6 flex gap-1.5 border-b border-white/[0.08] bg-pitflix-bg/95 px-6 backdrop-blur sm:px-14"
          >
            {(
              [
                ["episodes", "Episodes"],
                ["cast", "Cast & crew"],
                ["details", "Details"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-current={tab === id ? "page" : undefined}
                onClick={() => setTab(id)}
                className={cn(
                  "h-14 border-b-[3px] px-4 text-[15px] font-bold transition",
                  tab === id ? "border-pitflix-primary text-white" : "border-transparent text-white/55 hover:text-white",
                )}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex flex-col gap-12 py-8 sm:px-8">
            {tab === "episodes" ? (
              <section className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-[22px] font-extrabold text-white">
                    {seasonsInLibrary.length === 1 && vm.series?.seasonsSummary.length === 1 ? "Episodes" : "Seasons"}
                  </h2>
                  <SeasonPicker vm={vm} season={season} onChange={setSeason} />
                </div>
                {season != null ? (
                  <EpisodeList vm={vm} season={season} episodes={episodes} variant="rows" />
                ) : (
                  <p className="text-[14px] text-pitflix-muted">No episodes in the library yet.</p>
                )}
              </section>
            ) : null}

            {tab === "cast" ? (
              <div className="[&>section]:mt-0">
                <CastCrewSection cast={vm.cast} crew={vm.crew} navigate={vm.navigate} />
              </div>
            ) : null}

            {tab === "details" ? (
              <div className="flex flex-col gap-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <Card title="Ratings">
                    <RatingsList tmdbId={vm.tmdbId} mediaType="tv" {...vm.ratingsRefresh} />
                  </Card>
                  <Card title="Network & studios">
                    {vm.companies.length > 0 ? <CompanyChips vm={vm} /> : <p className="text-[13px] text-pitflix-subtle">Unknown</p>}
                  </Card>
                  <Card title="On this device">
                    <p className="text-[13px] text-white/75">
                      {totalEpisodes} episode{totalEpisodes === 1 ? "" : "s"} in your library
                    </p>
                    {vm.localPath ? <p className="break-all text-[12px] text-pitflix-subtle">{vm.localPath}</p> : null}
                  </Card>
                </div>
                <ParentsGuideSection imdbId={vm.imdbId} />
                <TitleAwardsSection tmdbId={vm.tmdbId} mediaType="tv" />
              </div>
            ) : null}

            <SimilarRow vm={vm} />
            <div className="[&>section]:mt-0">
              <VideoExtrasSection videos={vm.extras} />
            </div>
          </div>
        </>
      ) : (
        <div className="grid gap-10 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-10">
            <div className="[&>section]:mt-0">
              <CastCrewSection cast={vm.cast} crew={vm.crew} navigate={vm.navigate} />
            </div>
            {vm.collection ? (
              <section className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-pitflix-light">Part of a collection</p>
                  <p className="mt-1 text-[16px] font-bold text-white">{vm.collection.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    vm.navigate("/stream-collection", {
                      state: { collectionId: vm.collection!.id, collectionName: vm.collection!.name },
                    })
                  }
                  className="flex items-center gap-1 rounded-lg border border-pitflix-primary/50 px-3 py-1.5 text-[13px] font-semibold text-pitflix-light hover:bg-pitflix-primary/10"
                >
                  View collection <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </section>
            ) : null}
            <SimilarRow vm={vm} />
            <div className="[&>section]:mt-0">
              <TitleAwardsSection tmdbId={vm.tmdbId} mediaType="movie" />
            </div>
            <div className="[&>section]:mt-0">
              <VideoExtrasSection videos={vm.extras} />
            </div>
          </div>

          <aside className="flex flex-col gap-4">
            <Card title="Your copy">
              {vm.localPath ? (
                <>
                  <p className="break-all text-[13px] text-white/80">{vm.localPath.split(/[\\/]/).pop()}</p>
                  <p className="break-all text-[11.5px] text-pitflix-subtle">{vm.localPath}</p>
                </>
              ) : (
                <p className="text-[13px] text-pitflix-subtle">No file linked.</p>
              )}
              {vm.movie && vm.movie.rewatchCount > 0 ? (
                <p className="text-[12.5px] text-white/70">
                  Rewatched {vm.movie.rewatchCount} time{vm.movie.rewatchCount === 1 ? "" : "s"}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {vm.movie?.filePath ? (
                  <button
                    type="button"
                    onClick={vm.movie.onSubtitles}
                    className="flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/[0.15]"
                  >
                    <Subtitles className="h-3.5 w-3.5" /> Subtitles
                  </button>
                ) : null}
                {vm.deviceActions
                  .filter((a) => a.key === "folder")
                  .map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      onClick={a.onClick}
                      className="flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/[0.15]"
                    >
                      <FolderOpen className="h-3.5 w-3.5" /> {a.label}
                    </button>
                  ))}
              </div>
            </Card>
            <Card title="Ratings">
              <RatingsList tmdbId={vm.tmdbId} mediaType="movie" {...vm.ratingsRefresh} />
            </Card>
            {vm.companies.length > 0 ? (
              <Card title="Studios">
                <CompanyChips vm={vm} />
              </Card>
            ) : null}
            <div className="[&>*]:my-0">
              <ParentsGuideSection imdbId={vm.imdbId} />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
