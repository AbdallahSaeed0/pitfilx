import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getMovies } from "../../api/movies";
import { getAllSeries } from "../../api/series";
import { COMMON_GENRES } from "../../data/commonGenres";
import { toPosterSrc } from "../../utils/posterSrc";
import type { MediaCard } from "../../types/media";
import { HorizontalScrollRow } from "../../components/ui/HorizontalScrollRow";

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

/** Number of genre tiles to show in the slider before "See all" */
const VISIBLE_COUNT = 7;

export function GenreCategorySection() {
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

  // Count items per genre and build genre → candidate images
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

  // Pick one image per genre, avoiding reusing the same image for different genre tiles
  const usedSrcs = new Set<string>();
  const genreMap = new Map<string, string>();
  for (const genre of COMMON_GENRES) {
    const candidates = genreToImages.get(genre) ?? [];
    const unique = candidates.find((s) => !usedSrcs.has(s));
    if (unique) {
      genreMap.set(genre, unique);
      usedSrcs.add(unique);
    } else if (candidates.length > 0) {
      // Fall back to first candidate even if reused
      genreMap.set(genre, candidates[0]!);
    }
  }

  // Only include genres that have at least one item in the library
  const filledGenres = COMMON_GENRES.filter((g) => (genreItemCount.get(g) ?? 0) > 0);

  const tiles = filledGenres.map((genre, i) => ({
    genre,
    src: genreMap.get(genre) ?? null,
    accent: GENRE_ACCENTS[i % GENRE_ACCENTS.length]!,
  }));

  const visibleTiles = tiles.slice(0, VISIBLE_COUNT);

  if (filledGenres.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Browse by Category</h2>
        <button
          type="button"
          onClick={() => navigate("/categories")}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-pitflix-muted transition hover:border-pitflix-primary/40 hover:text-white"
        >
          See all →
        </button>
      </div>

      <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3 pb-2">
        {visibleTiles.map(({ genre, src, accent }) => (
          <button
            key={genre}
            type="button"
            onClick={() => navigate(`/genre/${encodeURIComponent(genre)}`)}
            className="group relative shrink-0 w-[140px] overflow-hidden rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-pitflix-primary"
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
            <div className={`absolute inset-0 bg-gradient-to-b ${accent[0]} ${accent[1]}`} />
            <div className="absolute inset-0 flex items-end p-3">
              <p className="text-sm font-bold leading-tight text-white drop-shadow-lg">{genre}</p>
            </div>
          </button>
        ))}

        {/* "See all" tile */}
        <button
          type="button"
          onClick={() => navigate("/categories")}
          className="group relative shrink-0 w-[140px] overflow-hidden rounded-2xl border border-white/10 bg-pitflix-card/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-pitflix-primary"
          style={{ aspectRatio: "2/3" }}
        >
          <div className="flex h-full flex-col items-center justify-center gap-2 p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/5 text-xl text-white">
              ≡
            </div>
            <p className="text-center text-xs font-semibold text-pitflix-muted group-hover:text-white">
              All {filledGenres.length} genres
            </p>
          </div>
        </button>
      </HorizontalScrollRow>
    </section>
  );
}
