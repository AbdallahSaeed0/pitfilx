import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../utils/cn";

export type MediaImageProps = {
  src?: string | null;
  /** Loaded when primary <code>src</code> fails (e.g. cleared image cache but TMDB backup exists). */
  fallbackSrc?: string | null;
  alt?: string;
  /** Wrapper: set size / aspect (e.g. <code>aspect-[2/3] w-full rounded-lg</code>). */
  className?: string;
  /** Extra classes on the <code>&lt;img&gt;</code> itself, e.g. a `group-hover:blur-*` effect. */
  imgClassName?: string;
  fallbackText?: string;
  /**
   * Default <code>eager</code>. Lazy was tried (2026-10-10) and posters stayed on their placeholder
   * on a fresh app start until a refresh — WebView2's lazy loading leans on intersection detection,
   * which can miss during startup. Pages keep off-screen work down by mounting rows on approach
   * (LazyMount on Home / Online Streaming) instead.
   */
  loading?: "lazy" | "eager";
};

type Phase = "primary" | "fallback" | "dead";

/**
 * Backoff for retrying a dead image (~15s total). One quick retry used to be all it got, which lost
 * to cold launches right after a PC boot: the API sidecar is still warming up and WebView2 aborts
 * in-flight requests (localhost included) while network adapters come up, so whole rows of posters
 * stayed on their initials until a manual refresh. Same idea as HOME_COLD_START_RETRY for the JSON.
 */
const DEAD_RETRY_DELAYS_MS = [450, 1000, 2000, 4000, 8000];

/** Distinct URL per retry so WebView2 can't hand back its remembered failure for the same src. */
function withRetryParam(url: string, attempt: number): string {
  if (attempt === 0 || !/^https?:\/\//i.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}_r=${attempt}`;
}

export function MediaImage({
  src,
  fallbackSrc,
  alt = "",
  className,
  imgClassName,
  fallbackText,
  loading = "eager",
}: MediaImageProps) {
  const [phase, setPhase] = useState<Phase>("primary");
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setPhase("primary");
    setLoaded(false);
    setAttempt(0);
  }, [src, fallbackSrc]);

  const primary = src?.trim() || "";
  const backup = fallbackSrc?.trim() || "";
  const displaySrc = withRetryParam(phase === "primary" ? primary : backup, attempt);
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

  /** Transient failures (API warming up, network coming up): retry with backoff so users do not need to refresh. */
  useEffect(() => {
    if (phase !== "dead" || !primary) return;
    const retry = () => {
      setAttempt((a) => a + 1);
      setPhase("primary");
      setLoaded(false);
    };
    // Coming back online (e.g. Wi-Fi connecting after boot) is a good moment for one more try even
    // after the backoff ran out.
    window.addEventListener("online", retry);
    const delay = DEAD_RETRY_DELAYS_MS[attempt];
    const t = delay === undefined ? undefined : window.setTimeout(retry, delay);
    return () => {
      window.removeEventListener("online", retry);
      if (t !== undefined) window.clearTimeout(t);
    };
  }, [phase, primary, attempt]);

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
      {/* Shimmering placeholder holding the image's exact footprint. The old blurred-dark version
          was indistinguishable from an empty tile once a card's own overlay sat on top of it. */}
      {!loaded ? <div className="pitflix-skeleton absolute inset-0 z-10 rounded-[inherit]" /> : null}
      <img
        ref={imgRef}
        key={displaySrc}
        src={displaySrc}
        alt={alt}
        // Fade in only — no blur-up. A CSS filter (even the resting `blur(0px)`) gave every poster its
        // own GPU layer for as long as it stayed on screen, ~200 on Home / Online Streaming, all
        // recomposited while scrolling; the shimmer placeholder above already covers loading.
        className={cn(
          "h-full w-full object-cover transition-[opacity,transform] duration-300 ease-out",
          loaded ? "opacity-100" : "opacity-0",
          imgClassName,
        )}
        loading={loading}
        decoding="async"
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
