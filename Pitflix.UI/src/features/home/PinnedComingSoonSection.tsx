import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Pin, Trash2, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getComingSoon as getPinnedComingSoon, unpinComingSoon, type ComingSoonItem } from "../../api/comingSoon";
import { HorizontalScrollRow } from "../../components/ui/HorizontalScrollRow";
import { MediaImage } from "../../components/ui/MediaImage";
import type { StreamPlayerLocationState } from "../../pages/StreamPlayerPage";

function youtubeEmbedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.includes("/embed/")) return raw;
  const m = raw.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}?autoplay=1`;
  return null;
}

function releaseDateLabel(date: string | null | undefined): string {
  if (!date) return "TBD";
  try {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return date;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return date;
  }
}

function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  try {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  } catch {
    return null;
  }
}

function PinnedCard({ item, onUnpin }: { item: ComingSoonItem; onUnpin: () => void }) {
  const navigate = useNavigate();
  const days = daysUntil(item.releaseDate);
  const embedUrl = youtubeEmbedUrl(item.trailerUrl);

  function handleTrailer() {
    if (!embedUrl) return;
    const state: StreamPlayerLocationState = {
      streamUrl: embedUrl,
      title: `${item.title} — Trailer`,
      posterUrl: item.posterUrl,
    };
    navigate("/stream-player", { state });
  }

  return (
    <div className="group relative w-[160px] shrink-0 overflow-hidden rounded-xl border border-pitflix-card/60 bg-pitflix-surface/50 shadow-md shadow-black/20 transition-shadow hover:shadow-pitflix-primary/10">
      <div className="relative">
        <MediaImage
          src={item.posterUrl ?? undefined}
          alt=""
          className="aspect-[2/3] w-full object-cover"
          fallbackText={item.title.slice(0, 2)}
        />
        {/* Unpin button */}
        <button
          type="button"
          onClick={onUnpin}
          title="Unpin"
          className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-red-600/80 group-hover:opacity-100"
        >
          <Trash2 className="h-3 w-3" />
        </button>
        {/* Trailer button */}
        {embedUrl ? (
          <button
            type="button"
            onClick={handleTrailer}
            title="Watch trailer"
            className="absolute bottom-1 right-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-pitflix-primary/80 group-hover:opacity-100"
          >
            <Video className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      <div className="space-y-1 p-2">
        <p className="line-clamp-2 text-xs font-semibold text-white">{item.title}</p>
        <p className="text-[10px] text-pitflix-subtle">{releaseDateLabel(item.releaseDate)}</p>
        {days !== null ? (
          <p className={`text-[10px] font-semibold ${days <= 14 ? "text-amber-300" : "text-pitflix-muted"}`}>
            {days <= 0 ? "Out now!" : `In ${days}d`}
          </p>
        ) : null}
        <p className="text-[10px] uppercase text-pitflix-muted">{item.mediaType}</p>
      </div>
    </div>
  );
}

export function PinnedComingSoonSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["pinned-coming-soon"],
    queryFn: getPinnedComingSoon,
    staleTime: 30_000,
  });

  const unpinMut = useMutation({
    mutationFn: (id: number) => unpinComingSoon(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pinned-coming-soon"] }),
  });

  const items = data ?? [];
  if (isLoading || items.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <Pin className="h-4 w-4 text-pitflix-primary" />
        <h2 className="text-base font-bold text-white">Coming Soon</h2>
        <CalendarClock className="h-4 w-4 text-pitflix-muted" />
        <span className="text-xs text-pitflix-subtle">Your pinned upcoming titles</span>
      </div>
      <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3 pb-2">
        {items.map((item) => (
          <PinnedCard
            key={item.id}
            item={item}
            onUnpin={() => unpinMut.mutate(item.id)}
          />
        ))}
      </HorizontalScrollRow>
    </section>
  );
}
