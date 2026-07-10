import { Play } from "lucide-react";
import { MediaImage } from "../../components/ui/MediaImage";
import { cn } from "../../utils/cn";
import { toPosterSrc } from "../../utils/posterSrc";

export type CompanionEpisodeRow = {
  id: number;
  episodeNumber: number;
  title?: string | null;
  filePath: string;
  stillLocalPath?: string | null;
};

type Props = {
  season: number;
  seasonName?: string | null;
  episodes: CompanionEpisodeRow[];
  currentEpisodeId?: number;
  loading?: boolean;
  onSelectEpisode: (ep: CompanionEpisodeRow) => void;
};

function epCode(season: number, episodeNumber: number) {
  return `S${String(season).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
}

/** Scrollable season episode list for the external-player companion page. */
export function PlayerCompanionEpisodeList({
  season,
  seasonName,
  episodes,
  currentEpisodeId,
  loading,
  onSelectEpisode,
}: Props) {
  if (!loading && episodes.length === 0) return null;

  const heading = seasonName?.trim() || (season === 0 ? "Specials" : `Season ${season}`);

  return (
    <div className="w-full max-w-4xl">
      <div className="rounded-xl bg-pitflix-bg-elevated/50 p-4 backdrop-blur-sm sm:p-5">
        <p className="mb-3 text-center text-caption font-semibold text-pitflix-text-secondary">
          {heading}
        </p>
        {loading ? (
          <p className="py-6 text-center text-sm text-pitflix-text-muted">Loading episodes…</p>
        ) : (
          <div className="flex max-h-[min(40vh,22rem)] flex-col gap-1 overflow-y-auto pr-1">
            {episodes.map((ep) => {
              const isCurrent = ep.id === currentEpisodeId;
              const stillSrc = toPosterSrc(ep.stillLocalPath ?? undefined);
              return (
                <button
                  key={ep.id}
                  type="button"
                  disabled={isCurrent}
                  onClick={() => onSelectEpisode(ep)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-2 py-2 text-left transition",
                    isCurrent
                      ? "cursor-default border-pitflix-accent-primary/45 bg-pitflix-accent-soft/15"
                      : "border-transparent hover:border-white/10 hover:bg-white/[0.05]",
                  )}
                >
                  <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-black/50">
                    {stillSrc ? (
                      <MediaImage
                        src={stillSrc}
                        alt=""
                        className="h-full w-full object-cover"
                        fallbackText={String(ep.episodeNumber)}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[11px] font-semibold text-white/40">
                        {ep.episodeNumber}
                      </div>
                    )}
                    {isCurrent ? (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                        <Play className="h-4 w-4 fill-white text-white" />
                      </span>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-xs font-semibold tabular-nums",
                        isCurrent ? "text-pitflix-accent-hover" : "text-pitflix-text-primary",
                      )}
                    >
                      {epCode(season, ep.episodeNumber)}
                    </p>
                    {ep.title ? (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-pitflix-text-muted">
                        {ep.title}
                      </p>
                    ) : null}
                  </div>
                  {isCurrent ? (
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-pitflix-accent-hover">
                      Playing
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
