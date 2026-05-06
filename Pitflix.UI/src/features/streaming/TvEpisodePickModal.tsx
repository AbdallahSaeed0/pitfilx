import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getStreamTvSeasons, type StreamTvSeasonRow } from "../../api/stream";
import { Spinner } from "../../components/ui/Spinner";

export type TvEpisodePickModalProps = {
  open: boolean;
  title: string;
  tmdbId: number;
  imdbId: string;
  onClose: () => void;
  onPlay: (season: number, episode: number) => void;
};

export function TvEpisodePickModal({
  open,
  title,
  tmdbId,
  imdbId,
  onClose,
  onPlay,
}: TvEpisodePickModalProps) {
  const q = useQuery({
    queryKey: ["stream-tv-seasons", tmdbId],
    queryFn: () => getStreamTvSeasons(tmdbId),
    enabled: open && tmdbId > 0,
  });

  const seasons = q.data ?? [];
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);

  useEffect(() => {
    if (!open) return;
    setSeason(1);
    setEpisode(1);
  }, [open, tmdbId]);

  useEffect(() => {
    if (!open || seasons.length === 0) return;
    const sn = seasons[0].seasonNumber;
    setSeason(sn);
    setEpisode(1);
  }, [open, seasons]);

  const selected: StreamTvSeasonRow | undefined = useMemo(
    () => seasons.find((s) => s.seasonNumber === season),
    [seasons, season],
  );

  const epMax = selected?.episodeCount ?? 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose episode"
        className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-pitflix-surface p-5 shadow-2xl"
      >
        <h2 className="text-lg font-bold text-white">{title}</h2>
        <p className="mt-1 text-xs text-pitflix-subtle">IMDb {imdbId}</p>

        {q.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : q.isError || seasons.length === 0 ? (
          <p className="mt-4 text-sm text-pitflix-muted">Could not load seasons from TMDB.</p>
        ) : (
          <div className="mt-4 space-y-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-pitflix-muted">
              Season
              <select
                className="mt-1 w-full rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-sm text-white"
                value={season}
                onChange={(e) => {
                  const sn = Number(e.target.value);
                  setSeason(sn);
                  setEpisode(1);
                }}
              >
                {seasons.map((s) => (
                  <option key={s.seasonNumber} value={s.seasonNumber}>
                    {s.name} ({s.episodeCount || "?"} eps)
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-semibold uppercase tracking-wide text-pitflix-muted">
              Episode
              {epMax > 0 ? (
                <select
                  className="mt-1 w-full rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-sm text-white"
                  value={Math.min(Math.max(1, episode), epMax)}
                  onChange={(e) => setEpisode(Number(e.target.value))}
                >
                  {Array.from({ length: epMax }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      Episode {n}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-2 text-xs text-amber-200/90">No episodes listed for this season on TMDB.</p>
              )}
            </label>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-pitflix-muted hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={q.isLoading || seasons.length === 0 || epMax <= 0}
            onClick={() => onPlay(season, Math.min(Math.max(1, episode), epMax))}
            className="inline-flex items-center gap-2 rounded-lg bg-pitflix-primary px-4 py-2 text-sm font-semibold text-white hover:bg-pitflix-light disabled:opacity-40"
          >
            <Play className="h-4 w-4" />
            Play
          </button>
        </div>
      </div>
    </div>
  );
}
