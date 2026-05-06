import { HorizontalScrollRow } from "../../components/ui/HorizontalScrollRow";
import { MediaImage } from "../../components/ui/MediaImage";
import type { HomeLayoutStyle } from "../../types/homeSection";
import type { WatchHistoryRow } from "../../types/homeSection";
import { toPosterSrc } from "../../utils/posterSrc";
import { cn } from "../../utils/cn";
import { useNavigate } from "react-router-dom";

function ContinueThumb({
  item,
  onManage,
}: {
  item: WatchHistoryRow;
  onManage?: (id: number) => void;
}) {
  const navigate = useNavigate();
  const src = toPosterSrc(item.posterLocalPath ?? item.posterRemoteUrl ?? undefined);
  const fallbackSrc =
    item.posterLocalPath && item.posterRemoteUrl ? toPosterSrc(item.posterRemoteUrl) : undefined;

  const goToDetailPage = () => {
    if (item.libraryMovieId != null) {
      navigate(`/movie/${item.libraryMovieId}`);
    } else if (item.libraryShowId != null) {
      navigate(`/series/${item.libraryShowId}`);
    }
  };

  return (
    <div className="flex w-[200px] shrink-0 items-stretch gap-1 rounded-xl bg-black/30 p-1 ring-1 ring-white/10">
      <button
        type="button"
        onClick={() => goToDetailPage()}
        className="flex min-w-0 flex-1 gap-2 rounded-lg p-1 text-left transition hover:bg-white/5"
        title="Go to series or movie details"
      >
        <MediaImage
          src={src}
          fallbackSrc={fallbackSrc}
          alt=""
          className="h-20 w-14 shrink-0 rounded-lg bg-pitflix-card object-cover cursor-pointer hover:opacity-90 transition-opacity"
          fallbackText=""
          loading="lazy"
        />
        <span className="line-clamp-3 pt-1 text-xs leading-snug text-white">{item.title}</span>
      </button>
      {onManage ? (
        <button
          type="button"
          className="shrink-0 rounded-md px-2 text-xs text-pitflix-muted hover:bg-white/10 hover:text-white"
          title="Remove or mark completed…"
          aria-label="Continue watching options"
          onClick={() => onManage(item.id)}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

export function ContinueWatchingRow({
  history,
  isEditing,
  layoutStyle,
  onManage,
}: {
  history: WatchHistoryRow[];
  isEditing: boolean;
  layoutStyle: HomeLayoutStyle;
  onManage?: (id: number) => void;
}) {
  if (history.length === 0) {
    return <p className="text-sm text-pitflix-muted">Nothing in Continue watching yet.</p>;
  }

  if (layoutStyle === "grid" || layoutStyle === "landscape-row") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {history.map((h) => (
          <ContinueThumb key={h.id} item={h} onManage={onManage} />
        ))}
      </div>
    );
  }

  if (layoutStyle === "ranked-row") {
    return (
      <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3">
        <>
          {history.map((h, i) => (
            <div key={h.id} className="relative shrink-0">
              <span className="absolute -left-1 -top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-pitflix-primary text-xs font-bold text-white ring-2 ring-black/40">
                {i + 1}
              </span>
              <ContinueThumb item={h} onManage={onManage} />
            </div>
          ))}
        </>
      </HorizontalScrollRow>
    );
  }

  return (
    <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3">
      <>
        {history.map((h) => (
          <div key={h.id} className={cn(isEditing && "rounded-xl ring-1 ring-dashed ring-white/15")}>
            <ContinueThumb item={h} onManage={onManage} />
          </div>
        ))}
      </>
    </HorizontalScrollRow>
  );
}
