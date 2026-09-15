import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getTvdbArtworks,
  isClearLogoType,
  TVDB_ARTWORK,
  type TvdbArtwork,
} from "../api/tvdb";
import { getFanartArtwork } from "../api/fanart";
import { Lightbox } from "./ui/Lightbox";

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

  const { data: fanart } = useQuery({
    queryKey: ["fanart-artwork", tmdbId, mediaType],
    queryFn: () => getFanartArtwork(tmdbId, mediaType),
    staleTime: 1000 * 60 * 60 * 24,
    retry: false,
    enabled: tmdbId > 0,
  });

  const artworks = initialArtworks?.length ? initialArtworks : fetchedArtworks;
  const hasFanart =
    !!fanart &&
    (fanart.clearLogos.length + fanart.posters.length + fanart.backgrounds.length + fanart.characterArt.length) > 0;

  if ((!artworks || artworks.length === 0) && !hasFanart) return null;

  const groups = artworks ? groupArtworks(artworks) : {};
  const sectionOrder = [
    String(TVDB_ARTWORK.POSTER),
    String(TVDB_ARTWORK.BACKGROUND),
    String(TVDB_ARTWORK.BANNER),
    LOGO_GROUP_KEY,
  ];

  const fanartRow = (label: string, items: { url: string; type: string }[] | undefined, contain: boolean) => {
    if (!items || items.length === 0) return null;
    return (
      <div key={`fanart-${label}`}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">{label}</p>
        <div className="flex flex-wrap gap-2">
          {items.map((a, i) => (
            <button
              key={`${a.url}-${i}`}
              type="button"
              onClick={() => setLightboxUrl(a.url)}
              className={
                contain
                  ? "h-[60px] w-[180px] overflow-hidden rounded-lg border border-white/10 bg-white/5 transition hover:border-pitflix-primary/40"
                  : "h-[90px] w-[160px] overflow-hidden rounded-lg border border-white/10 transition hover:border-pitflix-primary/40"
              }
            >
              <img
                src={a.url}
                alt={label}
                loading="lazy"
                className={`h-full w-full ${contain ? "object-contain" : "object-cover"}`}
              />
            </button>
          ))}
        </div>
      </div>
    );
  };

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
          {hasFanart && (
            <div className="space-y-6 border-t border-white/[0.06] pt-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/30">From Fanart.tv</p>
              {fanartRow("Clearlogos", fanart?.clearLogos, true)}
              {fanartRow("Posters", fanart?.posters, false)}
              {fanartRow("Backgrounds", fanart?.backgrounds, false)}
              {fanartRow("Character Art", fanart?.characterArt, true)}
            </div>
          )}
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
          {hasFanart ? (
            <>
              {" "}
              and{" "}
              <a
                href="https://fanart.tv"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-white/50"
              >
                Fanart.tv
              </a>
            </>
          ) : null}
        </p>
      </section>
    </>
  );
}
