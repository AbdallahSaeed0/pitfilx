import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { Bookmark, BellRing, ChevronRight, Clock, Ticket } from "lucide-react";
import { readCachedPremiereShowtimes, readStoredBranch } from "../../api/cinemas";
import {
  isFollowedIn,
  loadWatchlistTmdbIds,
  matchKey,
  premiereNowShowingYear,
  voxYearFor,
} from "../../api/cinemaMatches";
import { HorizontalScrollRow } from "../../components/ui/HorizontalScrollRow";
import { MediaImage } from "../../components/ui/MediaImage";
import { useAppPrefsStore } from "../../store/appPrefsStore";
import { useCinemasStore } from "../../store/cinemasStore";
import { cn } from "../../utils/cn";
import { cairoNowMinutes, cairoToday, displayTime, fmtCinemaDate, inMinutes, showtimeMinutes } from "./cinemaTime";
import { readRecentDrops, type RecentDrop } from "./ticketDrops";

type TonightPick = {
  key: string;
  title: string;
  posterUrl: string | null;
  chain: "VOX" | "Premiere";
  branch: string;
  time: string;
  mins: number;
  important: boolean;
};

const MAX_TONIGHT = 12;

/**
 * Home row for the Cinemas Schedule: movies that just opened for booking, and what's still
 * showing tonight at the branches picked on the Cinemas page (VOX, plus Premiere where its times
 * are already loaded). Watchlist / followed films sort first. Hidden when there's nothing to show.
 */
export function CinemasHomeRow() {
  const cinemasEnabled = useAppPrefsStore((s) => s.cinemasEnabled);
  return cinemasEnabled ? <CinemasHomeRowContent /> : null;
}

function CinemasHomeRowContent() {
  const vox = useCinemasStore((s) => s.vox);
  const premiere = useCinemasStore((s) => s.premiere);
  const matches = useCinemasStore((s) => s.matches);
  const follows = useCinemasStore((s) => s.follows);
  const watchlist = useQuery({ queryKey: ["cinemas-watchlist"], queryFn: loadWatchlistTmdbIds, staleTime: 10 * 60_000 });

  // Recomputed whenever a refresh lands (that's also when new drops get recorded).
  const drops = useMemo<RecentDrop[]>(
    () => readRecentDrops().sort((a, b) => Number(b.important) - Number(a.important) || b.at - a.at),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vox, premiere],
  );

  const tonight = useMemo<TonightPick[]>(() => {
    const today = cairoToday();
    const now = cairoNowMinutes();
    const isImportant = (title: string, year: number | null) => {
      const id = matches[matchKey(title, year)]?.tmdbId ?? null;
      return (!!id && !!watchlist.data?.has(id)) || isFollowedIn(follows, title, id);
    };
    const picks: TonightPick[] = [];

    const voxBranch = readStoredBranch("vox");
    const voxPosters = new Map<string, string>();
    for (const m of [...(vox?.nowShowing ?? []), ...(vox?.comingSoon ?? [])]) if (m.posterUrl) voxPosters.set(m.slug, m.posterUrl);
    for (const m of vox?.days.find((d) => d.date === today)?.movies ?? []) {
      let best: { time: string; branch: string; mins: number } | null = null;
      for (const c of m.cinemas) {
        if (voxBranch !== "all" && c.name !== voxBranch) continue;
        for (const f of c.formats)
          for (const t of f.times) {
            const mins = showtimeMinutes(t.time);
            if (mins !== null && mins >= now && (!best || mins < best.mins)) best = { time: t.time, branch: c.name, mins };
          }
      }
      if (best) {
        picks.push({
          key: `vox:${m.slug}`,
          title: m.title,
          posterUrl: voxPosters.get(m.slug) ?? m.heroUrl,
          chain: "VOX",
          ...best,
          important: isImportant(m.title, voxYearFor(m.title, vox)),
        });
      }
    }

    // Premiere times only exist once loaded; the background preload fills them for the picked branch.
    const premiereBranch = readStoredBranch("premiere");
    for (const m of premiere?.nowShowing ?? []) {
      const times = readCachedPremiereShowtimes(m.id, today, premiereBranch === "all" ? null : premiereBranch);
      let best: { time: string; branch: string; mins: number } | null = null;
      for (const c of times?.cinemas ?? []) {
        if (premiereBranch !== "all" && c.name !== premiereBranch) continue;
        for (const f of c.formats)
          for (const t of f.times) {
            const mins = showtimeMinutes(t.time);
            if (mins !== null && mins >= now && (!best || mins < best.mins)) best = { time: t.time, branch: c.name, mins };
          }
      }
      if (best) {
        picks.push({
          key: `premiere:${m.id}`,
          title: m.title,
          posterUrl: m.posterUrl,
          chain: "Premiere",
          ...best,
          important: isImportant(m.title, premiereNowShowingYear(m.info)),
        });
      }
    }

    return picks.sort((a, b) => Number(b.important) - Number(a.important) || a.mins - b.mins).slice(0, MAX_TONIGHT);
  }, [vox, premiere, matches, follows, watchlist.data]);

  if (!isTauri() || (drops.length === 0 && tonight.length === 0)) return null;
  const nowMinutes = cairoNowMinutes();

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <Ticket className="h-5 w-5 text-pitflix-primary" />
          In cinemas
        </h2>
        <Link to="/cinemas" className="inline-flex items-center gap-0.5 text-xs font-semibold text-pitflix-muted hover:text-white">
          Cinemas Schedule
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {drops.length > 0 ? (
        <Strip title="Tickets just opened">
          {drops.map((d) => (
            <PosterTile
              key={`${d.chain}:${d.title}:${d.at}`}
              title={d.title}
              posterUrl={d.posterUrl}
              important={d.important}
              importantIcon={d.reason === "followed" ? "followed" : "watchlist"}
              lines={[
                d.chain === "vox" ? "VOX Cinemas" : "Premiere Cinemas",
                d.firstDate ? `From ${fmtCinemaDate(d.firstDate, { weekday: "short", day: "numeric", month: "short" })}` : null,
              ]}
            />
          ))}
        </Strip>
      ) : null}

      {tonight.length > 0 ? (
        <Strip title="Still showing today">
          {tonight.map((t) => (
            <PosterTile
              key={t.key}
              title={t.title}
              posterUrl={t.posterUrl}
              important={t.important}
              importantIcon="watchlist"
              lines={[`${displayTime(t.time)} · ${inMinutes(t.mins - nowMinutes)}`, `${t.chain} · ${t.branch}`]}
              accent
            />
          ))}
        </Strip>
      ) : null}
    </section>
  );
}

function Strip({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-pitflix-muted">{title}</p>
      <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3 pb-2">
        {children}
      </HorizontalScrollRow>
    </div>
  );
}

function PosterTile({
  title,
  posterUrl,
  important,
  importantIcon,
  lines,
  accent = false,
}: {
  title: string;
  posterUrl: string | null;
  important: boolean;
  importantIcon: "watchlist" | "followed";
  lines: (string | null)[];
  accent?: boolean;
}) {
  return (
    <Link to="/cinemas" className="group w-[132px] shrink-0">
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border shadow-lg shadow-black/40 transition-colors",
          important ? "border-pitflix-primary/60" : "border-white/[0.07] group-hover:border-pitflix-primary/50",
        )}
      >
        <MediaImage
          src={posterUrl}
          alt={title}
          className="aspect-[2/3] w-full"
          imgClassName="h-full w-full object-cover"
          fallbackText="🎬"
          loading="lazy"
        />
        {important ? (
          <span className="absolute right-1.5 top-1.5 rounded-md bg-pitflix-primary p-1 text-white shadow">
            {importantIcon === "followed" ? <BellRing className="h-3 w-3" /> : <Bookmark className="h-3 w-3 fill-current" />}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 line-clamp-1 text-xs font-semibold text-white">{title}</p>
      {lines.filter(Boolean).map((l, i) => (
        <p
          key={i}
          className={cn(
            "line-clamp-1 text-[11px]",
            accent && i === 0 ? "inline-flex items-center gap-1 font-semibold text-emerald-300" : "text-pitflix-muted",
          )}
        >
          {accent && i === 0 ? <Clock className="h-3 w-3" /> : null}
          {l}
        </p>
      ))}
    </Link>
  );
}
