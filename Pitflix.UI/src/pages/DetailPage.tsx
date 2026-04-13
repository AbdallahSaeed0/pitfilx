import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getMovie } from "../api/movies";
import { getShow, type SeasonSummary } from "../api/series";
import { DetailToolbar } from "../components/DetailToolbar";
import { SubtitleDrawer } from "../components/SubtitleDrawer";
import { usePlayback } from "../hooks/usePlayback";
import { PosterPickerModal } from "../components/PosterPickerModal";
import { HorizontalDragScroll } from "../components/ui/HorizontalDragScroll";
import { MediaImage } from "../components/ui/MediaImage";
import { PosterCard } from "../components/ui/PosterCard";
import { Spinner } from "../components/ui/Spinner";
import { Badge } from "../components/ui/Badge";
import type { MediaCard } from "../types/media";
import { formatRating, formatYear } from "../utils/format";
import { toPosterSrc } from "../utils/posterSrc";
import { RatingsPanel } from "../components/RatingsPanel";

type CrewMember = {
  id: number;
  name: string;
  job: string;
  profilePath?: string;
  profileLocalPath?: string | null;
};

function isFeaturedCrewJob(job: string) {
  const j = job.toLowerCase();
  return j === "director" || j.includes("writer") || j.includes("composer");
}

function filterFeaturedCrew(crew: CrewMember[]) {
  const out: CrewMember[] = [];
  const seen = new Set<number>();
  for (const c of crew) {
    if (!isFeaturedCrewJob(c.job)) continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

function crewAvatarSrc(c: CrewMember) {
  const local = toPosterSrc(c.profileLocalPath ?? undefined);
  if (local) return local;
  if (c.profilePath) return `https://image.tmdb.org/t/p/w185${c.profilePath}`;
  return undefined;
}

/** Hero poster: compact 2:3, same for movie and series detail. */
const detailHeroPosterClass =
  "hidden aspect-[2/3] w-[88px] max-h-[132px] shrink-0 overflow-hidden rounded-lg object-cover object-center shadow-xl ring-1 ring-white/10 sm:block sm:w-[96px] sm:max-h-[144px]";

/** Routes must match library row kind; similar cards always set `tmdbMediaType` from the API. */
function posterCardMediaType(item: MediaCard): "Movie" | "Series" {
  if (item.tmdbMediaType === "Series") return "Series";
  if (item.tmdbMediaType === "Movie") return "Movie";
  return item.mediaFilePath || item.filePath ? "Movie" : "Series";
}

export function MovieDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { play } = usePlayback();
  const [showPosterPicker, setShowPosterPicker] = useState(false);
  const [showBackdropPicker, setShowBackdropPicker] = useState(false);
  const [subtitlesOpen, setSubtitlesOpen] = useState(false);
  const mid = Number(id);
  const { data, isLoading } = useQuery({
    queryKey: ["movie", mid],
    queryFn: () => getMovie(mid),
    enabled: Number.isFinite(mid) && mid > 0,
  });

  if (!Number.isFinite(mid) || mid <= 0) return <p className="text-pitflix-muted">Invalid id</p>;
  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
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
  }[];
  const crewFeatured = filterFeaturedCrew((data.crew ?? []) as CrewMember[]);
  const similar = (data.similar ?? []) as MediaCard[];
  const durationSeconds = (movie.runtime ?? 0) > 0 ? (movie.runtime as number) * 60 : 0;
  const backdrop = toPosterSrc(movie.selectedBackdropPath || movie.backdropLocalPath || undefined);
  const poster = toPosterSrc(
    movie.selectedPosterPath || movie.posterLocalPath || movie.posterRemoteUrl || undefined,
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 text-sm text-pitflix-muted hover:text-white"
      >
        ← Back
      </button>
      <div className="relative overflow-hidden rounded-xl bg-pitflix-card">
        <div className="pointer-events-none absolute inset-0 min-h-[200px] sm:min-h-[240px]">
          {backdrop ? (
            <div className="absolute inset-0 [&_img]:opacity-70">
              <MediaImage
                src={backdrop}
                alt=""
                className="h-full w-full bg-pitflix-card"
                fallbackText=""
              />
            </div>
          ) : (
            <div className="absolute inset-0 bg-pitflix-card" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-pitflix-bg via-pitflix-bg/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-pitflix-bg to-transparent" />
        </div>
        <div className="relative z-10 flex w-full max-w-[min(100%,1040px)] flex-col gap-4 p-4 pt-24 sm:flex-row sm:items-start sm:gap-5 sm:p-8 sm:pt-28">
          <MediaImage
            src={poster}
            alt={movie.title}
            className={detailHeroPosterClass}
            fallbackText={movie.title}
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-bold text-white sm:text-4xl">{movie.title}</h1>
            <p className="mt-2 text-sm text-pitflix-muted">
              {formatYear(movie.year)} · ★ {formatRating(movie.voteAverage)}
              {movie.runtime ? ` · ${movie.runtime} min` : ""}
            </p>
            {(movie.genres ?? movie.genresCsv) ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {(movie.genres ?? movie.genresCsv)!
                  .split(",")
                  .map((g) => (
                  <Badge key={g}>{g.trim()}</Badge>
                ))}
              </div>
            ) : null}
            <p className="mt-3 line-clamp-3 max-w-2xl text-sm text-pitflix-muted">{movie.overview}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {movie.mediaFilePath || movie.filePath ? (
                <button
                  type="button"
                  className="rounded-lg bg-pitflix-primary px-6 py-2.5 text-sm font-semibold text-white"
                  onClick={() =>
                    void play(
                      movie.mediaFilePath || movie.filePath || "",
                      movie.title,
                      movie.selectedPosterPath || movie.posterLocalPath || null,
                      "Movie",
                      durationSeconds,
                    )
                  }
                >
                  ▶ Play
                </button>
              ) : null}
              {(movie.mediaFilePath || movie.filePath) ? (
                <button
                  type="button"
                  className="rounded-lg border border-pitflix-card px-4 py-2.5 text-sm font-medium text-pitflix-muted hover:border-pitflix-primary/50 hover:text-white"
                  onClick={() => setSubtitlesOpen(true)}
                >
                  🔤 Subtitles
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-lg border border-pitflix-card px-4 py-2.5 text-sm font-medium text-pitflix-muted hover:border-pitflix-primary/50 hover:text-white"
                onClick={() => setShowPosterPicker(true)}
              >
                Change poster
              </button>
              <button
                type="button"
                className="rounded-lg border border-pitflix-card px-4 py-2.5 text-sm font-medium text-pitflix-muted hover:border-pitflix-primary/50 hover:text-white"
                onClick={() => setShowBackdropPicker(true)}
              >
                Change cover
              </button>
            </div>
            <DetailToolbar
              kind="movie"
              libraryId={movie.id}
              tmdbId={movie.tmdbId}
              watchStatus={movie.watchStatus}
              pickHint={movie.title}
              filePath={movie.mediaFilePath || movie.filePath || undefined}
              onDeleted={() => navigate(-1)}
              onMovieRematched={(newLibraryId) => {
                void qc.invalidateQueries({ queryKey: ["movie", mid] });
                void qc.invalidateQueries({ queryKey: ["movie", newLibraryId] });
                if (newLibraryId !== mid) navigate(`/movie/${newLibraryId}`, { replace: true });
              }}
            />
            <div className="mt-4 w-full max-w-xl min-w-0">
              <RatingsPanel tmdbId={movie.tmdbId} mediaType="movie" />
            </div>
          </div>
        </div>
      </div>

      {showPosterPicker ? (
        <PosterPickerModal
          libraryId={movie.id}
          tmdbId={movie.tmdbId}
          mediaType="Movie"
          initialTab="poster"
          onClose={() => setShowPosterPicker(false)}
          onApplied={() => void qc.invalidateQueries({ queryKey: ["movie", mid] })}
        />
      ) : null}
      {showBackdropPicker ? (
        <PosterPickerModal
          libraryId={movie.id}
          tmdbId={movie.tmdbId}
          mediaType="Movie"
          initialTab="backdrop"
          onClose={() => setShowBackdropPicker(false)}
          onApplied={() => void qc.invalidateQueries({ queryKey: ["movie", mid] })}
        />
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

      <section className="mt-10">
        <h2 className="mb-4 text-xl font-bold">Cast</h2>
        <HorizontalDragScroll>
          {cast?.slice(0, 24).map((c) => (
            <button
              key={`${c.personTmdbId}-${c.name}`}
              type="button"
              onClick={() =>
                c.personTmdbId > 0 ? navigate(`/person/${c.personTmdbId}`) : undefined
              }
              className="w-24 shrink-0 text-center"
            >
              <MediaImage
                src={toPosterSrc(c.profileLocalPath)}
                alt={c.name}
                className="mx-auto h-20 w-20 rounded-full bg-pitflix-card"
                fallbackText={c.name.slice(0, 2)}
              />
              <p className="mt-2 text-xs font-medium text-white">{c.name}</p>
              <p className="text-[10px] text-pitflix-subtle">{c.character}</p>
            </button>
          ))}
        </HorizontalDragScroll>
      </section>

      {crewFeatured.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold">Crew</h2>
          <HorizontalDragScroll>
            {crewFeatured.map((c) => (
              <button
                key={`${c.id}-${c.job}`}
                type="button"
                onClick={() => (c.id > 0 ? navigate(`/person/${c.id}`) : undefined)}
                className="w-24 shrink-0 text-center"
              >
                <MediaImage
                  src={crewAvatarSrc(c)}
                  alt={c.name}
                  className="mx-auto h-20 w-20 rounded-full bg-pitflix-card"
                  fallbackText={c.name.slice(0, 2)}
                />
                <p className="mt-2 text-xs font-medium text-white">{c.name}</p>
                <p className="text-[10px] text-pitflix-subtle">{c.job}</p>
              </button>
            ))}
          </HorizontalDragScroll>
        </section>
      ) : null}

      <section id="detail-similar" className="mt-10 scroll-mt-4">
        <h2 className="mb-4 text-xl font-bold">More like this</h2>
        <HorizontalDragScroll className="pb-4">
          {similar.map((s) => {
            const mt = posterCardMediaType(s);
            return (
              <PosterCard
                key={`similar-${mt}-${s.id}`}
                className="w-[140px] shrink-0"
                item={s}
                mediaType={mt}
              />
            );
          })}
        </HorizontalDragScroll>
      </section>
    </div>
  );
}

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
  const { play } = usePlayback();
  const [showPosterPicker, setShowPosterPicker] = useState(false);
  const [showBackdropPicker, setShowBackdropPicker] = useState(false);
  const sid = Number(id);
  const { data, isLoading } = useQuery({
    queryKey: ["show", sid],
    queryFn: () => getShow(sid),
    enabled: Number.isFinite(sid) && sid > 0,
  });

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
  const cast = data.cast as {
    name: string;
    character?: string;
    personTmdbId: number;
    profileLocalPath?: string | null;
  }[];
  const crewFeatured = filterFeaturedCrew((data.crew ?? []) as CrewMember[]);
  const similar = (data.similar ?? []) as MediaCard[];

  const backdrop = toPosterSrc(show.selectedBackdropPath || show.backdropLocalPath || undefined);
  const poster = toPosterSrc(
    show.selectedPosterPath || show.posterLocalPath || show.posterRemoteUrl || undefined,
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 text-sm text-pitflix-muted hover:text-white"
      >
        ← Back
      </button>
      <div className="relative overflow-hidden rounded-xl bg-pitflix-card">
        <div className="pointer-events-none absolute inset-0 min-h-[200px] sm:min-h-[240px]">
          {backdrop ? (
            <div className="absolute inset-0 [&_img]:opacity-70">
              <MediaImage
                src={backdrop}
                alt=""
                className="h-full w-full bg-pitflix-card"
                fallbackText=""
              />
            </div>
          ) : (
            <div className="absolute inset-0 bg-pitflix-card" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-pitflix-bg via-pitflix-bg/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-pitflix-bg to-transparent" />
        </div>
        <div className="relative z-10 flex w-full max-w-[min(100%,1040px)] flex-col gap-4 p-4 pt-24 sm:flex-row sm:items-start sm:gap-5 sm:p-8 sm:pt-28">
          <MediaImage
            src={poster}
            alt={show.title}
            className={detailHeroPosterClass}
            fallbackText={show.title}
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-bold text-white sm:text-4xl">{show.title}</h1>
            <p className="mt-2 text-sm text-pitflix-muted">
              {formatYear(show.year)} · ★ {formatRating(show.voteAverage)}
            </p>
            {(show.genres ?? show.genresCsv) ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {(show.genres ?? show.genresCsv)!
                  .split(",")
                  .map((g) => (
                  <Badge key={g}>{g.trim()}</Badge>
                ))}
              </div>
            ) : null}
            <p className="mt-3 line-clamp-3 max-w-2xl text-sm text-pitflix-muted">{show.overview}</p>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              {nextEpisode ? (
                <div className="flex min-w-0 flex-col gap-1">
                  <button
                    type="button"
                    className="rounded-lg bg-pitflix-primary px-6 py-2.5 text-sm font-semibold text-white"
                    onClick={() =>
                      void play(
                        nextEpisode.filePath,
                        `${show.title} · S${nextEpisode.season}E${nextEpisode.episodeNumber}`,
                        show.selectedPosterPath || show.posterLocalPath || null,
                        "Series",
                        0,
                      )
                    }
                  >
                    ▶ Continue — S{nextEpisode.season}E{nextEpisode.episodeNumber}
                  </button>
                  {nextEpisode.title ? (
                    <p className="max-w-md truncate text-xs text-pitflix-muted">{nextEpisode.title}</p>
                  ) : null}
                </div>
              ) : firstEpisode ? (
                <button
                  type="button"
                  className="rounded-lg bg-pitflix-primary px-6 py-2.5 text-sm font-semibold text-white"
                  onClick={() =>
                    void play(
                      firstEpisode.episode.filePath,
                      `${show.title} · S${firstEpisode.season}E${firstEpisode.episode.episodeNumber}`,
                      show.selectedPosterPath || show.posterLocalPath || null,
                      "Series",
                      0,
                    )
                  }
                >
                  ▶ Watch Again from S{firstEpisode.season}E{firstEpisode.episode.episodeNumber}
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-lg border border-pitflix-card px-4 py-2.5 text-sm font-medium text-pitflix-muted hover:border-pitflix-primary/50 hover:text-white"
                onClick={() => setShowPosterPicker(true)}
              >
                Change poster
              </button>
              <button
                type="button"
                className="rounded-lg border border-pitflix-card px-4 py-2.5 text-sm font-medium text-pitflix-muted hover:border-pitflix-primary/50 hover:text-white"
                onClick={() => setShowBackdropPicker(true)}
              >
                Change cover
              </button>
            </div>
            <DetailToolbar
              kind="series"
              libraryId={show.id}
              tmdbId={show.tmdbId}
              watchStatus={show.watchStatus}
              pickHint={show.title}
              folderPath={show.folderPath || undefined}
              onDeleted={() => navigate(-1)}
              onShowRematched={(newLibraryId) => {
                void qc.invalidateQueries({ queryKey: ["show", sid] });
                void qc.invalidateQueries({ queryKey: ["show", newLibraryId] });
                if (newLibraryId !== sid) navigate(`/series/${newLibraryId}`, { replace: true });
              }}
            />
            <div className="mt-4 w-full max-w-xl min-w-0">
              <RatingsPanel tmdbId={show.tmdbId} mediaType="tv" />
            </div>
          </div>
        </div>
      </div>

      {showPosterPicker ? (
        <PosterPickerModal
          libraryId={show.id}
          tmdbId={show.tmdbId}
          mediaType="Series"
          initialTab="poster"
          onClose={() => setShowPosterPicker(false)}
          onApplied={() => void qc.invalidateQueries({ queryKey: ["show", sid] })}
        />
      ) : null}
      {showBackdropPicker ? (
        <PosterPickerModal
          libraryId={show.id}
          tmdbId={show.tmdbId}
          mediaType="Series"
          initialTab="backdrop"
          onClose={() => setShowBackdropPicker(false)}
          onApplied={() => void qc.invalidateQueries({ queryKey: ["show", sid] })}
        />
      ) : null}

      {seasonsSummary.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold">Seasons</h2>
          <p className="mb-4 max-w-2xl text-sm text-pitflix-subtle">
            Open a season to manage episodes, playback, and subtitles. Posters and metadata come from TMDB when
            available.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {seasonsSummary.map((s) => (
              <Link
                key={s.seasonNumber}
                to={`/series/${sid}/season/${s.seasonNumber}`}
                className="group overflow-hidden rounded-2xl border border-pitflix-card/70 bg-pitflix-surface/40 transition-all hover:border-pitflix-primary/50 hover:shadow-lg hover:shadow-pitflix-primary/10"
              >
                <MediaImage
                  src={s.posterUrl ?? undefined}
                  alt=""
                  className="aspect-[2/3] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  fallbackText={s.name.slice(0, 2)}
                />
                <div className="space-y-0.5 p-3">
                  <p className="line-clamp-2 text-sm font-semibold text-white">{s.name}</p>
                  <p className="text-[11px] text-pitflix-muted">
                    {s.episodeCount} in library
                    {s.tmdbEpisodeCount > 0 ? ` · ${s.tmdbEpisodeCount} on TMDB` : ""}
                  </p>
                  {s.airDate ? (
                    <p className="text-[10px] text-pitflix-subtle">Premiered {s.airDate}</p>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : seasons.length === 0 ? (
        <section className="mt-10">
          <h2 className="mb-2 text-xl font-bold">Seasons</h2>
          <p className="text-sm text-pitflix-muted">No episodes in the library yet.</p>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="mb-4 text-xl font-bold">Cast</h2>
        <HorizontalDragScroll>
          {cast?.slice(0, 24).map((c) => (
            <button
              key={`${c.personTmdbId}-${c.name}`}
              type="button"
              onClick={() =>
                c.personTmdbId > 0 ? navigate(`/person/${c.personTmdbId}`) : undefined
              }
              className="w-24 shrink-0 text-center"
            >
              <MediaImage
                src={toPosterSrc(c.profileLocalPath)}
                alt={c.name}
                className="mx-auto h-20 w-20 rounded-full bg-pitflix-card"
                fallbackText={c.name.slice(0, 2)}
              />
              <p className="mt-2 text-xs font-medium text-white">{c.name}</p>
              <p className="text-[10px] text-pitflix-subtle">{c.character}</p>
            </button>
          ))}
        </HorizontalDragScroll>
      </section>

      {crewFeatured.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold">Crew</h2>
          <HorizontalDragScroll>
            {crewFeatured.map((c) => (
              <button
                key={`${c.id}-${c.job}`}
                type="button"
                onClick={() => (c.id > 0 ? navigate(`/person/${c.id}`) : undefined)}
                className="w-24 shrink-0 text-center"
              >
                <MediaImage
                  src={crewAvatarSrc(c)}
                  alt={c.name}
                  className="mx-auto h-20 w-20 rounded-full bg-pitflix-card"
                  fallbackText={c.name.slice(0, 2)}
                />
                <p className="mt-2 text-xs font-medium text-white">{c.name}</p>
                <p className="text-[10px] text-pitflix-subtle">{c.job}</p>
              </button>
            ))}
          </HorizontalDragScroll>
        </section>
      ) : null}

      <section id="detail-similar" className="mt-10 scroll-mt-4">
        <h2 className="mb-4 text-xl font-bold">More like this</h2>
        <HorizontalDragScroll className="pb-4">
          {similar.map((s) => {
            const mt = posterCardMediaType(s);
            return (
              <PosterCard
                key={`similar-${mt}-${s.id}`}
                className="w-[140px] shrink-0"
                item={s}
                mediaType={mt}
              />
            );
          })}
        </HorizontalDragScroll>
      </section>
    </div>
  );
}
