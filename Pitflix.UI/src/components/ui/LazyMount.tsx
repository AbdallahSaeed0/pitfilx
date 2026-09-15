import { useEffect, useRef, useState } from "react";

/**
 * Defers mounting `children` until the wrapper scrolls near the viewport (IntersectionObserver,
 * generous rootMargin so content is ready well before the user actually reaches it — not a
 * last-second pop-in). Used on Home, which renders ~15 independent sections each firing their own
 * query; mounting all of them immediately means ~15 parallel requests and a huge initial DOM on
 * every visit, most of it for rows the user hasn't scrolled to yet. Movies/Series don't have this
 * problem — they're one paginated query and one page of items — so lazy-mounting brings Home's
 * initial cost down to roughly the same shape.
 *
 * Renders a plain placeholder `<div>` (no skeleton chrome — sections already show their own
 * loading state once mounted) at a rough approximate height so the page doesn't jump much when
 * the real content swaps in.
 */
export function LazyMount({
  eager = false,
  minHeight = 280,
  children,
}: {
  /** Skip the intersection gate and mount immediately — use for above-the-fold sections. */
  eager?: boolean;
  /** Approximate placeholder height in px, to reduce layout shift when the real content mounts. */
  minHeight?: number;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(eager);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  if (visible) return <>{children}</>;
  return <div ref={ref} style={{ minHeight }} aria-hidden />;
}
