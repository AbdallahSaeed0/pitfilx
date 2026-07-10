import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getMovies } from "../api/movies";
import { getAllSeries } from "../api/series";
import { LibraryPosterGrid } from "../components/ui/LibraryPosterGrid";
import { PosterCard } from "../components/ui/PosterCard";
import { Spinner } from "../components/ui/Spinner";
import { LibraryContextMenuLayer } from "../features/library/LibraryContextMenuLayer";
import { useLibraryPosterCards } from "../features/library/useLibraryPosterCards";
import { toPosterSrc } from "../utils/posterSrc";
import type { MediaCard } from "../types/media";

type Tab = "all" | "movies" | "series";

export function GenreBrowsePage() {
  const { genreName } = useParams<{ genreName: string }>();
  const navigate = useNavigate();
  const genre = decodeURIComponent(genreName ?? "");
  const [tab, setTab] = useState<Tab>("all");

  const moviesQ = useQuery({
    queryKey: ["genre-browse-movies", genre],
    queryFn: () =>
      getMovies({ genre, sort: "rating", limit: 60 }) as Promise<
        { items?: MediaCard[]; totalItems?: number } | MediaCard[]
      >,
    enabled: !!genre,
    staleTime: 5 * 60_000,
  });

  const seriesQ = useQuery({
    queryKey: ["genre-browse-series", genre],
    queryFn: () =>
      getAllSeries({ genre, sort: "rating", limit: 60 }) as Promise<
        { items?: MediaCard[]; totalItems?: number } | MediaCard[]
      >,
    enabled: !!genre,
    staleTime: 5 * 60_000,
  });

  const movies = Array.isArray(moviesQ.data)
    ? moviesQ.data
    : ((moviesQ.data as { items?: MediaCard[] })?.items ?? []);

  const series = Array.isArray(seriesQ.data)
    ? seriesQ.data
    : ((seriesQ.data as { items?: MediaCard[] })?.items ?? []);

  const isLoading = moviesQ.isLoading || seriesQ.isLoading;

  // Pick a hero backdrop from the top-rated item
  const heroItem = movies[0] ?? series[0];
  const heroBackdrop = heroItem
    ? toPosterSrc(
        (heroItem as { selectedBackdropPath?: string; backdropLocalPath?: string }).selectedBackdropPath ||
        (heroItem as { selectedBackdropPath?: string; backdropLocalPath?: string }).backdropLocalPath ||
        heroItem.selectedPosterPath || heroItem.posterLocalPath || undefined,
      )
    : null;

  const allItems: MediaCard[] = [...movies, ...series];
  const displayed = tab === "movies" ? movies : tab === "series" ? series : allItems;
  const { menu, closeMenu, runAction, cardExtras } = useLibraryPosterCards(displayed);

  return (
    <div className="pb-12">
      {/* Hero banner */}
      <div className="relative -mx-4 mb-8 h-[220px] overflow-hidden sm:-mx-6 md:-mx-8 md:h-[280px] rounded-2xl">
        {heroBackdrop ? (
          <img
            src={heroBackdrop}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-center opacity-50"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-pitflix-primary/30 to-pitflix-card" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-pitflix-bg via-pitflix-bg/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-pitflix-bg/80 via-transparent to-transparent" />

        <div className="absolute bottom-0 left-0 p-6">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-3 inline-flex items-center gap-1 text-sm text-pitflix-muted hover:text-white"
          >
            ← Back
          </button>
          <h1 className="text-4xl font-bold tracking-tight text-white drop-shadow-lg md:text-5xl">{genre}</h1>
          <p className="mt-1 text-sm text-pitflix-muted">
            {movies.length > 0 && `${movies.length} movie${movies.length === 1 ? "" : "s"}`}
            {movies.length > 0 && series.length > 0 && " · "}
            {series.length > 0 && `${series.length} show${series.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 rounded-xl border border-white/10 bg-pitflix-surface/60 p-1 w-fit">
        {(
          [
            { id: "all" as Tab, label: `All (${allItems.length})` },
            { id: "movies" as Tab, label: `Movies (${movies.length})` },
            { id: "series" as Tab, label: `Shows (${series.length})` },
          ]
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
              tab === id
                ? "bg-pitflix-primary text-white shadow-md shadow-pitflix-primary/30"
                : "text-pitflix-muted hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      )}

      {!isLoading && displayed.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-pitflix-muted">Nothing here yet</p>
          <p className="mt-1 text-sm text-pitflix-subtle">
            {tab === "movies"
              ? "No movies found in your library for this genre."
              : tab === "series"
              ? "No TV shows found in your library for this genre."
              : "No titles found in your library for this genre."}
          </p>
        </div>
      )}

      {!isLoading && displayed.length > 0 && (
        <>
          <LibraryPosterGrid>
            {displayed.map((item) => {
              const extras = cardExtras(item);
              return (
                <PosterCard
                  key={`${extras.mediaType}-${item.id}`}
                  item={item}
                  mediaType={extras.mediaType}
                  imdbRating={extras.imdbRating}
                  onContextMenu={extras.onContextMenu}
                />
              );
            })}
          </LibraryPosterGrid>
          <LibraryContextMenuLayer menu={menu} onClose={closeMenu} onAction={(a) => void runAction(a)} />
        </>
      )}
    </div>
  );
}
