import { useQuery } from "@tanstack/react-query";
import { getMovie } from "../../api/movies";
import { getEpisodeCredits, getShow } from "../../api/series";
import { CastCrewSection, type CastPerson, type CrewMember } from "../detail/detailComponents";
import { fmtTime, parentDirectory } from "./playerFormat";
import { EMBEDDED_PLAYER_SHORTCUT_SECTIONS } from "./playerShortcuts";
import type { PlaybackLaunchState } from "../../types/playback";

type Props = {
  open: boolean;
  onClose: () => void;
  state: PlaybackLaunchState;
  timePos: number;
  duration: number;
};

// The popup is a separate frameless player window with no MainLayout/router chrome for
// `/person/:id` — clicking a portrait here would navigate the player window itself into a
// page it can't render. Portraits are display-only, so this intentionally does nothing.
const noNavigate = () => {};

/** Episode details + keyboard-shortcuts popup, opened from clicking the title in the header. */
export function PlayerEmbeddedEpisodeInfoModal({ open, onClose, state, timePos, duration }: Props) {
  const movieQ = useQuery({
    queryKey: ["movie", state.libraryMovieId],
    queryFn: () => getMovie(state.libraryMovieId!),
    enabled: open && state.libraryMovieId != null,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
  const showQ = useQuery({
    queryKey: ["show", state.libraryShowId],
    queryFn: () => getShow(state.libraryShowId!),
    // Only a fallback when there's no season/episode number to fetch real episode credits with.
    enabled: open && state.libraryShowId != null && (state.season == null || state.episodeNumber == null),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
  // Show-level credits often list the showrunner as "Executive Producer" even on episodes they
  // directed (TMDB doesn't roll up per-episode directing credits into the show's crew list) —
  // episode credits give the real director for the exact episode that's playing.
  const episodeCreditsQ = useQuery({
    queryKey: ["episode-credits", state.libraryShowId, state.season, state.episodeNumber],
    queryFn: () => getEpisodeCredits(state.libraryShowId!, state.season!, state.episodeNumber!),
    enabled: open && state.libraryShowId != null && state.season != null && state.episodeNumber != null,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });

  if (!open) return null;

  // Prefer the explicit launch-state seriesName; fall back to the
  // parent folder of the file (e.g. "The Pitt" from `…\The Pitt\…`).
  const explicit = state.seriesName?.trim();
  const dir = parentDirectory(state.filePath);
  const fromDir = dir ? dir.split(/[\\/]/).filter(Boolean).pop() ?? "" : "";
  const seriesName = explicit || fromDir;

  const credits = (movieQ.data ?? episodeCreditsQ.data ?? showQ.data) as
    | { cast?: CastPerson[]; crew?: CrewMember[] }
    | undefined;

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
              {state.mediaType || "Now playing"}
            </p>
            {seriesName ? (
              <p className="mb-0.5 text-[13px] font-semibold uppercase tracking-wide text-pitflix-primary">
                {seriesName}
              </p>
            ) : null}
            <h2 className="text-xl font-bold text-white">{state.title}</h2>
            {state.season != null && state.episodeNumber != null ? (
              <p className="mt-1 text-sm text-pitflix-muted">
                Season {state.season} · Episode {state.episodeNumber}
              </p>
            ) : null}
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
        <dl className="mt-5 grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-[12px]">
          {state.durationSeconds > 0 ? (
            <>
              <dt className="text-pitflix-muted">Duration</dt>
              <dd className="text-white">{fmtTime(state.durationSeconds)}</dd>
            </>
          ) : null}
          {duration > 0 ? (
            <>
              <dt className="text-pitflix-muted">Position</dt>
              <dd className="text-white">
                {fmtTime(timePos)} / {fmtTime(duration)}
              </dd>
            </>
          ) : null}
          <dt className="text-pitflix-muted">File</dt>
          <dd className="break-all text-white/85">{state.filePath}</dd>
        </dl>
        {credits ? (
          <CastCrewSection cast={credits.cast ?? []} crew={credits.crew ?? []} navigate={noNavigate} />
        ) : null}
        <div className="mt-5 space-y-4 border-t border-white/10 pt-4">
          {EMBEDDED_PLAYER_SHORTCUT_SECTIONS.map((section) => (
            <div key={section.title}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
                {section.title}
              </p>
              <div className="grid grid-cols-1 gap-y-1.5 sm:grid-cols-2 sm:gap-x-4">
                {section.rows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3 text-[11px] text-pitflix-muted">
                    <span className="min-w-0">{row.label}</span>
                    <kbd className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white">
                      {row.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
