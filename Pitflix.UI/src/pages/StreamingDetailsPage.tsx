import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Heart, HeartOff, Play, Tv, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getStreamDetails, getStreamImdbId } from "../api/stream";
import { getLists, addListItem, removeListItem, listContains } from "../api/lists";
import { corsFlixMovieUrl, corsFlixTvUrl } from "../features/streaming/streamEmbedUrls";
import { TvEpisodePickModal } from "../features/streaming/TvEpisodePickModal";
import { streamMovieEmbedUrl, streamTvEmbedUrl } from "../features/streaming/streamEmbedUrls";
import { HorizontalScrollRow } from "../components/ui/HorizontalScrollRow";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../utils/cn";

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

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-md bg-pitflix-card px-2 py-0.5 text-xs text-pitflix-muted">
      {children}
    </span>
  );
}

export function StreamingDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const state = location.state as StreamingDetailsLocationState | null;

  const tmdbId = state?.tmdbId ?? 0;
  const mediaType = state?.mediaType ?? "Movie";
  const autoPlay = state?.autoPlay ?? false;

  const [tvPick, setTvPick] = useState<{ imdbId: string } | null>(null);
  const autoPlayFiredRef = useRef(false);
  const [myListBusy, setMyListBusy] = useState(false);
  const [provider, setProvider] = useState<"streamimdb" | "corsflix">("streamimdb");

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

  // Fetch the default list for "Add to My List"
  const listsQ = useQuery({
    queryKey: ["lists"],
    queryFn: getLists,
    staleTime: 60 * 1000,
  });
  const defaultList = listsQ.data?.find((l) => l.isDefault) ?? listsQ.data?.[0] ?? null;

  const inListQ = useQuery({
    queryKey: ["list-contains", defaultList?.id, tmdbId, mediaType],
    queryFn: () => listContains(defaultList!.id, { tmdbId, mediaType }),
    enabled: defaultList != null && tmdbId > 0,
    staleTime: 30 * 1000,
  });
  const inList = inListQ.data?.inList ?? false;

  const d = detailsQ.data;
  // Use pre-resolved imdbId from navigation state first (avoids TMDB lookup gap for list items)
  const imdbId = imdbQ.data?.imdbId ?? d?.imdbId ?? state?.imdbId ?? null;

  const title = d?.title ?? state?.title ?? "…";
  const year = d?.year ?? state?.year ?? null;
  const posterUrl = d?.posterUrl ?? state?.posterUrl ?? null;
  const backdropUrl = d?.backdropUrl ?? null;
  const overview = d?.overview ?? null;
  const voteAverage = d?.voteAverage ?? 0;
  const voteCount = d?.voteCount ?? 0;
  const genres = d?.genres ?? [];
  const trailer = d?.trailer ?? null;
  const recs = d?.recommendations ?? [];
  const numberOfSeasons = d?.numberOfSeasons ?? 0;
  const seasons = d?.seasons ?? [];
  const cast = d?.cast ?? [];
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
        returnToDetails,
      },
    });
  }

  // Auto-play when navigated from "Play Stream" card button
  useEffect(() => {
    if (!autoPlay || autoPlayFiredRef.current) return;
    // CorsFlix doesn't need imdbId
    if (provider === "corsflix") {
      autoPlayFiredRef.current = true;
      if (mediaType === "Movie") {
        playCorsFlix();
      } else {
        setTvPick({ imdbId: "" }); // opens picker; CorsFlix play handled in onPlay
      }
      return;
    }
    if (imdbLoading || !imdbId) return;
    autoPlayFiredRef.current = true;
    if (mediaType === "Movie") {
      playMovie();
    } else {
      setTvPick({ imdbId });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, imdbLoading, imdbId, mediaType, provider]);

  const toggleMyList = async () => {
    if (!defaultList || myListBusy) return;
    setMyListBusy(true);
    try {
      if (inList) {
        await removeListItem(defaultList.id, tmdbId, mediaType);
      } else {
        await addListItem(defaultList.id, {
          tmdbId,
          mediaType,
          title: title !== "…" ? title : undefined,
          posterRemoteUrl: posterUrl ?? undefined,
          imdbId: imdbId ?? undefined,
        });
      }
      void qc.invalidateQueries({ queryKey: ["list-contains", defaultList.id, tmdbId, mediaType] });
      void qc.invalidateQueries({ queryKey: ["lists"] });
    } catch {
      // ignore
    } finally {
      setMyListBusy(false);
    }
  };

  if (tmdbId === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-pitflix-muted">
        No title selected. Go back to search.
      </div>
    );
  }

  return (
    <div className="relative pb-16">
      {/* Back */}
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
        className="mb-4 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-white hover:bg-white/10"
      >
        <ChevronLeft className="h-4 w-4" />
        Back
      </button>

      {/* Backdrop */}
      {backdropUrl && (
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 overflow-hidden rounded-xl opacity-30">
          <img src={backdropUrl} alt="" className="h-full w-full object-cover object-top" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-pitflix-bg" />
        </div>
      )}

      {/* Hero */}
      <div className="flex gap-5 pt-4">
        {/* Poster */}
        <div className="aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-xl shadow-xl ring-1 ring-white/10 sm:w-40">
          <MediaImage
            src={posterUrl}
            alt={title}
            className="h-full w-full object-cover"
            fallbackText={mediaType === "Movie" ? "Movie" : "TV"}
          />
        </div>

        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-pitflix-primary/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pitflix-light">
              {mediaType === "Movie" ? "Movie" : "TV Series"}
            </span>
            {year && <span className="text-xs text-pitflix-muted">{year}</span>}
          </div>

          <h1 className="text-xl font-bold text-white sm:text-2xl">{title}</h1>

          {voteAverage > 0 && (
            <div className="flex items-center gap-2 text-amber-400">
              <span className="text-base leading-none">★</span>
              <span className="text-sm font-semibold">{voteAverage.toFixed(1)}</span>
              {voteCount > 0 && (
                <span className="text-xs text-pitflix-muted">
                  ({voteCount.toLocaleString()} votes)
                </span>
              )}
            </div>
          )}

          {genres.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {genres.map((g) => <Badge key={g}>{g}</Badge>)}
            </div>
          )}

          {mediaType === "Series" && numberOfSeasons > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-pitflix-muted">
              <Tv className="h-3.5 w-3.5" />
              {numberOfSeasons} season{numberOfSeasons !== 1 ? "s" : ""}
            </p>
          )}

          {/* Provider toggle */}
          <div className="mt-2 flex gap-1 self-start rounded-lg border border-pitflix-card bg-pitflix-bg p-1 text-xs">
            <button
              type="button"
              onClick={() => setProvider("streamimdb")}
              className={cn(
                "rounded px-2.5 py-1 font-semibold transition-colors",
                provider === "streamimdb" ? "bg-pitflix-primary text-white" : "text-pitflix-muted hover:text-white",
              )}
            >
              StreamIMDB
            </button>
            <button
              type="button"
              onClick={() => setProvider("corsflix")}
              className={cn(
                "rounded px-2.5 py-1 font-semibold transition-colors",
                provider === "corsflix" ? "bg-pitflix-primary text-white" : "text-pitflix-muted hover:text-white",
              )}
            >
              CorsFlix
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {provider === "corsflix" ? (
              mediaType === "Movie" ? (
                <button
                  type="button"
                  onClick={() => playCorsFlix()}
                  className="inline-flex items-center gap-2 rounded-xl bg-pitflix-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-pitflix-light"
                >
                  <Play className="h-4 w-4" />
                  Play stream
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setTvPick({ imdbId: "" })}
                  className="inline-flex items-center gap-2 rounded-xl bg-pitflix-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-pitflix-light"
                >
                  <Play className="h-4 w-4" />
                  Select episode
                </button>
              )
            ) : detailsQ.isLoading || imdbLoading ? (
              <Spinner className="h-5 w-5" />
            ) : !imdbId ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-pitflix-muted">StreamIMDB needs an IMDb ID — not found for this title.</p>
                <button
                  type="button"
                  onClick={() => setProvider("corsflix")}
                  className="self-start rounded-lg border border-pitflix-primary/50 bg-pitflix-primary/10 px-3 py-1.5 text-xs font-semibold text-pitflix-light hover:bg-pitflix-primary/20"
                >
                  Try CorsFlix instead
                </button>
              </div>
            ) : mediaType === "Movie" ? (
              <button
                type="button"
                onClick={playMovie}
                className="inline-flex items-center gap-2 rounded-xl bg-pitflix-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-pitflix-light"
              >
                <Play className="h-4 w-4" />
                Play stream
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setTvPick({ imdbId })}
                className="inline-flex items-center gap-2 rounded-xl bg-pitflix-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-pitflix-light"
              >
                <Play className="h-4 w-4" />
                Select episode
              </button>
            )}

            {trailer?.key && (
              <button
                type="button"
                onClick={playTrailer}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-pitflix-card px-4 py-2.5 text-sm font-semibold text-white hover:border-pitflix-primary/50"
              >
                <Video className="h-4 w-4" />
                Trailer
              </button>
            )}

            {defaultList && (
              <button
                type="button"
                disabled={myListBusy || inListQ.isLoading}
                onClick={() => void toggleMyList()}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50",
                  inList
                    ? "border-rose-700/50 bg-rose-950/40 text-rose-300 hover:border-rose-500/60"
                    : "border-white/15 bg-pitflix-card text-white hover:border-pitflix-primary/50",
                )}
              >
                {inList ? <HeartOff className="h-4 w-4" /> : <Heart className="h-4 w-4" />}
                {inList ? "Remove from list" : "Add to My List"}
              </button>
            )}

          </div>
        </div>
      </div>

      {/* Loading state */}
      {detailsQ.isLoading && (
        <div className="mt-10 flex justify-center">
          <Spinner />
        </div>
      )}

      {/* Overview */}
      {overview && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-pitflix-muted">Overview</h2>
          <p className="text-sm leading-relaxed text-white/80">{overview}</p>
        </div>
      )}

      {/* Seasons */}
      {seasons.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-pitflix-muted">Seasons</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {seasons.map((s) => (
              <button
                key={s.seasonNumber}
                type="button"
                onClick={() =>
                  navigate("/stream-season", {
                    state: {
                      tmdbId,
                      seasonNumber: s.seasonNumber,
                      seriesTitle: title,
                      imdbId: imdbId ?? null,
                      provider,
                    },
                  })
                }
                className="group flex flex-col overflow-hidden rounded-lg border border-pitflix-card/60 bg-pitflix-surface/60 text-left shadow hover:border-pitflix-primary/50"
              >
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
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cast */}
      {cast.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-pitflix-muted">Cast</h2>
          <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3 pb-2">
            {cast.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => navigate(`/person/${person.id}`)}
                className="group flex w-20 shrink-0 flex-col items-center gap-1.5 text-center"
              >
                <div className="h-20 w-20 overflow-hidden rounded-full border border-white/10 bg-pitflix-card/60 ring-2 ring-transparent transition-all group-hover:ring-pitflix-primary/60">
                  <MediaImage
                    src={person.profileUrl}
                    alt={person.name}
                    className="h-full w-full object-cover transition-opacity group-hover:opacity-85"
                    fallbackText="?"
                  />
                </div>
                <p className="line-clamp-2 text-[11px] font-semibold leading-tight text-white group-hover:text-pitflix-primary">{person.name}</p>
                {person.character && (
                  <p className="line-clamp-1 text-[10px] leading-tight text-pitflix-muted">{person.character}</p>
                )}
              </button>
            ))}
          </HorizontalScrollRow>
        </div>
      )}

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
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
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
                <div className="p-2">
                  <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-white">{r.title}</p>
                  {r.year && <p className="mt-0.5 text-[10px] text-pitflix-muted">{r.year}</p>}
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
            if (provider === "corsflix") {
              playCorsFlix(season, episode);
            } else {
              playTv(season, episode);
            }
            setTvPick(null);
          }}
        />
      )}
    </div>
  );
}
