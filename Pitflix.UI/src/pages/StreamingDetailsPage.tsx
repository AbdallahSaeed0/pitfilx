import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Download, Play, Tv, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getStreamDetails, getStreamImdbId, type StreamDetailsCastMember, type StreamDetailsCrewMember } from "../api/stream";
import { corsFlixMovieUrl, corsFlixTvUrl } from "../features/streaming/streamEmbedUrls";
import { TvEpisodePickModal } from "../features/streaming/TvEpisodePickModal";
import { StreamingTitleActions } from "../components/streaming/StreamingTitleActions";
import { MediaContextMenu } from "../features/library/MediaContextMenu";
import { useMediaContextMenu } from "../features/library/useMediaContextMenu";
import { WsmDownloadModal } from "../components/WsmDownloadModal";
import { streamMovieEmbedUrl, streamTvEmbedUrl } from "../features/streaming/streamEmbedUrls";
import { AirDateCountdown } from "../components/ui/AirDateCountdown";
import { HorizontalDragScroll } from "../components/ui/HorizontalDragScroll";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { RatingsPanel } from "../components/RatingsPanel";
import { ParentsGuideSection } from "../components/ParentsGuideSection";
import { cn } from "../utils/cn";

type StreamCastTabKey = "cast" | "directors" | "writers" | "crew";

function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function StreamPersonPortraitCard({ name, role, imgSrc, onClick }: {
  name: string; role?: string | null; imgSrc?: string | null; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="w-[110px] shrink-0 text-left focus:outline-none">
      <div className="aspect-[2/3] overflow-hidden rounded-xl bg-pitflix-surface ring-1 ring-white/[0.08] transition group-hover:ring-pitflix-primary/50">
        <MediaImage
          src={imgSrc ?? undefined}
          alt={name}
          className="h-full w-full object-cover object-top transition-transform duration-300 hover:scale-105"
          fallbackText={name.slice(0, 2)}
        />
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] font-semibold leading-snug text-white">{name}</p>
      {role ? <p className="mt-0.5 line-clamp-1 text-[10px] text-pitflix-subtle">{role}</p> : null}
    </button>
  );
}

function StreamCastCrewSection({ cast, crew, navigate }: {
  cast: StreamDetailsCastMember[];
  crew: StreamDetailsCrewMember[];
  navigate: (to: string) => void;
}) {
  const [tab, setTab] = useState<StreamCastTabKey>("cast");

  const directors = crew.filter((c) => c.job.toLowerCase() === "director");
  const writers = crew.filter((c) => {
    const j = c.job.toLowerCase();
    return j === "writer" || j === "screenplay" || j === "story" || j === "co-writer" || j.includes("writer");
  });
  const otherCrew = crew.filter((c) => {
    const j = c.job.toLowerCase();
    return j !== "director" && !j.includes("writer") && j !== "screenplay" && j !== "story";
  });

  const tabs: { key: StreamCastTabKey; label: string; count: number }[] = (
    [
      { key: "cast", label: "Cast", count: cast.length },
      { key: "directors", label: "Directors", count: directors.length },
      { key: "writers", label: "Writers", count: writers.length },
      { key: "crew", label: "Crew", count: otherCrew.length },
    ] as { key: StreamCastTabKey; label: string; count: number }[]
  ).filter((t) => t.count > 0);

  const items: { name: string; role?: string | null; imgSrc?: string | null; id: number; key: string }[] =
    tab === "cast"
      ? cast.map((c) => ({ name: c.name, role: c.character, imgSrc: c.profileUrl, id: c.id, key: `${c.id}-${c.name}` }))
      : tab === "directors"
      ? directors.map((c) => ({ name: c.name, role: c.job, imgSrc: c.profileUrl, id: c.id, key: `${c.id}-${c.job}` }))
      : tab === "writers"
      ? writers.map((c) => ({ name: c.name, role: c.job, imgSrc: c.profileUrl, id: c.id, key: `${c.id}-${c.job}` }))
      : otherCrew.map((c) => ({ name: c.name, role: c.job, imgSrc: c.profileUrl, id: c.id, key: `${c.id}-${c.job}` }));

  if (tabs.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-pitflix-muted">Cast &amp; Crew</h2>
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-semibold transition-all",
                tab === t.key
                  ? "bg-pitflix-primary text-white shadow-sm"
                  : "border border-white/10 text-pitflix-muted hover:border-white/25 hover:text-white",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <HorizontalDragScroll className="gap-3 pb-2">
        {items.map((item) => (
          <StreamPersonPortraitCard
            key={item.key}
            name={item.name}
            role={item.role}
            imgSrc={item.imgSrc}
            onClick={() => (item.id > 0 ? navigate(`/person/${item.id}`) : undefined)}
          />
        ))}
      </HorizontalDragScroll>
    </div>
  );
}

export type StreamingDetailsLocationState = {
  tmdbId: number;
  mediaType: "Movie" | "Series";
  /** Minimal data shown while details load */
  title?: string;
  posterUrl?: string | null;
  year?: string | null;
  /** Pre-resolved IMDb ID (skips TMDB lookup when provided). */
  imdbId?: string | null;
  /** When true, auto-trigger play as soon as IMDb ID is available */
  autoPlay?: boolean;
  /** Search state to restore when going back to OnlineStreamPage */
  returnSeedQuery?: string;
  returnSeedKind?: "Both" | "Movie" | "Series";
};

export function StreamingDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as StreamingDetailsLocationState | null;

  const tmdbId = state?.tmdbId ?? 0;
  const mediaType = state?.mediaType ?? "Movie";
  const autoPlay = state?.autoPlay ?? false;

  const [tvPick, setTvPick] = useState<{ imdbId: string; provider: "streamimdb" | "corsflix" } | null>(null);
  const [wsmDownloadOpen, setWsmDownloadOpen] = useState(false);
  const [wsmSeasonDownload, setWsmSeasonDownload] = useState<number | null>(null);
  const autoPlayFiredRef = useRef(false);
  const { menu, closeMenu, handleContextMenu, runAction } = useMediaContextMenu();

  const detailsQ = useQuery({
    queryKey: ["stream-details", tmdbId, mediaType],
    queryFn: () => getStreamDetails(tmdbId, mediaType),
    enabled: tmdbId > 0,
    staleTime: 5 * 60 * 1000,
  });

  const imdbQ = useQuery({
    queryKey: ["stream-imdb", tmdbId, mediaType],
    queryFn: () => getStreamImdbId(tmdbId, mediaType),
    enabled: tmdbId > 0,
    staleTime: 10 * 60 * 1000,
  });

  const d = detailsQ.data;
  // Use pre-resolved imdbId from navigation state first (avoids TMDB lookup gap for list items)
  const imdbId = imdbQ.data?.imdbId ?? d?.imdbId ?? state?.imdbId ?? null;

  const title = d?.title ?? state?.title ?? "…";
  const year = d?.year ?? state?.year ?? null;
  const releaseDate = d?.releaseDate ?? null;
  const isUpcoming = !!releaseDate && new Date(releaseDate) > new Date();
  const posterUrl = d?.posterUrl ?? state?.posterUrl ?? null;
  const backdropUrl = d?.backdropUrl ?? null;
  const overview = d?.overview ?? null;
  const voteAverage = d?.voteAverage ?? 0;
  const voteCount = d?.voteCount ?? 0;
  const genres = d?.genres ?? [];
  const trailer = d?.trailer ?? null;
  const recs = d?.recommendations ?? [];
  const numberOfSeasons = d?.numberOfSeasons ?? 0;
  const runtimeMinutes = d?.runtimeMinutes ?? null;
  const seasons = d?.seasons ?? [];
  const cast = d?.cast ?? [];
  const crew = d?.crew ?? [];
  const collection = (d as { collection?: { id: number; name: string; posterUrl?: string | null } | null })?.collection ?? null;

  const imdbLoading = imdbQ.isFetching || (imdbId == null && imdbQ.fetchStatus !== "idle");

  const returnToDetails = {
    tmdbId,
    mediaType,
    title: state?.title ?? title,
    posterUrl: posterUrl ?? state?.posterUrl ?? null,
    year: year ?? state?.year ?? null,
    imdbId: imdbId ?? state?.imdbId ?? null,
  };

  const playMovie = useCallback(() => {
    if (!imdbId) return;
    navigate("/stream-player", {
      state: {
        streamUrl: streamMovieEmbedUrl(imdbId),
        title,
        libraryWatchMeta: { tmdbId, mediaType: "Movie" as const },
        posterUrl,
        imdbId,
        returnToDetails,
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imdbId, navigate, title, tmdbId, returnToDetails]);

  function playTv(season: number, episode: number) {
    if (!imdbId) return;
    navigate("/stream-player", {
      state: {
        streamUrl: streamTvEmbedUrl(imdbId, season, episode),
        title: `${title} · S${season}E${episode}`,
        libraryWatchMeta: { tmdbId, mediaType: "Series" as const, season, episode },
        posterUrl,
        imdbId,
        returnToDetails,
      },
    });
  }

  function playTrailer() {
    if (!trailer?.key) return;
    navigate("/stream-player", {
      state: {
        streamUrl: `https://www.youtube.com/embed/${trailer.key}?autoplay=1`,
        title: trailer.name ?? `${title} — Trailer`,
        returnToDetails,
      },
    });
  }

  function playCorsFlix(season?: number, episode?: number) {
    const streamUrl =
      mediaType === "Movie"
        ? corsFlixMovieUrl(tmdbId)
        : corsFlixTvUrl(tmdbId, season ?? 1, episode ?? 1);
    const epLabel = season != null ? ` · S${season}E${episode}` : "";
    navigate("/stream-player", {
      state: {
        streamUrl,
        title: `${title}${epLabel}`,
        libraryWatchMeta: mediaType === "Movie"
          ? { tmdbId, mediaType: "Movie" as const }
          : { tmdbId, mediaType: "Series" as const, season, episode },
        posterUrl,
        imdbId,
        returnToDetails,
      },
    });
  }

  // Auto-play when navigated from "Play Stream" card button — prefer StreamIMDB,
  // fall back to CorsFlix automatically once the IMDb lookup settles with no result.
  useEffect(() => {
    if (!autoPlay || autoPlayFiredRef.current) return;
    if (isUpcoming) return;
    if (imdbLoading) return;
    autoPlayFiredRef.current = true;
    if (imdbId) {
      if (mediaType === "Movie") playMovie();
      else setTvPick({ imdbId, provider: "streamimdb" });
    } else {
      if (mediaType === "Movie") playCorsFlix();
      else setTvPick({ imdbId: "", provider: "corsflix" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, imdbLoading, imdbId, mediaType]);

  if (tmdbId === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-pitflix-muted">
        No title selected. Go back to search.
      </div>
    );
  }

  return (
    <div className="pb-16">
      {/* ── CINEMATIC HERO ── */}
      <div className="-mx-6 -mt-12">
        <div className="relative h-[560px] overflow-hidden bg-pitflix-card">
          <button
            type="button"
            onClick={() => {
              if (state?.returnSeedQuery) {
                navigate("/online-stream", {
                  state: { seedQuery: state.returnSeedQuery, seedKind: state.returnSeedKind ?? "Both" },
                });
              } else {
                navigate(-1);
              }
            }}
            className="absolute left-6 top-6 z-20 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/[0.32] px-[18px] py-2 text-[13px] font-medium text-white shadow-lg backdrop-blur-xl transition hover:bg-black/55"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <div className="pointer-events-none absolute inset-0">
            {backdropUrl ? (
              <div className="absolute inset-0 [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_img]:object-top [&_img]:opacity-75">
                <MediaImage src={backdropUrl} alt="" className="h-full w-full bg-pitflix-card" fallbackText="" />
              </div>
            ) : (
              <div className="absolute inset-0 bg-pitflix-card" />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-pitflix-bg via-pitflix-bg/55 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 h-2/3 bg-gradient-to-t from-pitflix-bg via-pitflix-bg/60 to-transparent" />
          </div>
          <div
            className="absolute bottom-0 left-0 right-0 z-10 flex items-end gap-9 px-12 pb-9"
            onContextMenu={handleContextMenu({
              kind: "streaming",
              tmdbId,
              mediaType,
              title,
              posterUrl,
              imdbId,
            })}
          >
            <MediaImage
              src={posterUrl}
              alt={title}
              className="h-[228px] w-[152px] shrink-0 overflow-hidden rounded-[9px] object-cover object-center shadow-[0_20px_60px_rgba(0,0,0,0.75)] ring-1 ring-white/[0.08]"
              fallbackText={mediaType === "Movie" ? "Movie" : "TV"}
            />
            <div className="min-w-0 flex-1 pb-1">
              <div className="mb-3">
                <span className="inline-flex items-center rounded-full border border-white/[0.15] bg-white/[0.08] px-[14px] py-1 text-[11px] font-semibold tracking-[0.06em] text-white/80">
                  {mediaType === "Movie" ? "MOVIE" : "TV SERIES"}
                </span>
              </div>
              <h1 className="mb-2.5 text-[42px] font-semibold leading-[1.05] tracking-tight text-white [text-shadow:0_2px_20px_rgba(0,0,0,0.55)]">
                {title}
              </h1>
              <div className="mb-3 flex flex-wrap items-center gap-2.5 text-sm text-white/50">
                {year && <span>{year}</span>}
                {voteAverage > 0 && (
                  <>
                    {year && <span className="text-white/15">·</span>}
                    <span className="flex items-center gap-1.5">
                      <span className="text-amber-400">★</span>
                      <span>{voteAverage.toFixed(1)}</span>
                      {voteCount > 0 && <span>({voteCount.toLocaleString()} votes)</span>}
                    </span>
                  </>
                )}
                {mediaType === "Series" && numberOfSeasons > 0 && (
                  <>
                    <span className="text-white/15">·</span>
                    <span className="flex items-center gap-1.5">
                      <Tv className="h-3.5 w-3.5" />
                      {numberOfSeasons} season{numberOfSeasons !== 1 ? "s" : ""}
                    </span>
                  </>
                )}
                {runtimeMinutes != null && runtimeMinutes > 0 && (
                  <>
                    <span className="text-white/15">·</span>
                    <span>{formatRuntime(runtimeMinutes)}{mediaType === "Series" ? " / ep" : ""}</span>
                  </>
                )}
              </div>
              {genres.length > 0 ? (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {genres.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => navigate(`/genre/${encodeURIComponent(g)}`)}
                      className="rounded-2xl border border-violet-400/[0.22] bg-violet-500/[0.12] px-3 py-[3px] text-xs font-medium text-violet-300 transition hover:bg-violet-500/[0.22] hover:border-violet-400/[0.4]"
                    >
                      {g}
                    </button>
                  ))}
                </div>
              ) : null}
              {overview ? (
                <p className="mb-6 line-clamp-3 max-w-[540px] text-sm leading-[1.68] text-white/[0.58]">
                  {overview}
                </p>
              ) : null}

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                {detailsQ.isLoading || imdbLoading ? (
                  <Spinner className="h-5 w-5" />
                ) : isUpcoming ? (
                  <AirDateCountdown airDate={releaseDate!} layout="inline" />
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={!imdbId}
                      title={imdbId ? undefined : "StreamIMDB needs an IMDb ID — not found for this title."}
                      onClick={() => {
                        if (mediaType === "Movie") playMovie();
                        else if (imdbId) setTvPick({ imdbId, provider: "streamimdb" });
                      }}
                      className="flex items-center gap-2.5 rounded-[9px] bg-[#7c3aed] px-[26px] py-[13px] text-sm font-semibold text-white shadow-[0_4px_24px_rgba(124,58,237,0.45)] transition hover:-translate-y-px hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Play className="h-4 w-4" />
                      Play on StreamIMDB
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (mediaType === "Movie") playCorsFlix();
                        else setTvPick({ imdbId: imdbId ?? "", provider: "corsflix" });
                      }}
                      className="flex items-center gap-2.5 rounded-[9px] bg-[#0891b2] px-[26px] py-[13px] text-sm font-semibold text-white shadow-[0_4px_24px_rgba(8,145,178,0.45)] transition hover:-translate-y-px hover:bg-[#0e7490]"
                    >
                      <Play className="h-4 w-4" />
                      Play on CorsFlix
                    </button>
                  </>
                )}

                {trailer?.key && (
                  <button
                    type="button"
                    onClick={playTrailer}
                    className="flex items-center gap-2 rounded-[9px] border border-white/[0.11] bg-white/[0.07] px-5 py-[13px] text-sm font-medium text-white/[0.62] transition hover:bg-white/[0.14]"
                  >
                    <Video className="h-4 w-4" />
                    Trailer
                  </button>
                )}

                {mediaType === "Movie" && !isUpcoming && (
                  <button
                    type="button"
                    disabled={!year || title === "…"}
                    onClick={() => setWsmDownloadOpen(true)}
                    className="flex items-center gap-2 rounded-[9px] border border-white/[0.11] bg-white/[0.07] px-5 py-[13px] text-sm font-medium text-white/[0.62] transition hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Download className="h-4 w-4" />
                    Download
                  </button>
                )}

                {tmdbId > 0 ? (
                  <StreamingTitleActions
                    tmdbId={tmdbId}
                    mediaType={mediaType}
                    title={title}
                    posterUrl={posterUrl}
                    imdbId={imdbId}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <WsmDownloadModal
        isOpen={wsmDownloadOpen}
        onClose={() => setWsmDownloadOpen(false)}
        mode="movie"
        tmdbId={tmdbId}
        imdbId={imdbId}
        title={title}
        year={year ? parseInt(year, 10) : null}
      />

      {/* ── RATINGS ── */}
      <div className="-mx-6 border-t border-white/5 px-12 py-5">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/35">Ratings</p>
        <RatingsPanel
          tmdbId={tmdbId}
          mediaType={mediaType === "Movie" ? "movie" : "tv"}
          thumbnailSrc={backdropUrl ?? posterUrl ?? undefined}
        />
      </div>

      <ParentsGuideSection imdbId={imdbId} />

      {/* Seasons */}
      {seasons.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-pitflix-muted">Seasons</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {seasons.map((s) => (
              <div
                key={s.seasonNumber}
                role="button"
                tabIndex={0}
                onClick={() =>
                  navigate("/stream-season", {
                    state: {
                      tmdbId,
                      seasonNumber: s.seasonNumber,
                      seriesTitle: title,
                      seriesYear: year ? parseInt(year, 10) : null,
                      seriesPosterUrl: posterUrl,
                      seasons: seasons.map((sx) => sx.seasonNumber),
                      imdbId: imdbId ?? null,
                    },
                  })
                }
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.click()}
                onContextMenu={handleContextMenu({
                  kind: "streaming",
                  tmdbId,
                  mediaType: "Series",
                  title: `${title} · ${s.name}`,
                  posterUrl,
                  imdbId,
                  seasonNumber: s.seasonNumber,
                })}
                className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border border-pitflix-card/60 bg-pitflix-surface/60 text-left shadow hover:border-pitflix-primary/50"
              >
                <button
                  type="button"
                  title={`Download ${s.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setWsmSeasonDownload(s.seasonNumber);
                  }}
                  className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <div className="aspect-[2/3] w-full bg-pitflix-card/40">
                  <MediaImage
                    src={s.posterUrl}
                    alt={s.name}
                    className="h-full w-full object-cover transition-opacity group-hover:opacity-80"
                    fallbackText="TV"
                  />
                </div>
                <div className="p-2">
                  <p className="line-clamp-1 text-[11px] font-semibold leading-snug text-white">{s.name}</p>
                  <p className="mt-0.5 text-[10px] text-pitflix-muted">
                    {s.episodeCount} ep{s.episodeCount !== 1 ? "s" : ""}
                    {s.airDate ? ` · ${s.airDate.slice(0, 4)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <WsmDownloadModal
        isOpen={wsmSeasonDownload != null}
        onClose={() => setWsmSeasonDownload(null)}
        mode="season"
        tmdbId={tmdbId}
        imdbId={imdbId}
        title={title}
        season={wsmSeasonDownload ?? undefined}
        episodeLabel={wsmSeasonDownload != null ? `Season ${wsmSeasonDownload}` : undefined}
      />

      {/* Cast & Crew */}
      <StreamCastCrewSection cast={cast} crew={crew} navigate={navigate} />

      {/* Collection */}
      {collection && mediaType === "Movie" && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-pitflix-card bg-pitflix-surface/40 p-4">
          <div className="flex items-center gap-3 min-w-0">
            {collection.posterUrl && (
              <img
                src={collection.posterUrl}
                alt={collection.name}
                className="h-14 w-10 shrink-0 rounded object-cover shadow"
              />
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-pitflix-primary">Part of a collection</p>
              <p className="truncate text-base font-bold text-white">{collection.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              navigate("/stream-collection", {
                state: { collectionId: collection.id, collectionName: collection.name },
              })
            }
            className="shrink-0 rounded-lg border border-pitflix-primary/50 px-3 py-1.5 text-xs font-medium text-pitflix-primary hover:bg-pitflix-primary/10"
          >
            View All →
          </button>
        </div>
      )}

      {/* Recommendations */}
      {recs.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-pitflix-muted">More like this</h2>
          <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-8">
            {recs.map((r) => (
              <button
                key={`${r.mediaType}-${r.id}`}
                type="button"
                onClick={() =>
                  navigate("/stream-details", {
                    state: {
                      tmdbId: r.id,
                      mediaType: r.mediaType,
                      title: r.title,
                      posterUrl: r.posterUrl,
                      year: r.year,
                    } satisfies StreamingDetailsLocationState,
                  })
                }
                className="group flex flex-col overflow-hidden rounded-lg border border-pitflix-card/60 bg-pitflix-surface/60 text-left shadow"
              >
                <div className="aspect-[2/3] w-full bg-pitflix-card/40">
                  <MediaImage
                    src={r.posterUrl}
                    alt={r.title}
                    className="h-full w-full object-cover transition-opacity group-hover:opacity-80"
                    fallbackText={r.mediaType === "Movie" ? "Movie" : "TV"}
                  />
                </div>
                <div className="p-1.5">
                  <p className="line-clamp-2 text-[10px] font-semibold leading-snug text-white">{r.title}</p>
                  {r.year && <p className="mt-0.5 text-[9px] text-pitflix-muted">{r.year}</p>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* TV episode picker */}
      {tvPick && (
        <TvEpisodePickModal
          open
          title={title}
          tmdbId={tmdbId}
          imdbId={tvPick.imdbId}
          onClose={() => setTvPick(null)}
          onPlay={(season, episode) => {
            if (tvPick.provider === "corsflix") {
              playCorsFlix(season, episode);
            } else {
              playTv(season, episode);
            }
            setTvPick(null);
          }}
        />
      )}
      {menu ? (
        <MediaContextMenu
          label={menu.target.title}
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
