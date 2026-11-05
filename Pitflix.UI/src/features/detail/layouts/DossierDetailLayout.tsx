import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown } from "lucide-react";
import { DetailToolbar } from "../../../components/DetailToolbar";
import { ParentsGuideSection } from "../../../components/ParentsGuideSection";
import { MediaImage } from "../../../components/ui/MediaImage";
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
  EpisodeList,
  MetaLine,
  PrimaryPlayButton,
  RatingsStrip,
  SeasonPicker,
  SimilarRow,
  useSeasonEpisodes,
} from "./DetailLayoutParts";
import type { DetailViewModel } from "./types";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-pitflix-subtle">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-white/85">{children}</dd>
    </>
  );
}

/**
 * Two-column layout — a backdrop band with the title, then a poster column (actions, facts,
 * collapsed management) beside the story, ratings strip, episodes, cast and similar titles.
 */
export function DossierDetailLayout({ vm }: { vm: DetailViewModel }) {
  const isSeries = vm.kind === "series";
  const [season, setSeason] = useState<number | null>(vm.series?.focusSeason ?? null);
  const [manageOpen, setManageOpen] = useState(false);
  const { episodes } = useSeasonEpisodes(isSeries ? vm.libraryId : 0, season);

  const seasonsInLibrary = (vm.series?.seasonsSummary ?? []).filter((s) => s.inLibrary !== false && s.seasonNumber > 0);
  const totalEpisodes = seasonsInLibrary.reduce((n, s) => n + s.episodeCount, 0);
  const watchedInSeason = episodes.filter((e) => e.watchStatus === "Completed").length;
  const network = vm.companies.find((c) => c.kind === "network");
  const studios = vm.companies.filter((c) => c.kind !== "network");

  const factButton = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="text-left hover:text-white hover:underline">
      {label}
    </button>
  );
  const companyLink = (c: (typeof vm.companies)[number]) =>
    factButton(c.name, () =>
      vm.navigate("/stream-studio", { state: { studioId: c.id, kind: c.kind, name: c.name, logoUrl: c.logoUrl } }),
    );

  return (
    <>
      <div className="-mx-6 -mt-12">
        <section className="relative h-[380px] overflow-hidden">
          <Art src={vm.backdrop} fallbackPosterSrc={vm.poster} posterAlign="right" eager />
          <div className="absolute inset-0 bg-gradient-to-t from-pitflix-bg via-pitflix-bg/40 via-45% to-black/20" />
          <button
            type="button"
            onClick={() => vm.navigate(-1)}
            className="absolute left-6 top-6 z-20 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/[0.35] px-[18px] py-2 text-[13px] font-medium text-white backdrop-blur-xl transition hover:bg-black/55"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div
            className="absolute bottom-7 left-6 right-6 z-10 flex flex-col gap-3 md:left-[392px]"
            onContextMenu={vm.onContextMenu}
          >
            {vm.watchStatus === "Completed" ? (
              <span className="inline-flex w-fit items-center gap-1 rounded-full border border-green-400/30 bg-green-500/15 px-3 py-1 text-[11px] font-semibold tracking-[0.06em] text-green-300">
                <Check className="h-3 w-3" /> WATCHED
              </span>
            ) : null}
            {vm.clearLogoUrl ? (
              <img
                src={vm.clearLogoUrl}
                alt={vm.title}
                className="max-h-[100px] max-w-[min(520px,100%)] object-contain object-left drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)]"
              />
            ) : (
              <h1 className="text-4xl font-black leading-none tracking-tight text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.6)] md:text-[60px]">
                {vm.title}
              </h1>
            )}
            <MetaLine vm={vm} extra={isSeries ? [seasonsInLibrary.length === 1 ? null : `${seasonsInLibrary.length} seasons`] : []} />
          </div>
        </section>
      </div>

      <div className="grid gap-10 pb-10 md:grid-cols-[300px_minmax(0,1fr)] md:gap-12 md:px-8">
        <aside className="relative flex flex-col gap-4 md:-mt-[250px]">
          <button type="button" onClick={vm.onPosterClick} className="hidden overflow-hidden rounded-2xl shadow-[0_30px_60px_rgba(0,0,0,0.55)] ring-1 ring-white/10 md:block">
            <MediaImage src={vm.poster} alt={vm.title} className="aspect-[2/3] w-full object-cover" fallbackText={vm.title} />
          </button>

          <PrimaryPlayButton vm={vm} className="w-full justify-center" />
          {vm.tmdbId > 0 ? (
            <TrailerButton
              tmdbId={vm.tmdbId}
              mediaType={isSeries ? "Series" : "Movie"}
              title={vm.title}
              posterUrl={vm.poster}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.14] bg-white/[0.05] text-[15px] font-semibold text-white transition hover:bg-white/[0.12] disabled:opacity-60"
            />
          ) : null}
          {vm.tmdbId > 0 ? (
            <div className="[&>div]:grid [&>div]:grid-cols-3 [&>div]:gap-2 [&_button]:w-full">
              <HeroActionIcons
                tmdbId={vm.tmdbId}
                mediaType={isSeries ? "Series" : "Movie"}
                watchStatus={vm.watchStatus}
                kind={vm.kind}
                libraryId={vm.libraryId}
                variant="labeled"
              />
            </div>
          ) : null}

          <dl className="mt-2 grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-3 text-[14px]">
            {network ? <Fact label="Network">{companyLink(network)}</Fact> : null}
            {studios.length > 0 ? (
              <Fact label={studios.length > 1 ? "Studios" : "Studio"}>
                <span className="flex flex-col gap-1">{studios.slice(0, 4).map((c) => <span key={c.id}>{companyLink(c)}</span>)}</span>
              </Fact>
            ) : null}
            {isSeries ? (
              <Fact label="Episodes">
                {totalEpisodes} in your library{seasonsInLibrary.length > 1 ? ` · ${seasonsInLibrary.length} seasons` : ""}
              </Fact>
            ) : null}
            {vm.collection ? (
              <Fact label="Collection">
                {factButton(vm.collection.name, () =>
                  vm.navigate("/stream-collection", {
                    state: { collectionId: vm.collection!.id, collectionName: vm.collection!.name },
                  }),
                )}
              </Fact>
            ) : null}
            {vm.movie?.rewatchCount ? <Fact label="Rewatched">{vm.movie.rewatchCount}×</Fact> : null}
            {vm.localPath ? (
              <Fact label={isSeries ? "Folder" : "File"}>
                <span className="text-[12.5px] text-pitflix-subtle">{vm.localPath}</span>
              </Fact>
            ) : null}
          </dl>

          <div className="mt-1 border-t border-white/[0.08] pt-2">
            <button
              type="button"
              aria-expanded={manageOpen}
              onClick={() => setManageOpen((o) => !o)}
              className="flex w-full items-center justify-between py-2 text-[13px] font-bold text-white/60 hover:text-white"
            >
              Manage files &amp; matching
              <ChevronDown className={cn("h-4 w-4 transition", manageOpen && "rotate-180")} />
            </button>
            {manageOpen ? (
              <div className="-mx-3">
                <DetailToolbar {...vm.toolbar} variant="list" extraItems={vm.deviceActions} />
              </div>
            ) : null}
          </div>
        </aside>

        <main className="flex min-w-0 flex-col gap-10 pt-2 md:pt-6">
          {vm.overview ? <p className="max-w-[760px] text-[17px] leading-relaxed text-white/80">{vm.overview}</p> : null}
          {vm.tmdbId > 0 ? <RatingsStrip tmdbId={vm.tmdbId} mediaType={isSeries ? "tv" : "movie"} /> : null}

          {isSeries ? (
            <section className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-[22px] font-extrabold text-white">Episodes</h2>
                <div className="flex items-center gap-4">
                  <SeasonPicker vm={vm} season={season} onChange={setSeason} />
                  {episodes.length > 0 ? (
                    <span className="text-[13px] text-pitflix-subtle">
                      {watchedInSeason} of {episodes.filter((e) => e.inLibrary !== false).length} watched
                    </span>
                  ) : null}
                </div>
              </div>
              {season != null ? (
                <EpisodeList vm={vm} season={season} episodes={episodes} variant="grid" />
              ) : (
                <p className="text-[14px] text-pitflix-muted">No episodes in the library yet.</p>
              )}
            </section>
          ) : null}

          <div className="[&>section]:mt-0">
            <CastCrewSection cast={vm.cast} crew={vm.crew} navigate={vm.navigate} />
          </div>

          {vm.kind === "movie" && vm.collection ? (
            <button
              type="button"
              onClick={() =>
                vm.navigate("/stream-collection", { state: { collectionId: vm.collection!.id, collectionName: vm.collection!.name } })
              }
              className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 text-left hover:bg-white/[0.06]"
            >
              <span>
                <span className="block text-[11px] font-bold uppercase tracking-[0.1em] text-pitflix-light">Part of a collection</span>
                <span className="mt-1 block text-[16px] font-bold text-white">{vm.collection.name}</span>
              </span>
              <ArrowRight className="h-4 w-4 text-pitflix-light" />
            </button>
          ) : null}

          <SimilarRow vm={vm} />
          <div className="[&>*]:my-0">
            <ParentsGuideSection imdbId={vm.imdbId} />
          </div>
          <div className="[&>section]:mt-0">
            <TitleAwardsSection tmdbId={vm.tmdbId} mediaType={isSeries ? "tv" : "movie"} />
          </div>
          <div className="[&>section]:mt-0">
            <VideoExtrasSection videos={vm.extras} />
          </div>
        </main>
      </div>
    </>
  );
}
