import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { browseByDecade } from "../api/browse";
import { PosterCard } from "../components/ui/PosterCard";
import { Spinner } from "../components/ui/Spinner";
import type { MediaCard } from "../types/media";

type Tab = "all" | "movies" | "series";

export function DecadeBrowsePage() {
  const { decade } = useParams<{ decade: string }>();
  const navigate = useNavigate();
  const decadeNum = Number(decade ?? 0);
  const decadeLabel = `${decadeNum}s`;
  const [tab, setTab] = useState<Tab>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["decade-browse", decadeNum],
    queryFn: () => browseByDecade(decadeNum),
    enabled: decadeNum > 0,
    staleTime: 10 * 60_000,
  });

  const allItems = (data?.items ?? []) as MediaCard[];
  const movies = allItems.filter((i) => i.tmdbMediaType === "Movie");
  const series = allItems.filter((i) => i.tmdbMediaType === "Series");
  const displayed = tab === "movies" ? movies : tab === "series" ? series : allItems;

  const heroItem = movies[0] ?? series[0];
  const heroBackdrop =
    heroItem?.selectedBackdropPath ||
    heroItem?.backdropLocalPath ||
    heroItem?.selectedPosterPath ||
    heroItem?.posterLocalPath ||
    null;

  return (
    <div className="pb-12">
      {/* Hero banner */}
      <div className="relative -mx-4 mb-8 h-[220px] overflow-hidden rounded-2xl sm:-mx-6 md:-mx-8 md:h-[280px]">
        {heroBackdrop ? (
          <img
            src={heroBackdrop}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-center opacity-40"
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
          <h1 className="text-4xl font-bold tracking-tight text-white drop-shadow-lg md:text-5xl">
            The {decadeLabel}
          </h1>
          <p className="mt-1 text-sm text-pitflix-muted">
            {movies.length > 0 && `${movies.length} movie${movies.length === 1 ? "" : "s"}`}
            {movies.length > 0 && series.length > 0 && " · "}
            {series.length > 0 && `${series.length} show${series.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex w-fit gap-1 rounded-xl border border-white/10 bg-pitflix-surface/60 p-1">
        {(
          [
            { id: "all" as Tab, label: `All (${allItems.length})` },
            { id: "movies" as Tab, label: `Movies (${movies.length})` },
            { id: "series" as Tab, label: `Shows (${series.length})` },
          ] as { id: Tab; label: string }[]
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
            No titles from the {decadeLabel} found in your library.
          </p>
        </div>
      )}

      {!isLoading && displayed.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
          {displayed.map((item) => (
            <PosterCard
              key={`${item.tmdbMediaType}-${item.id}`}
              item={item}
              mediaType={item.tmdbMediaType === "Series" ? "Series" : "Movie"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
