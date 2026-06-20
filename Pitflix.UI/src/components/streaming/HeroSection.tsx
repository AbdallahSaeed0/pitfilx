import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Info, Play } from "lucide-react";
import type { StreamDiscoverItem } from "../../api/stream";
import type { StreamingDetailsLocationState } from "../../pages/StreamingDetailsPage";
import { cn } from "../../utils/cn";

type Props = {
  items: StreamDiscoverItem[];
};

export function HeroSection({ items }: Props) {
  const navigate = useNavigate();
  const featured = items.slice(0, 6);
  const [activeIdx, setActiveIdx] = useState(0);
  const [fading, setFading] = useState(false);

  const switchTo = (idx: number) => {
    setFading(true);
    setTimeout(() => {
      setActiveIdx(idx);
      setFading(false);
    }, 250);
  };

  useEffect(() => {
    if (featured.length <= 1) return;
    const t = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setActiveIdx((i) => (i + 1) % featured.length);
        setFading(false);
      }, 250);
    }, 7000);
    return () => clearInterval(t);
  }, [featured.length]);

  if (!featured.length) return null;

  const item = featured[activeIdx]!;

  const navigate_ = (autoPlay: boolean) => {
    const state: StreamingDetailsLocationState = {
      tmdbId: item.id,
      mediaType: item.mediaType,
      title: item.title,
      posterUrl: item.posterUrl,
      year: item.year,
      ...(autoPlay ? { autoPlay: true as const } : {}),
    };
    navigate("/stream-details", { state });
  };

  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-2xl">
      {/* Backdrop image */}
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-500",
          fading ? "opacity-0" : "opacity-100",
        )}
      >
        {item.backdropUrl ? (
          <img
            key={item.backdropUrl}
            src={item.backdropUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full bg-pitflix-card" />
        )}
      </div>

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-black/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-transparent" />

      {/* Content */}
      <div
        className={cn(
          "absolute inset-0 flex flex-col justify-end p-8 transition-opacity duration-300",
          fading ? "opacity-0" : "opacity-100",
        )}
      >
        <div className="max-w-lg">
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-md bg-pitflix-primary/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
            TRENDING · {item.mediaType === "Movie" ? "MOVIE" : "TV SHOW"}
          </span>

          <h2 className="mb-2 text-4xl font-extrabold leading-tight text-white drop-shadow-lg line-clamp-2">
            {item.title}
          </h2>

          <div className="mb-3 flex items-center gap-3 text-sm text-white/70">
            {item.voteAverage > 0 ? (
              <span className="flex items-center gap-1">
                <span className="text-yellow-400">★</span>
                {item.voteAverage.toFixed(1)}
              </span>
            ) : null}
            {item.year ? <span>· {item.year}</span> : null}
          </div>

          {item.overview ? (
            <p className="mb-5 line-clamp-2 text-sm leading-relaxed text-white/75">
              {item.overview}
            </p>
          ) : null}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate_(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-pitflix-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-pitflix-light"
            >
              <Play className="h-4 w-4 fill-white" />
              Watch Now
            </button>
            <button
              type="button"
              onClick={() => navigate_(false)}
              className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-5 py-2.5 text-sm font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
            >
              <Info className="h-4 w-4" />
              More Info
            </button>
          </div>
        </div>
      </div>

      {/* Dot indicators */}
      {featured.length > 1 ? (
        <div className="absolute bottom-5 right-6 flex gap-1.5">
          {featured.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => switchTo(i)}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === activeIdx ? "w-6 bg-pitflix-primary" : "w-1.5 bg-white/35 hover:bg-white/60",
              )}
            />
          ))}
        </div>
      ) : null}

      {/* Nav arrows */}
      {featured.length > 1 ? (
        <>
          <button
            type="button"
            onClick={() => switchTo((activeIdx - 1 + featured.length) % featured.length)}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => switchTo((activeIdx + 1) % featured.length)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      ) : null}
    </div>
  );
}
