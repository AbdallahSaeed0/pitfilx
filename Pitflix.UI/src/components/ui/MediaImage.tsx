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

  /** No URL at all — show initials placeholder (must not return before hooks below). */
  const initialsPlaceholder = !primary && !backup && !!(fallbackText?.trim() || alt.trim());

  /** Cached / decoded images often skip <code>onLoad</code>; avoid a permanent loading pulse. */
  useLayoutEffect(() => {
    if (initialsPlaceholder || dead) return;
    const el = imgRef.current;
    if (!el) return;
    if (el.complete && el.naturalHeight > 0) {
      setLoaded(true);
    }
  }, [dead, displaySrc, phase, initialsPlaceholder]);

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

  if (initialsPlaceholder) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-zinc-950 font-semibold uppercase tracking-wide text-zinc-500 ring-1 ring-inset ring-white/10",
          className,
        )}
      >
        <span className="px-2 text-center text-xs">{fallbackText?.trim() || alt.slice(0, 2) || "?"}</span>
      </div>
    );
  }

  if (dead) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-zinc-950 text-zinc-500 ring-1 ring-inset ring-white/10",
          className,
        )}
      >
        <span className="px-2 text-center text-xs">{fallbackText || alt || "?"}</span>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* Blurred placeholder — matches spoiler-protection blur visually so the
          loading state reads as "image incoming" instead of a flat gray block. */}
      {!loaded ? (
        <div
          className="absolute inset-0 z-10 animate-pulse rounded-[inherit] bg-gradient-to-br from-zinc-700/70 via-zinc-800/60 to-zinc-900/80"
          style={{ filter: "blur(12px)" }}
        />
      ) : null}
      <img
        ref={imgRef}
        key={displaySrc}
        src={displaySrc}
        alt={alt}
        className={cn(
          "h-full w-full object-cover transition-[opacity,filter] duration-500 ease-out",
          loaded ? "opacity-100 blur-0" : "opacity-30 blur-xl",
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
