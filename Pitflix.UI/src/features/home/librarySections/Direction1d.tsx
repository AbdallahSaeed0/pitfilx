import { useNavigate, Link } from "react-router-dom";
import { Check, ChevronRight, Play, X } from "lucide-react";
import { MediaImage } from "../../../components/ui/MediaImage";
import { toPosterSrc } from "../../../utils/posterSrc";
import { trustedResumeHeadFromRow } from "../../../utils/trustedResume";
import { continueLabel, continueWatchingHeadline } from "../ContinueWatchingHero";
import { formatMinutesLeft, upNextEpisodeBadge, upNextEpisodeCode, upNextProgressPercent } from "./shared";
import type { DirectionProps } from "./types";
import type { WatchHistoryRow } from "../../../types/homeSection";

function longEpisodeInfo(item: WatchHistoryRow, remainingSeconds: number): string {
  const m = item.nextUpLabel?.match(/S\s*(\d+)\s*E\s*(\d+)/i);
  const parts: string[] = [];
  if (m) parts.push(`Season ${m[1]}, Episode ${m[2]}`);
  if (item.episodeTitle?.trim()) parts.push(`"${item.episodeTitle.trim()}"`);
  parts.push(formatMinutesLeft(remainingSeconds));
  return parts.join(" · ");
}

export function Direction1d({
  featured,
  history,
  currentIndex,
  upNext,
  onManageContinue,
  onSelectFeatured,
  requestPlay,
}: DirectionProps) {
  const navigate = useNavigate();

  const dur = featured.fileDurationSeconds ?? 0;
  const head = trustedResumeHeadFromRow(featured);
  const pct = dur > 0 ? Math.min(100, Math.round((head / dur) * 100)) : 0;
  const remaining = Math.max(0, dur - head);

  const headline = continueWatchingHeadline(featured);
  const others = history.map((h, i) => ({ h, i })).filter(({ i }) => i !== currentIndex);
  const detailPath =
    featured.libraryMovieId != null
      ? `/movie/${featured.libraryMovieId}`
      : featured.libraryShowId != null
        ? `/series/${featured.libraryShowId}`
        : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-[#0d0d1c]">
      {/* ── Continue Watching — 60/40 split ── */}
      <div className="flex flex-col border-b border-white/5 sm:flex-row">
        <div className="flex min-w-0 flex-col justify-between gap-5 border-b border-white/5 p-6 sm:w-3/5 sm:border-b-0 sm:border-r sm:p-7">
          <div>
            <p className="mb-4 text-[9.5px] font-bold uppercase tracking-[0.16em] text-pitflix-primary">
              Continue Watching
            </p>
            <h2 className="mb-1.5 text-[28px] font-extrabold leading-[1.05] tracking-[-0.03em] text-white sm:text-[32px]">
              {headline}
            </h2>
            <p className="mb-5 text-[13px] text-white/38">{longEpisodeInfo(featured, remaining)}</p>
            <div>
              <div className="mb-1.5 flex justify-between text-[11px] text-white/28">
                <span>{pct}% watched</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-pitflix-primary to-violet-400"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => requestPlay(featured)}
              className="flex items-center gap-2 rounded-[9px] bg-pitflix-primary px-6 py-3 text-[13px] font-bold text-white shadow-[0_4px_20px_rgba(124,58,237,0.45)] hover:bg-pitflix-light"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              {continueLabel(featured.nextUpLabel)}
            </button>
            {detailPath ? (
              <button
                type="button"
                onClick={() => navigate(detailPath)}
                className="rounded-[9px] border border-white/[0.09] bg-white/5 px-[18px] py-3 text-[13px] text-white/60 hover:text-white"
              >
                Details
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Mark completed"
              onClick={() => onManageContinue(featured.id)}
              className="rounded-[9px] border border-white/[0.09] bg-white/5 px-3.5 py-3 text-[13px] text-white/38 hover:text-green-400"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => onManageContinue(featured.id)}
              className="rounded-[9px] border border-white/[0.09] bg-white/5 px-3.5 py-3 text-[13px] text-white/38 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:w-2/5">
          <div className="border-b border-white/[0.04] px-[18px] pb-2 pt-3">
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/20">Also in progress</span>
          </div>
          {others.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-5">
              <p className="text-[12px] text-white/22">Nothing else in progress right now.</p>
            </div>
          ) : (
            <>
              {others.slice(0, 2).map(({ h, i }) => {
                const rDur = h.fileDurationSeconds ?? 0;
                const rHead = trustedResumeHeadFromRow(h);
                const code = h.nextUpLabel?.match(/S\s*(\d+)\s*E\s*(\d+)/i);
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => onSelectFeatured(i)}
                    className="flex items-center gap-2.5 border-b border-white/[0.04] px-[18px] py-2.5 text-left hover:bg-white/[0.03]"
                  >
                    <MediaImage
                      src={toPosterSrc(h.posterLocalPath ?? h.posterRemoteUrl ?? undefined)}
                      alt=""
                      className="h-[46px] w-8 shrink-0 rounded bg-pitflix-card"
                      fallbackText={h.title.slice(0, 2)}
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold text-white/70">{h.title}</p>
                      <p className="text-[10.5px] text-white/30">
                        {code ? `S${code[1]} E${code[2]} · ` : ""}
                        {rDur > 0 ? formatMinutesLeft(Math.max(0, rDur - rHead)) : h.mediaType}
                      </p>
                    </div>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/[0.09] bg-white/[0.06] text-white/45">
                      <Play className="h-3 w-3 translate-x-0.5 fill-current" />
                    </span>
                  </button>
                );
              })}
              {others.length > 2 ? (
                <div className="flex flex-1 items-center justify-center p-3">
                  <span className="text-[12px] text-white/22">+ {others.length - 2} more in progress</span>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* ── Up Next — episode-first shelf ── */}
      {upNext.length > 0 ? (
        <div className="px-6 pb-6 pt-[22px] sm:px-[26px]">
          <div className="mb-4 flex items-baseline justify-between">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[15px] font-bold text-white">Up Next</span>
              <span className="text-[12.5px] text-white/28">Shows you're still watching</span>
            </div>
            <Link
              to="/series"
              className="inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-pitflix-primary hover:underline"
            >
              Browse series <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {upNext.map((card) => {
              const poster = toPosterSrc(card.posterUrl ?? undefined);
              const pct = upNextProgressPercent(card);
              return (
                <div
                  key={card.libraryShowId}
                  className="relative min-w-[180px] flex-1 rounded-[10px] border border-white/[0.06] bg-white/[0.03] p-3.5"
                >
                  <div className="flex items-start gap-2.5">
                    <MediaImage
                      src={poster}
                      alt=""
                      className="h-14 w-10 shrink-0 rounded bg-pitflix-card"
                      fallbackText={card.showTitle.slice(0, 2)}
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1 pr-9">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white/28">
                        {upNextEpisodeCode(card)}
                      </p>
                      <p className="mb-0.5 truncate text-[14px] font-bold leading-tight text-white/85">
                        {card.showTitle}
                      </p>
                      <p className="mb-2.5 text-[11px] text-white/35">
                        {card.watchedEpisodes ?? 0} / {card.totalEpisodes ?? 0} eps · {upNextEpisodeBadge(card)}
                      </p>
                      <div className="h-[2px] rounded-full bg-white/[0.08]">
                        <div className="h-full rounded-full bg-white/25" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Continue ${card.showTitle}`}
                    onClick={() => navigate(`/series/${card.libraryShowId}`)}
                    className="absolute right-3 top-3 flex h-[30px] w-[30px] items-center justify-center rounded-full border border-white/10 bg-white/[0.07] text-white/55 hover:border-pitflix-primary/40 hover:text-white"
                  >
                    <Play className="h-3 w-3 translate-x-0.5 fill-current" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
