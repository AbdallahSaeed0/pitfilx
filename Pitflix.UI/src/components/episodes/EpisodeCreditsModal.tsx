import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getEpisodeCredits } from "../../api/series";
import { CastCrewSection, type CastPerson, type CrewMember } from "../../features/detail/detailComponents";
import { Spinner } from "../ui/Spinner";

type Props = {
  libraryShowId: number;
  season: number;
  episodeNumber: number;
  episodeTitle: string;
  onClose: () => void;
};

/** Cast/director/writer for one specific episode — same data source and layout as the player's
 * "click the title" credits popup (PlayerEmbeddedEpisodeInfoModal), just reachable from the
 * season grid/list without having to start playback first. Episode-level credits (not the show's
 * overall cast list) since TMDB doesn't roll up per-episode directing/writing into the show's
 * crew — the showrunner often shows as "Executive Producer" there even on episodes someone else
 * directed. */
export function EpisodeCreditsModal({ libraryShowId, season, episodeNumber, episodeTitle, onClose }: Props) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["episode-credits", libraryShowId, season, episodeNumber],
    queryFn: () => getEpisodeCredits(libraryShowId, season, episodeNumber),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });

  const credits = q.data as { cast?: CastPerson[]; crew?: CrewMember[] } | undefined;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[min(88vh,720px)] w-[min(560px,92vw)] overflow-y-auto rounded-2xl border border-white/10 bg-[#0f0f12]/95 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
              Season {season} · Episode {episodeNumber}
            </p>
            <h2 className="text-xl font-bold text-white">{episodeTitle}</h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-pitflix-muted hover:bg-white/10 hover:text-white"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {q.isLoading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-pitflix-subtle">
            <Spinner className="h-5 w-5" /> Loading credits…
          </div>
        ) : credits && ((credits.cast?.length ?? 0) > 0 || (credits.crew?.length ?? 0) > 0) ? (
          <CastCrewSection cast={credits.cast ?? []} crew={credits.crew ?? []} navigate={navigate} />
        ) : (
          <p className="mt-6 text-sm text-pitflix-subtle">No credits found for this episode.</p>
        )}
      </div>
    </div>
  );
}
