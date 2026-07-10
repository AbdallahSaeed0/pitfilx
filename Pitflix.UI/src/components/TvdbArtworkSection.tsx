import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import {
  getTvdbArtworks,
  isClearLogoType,
  TVDB_ARTWORK,
  type TvdbArtwork,
} from "../api/tvdb";

const TYPE_LABEL: Record<number, string> = {
  [TVDB_ARTWORK.BANNER]: "Banners",
  [TVDB_ARTWORK.POSTER]: "Posters",
  [TVDB_ARTWORK.BACKGROUND]: "Backdrops",
};

const LOGO_GROUP_KEY = "logos";

function groupArtworks(artworks: TvdbArtwork[]) {
  const groups: Record<string, TvdbArtwork[]> = {};
  for (const a of artworks) {
    const key = isClearLogoType(a.type) ? LOGO_GROUP_KEY : String(a.type);
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
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

function thumbClass(type: number) {
  if (type === TVDB_ARTWORK.BACKGROUND) {
    return "h-[90px] w-[160px] overflow-hidden rounded-lg border border-white/10 transition hover:border-pitflix-primary/40";
  }
  if (type === TVDB_ARTWORK.BANNER) {
    return "h-[52px] w-[280px] overflow-hidden rounded-lg border border-white/10 transition hover:border-pitflix-primary/40";
  }
  if (isClearLogoType(type)) {
    return "h-[60px] w-[180px] overflow-hidden rounded-lg border border-white/10 bg-white/5 transition hover:border-pitflix-primary/40";
  }
  return "h-[120px] w-[80px] overflow-hidden rounded-lg border border-white/10 transition hover:border-pitflix-primary/40";
}

export function TvdbArtworkSection({
  tmdbId,
  mediaType,
  initialArtworks,
}: {
  tmdbId: number;
  mediaType: "movie" | "series";
  initialArtworks?: TvdbArtwork[] | null;
}) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const { data: fetchedArtworks } = useQuery({
    queryKey: ["tvdb-artworks", tmdbId, mediaType],
    queryFn: () => getTvdbArtworks(tmdbId, mediaType),
    staleTime: 1000 * 60 * 60 * 24,
    retry: false,
    enabled: tmdbId > 0 && !initialArtworks?.length,
  });

  const artworks = initialArtworks?.length ? initialArtworks : fetchedArtworks;

  if (!artworks || artworks.length === 0) return null;

  const groups = groupArtworks(artworks);
  const sectionOrder = [
    String(TVDB_ARTWORK.POSTER),
    String(TVDB_ARTWORK.BACKGROUND),
    String(TVDB_ARTWORK.BANNER),
    LOGO_GROUP_KEY,
  ];

  return (
    <>
      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-white">Images</h2>
        <div className="space-y-6">
          {sectionOrder.map((groupKey) => {
            const items = groups[groupKey];
            if (!items || items.length === 0) return null;
            const label =
              groupKey === LOGO_GROUP_KEY
                ? "Logos"
                : TYPE_LABEL[Number(groupKey)] ?? `Type ${groupKey}`;
            return (
              <div key={groupKey}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
                  {label}
                </p>
                <div className="flex flex-wrap gap-2">
                  {items.map((a, i) => (
                    <button
                      key={`${a.url}-${i}`}
                      type="button"
                      onClick={() => setLightboxUrl(a.url)}
                      className={thumbClass(a.type)}
                    >
                      <img
                        src={a.thumbnail || a.url}
                        alt={label}
                        loading="lazy"
                        className={`h-full w-full ${isClearLogoType(a.type) ? "object-contain" : "object-cover"}`}
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
