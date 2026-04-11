import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../utils/cn";

export type MediaImageProps = {
  src?: string | null;
  /** Loaded when primary <code>src</code> fails (e.g. cleared image cache but TMDB backup exists). */
  fallbackSrc?: string | null;
  alt?: string;
  /** Wrapper: set size / aspect (e.g. <code>aspect-[2/3] w-full rounded-lg</code>). */
  className?: string;
  fallbackText?: string;
  /** Prefer <code>eager</code> for above-the-fold posters so WebView/intersection quirks do not skip loading. */
  loading?: "lazy" | "eager";
};

type Phase = "primary" | "fallback" | "dead";

export function MediaImage({
  src,
  fallbackSrc,
  alt = "",
  className,
  fallbackText,
  loading = "eager",
}: MediaImageProps) {
  const [phase, setPhase] = useState<Phase>("primary");
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const retriedDeadRef = useRef(false);

  useEffect(() => {
    setPhase("primary");
    setLoaded(false);
    retriedDeadRef.current = false;
  }, [src, fallbackSrc]);

  const primary = src?.trim() || "";
  const backup = fallbackSrc?.trim() || "";
  const displaySrc = phase === "primary" ? primary : backup;
  const dead = phase === "dead" || !displaySrc;

  /** Cached / decoded images often skip <code>onLoad</code>; avoid a permanent loading pulse. */
  useLayoutEffect(() => {
    if (dead) return;
    const el = imgRef.current;
    if (!el) return;
    if (el.complete && el.naturalHeight > 0) {
      setLoaded(true);
    }
  }, [dead, displaySrc, phase]);

  /** Transient failures (API warming up, race): one retry so users do not need to leave and re-enter the route. */
  useEffect(() => {
    if (phase !== "dead" || !primary || retriedDeadRef.current) return;
    retriedDeadRef.current = true;
    const t = window.setTimeout(() => {
      setPhase("primary");
      setLoaded(false);
    }, 450);
    return () => window.clearTimeout(t);
  }, [phase, primary]);

  if (dead) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-pitflix-card text-pitflix-subtle",
          className,
        )}
      >
        <span className="px-2 text-center text-xs">{fallbackText || alt || "No image"}</span>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {!loaded ? (
        <div className="absolute inset-0 z-10 animate-pulse rounded-[inherit] bg-pitflix-card" />
      ) : null}
      <img
        ref={imgRef}
        key={displaySrc}
        src={displaySrc}
        alt={alt}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
        )}
        loading={loading}
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (phase === "primary" && backup) {
            setPhase("fallback");
            setLoaded(false);
          } else {
            setPhase("dead");
          }
        }}
      />
    </div>
  );
}
