import { useQuery } from "@tanstack/react-query";
import { Clapperboard, Info, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { searchUnmatched } from "../api/unmatched";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { useDebounce } from "../hooks/useDebounce";
import { cn } from "../utils/cn";
import type { StreamingDetailsLocationState } from "./StreamingDetailsPage";

type SearchKind = "Both" | "Movie" | "Series";

type StreamSearchRow = {
  id: number;
  title: string;
  year?: string;
  posterUrl: string | null;
  mediaType: "Movie" | "Series";
};

function mapSearchRows(data: unknown, fallback: SearchKind): StreamSearchRow[] {
  const rows = (Array.isArray(data) ? data : []).map((raw) => {
    const r = raw as Record<string, unknown>;
    const id = Number(r.id ?? r.Id ?? 0);
    const title = String(r.title ?? r.Title ?? "");
    const year = typeof r.year === "string" && r.year.length >= 4 ? r.year.slice(0, 4) : undefined;
    const posterUrl =
      typeof r.posterUrl === "string"
        ? r.posterUrl
        : typeof r.poster_url === "string"
          ? r.poster_url
          : null;
    const mtRaw = typeof r.mediaType === "string" ? r.mediaType : "";
    let mediaType: "Movie" | "Series";
    if (mtRaw === "Movie" || mtRaw === "Series") {
      mediaType = mtRaw;
    } else if (fallback === "Movie" || fallback === "Series") {
      mediaType = fallback;
    } else {
      mediaType = "Movie";
    }
    return { id, title, year, posterUrl, mediaType };
  });
  return rows.filter((x) => x.id > 0 && x.title);
}

function posterDisplay(url: string | null): string | null {
  if (!url) return null;
  return url.includes("/w92") ? url.replace("/w92", "/w342") : url;
}

export function OnlineStreamPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 280);
  const [kind, setKind] = useState<SearchKind>("Both");

  useEffect(() => {
    const st = location.state as { seedQuery?: string; seedKind?: SearchKind } | null;
    if (!st?.seedQuery || st.seedQuery.trim().length < 1) return;
    setQuery(st.seedQuery.trim());
    if (st.seedKind === "Movie" || st.seedKind === "Series" || st.seedKind === "Both") {
      setKind(st.seedKind);
    }
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  const searchMediaType = kind === "Both" ? "Both" : kind;

  const searchQuery = useQuery({
    queryKey: ["online-stream-search", debounced.trim(), searchMediaType],
    queryFn: async () => {
      const raw = await searchUnmatched({ query: debounced.trim(), mediaType: searchMediaType });
      return mapSearchRows(raw, kind);
    },
    enabled: debounced.trim().length >= 2,
  });

  const rows = searchQuery.data ?? [];

  const openDetails = (row: StreamSearchRow) => {
    const state: StreamingDetailsLocationState = {
      tmdbId: row.id,
      mediaType: row.mediaType,
      title: row.title,
      posterUrl: posterDisplay(row.posterUrl),
      year: row.year ?? null,
    };
    navigate("/stream-details", { state });
  };

  const kindTabs: { id: SearchKind; label: string }[] = [
    { id: "Both", label: "All" },
    { id: "Movie", label: "Movies" },
    { id: "Series", label: "TV" },
  ];

  return (
    <div className="mx-auto max-w-6xl pb-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-white">
            <Clapperboard className="h-7 w-7 text-pitflix-primary" />
            Online streaming
            <span className="rounded-md bg-pitflix-primary/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-pitflix-light">
              Beta
            </span>
          </h1>
          <p className="mt-1 max-w-xl text-sm text-pitflix-subtle">
            Search TMDB and stream in-app. Click a result to open its details page.
          </p>
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies or TV shows…"
            className="w-full rounded-xl border border-pitflix-card bg-pitflix-surface py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-pitflix-muted focus:border-pitflix-primary focus:outline-none focus:ring-1 focus:ring-pitflix-primary"
            autoComplete="off"
          />
        </div>
        <div className="flex gap-1 rounded-xl border border-pitflix-card bg-pitflix-bg p-1">
          {kindTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setKind(t.id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                kind === t.id ? "bg-pitflix-primary text-white" : "text-pitflix-muted hover:text-white",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {debounced.trim().length > 0 && debounced.trim().length < 2 ? (
        <p className="text-sm text-pitflix-muted">Type at least 2 characters to search.</p>
      ) : null}

      {searchQuery.isFetching ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : searchQuery.isError ? (
        <p className="text-sm text-red-300">Search failed. Check that the API is running and TMDB is configured.</p>
      ) : rows.length === 0 && debounced.trim().length >= 2 ? (
        <p className="text-sm text-pitflix-muted">No results.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {rows.map((row) => {
            const poster = posterDisplay(row.posterUrl);
            return (
              <article
                key={`${row.mediaType}-${row.id}`}
                className="flex cursor-pointer flex-col overflow-hidden rounded-xl border border-pitflix-card/60 bg-pitflix-surface/80 shadow-lg shadow-black/30 transition-transform hover:scale-[1.02]"
                onClick={() => openDetails(row)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openDetails(row); }}
              >
                <div className="relative aspect-[2/3] w-full bg-pitflix-card/40">
                  <MediaImage
                    src={poster}
                    alt=""
                    className="h-full w-full object-cover"
                    fallbackText={row.mediaType === "Movie" ? "Movie" : "TV"}
                  />
                  <span className="absolute left-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                    {row.mediaType === "Movie" ? "Movie" : "TV"}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-3">
                  <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white">{row.title}</h3>
                  <p className="text-[11px] text-pitflix-muted">{row.year ?? "—"}</p>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openDetails(row); }}
                    className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg border border-pitflix-card bg-pitflix-card/60 py-1.5 text-xs font-semibold text-white hover:border-pitflix-primary/50 hover:bg-pitflix-primary/20"
                  >
                    <Info className="h-3.5 w-3.5" />
                    View details
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
