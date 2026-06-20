import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getMovies } from "../api/movies";
import { getAllSeries } from "../api/series";
import { COMMON_GENRES } from "../data/commonGenres";
import { toPosterSrc } from "../utils/posterSrc";
import type { MediaCard } from "../types/media";

const DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020];
const DECADE_ACCENTS: [string, string][] = [
  ["from-yellow-700/40", "to-yellow-950/80"],
  ["from-orange-600/40", "to-orange-950/80"],
  ["from-red-600/40", "to-red-950/80"],
  ["from-purple-600/40", "to-purple-950/80"],
  ["from-blue-600/40", "to-blue-950/80"],
  ["from-emerald-600/40", "to-emerald-950/80"],
  ["from-sky-500/40", "to-sky-950/80"],
];

const GENRE_ACCENTS: [string, string][] = [
  ["from-red-600/30",    "to-red-950/80"],
  ["from-blue-600/30",   "to-blue-950/80"],
  ["from-emerald-600/30","to-emerald-950/80"],
  ["from-yellow-500/30", "to-yellow-950/80"],
  ["from-purple-600/30", "to-purple-950/80"],
  ["from-orange-600/30", "to-orange-950/80"],
  ["from-pink-600/30",   "to-pink-950/80"],
  ["from-sky-600/30",    "to-sky-950/80"],
  ["from-teal-600/30",   "to-teal-950/80"],
  ["from-rose-600/30",   "to-rose-950/80"],
  ["from-indigo-600/30", "to-indigo-950/80"],
  ["from-cyan-600/30",   "to-cyan-950/80"],
  ["from-lime-500/30",   "to-lime-950/80"],
  ["from-fuchsia-600/30","to-fuchsia-950/80"],
  ["from-green-600/30",  "to-green-950/80"],
  ["from-violet-600/30", "to-violet-950/80"],
  ["from-amber-500/30",  "to-amber-950/80"],
  ["from-stone-500/30",  "to-stone-950/80"],
  ["from-red-700/30",    "to-indigo-950/80"],
  ["from-sky-600/30",    "to-emerald-950/80"],
  ["from-blue-700/30",   "to-violet-950/80"],
  ["from-teal-600/30",   "to-blue-950/80"],
  ["from-orange-700/30", "to-red-950/80"],
  ["from-purple-700/30", "to-rose-950/80"],
  ["from-cyan-600/30",   "to-teal-950/80"],
  ["from-pink-600/30",   "to-purple-950/80"],
  ["from-green-600/30",  "to-sky-950/80"],
  ["from-amber-600/30",  "to-orange-950/80"],
  ["from-violet-600/30", "to-pink-950/80"],
  ["from-lime-600/30",   "to-green-950/80"],
];

export function AllCategoriesPage() {
  const navigate = useNavigate();

  const moviesQ = useQuery({
    queryKey: ["genre-section-posters-movies"],
    queryFn: () => getMovies({ sort: "rating", limit: 100 }) as Promise<{ items?: MediaCard[] } | MediaCard[]>,
    staleTime: 15 * 60_000,
  });
  const seriesQ = useQuery({
    queryKey: ["genre-section-posters-series"],
    queryFn: () => getAllSeries({ sort: "rating", limit: 100 }) as Promise<{ items?: MediaCard[] } | MediaCard[]>,
    staleTime: 15 * 60_000,
  });

  const movies = Array.isArray(moviesQ.data) ? moviesQ.data : ((moviesQ.data as { items?: MediaCard[] })?.items ?? []);
  const series = Array.isArray(seriesQ.data) ? seriesQ.data : ((seriesQ.data as { items?: MediaCard[] })?.items ?? []);
  const allMedia = [...movies, ...series];

  // Count items per genre so we can hide genres with nothing in the library
  const genreItemCount = new Map<string, number>();
  const genreToImages = new Map<string, string[]>();
  for (const item of allMedia) {
    const genres = (item.genresCsv ?? "").split(",").map((g) => g.trim()).filter(Boolean);
    // Include remote URL so tiles get an image even when local poster hasn't been downloaded yet
    const src = toPosterSrc(
      item.selectedPosterPath || item.posterLocalPath ||
      item.selectedBackdropPath || item.backdropLocalPath ||
      item.posterRemoteUrl || undefined,
    );
    for (const genre of genres) {
      genreItemCount.set(genre, (genreItemCount.get(genre) ?? 0) + 1);
      if (src) {
        const list = genreToImages.get(genre) ?? [];
        if (!list.includes(src)) list.push(src);
        genreToImages.set(genre, list);
      }
    }
  }

  const usedSrcs = new Set<string>();
  const genreMap = new Map<string, string>();
  for (const genre of COMMON_GENRES) {
    const candidates = genreToImages.get(genre) ?? [];
    const unique = candidates.find((s) => !usedSrcs.has(s));
    if (unique) {
      genreMap.set(genre, unique);
      usedSrcs.add(unique);
    } else if (candidates.length > 0) {
      // Fall back to first candidate even if reused across tiles
      genreMap.set(genre, candidates[0]!);
    }
  }

  // Only show genres that actually have items in the library
  const displayedGenres = COMMON_GENRES.filter((g) => (genreItemCount.get(g) ?? 0) > 0);

  return (
    <div className="pb-12">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 text-sm text-pitflix-muted hover:text-white"
      >
        ← Back
      </button>

      <h1 className="mb-1 text-3xl font-bold text-white">All Categories</h1>
      <p className="mb-6 text-sm text-pitflix-muted">Browse your library by genre or era</p>

      {/* Decades */}
      <h2 className="mb-3 text-lg font-semibold text-white">Browse by Era</h2>
      <div className="mb-8 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-7">
        {DECADES.map((decade, i) => {
          const [from, to] = DECADE_ACCENTS[i % DECADE_ACCENTS.length]!;
          return (
            <button
              key={decade}
              type="button"
              onClick={() => navigate(`/browse/decade/${decade}`)}
              className="group relative flex items-center justify-center overflow-hidden rounded-2xl border border-white/10 py-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-pitflix-primary"
              style={{ aspectRatio: "1.5" }}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${from} ${to}`} />
              <span className="relative z-10 text-xl font-bold text-white drop-shadow-lg group-hover:scale-110 transition-transform">
                {decade}s
              </span>
            </button>
          );
        })}
      </div>

      <h2 className="mb-3 text-lg font-semibold text-white">Browse by Genre</h2>

      {displayedGenres.length === 0 ? (
        <p className="text-sm text-pitflix-muted">No genres found. Add movies or series to your library first.</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {displayedGenres.map((genre, i) => {
          const src = genreMap.get(genre) ?? null;
          const [from, to] = GENRE_ACCENTS[i % GENRE_ACCENTS.length]!;
          return (
            <button
              key={genre}
              type="button"
              onClick={() => navigate(`/genre/${encodeURIComponent(genre)}`)}
              className="group relative overflow-hidden rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-pitflix-primary"
              style={{ aspectRatio: "2/3" }}
            >
              {src ? (
                <img
                  src={src}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
              ) : (
                <div className="absolute inset-0 bg-pitflix-card" />
              )}
              <div className={`absolute inset-0 bg-gradient-to-b ${from} ${to}`} />
              <div className="absolute inset-0 flex items-end p-4">
                <p className="text-base font-bold leading-tight text-white drop-shadow-lg">{genre}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
