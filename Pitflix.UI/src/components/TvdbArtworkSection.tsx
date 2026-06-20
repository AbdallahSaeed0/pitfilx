import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { getTvdbArtworks, type TvdbArtwork } from "../api/tvdb";

const TYPE_LABEL: Record<number, string> = {
  2: "Posters",
  3: "Backdrops",
  11: "Logos",
};

function groupByType(artworks: TvdbArtwork[]) {
  const groups: Record<number, TvdbArtwork[]> = {};
  for (const a of artworks) {
    if (!groups[a.type]) groups[a.type] = [];
    groups[a.type].push(a);
  }
  return groups;
}

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        onClick={onClose}
      >
        <X className="h-4 w-4" />
      </button>
      <img
        src={url}
        alt="Full resolution artwork"
        className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export function TvdbArtworkSection({
  tmdbId,
  mediaType,
}: {
  tmdbId: number;
  mediaType: "movie" | "series";
}) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const { data: artworks } = useQuery({
    queryKey: ["tvdb-artworks", tmdbId, mediaType],
    queryFn: () => getTvdbArtworks(tmdbId, mediaType),
    staleTime: 1000 * 60 * 60 * 24, // 24 h — TVDB images rarely change
    retry: false,
    enabled: tmdbId > 0,
  });

  if (!artworks || artworks.length === 0) return null;

  const groups = groupByType(artworks);
  const typeOrder = [2, 3, 11]; // poster, backdrop, logo

  return (
    <>
      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-white">Images</h2>
        <div className="space-y-6">
          {typeOrder.map((type) => {
            const items = groups[type];
            if (!items || items.length === 0) return null;
            return (
              <div key={type}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
                  {TYPE_LABEL[type] ?? `Type ${type}`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {items.map((a, i) => (
                    <button
                      key={`${a.url}-${i}`}
                      type="button"
                      onClick={() => setLightboxUrl(a.url)}
                      className={
                        type === 3
                          ? "h-[90px] w-[160px] overflow-hidden rounded-lg border border-white/10 transition hover:border-pitflix-primary/40"
                          : type === 11
                            ? "h-[60px] w-[180px] overflow-hidden rounded-lg border border-white/10 bg-white/5 transition hover:border-pitflix-primary/40"
                            : "h-[120px] w-[80px] overflow-hidden rounded-lg border border-white/10 transition hover:border-pitflix-primary/40"
                      }
                    >
                      <img
                        src={a.thumbnail || a.url}
                        alt={TYPE_LABEL[type] ?? "Artwork"}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-[10px] text-white/25">
          Image data provided by{" "}
          <a
            href="https://thetvdb.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/50"
          >
            TheTVDB
          </a>
        </p>
      </section>
    </>
  );
}
