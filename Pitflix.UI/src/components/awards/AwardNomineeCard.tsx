import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Info, ListPlus, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { TrailerCard } from "../../api/homeDiscover";
import { browseTrailers } from "../../api/homeDiscover";
import { getPosters } from "../../api/images";
import { addListItem, getLists } from "../../api/lists";
import { getStreamImdbId } from "../../api/stream";
import { getTrailersForTmdbTitle } from "../../api/trailers";
import type { AwardNominee } from "../../api/awards";
import { TvEpisodePickModal } from "../../features/streaming/TvEpisodePickModal";
import { streamMovieEmbedUrl, streamTvEmbedUrl } from "../../features/streaming/streamEmbedUrls";
import type { LibraryTmdbIndex } from "../../hooks/useLibraryTmdbIndex";
import { TrailerModal } from "../trailers/TrailerModal";
import { MediaImage } from "../ui/MediaImage";
import { cn } from "../../utils/cn";
import {
  nomineeMediaKind,
  nomineeMediaTypeLabel,
} from "../../utils/awardNomineeMedia";
import type { StreamingDetailsLocationState } from "../../pages/StreamingDetailsPage";
import { resolveTmdbIdFromTitleYear } from "../../utils/awardNomineeResolve";
import { toPosterSrc } from "../../utils/posterSrc";
import { youtubeKeyFromWatchOrEmbedUrl } from "../../utils/youtubeUrl";

export type AwardNomineeCardProps = {
  nominee: AwardNominee;
  listIndex: number;
  ceremonyYear: number;
  libraryIndex?: LibraryTmdbIndex | null;
};

function formatMediaType(raw: string) {
  if (!raw) return "";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isPlaceholderPoster(url: string | null | undefined) {
  return (
    !url ||
    url.includes("/api/awards/placeholder/poster") ||
    url.includes("awards/placeholder/poster")
  );
}

async function fetchImdbWithMediaFallback(tmdbId: number, primary: "Movie" | "Series") {
  const a = await getStreamImdbId(tmdbId, primary);
  if (a.imdbId) return { imdbId: a.imdbId, media: primary };
  const alt = primary === "Movie" ? "Series" : "Movie";
  const b = await getStreamImdbId(tmdbId, alt);
  if (b.imdbId) return { imdbId: b.imdbId, media: alt };
  return { imdbId: null as string | null, media: primary };
}

function useNomineePosterSrc(nominee: AwardNominee, effectiveTmdbId: number | null) {
  const label = nomineeMediaTypeLabel(nominee.mediaType);
  const rawUrl = nominee.posterUrl;
  const tid = effectiveTmdbId && effectiveTmdbId > 0 ? effectiveTmdbId : 0;

  const q = useQuery({
    queryKey: ["award-nominee-poster", tid, label],
    queryFn: async () => {
      const rows = await getPosters(tid, label);
      const r0 = (rows as { filePath?: string; file_path?: string }[])[0];
      const fp = r0?.filePath ?? r0?.file_path;
      if (!fp) return null;
      return toPosterSrc(`https://image.tmdb.org/t/p/w342${fp.startsWith("/") ? fp : `/${fp}`}`);
    },
    enabled: tid > 0,
    staleTime: 7 * 86_400_000,
  });

  return useMemo(() => {
    if (tid > 0 && q.data) return q.data;
    const cached = toPosterSrc(rawUrl ?? undefined);
    if (cached && rawUrl && !isPlaceholderPoster(rawUrl)) return cached;
    return cached;
  }, [tid, q.data, rawUrl]);
}

export function AwardNomineeCard({
  nominee,
  listIndex,
  ceremonyYear,
  libraryIndex,
}: AwardNomineeCardProps) {
  const { title, mediaType, tmdbId: rawTmdbId, winner } = nominee;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const kind = nomineeMediaKind(mediaType);
  const mtLabel = nomineeMediaTypeLabel(mediaType);

  const resolveQ = useQuery({
    queryKey: ["award-resolve-tmdb", title, ceremonyYear, mtLabel],
    queryFn: () => resolveTmdbIdFromTitleYear(title, ceremonyYear, mtLabel),
    enabled: !rawTmdbId && title.trim().length >= 2,
    staleTime: 86_400_000,
    gcTime: 604_800_000,
  });

  const effectiveTmdbId = rawTmdbId ?? resolveQ.data ?? null;
  const posterSrc = useNomineePosterSrc(nominee, effectiveTmdbId);

  const [toast, setToast] = useState<string | null>(null);
  const [tvPick, setTvPick] = useState<{ imdbId: string } | null>(null);
  const [trailerCard, setTrailerCard] = useState<TrailerCard | null>(null);

  const listsQ = useQuery({ queryKey: ["lists"], queryFn: getLists, staleTime: 60_000 });
  const watchlist = listsQ.data?.find((l) => l.isDefault) ?? listsQ.data?.[0];

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  };

  const trailerMut = useMutation({
    mutationFn: async () => {
      let tid = effectiveTmdbId;
      if (!tid) tid = await resolveTmdbIdFromTitleYear(title, ceremonyYear, mtLabel);
      if (!tid) throw new Error("no-tmdb");
      const filter = kind === "tv" ? "tv" : "movie";
      const data = await getTrailersForTmdbTitle(tid, filter);
      const url = data.primary?.youtubeUrl ?? null;
      if (youtubeKeyFromWatchOrEmbedUrl(url)) {
        return {
          mode: "persisted" as const,
          tid,
          url: url!,
          trailerTitle: data.primary?.title?.trim() || "Trailer",
        };
      }
      const browse = await browseTrailers("trending", kind === "tv" ? "tv" : "movie", title);
      const hit = browse.find((x) => x.tmdbId === tid) ?? browse.find((x) => x.youtubeKey) ?? browse[0];
      if (hit?.youtubeKey) return { mode: "browse" as const, card: hit };
      throw new Error("no-trailer");
    },
    onSuccess: (res) => {
      if (res.mode === "browse") {
        setTrailerCard(res.card);
        return;
      }
      const key = youtubeKeyFromWatchOrEmbedUrl(res.url);
      if (!key) {
        showToast("No trailer found for this title.");
        return;
      }
      setTrailerCard({
        tmdbId: res.tid,
        mediaType: kind === "tv" ? "tv" : "movie",
        title,
        posterUrl: nominee.posterUrl,
        backdropUrl: nominee.backdropUrl ?? undefined,
        youtubeKey: key,
        trailerTitle: res.trailerTitle,
      });
    },
    onError: () => showToast("Could not load a trailer for this title."),
  });

  const streamMut = useMutation({
    mutationFn: async () => {
      let tid = effectiveTmdbId;
      if (!tid) tid = await resolveTmdbIdFromTitleYear(title, ceremonyYear, mtLabel);
      if (!tid) throw new Error("no-tmdb");
      return fetchImdbWithMediaFallback(tid, mtLabel);
    },
    onSuccess: ({ imdbId, media }) => {
      if (imdbId && media === "Movie") {
        navigate("/stream-player", {
          state: { streamUrl: streamMovieEmbedUrl(imdbId), title },
        });
        return;
      }
      if (imdbId && media === "Series") {
        setTvPick({ imdbId });
        return;
      }
      navigate("/online-stream", {
        state: {
          seedQuery: ceremonyYear ? `${title} ${ceremonyYear}` : title,
          seedKind: mtLabel === "Movie" ? "Movie" : "Series",
        },
      });
    },
    onError: () =>
      navigate("/online-stream", {
        state: {
          seedQuery: ceremonyYear ? `${title} ${ceremonyYear}` : title,
          seedKind: mtLabel === "Movie" ? "Movie" : "Series",
        },
      }),
  });

  const listMut = useMutation({
    mutationFn: async () => {
      if (!watchlist) throw new Error("No list");
      let tid = effectiveTmdbId;
      if (!tid) tid = await resolveTmdbIdFromTitleYear(title, ceremonyYear, mtLabel);
      if (!tid) throw new Error("no-tmdb");
      // Fetch imdbId to enable streaming from My List later
      let storedImdbId: string | null = null;
      try {
        const r = await getStreamImdbId(tid, mtLabel);
        storedImdbId = r.imdbId ?? null;
        if (!storedImdbId) {
          const alt = mtLabel === "Movie" ? "Series" : "Movie";
          const r2 = await getStreamImdbId(tid, alt);
          storedImdbId = r2.imdbId ?? null;
        }
      } catch { /* non-fatal */ }
      return addListItem(watchlist.id, {
        tmdbId: tid,
        mediaType: mtLabel,
        title,
        posterRemoteUrl: nominee.posterUrl ?? undefined,
        imdbId: storedImdbId ?? undefined,
      });
    },
    onSuccess: () => {
      showToast(`Added to ${watchlist?.name ?? "list"}.`);
      void qc.invalidateQueries({ queryKey: ["lists"] });
    },
    onError: () => showToast("Could not add to list."),
  });

  // Resolve where "Details" should navigate:
  // - Library match → internal library route
  // - TMDB match, not in library → stream-details page
  // - No TMDB id → nothing (button hidden)
  const detailTarget = useMemo(() => {
    const tid = effectiveTmdbId;
    if (!tid) return null;
    if (kind === "movie") {
      const libId = libraryIndex?.movieByTmdb.get(tid);
      if (libId != null) return { kind: "library" as const, href: `/movie/${libId}` };
      return { kind: "stream" as const, tmdbId: tid, mediaType: "Movie" as const };
    }
    const libId = libraryIndex?.seriesByTmdb.get(tid);
    if (libId != null) return { kind: "library" as const, href: `/series/${libId}` };
    return { kind: "stream" as const, tmdbId: tid, mediaType: "Series" as const };
  }, [effectiveTmdbId, kind, libraryIndex]);

  const btnClass =
    "pointer-events-auto relative z-[2] inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-white/[0.08] bg-black/25 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-pitflix-muted transition-colors hover:border-pitflix-primary/45 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 sm:text-[11px]";

  const busyResolve = resolveQ.isFetching && !rawTmdbId;

  return (
    <article
      className={cn(
        "group relative flex min-h-0 flex-col rounded-xl border transition-[border-color,background-color,box-shadow] duration-200 sm:flex-row",
        winner
          ? [
              "border-amber-400/35 bg-[linear-gradient(105deg,rgba(245,158,11,0.09)_0%,rgba(24,24,27,0.5)_42%,rgba(9,9,11,0.65)_100%)]",
              "shadow-[0_0_0_1px_rgba(251,191,36,0.1),0_2px_20px_-8px_rgba(0,0,0,0.85)]",
            ]
          : [
              "border-white/[0.06] bg-pitflix-surface/50",
              "hover:border-white/[0.1] hover:bg-pitflix-surface/75 hover:shadow-[0_4px_24px_-12px_rgba(0,0,0,0.6)]",
            ],
      )}
    >
      {winner ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-l-xl bg-gradient-to-b from-amber-200/90 via-amber-400 to-amber-600/85 shadow-[0_0_14px_rgba(251,191,36,0.35)]"
          aria-hidden
        />
      ) : null}

      <div
        className={cn(
          "relative z-[1] flex min-w-0 flex-1 flex-col gap-3 p-3 sm:flex-row sm:items-stretch sm:gap-3.5 sm:p-3.5",
          winner && "pl-[14px] sm:pl-4",
        )}
      >
        <MediaImage
          src={posterSrc}
          alt=""
          loading="lazy"
          className={cn(
            "pointer-events-none mx-auto h-[4.5rem] w-[3rem] shrink-0 overflow-hidden rounded-md bg-pitflix-card object-cover shadow-md ring-1 ring-black/40 sm:mx-0 sm:h-[5.25rem] sm:w-[3.5rem]",
            winner &&
              "ring-amber-400/30 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.7)] sm:h-[5.5rem] sm:w-[3.65rem]",
          )}
          fallbackText={title.slice(0, 2)}
        />

        <div className="relative z-[2] min-w-0 flex flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 text-sm font-semibold leading-tight text-white sm:text-[0.9375rem] sm:leading-snug">
              {title}
            </h3>
            {winner ? (
              <span className="mt-px shrink-0 rounded border border-amber-400/40 bg-amber-500/18 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-[0.12em] text-amber-100 shadow-sm sm:text-[10px] sm:tracking-[0.14em]">
                Winner
              </span>
            ) : (
              <span className="mt-px shrink-0 rounded border border-white/[0.08] bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-[0.11em] text-pitflix-muted sm:text-[10px]">
                Nominee
              </span>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-pitflix-muted">
              {formatMediaType(mediaType)}
            </span>
            {busyResolve ? (
              <span className="text-[10px] text-pitflix-subtle">Matching title…</span>
            ) : null}
          </div>

          <div className="pointer-events-auto relative z-[3] flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={trailerMut.isPending || title.trim().length < 2}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                trailerMut.mutate();
              }}
              className={btnClass}
            >
              {trailerMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clapperboard className="h-3 w-3" />}
              Trailer
            </button>
            <button
              type="button"
              disabled={streamMut.isPending || title.trim().length < 2}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                streamMut.mutate();
              }}
              className={cn(btnClass, "border-sky-500/25 text-sky-100/90 hover:border-sky-400/50")}
            >
              {streamMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Stream
            </button>
            <button
              type="button"
              disabled={!watchlist || listMut.isPending || title.trim().length < 2}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                listMut.mutate();
              }}
              className={btnClass}
            >
              {listMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListPlus className="h-3 w-3" />}
              Watchlist
            </button>
            {detailTarget?.kind === "library" ? (
              <Link
                to={detailTarget.href}
                onClick={(e) => e.stopPropagation()}
                className={cn(btnClass, "border-emerald-500/20 text-emerald-100/90")}
              >
                <Info className="h-3 w-3" />
                Details
              </Link>
            ) : detailTarget?.kind === "stream" ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigate("/stream-details", {
                    state: {
                      tmdbId: detailTarget.tmdbId,
                      mediaType: detailTarget.mediaType,
                      title,
                      posterUrl: nominee.posterUrl,
                      year: ceremonyYear ? String(ceremonyYear) : null,
                    } satisfies StreamingDetailsLocationState,
                  });
                }}
                className={cn(btnClass, "border-emerald-500/20 text-emerald-100/90")}
              >
                <Info className="h-3 w-3" />
                Details
              </button>
            ) : null}
          </div>

          {toast ? (
            <p className="text-[10px] font-medium text-amber-200/90" role="status">
              {toast}
            </p>
          ) : null}
        </div>
      </div>

      <span className="sr-only">
        {listIndex + 1}. {title}
        {winner ? ", winner" : ", nominee"}
      </span>

      <TrailerModal open={!!trailerCard} onClose={() => setTrailerCard(null)} trailer={trailerCard} />

      <TvEpisodePickModal
        open={tvPick != null}
        title={title}
        tmdbId={effectiveTmdbId ?? 0}
        imdbId={tvPick?.imdbId ?? ""}
        onClose={() => setTvPick(null)}
        onPlay={(season, episode) => {
          if (!tvPick?.imdbId || !effectiveTmdbId) return;
          navigate("/stream-player", {
            state: {
              streamUrl: streamTvEmbedUrl(tvPick.imdbId, season, episode),
              title: `${title} · S${season}E${episode}`,
            },
          });
          setTvPick(null);
        }}
      />
    </article>
  );
}
