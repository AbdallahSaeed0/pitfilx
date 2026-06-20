import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getListById, getListItems, removeListItem } from "../api/lists";
import { PosterCard } from "../components/ui/PosterCard";
import { Spinner } from "../components/ui/Spinner";
import type { MediaCard } from "../types/media";
import { decodeListTitle } from "../utils/listMarks";
import type { StreamingDetailsLocationState } from "./StreamingDetailsPage";

function formatListTitle(name: string, isDefault: boolean) {
  const n = decodeListTitle(name).title.trim();
  if (isDefault && /^favorites$/i.test(n)) return `❤️ ${n}`;
  return n;
}

export function ListDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listId = Number(id);

  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const listMetaQ = useQuery({
    queryKey: ["list-meta", listId],
    queryFn: () => getListById(listId),
    enabled: Number.isFinite(listId) && listId > 0,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["list-items", listId],
    queryFn: () => getListItems(listId),
    enabled: Number.isFinite(listId) && listId > 0,
  });

  const removeMut = useMutation({
    mutationFn: ({ tmdbId, mediaType }: { tmdbId: number; mediaType: string }) =>
      removeListItem(listId, tmdbId, mediaType),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["list-items", listId] });
      void qc.invalidateQueries({ queryKey: ["lists"] });
      setRemovingKey(null);
    },
    onError: () => setRemovingKey(null),
  });

  function handleRemove(tmdbId: number, mediaType: string) {
    const key = `${mediaType}-${tmdbId}`;
    setRemovingKey(key);
    removeMut.mutate({ tmdbId, mediaType });
  }

  if (!Number.isFinite(listId) || listId <= 0) return <p className="text-pitflix-muted">Invalid list</p>;
  if (isLoading || listMetaQ.isLoading)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  const meta = listMetaQ.data;
  const heading = meta ? formatListTitle(meta.name, meta.isDefault) : "List";
  const items = (data ?? []) as MediaCard[];

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 text-sm text-pitflix-muted hover:text-white"
      >
        ← Back
      </button>
      <h1 className="text-3xl font-bold text-white">{heading}</h1>

      {items.length === 0 && !isLoading && (
        <p className="mt-8 text-sm text-pitflix-muted">This list is empty.</p>
      )}

      <div className="mt-8 flex flex-wrap gap-4">
        {items.map((item) => {
          const rawMediaType = item.tmdbMediaType ?? (item.mediaFilePath || item.filePath ? "Movie" : "Series");
          const mediaType: "Movie" | "Series" = rawMediaType === "Series" ? "Series" : "Movie";
          const isStreamingOnly = (item.id ?? 0) <= 0 && (item.tmdbId ?? 0) > 0;
          const itemKey = `${mediaType}-${item.tmdbId}`;
          const isRemoving = removingKey === itemKey;

          if (isStreamingOnly) {
            const state: StreamingDetailsLocationState = {
              tmdbId: item.tmdbId,
              mediaType: mediaType as "Movie" | "Series",
              title: item.title,
              posterUrl: item.posterRemoteUrl ?? null,
              year: item.year != null ? String(item.year) : null,
              imdbId: item.imdbId ?? null,
            };
            return (
              <div key={`stream-${item.tmdbId}`} className="group relative w-[160px] shrink-0">
                <button
                  type="button"
                  onClick={() => navigate("/stream-details", { state })}
                  className="w-full cursor-pointer rounded-xl text-left transition-[transform,filter] duration-200 hover:-translate-y-1"
                >
                  <div className="overflow-hidden rounded-xl bg-pitflix-card ring-2 ring-transparent ring-offset-2 ring-offset-pitflix-bg transition-[transform,box-shadow,ring-color] duration-200 group-hover:scale-[1.04] group-hover:shadow-2xl group-hover:shadow-black/55 group-hover:ring-pitflix-primary/60">
                    <img
                      src={item.posterRemoteUrl ?? ""}
                      alt={item.title}
                      className="aspect-[2/3] w-full bg-gradient-to-b from-pitflix-card to-pitflix-surface object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  </div>
                  <p className="mt-2 truncate text-sm font-medium text-white">{item.title}</p>
                  <p className="truncate text-xs text-pitflix-subtle">{item.year ?? ""}</p>
                </button>

                {/* Remove button */}
                <button
                  type="button"
                  disabled={isRemoving}
                  onClick={() => handleRemove(item.tmdbId, mediaType)}
                  title="Remove from list"
                  className="absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-red-600/80 group-hover:opacity-100 disabled:cursor-not-allowed"
                >
                  {isRemoving ? (
                    <span className="h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            );
          }

          return (
            <div key={`${item.id}-${item.tmdbId}`} className="group relative w-[160px] shrink-0">
              <PosterCard item={item} mediaType={mediaType} />
              {/* Remove button */}
              <button
                type="button"
                disabled={isRemoving}
                onClick={() => handleRemove(item.tmdbId, mediaType)}
                title="Remove from list"
                className="absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-red-600/80 group-hover:opacity-100 disabled:cursor-not-allowed"
              >
                {isRemoving ? (
                  <span className="h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
