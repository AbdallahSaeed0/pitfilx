import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { browseByKeyword } from "../api/browse";
import { PosterCard } from "../components/ui/PosterCard";
import { Spinner } from "../components/ui/Spinner";
import type { MediaCard } from "../types/media";

type Tab = "all" | "movies" | "series";

export function KeywordBrowsePage() {
  const { keyword } = useParams<{ keyword: string }>();
  const navigate = useNavigate();
  const kw = decodeURIComponent(keyword ?? "");
  const [tab, setTab] = useState<Tab>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["keyword-browse", kw],
    queryFn: () => browseByKeyword(kw),
    enabled: kw.length > 0,
    staleTime: 10 * 60_000,
  });

  const allItems = (data?.items ?? []) as MediaCard[];
  const movies = allItems.filter((i) => i.tmdbMediaType === "Movie");
  const series = allItems.filter((i) => i.tmdbMediaType === "Series");
  const displayed = tab === "movies" ? movies : tab === "series" ? series : allItems;

  return (
    <div className="pb-12">
      <div className="mb-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 inline-flex items-center gap-1 text-sm text-pitflix-muted hover:text-white"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-pitflix-primary/20 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-pitflix-primary">
            Keyword
          </span>
          <h1 className="text-3xl font-bold capitalize text-white">{kw}</h1>
        </div>
        {!isLoading && (
          <p className="mt-1 text-sm text-pitflix-muted">
            {allItems.length} title{allItems.length === 1 ? "" : "s"} in your library tagged with this mood
          </p>
        )}
      </div>

      {/* Tab bar */}
      {allItems.length > 0 && (
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
      )}

      {isLoading && (
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      )}

      {!isLoading && allItems.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-pitflix-muted">No matches yet</p>
          <p className="mt-1 text-sm text-pitflix-subtle">
            No titles in your library are tagged with "{kw}". Keywords are loaded from TMDB on the first
            detail page visit for each title.
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
