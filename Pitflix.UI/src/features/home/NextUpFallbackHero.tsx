import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Info, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getShow, getShowSeason } from "../../api/series";
import type { WatchingCurrentlyCard } from "../../api/homeDiscover";
import { MediaImage } from "../../components/ui/MediaImage";
import { toPosterSrc } from "../../utils/posterSrc";
import { useResumeBeforePlay } from "../../hooks/useResumeBeforePlay";

type SeasonEpisodeRow = {
  id?: number | null;
  episodeNumber: number;
  title?: string | null;
  overview?: string | null;
  filePath?: string | null;
  runtimeMinutes?: number | null;
  stillLocalPath?: string | null;
  stillUrl?: string | null;
};

/**
 * Fallback hero shown when "Continue watching" has nothing in progress —
 * surfaces the next unwatched episode of the show the user most recently
 * finished an episode of, so the home page never presents an empty hero
 * while the user is mid-series.
 */
export function NextUpFallbackHero({ card }: { card: WatchingCurrentlyCard }) {
  const navigate = useNavigate();
  const { requestPlay, ResumePromptModal } = useResumeBeforePlay();

  const seasonQ = useQuery({
    queryKey: ["show-season", card.libraryShowId, card.nextSeason],
    queryFn: () => getShowSeason(card.libraryShowId, card.nextSeason),
    enabled: card.libraryShowId > 0 && card.nextSeason > 0,
    staleTime: 60_000,
    // This hero's backdrop depends on the show having a backdrop by the time it's cached — if that
    // finished downloading shortly after an earlier cache of this same query, the stale snapshot
    // would keep showing the episode-still fallback for up to staleTime. Always refetch on mount so
    // the hero reflects current backend state instead of requiring a full page reload to pick it up.
    refetchOnMount: "always",
  });

  const showQ = useQuery({
    queryKey: ["show", card.libraryShowId],
    queryFn: () => getShow(card.libraryShowId),
    enabled: card.libraryShowId > 0,
    staleTime: 5 * 60_000,
    refetchOnMount: "always",
  });

  const episodes = (seasonQ.data?.episodes ?? []) as SeasonEpisodeRow[];
  const episode = episodes.find((e) => e.episodeNumber === card.nextEpisode);

  const show = showQ.data?.show as
    | { selectedBackdropPath?: string; backdropLocalPath?: string }
    | undefined;

  const posterSrc = toPosterSrc(card.posterUrl ?? undefined);
  const backdropSrc = toPosterSrc(
    show?.selectedBackdropPath || show?.backdropLocalPath || episode?.stillUrl || undefined,
  );

  const seasonRoute = `/series/${card.libraryShowId}/season/${card.nextSeason}`;
  const episodeHeadline = episode?.title?.trim() || `Episode ${card.nextEpisode}`;

  return (
    <>
      {ResumePromptModal}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        aria-label={`Up next: ${card.showTitle}`}
        className="relative mb-8 min-h-[360px] w-full overflow-hidden rounded-2xl ring-1 ring-white/10"
      >
        {/* Backdrop */}
        <div className="absolute inset-0">
          {backdropSrc ? (
            <img src={backdropSrc} alt="" className="h-full w-full object-cover object-center" loading="eager" />
          ) : (
            <div
              className={
                posterSrc
                  ? "h-full w-full scale-110 bg-cover bg-center opacity-25 blur-2xl"
                  : "h-full w-full bg-pitflix-card"
              }
              style={posterSrc ? { backgroundImage: `url(${posterSrc})` } : undefined}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/70 to-black/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/15" />
        </div>

        {/* Content */}
        <div className="relative z-[1] flex min-h-[360px] items-end p-6 sm:p-10">
          <div className="flex w-full items-end gap-6">
            <div className="min-w-0 max-w-2xl flex-1">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-pitflix-primary">
                Up next · {card.showTitle}
              </p>

              <h2 className="line-clamp-2 text-3xl font-bold leading-tight text-white sm:text-4xl md:text-[42px]">
                {episodeHeadline}
              </h2>

              <p className="mt-2 text-sm text-pitflix-muted">
                S{card.nextSeason} E{card.nextEpisode}
              </p>

              {episode?.overview ? (
                <p className="mt-3 line-clamp-2 max-w-xl text-sm leading-relaxed text-pitflix-muted/90">
                  {episode.overview}
                </p>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-2">
                {episode?.filePath ? (
                  <button
                    type="button"
                    aria-label={`Play ${episodeHeadline}`}
                    className="inline-flex items-center gap-2 rounded-xl bg-pitflix-primary px-6 py-3 text-sm font-bold text-white shadow-lg shadow-pitflix-primary/30 transition hover:bg-pitflix-light active:scale-95"
                    onClick={() =>
                      void requestPlay({
                        filePath: episode.filePath!,
                        title: `${card.showTitle} · ${episodeHeadline}`,
                        posterPath: card.posterUrl ?? null,
                        mediaType: "Series",
                        durationSeconds: 0,
                        context: {
                          libraryShowId: card.libraryShowId,
                          libraryEpisodeId: episode.id ?? undefined,
                          season: card.nextSeason,
                          episodeNumber: card.nextEpisode,
                        },
                      })
                    }
                  >
                    <Play className="h-4 w-4 fill-current" />
                    Play
                  </button>
                ) : (
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-xl bg-pitflix-primary px-6 py-3 text-sm font-bold text-white shadow-lg shadow-pitflix-primary/30 transition hover:bg-pitflix-light active:scale-95"
                    onClick={() => navigate(seasonRoute)}
                  >
                    <Play className="h-4 w-4 fill-current" />
                    Go to episode
                  </button>
                )}

                <button
                  type="button"
                  aria-label={`Details for ${card.showTitle}`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:border-pitflix-primary/50 hover:bg-white/5"
                  onClick={() => navigate(seasonRoute)}
                >
                  <Info className="h-4 w-4" />
                  Details
                </button>
              </div>
            </div>

            {/* Poster */}
            <div className="hidden shrink-0 xl:block">
              <MediaImage
                src={posterSrc}
                alt=""
                className="aspect-[2/3] h-52 w-[138px] rounded-xl bg-pitflix-card object-cover shadow-2xl ring-1 ring-white/15"
                fallbackText={card.showTitle.slice(0, 2).toUpperCase()}
                loading="eager"
              />
            </div>
          </div>
        </div>
      </motion.section>
    </>
  );
}
