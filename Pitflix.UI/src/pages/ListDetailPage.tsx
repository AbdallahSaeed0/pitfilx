import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { getListById, getListItems } from "../api/lists";
import { PosterCard } from "../components/ui/PosterCard";
import { Spinner } from "../components/ui/Spinner";
import type { MediaCard } from "../types/media";

function formatListTitle(name: string, isDefault: boolean) {
  const n = name.trim();
  if (isDefault && /^favorites$/i.test(n)) return `❤️ ${n}`;
  return n;
}

export function ListDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const listId = Number(id);
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

  if (!Number.isFinite(listId) || listId <= 0) return <p className="text-pitflix-muted">Invalid list</p>;
  if (isLoading || listMetaQ.isLoading)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  const meta = listMetaQ.data;
  const heading = meta ? formatListTitle(meta.name, meta.isDefault) : "List";

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
      <div className="mt-8 flex flex-wrap gap-4">
        {((data ?? []) as MediaCard[]).map((item) => (
          <PosterCard
            key={`${item.id}-${item.tmdbId}`}
            item={item}
            mediaType={item.mediaFilePath || item.filePath ? "Movie" : "Series"}
          />
        ))}
      </div>
    </div>
  );
}
