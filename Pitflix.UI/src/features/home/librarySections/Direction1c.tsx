import { useNavigate, Link } from "react-router-dom";
import { Check, ChevronRight, Play } from "lucide-react";
import { MediaImage } from "../../../components/ui/MediaImage";
import { toPosterSrc } from "../../../utils/posterSrc";
import { trustedResumeHeadFromRow } from "../../../utils/trustedResume";
import { continueWatchingHeadline, episodeInfoLine, parseSeEp } from "../ContinueWatchingHero";
import { formatMinutesLeft, upNextEpisodeBadge, upNextProgressPercent } from "./shared";
import type { DirectionProps } from "./types";
import type { WatchHistoryRow } from "../../../types/homeSection";

function shortEpisodeCode(item: WatchHistoryRow): string | null {
  const { season, episodeNumber } = parseSeEp(item.nextUpLabel);
  if (season != null && episodeNumber != null) return `S${season} E${episodeNumber}`;
  return null;
}

export function Direction1c({
  featured,
  history,
  currentIndex,
  upNext,
  onManageContinue,
  onSelectFeatured,
  requestPlay,
}: DirectionProps) {
  const navigate = useNavigate();

  const backdropSrc = toPosterSrc(featured.backdropLocalPath ?? undefined);
  const headline = continueWatchingHeadline(featured);
  const epInfo = episodeInfoLine(featured);
  const detailPath =
    featured.libraryMovieId != null
      ? `/movie/${featured.libraryMovieId}`
      : featured.libraryShowId != null
        ? `/series/${featured.libraryShowId}`
        : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-[#0d0d1c]">
      {/* ── Continue Watching — queue + preview ── */}
      <div className="border-b border-white/5">
        <div className="flex items-center justify-between px-6 pb-3.5 pt-[18px] sm:px-[26px]">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-pitflix-primary">Continue Watching</p>
          <span className="text-[11px] text-white/20">{history.length} in progress</span>
        </div>
        <div className="flex min-h-[188px] flex-col sm:flex-row">
          <div className="flex shrink-0 flex-col border-b border-white/5 sm:w-[320px] sm:border-b-0 sm:border-r">
            {history.map((h, i) => {
              const active = i === currentIndex;
              const dur = h.fileDurationSeconds ?? 0;
              const head = trustedResumeHeadFromRow(h);
              const pct = dur > 0 ? Math.min(100, Math.round((head / dur) * 100)) : 0;
              const code = shortEpisodeCode(h);
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => onSelectFeatured(i)}
                  className={`flex items-center gap-3 border-l-2 px-[18px] py-2.5 text-left transition-colors ${
                    active ? "border-pitflix-primary bg-pitflix-primary/10" : "border-transparent hover:bg-white/[0.03]"
                  }`}
                >
                  <MediaImage
                    src={toPosterSrc(h.posterLocalPath ?? h.posterRemoteUrl ?? undefined)}
                    alt=""
                    className="h-16 w-[46px] shrink-0 rounded-[5px] bg-pitflix-card"
                    fallbackText={h.title.slice(0, 2)}
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[13px] ${active ? "font-bold text-white" : "font-semibold text-white/65"}`}>
                      {h.title}
                    </p>
                    <p className={`mb-1.5 text-[11px] ${active ? "text-white/35" : "text-white/28"}`}>{code ?? h.mediaType}</p>
                    <div className="h-[2px] rounded-full bg-white/[0.08]">
                      <div
                        className={`h-full rounded-full ${active ? "bg-pitflix-primary" : "bg-white/[0.22]"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className={`shrink-0 text-[11px] ${active ? "text-pitflix-light" : "text-white/22"}`}>
                    {dur > 0 ? formatMinutesLeft(Math.max(0, dur - head)) : ""}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="relative flex-1 overflow-hidden">
            <div className="absolute inset-0">
              {backdropSrc ? (
                <img src={backdropSrc} alt="" className="h-full w-full object-cover opacity-45" loading="eager" />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-br from-[#150822] via-[#1a0d2a] to-[#100818]" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_100%_at_80%_50%,rgba(124,58,237,0.22),transparent_65%)]" />
            </div>
            <div className="relative flex h-full flex-col justify-between p-5 sm:p-6">
              <div>
                <h3 className="mb-1 text-[22px] font-extrabold tracking-[-0.025em] text-white">{headline}</h3>
                <p className="text-[12px] text-white/35">{epInfo ?? featured.mediaType}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => requestPlay(featured)}
                  className="flex items-center gap-1.5 rounded-lg bg-pitflix-primary px-5 py-2.5 text-[12.5px] font-semibold text-white shadow-[0_3px_16px_rgba(124,58,237,0.4)] hover:bg-pitflix-light"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Continue
                </button>
                {detailPath ? (
                  <button
                    type="button"
                    onClick={() => navigate(detailPath)}
                    className="rounded-lg border border-white/[0.09] bg-white/[0.06] px-4 py-2.5 text-[12.5px] text-white/55 hover:text-white"
                  >
                    Details
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Mark completed"
                  onClick={() => onManageContinue(featured.id)}
                  className="flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.06] text-white/45 hover:text-green-400"
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Up Next — compact list rows ── */}
      {upNext.length > 0 ? (
        <div className="px-6 pb-[22px] pt-[18px] sm:px-[26px]">
          <div className="mb-3.5 flex items-baseline justify-between">
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
          <div className="flex flex-col gap-0.5">
            {upNext.map((card, i) => {
              const poster = toPosterSrc(card.posterUrl ?? undefined);
              const pct = upNextProgressPercent(card);
              const active = i === 0;
              return (
                <div
                  key={card.libraryShowId}
                  className={`flex items-center gap-3.5 rounded-lg px-2.5 py-2.5 ${active ? "bg-pitflix-primary/[0.07]" : ""}`}
                >
                  <MediaImage
                    src={poster}
                    alt=""
                    className="h-[68px] w-12 shrink-0 rounded-[5px] bg-pitflix-card"
                    fallbackText={card.showTitle.slice(0, 2)}
                    loading="lazy"
                  />
                  <button
                    type="button"
                    onClick={() => navigate(`/series/${card.libraryShowId}`)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[13px] font-semibold text-white/90">{card.showTitle}</p>
                    <p className="mb-[7px] text-[11px] text-white/35">
                      {upNextEpisodeBadge(card)} · {card.watchedEpisodes ?? 0} / {card.totalEpisodes ?? 0} eps
                    </p>
                    <div className="h-[2px] max-w-[240px] rounded-full bg-white/[0.07]">
                      <div className="h-full rounded-full bg-white/25" style={{ width: `${pct}%` }} />
                    </div>
                  </button>
                  <span className="shrink-0 text-[11px] text-white/20">
                    {card.episodesRemaining ?? 0} left
                  </span>
                  <button
                    type="button"
                    aria-label={`Continue ${card.showTitle}`}
                    onClick={() => navigate(`/series/${card.libraryShowId}`)}
                    className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] text-white/55 hover:border-pitflix-primary/40 hover:text-white"
                  >
                    <Play className="h-3.5 w-3.5 translate-x-0.5 fill-current" />
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
