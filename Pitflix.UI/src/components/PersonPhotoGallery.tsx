import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { getPersonImages, setPersonProfileOverride } from "../api/people";
import { Spinner } from "./ui/Spinner";

type Props = {
  tmdbId: number;
  name: string;
  onClose: () => void;
};

export function PersonPhotoGallery({ tmdbId, name, onClose }: Props) {
  const qc = useQueryClient();
  const [index, setIndex] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const { data: images, isLoading } = useQuery({
    queryKey: ["person-images", tmdbId],
    queryFn: () => getPersonImages(tmdbId),
  });

  const current = images && images.length > 0 ? images[Math.min(index, images.length - 1)] : null;

  const go = (delta: number) => {
    if (!images || images.length === 0) return;
    setApplied(false);
    setIndex((i) => (i + delta + images.length) % images.length);
  };

  const useThisPhoto = () => {
    if (!current) return;
    setApplying(true);
    void setPersonProfileOverride(tmdbId, current.profilePath)
      .then((r) => {
        if (r.success) {
          setApplied(true);
          void qc.invalidateQueries({ queryKey: ["person", tmdbId] });
          // This gallery's own list of candidate photos is a separate query — without this it kept
          // showing the pre-change set (and the picked photo not marked as current) until reopened.
          void qc.invalidateQueries({ queryKey: ["person-images", tmdbId] });
          // The backend now serves this photo wherever the person appears as cast/crew, but any
          // movie/show detail page already fetched (within its 5 min staleTime) is still holding the
          // old cast list in the cache — we don't know which titles feature them client-side, so
          // invalidate every cached movie/show detail query rather than leaving them stale.
          void qc.invalidateQueries({
            predicate: (query) => query.queryKey[0] === "movie" || query.queryKey[0] === "show",
          });
        }
      })
      .finally(() => setApplying(false));
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        onClick={onClose}
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>

      <div
        className="flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium text-white">{name}</p>

        <div className="relative flex items-center gap-3">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={!images || images.length < 2}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30"
            aria-label="Previous photo"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div className="flex h-[420px] w-[300px] items-center justify-center overflow-hidden rounded-xl bg-pitflix-card">
            {isLoading ? (
              <Spinner />
            ) : current ? (
              <img
                src={current.url}
                alt={name}
                className="h-full w-full object-cover"
              />
            ) : (
              <p className="px-4 text-center text-sm text-pitflix-muted">No photos found for this person.</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => go(1)}
            disabled={!images || images.length < 2}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30"
            aria-label="Next photo"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {images && images.length > 0 ? (
          <p className="text-xs text-pitflix-muted">
            {index + 1} / {images.length}
          </p>
        ) : null}

        {current ? (
          <button
            type="button"
            disabled={applying}
            onClick={useThisPhoto}
            className="rounded-lg bg-pitflix-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {applying ? "Applying…" : applied ? "✓ Photo updated" : "Use this photo"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
