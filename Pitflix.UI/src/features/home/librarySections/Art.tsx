import { cn } from "../../../utils/cn";

/**
 * Cover-fit landscape artwork with a poster fallback: when there's no still/backdrop, the poster is
 * blurred into a colour field and drawn sharp on top (centered on cards, right-aligned in heroes so
 * it stays clear of the title block).
 */
export function Art({
  src,
  fallbackPosterSrc,
  posterAlign = "center",
  className,
  eager,
}: {
  src?: string;
  fallbackPosterSrc?: string;
  posterAlign?: "center" | "right";
  className?: string;
  eager?: boolean;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        loading={eager ? "eager" : "lazy"}
        className={cn("h-full w-full object-cover object-center", className)}
      />
    );
  }
  if (fallbackPosterSrc) {
    return (
      <div className={cn("relative h-full w-full overflow-hidden", className)}>
        <div
          className="absolute inset-0 scale-125 bg-cover bg-center opacity-55 blur-2xl"
          style={{ backgroundImage: `url(${fallbackPosterSrc})` }}
        />
        <img
          src={fallbackPosterSrc}
          alt=""
          draggable={false}
          loading={eager ? "eager" : "lazy"}
          className={cn(
            "absolute top-[8%] h-[84%] w-auto rounded-md object-contain shadow-2xl shadow-black/60",
            posterAlign === "right" ? "right-[8%]" : "left-1/2 -translate-x-1/2",
          )}
        />
      </div>
    );
  }
  return <div className={cn("h-full w-full bg-pitflix-card", className)} />;
}
