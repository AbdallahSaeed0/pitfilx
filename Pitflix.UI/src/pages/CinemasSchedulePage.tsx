import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppPrefsStore } from "../store/appPrefsStore";
import { createPortal } from "react-dom";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  Bell,
  BellRing,
  Bookmark,
  CalendarDays,
  Clock,
  ExternalLink,
  Film,
  ListChecks,
  Loader2,
  MapPin,
  Moon,
  RefreshCw,
  Search,
  Star,
  Ticket,
} from "lucide-react";
import {
  BRANCH_STORAGE_KEYS,
  CINEMA_REFRESH_INTERVAL_MS,
  markPremiereViewed,
  fetchPremiereShowtimes,
  premiereWeekDates,
  readCachedPremiereShowtimes,
  type CinemaSchedule,
  type PremiereListings,
  type PremiereMovie,
} from "../api/cinemas";
import {
  isFollowedIn,
  loadWatchlistTmdbIds,
  matchKey,
  premiereNowShowingYear,
  voxYearFor,
  type CinemaMatch,
} from "../api/cinemaMatches";
import { LAYOUT_CHANGED, useCinemasStore } from "../store/cinemasStore";
import { useLibraryTmdbIndex } from "../hooks/useLibraryTmdbIndex";
import type { StreamingDetailsLocationState } from "./StreamingDetailsPage";
import { BackButton } from "../components/ui/BackButton";
import { MediaImage } from "../components/ui/MediaImage";
import { cn } from "../utils/cn";
import {
  cairoNowMinutes,
  cairoToday,
  displayTime,
  inMinutes,
  showtimeMinutes,
} from "../features/cinemas/cinemaTime";

type Tab = "showtimes" | "coming-soon";
type Source = "vox" | "premiere";

const SOURCES: { id: Source; label: string }[] = [
  { id: "vox", label: "VOX Cinemas" },
  { id: "premiere", label: "Premiere Cinemas" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A per-viewer preference kept in localStorage (remembered branch, chain, …). */
function useStoredState<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? fallback;
    } catch {
      return fallback;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* convenience only */
    }
  };
  return [value, set];
}

const utcDate = (isoDate: string) => new Date(`${isoDate}T12:00:00Z`);

function addDays(isoDate: string, days: number): string {
  const d = utcDate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (from: string, to: string) => Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000);

const fmtDate = (isoDate: string, opts: Intl.DateTimeFormatOptions) =>
  utcDate(isoDate).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

function dayLabel(isoDate: string, today: string): string {
  if (isoDate === today) return "Today";
  if (isoDate === addDays(today, 1)) return "Tomorrow";
  return fmtDate(isoDate, { weekday: "short", day: "2-digit", month: "short" });
}

const longDate = (isoDate: string) => fmtDate(isoDate, { weekday: "long", day: "numeric", month: "long" });

function timeAgo(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** For matching the same film across the two chains' listings. */
const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

function openExternal(url: string | null) {
  if (!url) return;
  if (isTauri()) void openUrl(url);
  else window.open(url, "_blank", "noopener");
}

const segmentClass = (active: boolean) =>
  cn(
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
    active ? "bg-pitflix-primary text-white shadow" : "text-pitflix-muted hover:text-white",
  );

const chipClass = (active: boolean) =>
  cn(
    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
    active
      ? "border-pitflix-primary/60 bg-pitflix-primary/25 text-white"
      : "border-white/10 bg-white/[0.03] text-pitflix-muted hover:border-white/25 hover:text-white",
  );

// ── Personal: TMDB link, watchlist, follows ─────────────────────────────────

type Personal = {
  match: CinemaMatch | null;
  onWatchlist: boolean;
  followed: boolean;
  toggleFollow: () => void;
  /** Opens the film's Pitflix page (library entry if owned, else the streaming details page). */
  openInPitflix: (() => void) | null;
};
type PersonalFn = (title: string, year: number | null) => Personal;
type PersonalFilter = { watchlist: boolean; following: boolean };

const passesPersonal = (p: Personal, f: PersonalFilter) =>
  (!f.watchlist && !f.following) || (f.watchlist && p.onWatchlist) || (f.following && p.followed);

/** Per-movie personal info, from the shared TMDB matches, watchlist and follows. */
function usePersonal(): PersonalFn {
  const matches = useCinemasStore((s) => s.matches);
  const follows = useCinemasStore((s) => s.follows);
  const toggleFollow = useCinemasStore((s) => s.toggleFollow);
  const watchlist = useQuery({ queryKey: ["cinemas-watchlist"], queryFn: loadWatchlistTmdbIds, staleTime: 10 * 60_000 });
  const library = useLibraryTmdbIndex();
  const navigate = useNavigate();

  return useCallback(
    (title: string, year: number | null): Personal => {
      const match = matches[matchKey(title, year)] ?? null;
      const tmdbId = match?.tmdbId ?? null;
      const libraryId = tmdbId ? library.data?.movieByTmdb.get(tmdbId) : undefined;
      return {
        match,
        onWatchlist: !!tmdbId && !!watchlist.data?.has(tmdbId),
        followed: isFollowedIn(follows, title, tmdbId),
        toggleFollow: () => toggleFollow(title, tmdbId),
        openInPitflix: !match
          ? null
          : libraryId
            ? () => navigate(`/movie/${libraryId}`)
            : () =>
                navigate("/stream-details", {
                  state: {
                    tmdbId: match.tmdbId,
                    mediaType: "Movie",
                    title: match.title,
                    posterUrl: match.posterUrl,
                    year: match.year,
                  } satisfies StreamingDetailsLocationState,
                }),
      };
    },
    [matches, follows, toggleFollow, watchlist.data, library.data, navigate],
  );
}

/** Follow bell: "Notify me when tickets open" / "Following". */
function FollowButton({ personal, compact = false }: { personal: Personal; compact?: boolean }) {
  const on = personal.followed;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        personal.toggleFollow();
      }}
      title={on ? "Following: you'll be notified when tickets open. Click to stop." : "Notify me when tickets open"}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md text-[11px] font-semibold transition-colors",
        compact ? "p-1.5" : "px-1.5 py-0.5",
        on ? "bg-amber-500/25 text-amber-200 hover:bg-amber-500/35" : "text-pitflix-muted hover:bg-white/5 hover:text-white",
        compact && !on && "bg-black/60 text-white backdrop-blur-sm",
      )}
    >
      {on ? <BellRing className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
      {compact ? null : on ? "Following" : "Notify me"}
    </button>
  );
}

function RatingChip({ match }: { match: CinemaMatch | null }) {
  if (!match || match.voteAverage <= 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-yellow-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-yellow-200">
      <Star className="h-3 w-3 fill-current" />
      {match.voteAverage.toFixed(1)}
      <span className="font-normal text-yellow-200/60">TMDB</span>
    </span>
  );
}

function WatchlistBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-pitflix-primary/25 px-1.5 py-0.5 text-[11px] font-semibold text-white ring-1 ring-pitflix-primary/40">
      <Bookmark className="h-3 w-3 fill-current" />
      Watchlist
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function CinemasSchedulePage() {
  const cinemasEnabled = useAppPrefsStore((s) => s.cinemasEnabled);
  if (!cinemasEnabled) return <Navigate to="/" replace />;
  return <CinemasSchedule />;
}

function CinemasSchedule() {
  const [source, setSource] = useStoredState<Source>("pitflix.cinemas.source", "vox");
  const [tab, setTab] = useState<Tab>("showtimes");
  const [search, setSearch] = useState("");

  // Shared with the app-wide background refresh (CinemasBackgroundSync), which normally keeps
  // this fresh before the page is even opened.
  const schedule = useCinemasStore((s) => s.vox);
  const premiere = useCinemasStore((s) => s.premiere);
  const refreshing = useCinemasStore((s) => s.refreshing);
  const errors = useCinemasStore((s) => s.errors);
  const progress = useCinemasStore((s) => s.voxProgress);
  const refresh = useCinemasStore((s) => s.refresh);
  const ensureMatches = useCinemasStore((s) => s.ensureMatches);
  const alertMode = useCinemasStore((s) => s.alertMode);
  const setAlertMode = useCinemasStore((s) => s.setAlertMode);
  const personal = usePersonal();
  const [personalFilter, setPersonalFilter] = useState<PersonalFilter>({ watchlist: false, following: false });

  // Usually already done by the background refresh; cheap (all cached) when it was.
  useEffect(() => {
    void ensureMatches();
  }, [schedule, premiere, ensureMatches]);

  // Only needed when the background refresh hasn't covered it (first run, or it failed).
  useEffect(() => {
    const data = source === "vox" ? schedule : premiere;
    // Listings saved before the scraper waited for Premiere's branch buttons have none.
    const incomplete = source === "premiere" && !!premiere?.nowShowing.some((m) => m.cinemas.length === 0);
    if (!data || Date.now() - data.fetchedAt > CINEMA_REFRESH_INTERVAL_MS || incomplete) void refresh(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // The toolbar counts as pinned once the marker just above it scrolls out of view.
  const [stuck, setStuck] = useState(false);
  const stickySentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stickySentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { root: el.closest("main") });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const today = cairoToday();
  const q = search.trim().toLowerCase();
  const fetchedAt = source === "vox" ? schedule?.fetchedAt : premiere?.fetchedAt;
  const hasData = source === "vox" ? !!schedule : !!premiere;
  const busy = refreshing[source];

  return (
    <div className="w-full space-y-5 pb-12">
      <BackButton className="mb-0" />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-white md:text-2xl">
            <Ticket className="h-7 w-7 shrink-0 text-pitflix-primary md:h-8 md:w-8" />
            Cinemas Schedule
          </h1>
          <p className="mt-1 text-xs text-pitflix-muted">
            What's playing and coming to cinemas in Egypt
            {fetchedAt ? ` · ${source === "vox" ? "VOX" : "Premiere"} updated ${timeAgo(fetchedAt)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAlertMode(alertMode === "important" ? "all" : "important")}
          title="Which new ticket sales pop a Windows notification (all of them always go to the bell)"
          className="inline-flex items-center gap-1.5 rounded-lg border border-pitflix-card bg-pitflix-surface px-3 py-1.5 text-xs font-semibold text-pitflix-muted hover:border-pitflix-primary/50 hover:text-white"
        >
          <BellRing className="h-3.5 w-3.5" />
          Alerts: {alertMode === "important" ? "watchlist & followed" : "every new movie"}
        </button>
        <button
          type="button"
          disabled={busy || !isTauri()}
          onClick={() => refresh(source)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-pitflix-card bg-pitflix-surface px-3 py-1.5 text-xs font-semibold text-white hover:border-pitflix-primary/50 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
          {busy
            ? source === "vox" && progress
              ? `Refreshing ${progress.done}/${progress.total}…`
              : "Refreshing…"
            : "Refresh"}
        </button>
        </div>
      </header>

      <div ref={stickySentinel} />
      {/* The scroll area has top padding; while pinned, the ::before strip hides cards scrolling through it. */}
      <div
        className={cn(
          "sticky top-0 z-20 -mx-4 space-y-3 border-b border-white/5 bg-pitflix-bg/95 px-4 py-3 backdrop-blur-md",
          stuck && "before:pointer-events-none before:absolute before:inset-x-0 before:-top-12 before:h-12 before:bg-pitflix-bg",
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {SOURCES.map((s) => (
              <button key={s.id} type="button" className={segmentClass(source === s.id)} onClick={() => setSource(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
            <button type="button" className={segmentClass(tab === "showtimes")} onClick={() => setTab("showtimes")}>
              <Clock className="h-3.5 w-3.5" />
              Showtimes
            </button>
            <button type="button" className={segmentClass(tab === "coming-soon")} onClick={() => setTab("coming-soon")}>
              <CalendarDays className="h-3.5 w-3.5" />
              Coming soon
            </button>
          </div>
          <div className="inline-flex gap-1.5">
            <button
              type="button"
              className={chipClass(personalFilter.watchlist)}
              onClick={() => setPersonalFilter((f) => ({ ...f, watchlist: !f.watchlist }))}
              title="Only films on your watchlist (the list your Letterboxd watchlist syncs into)"
            >
              <Bookmark className="h-3.5 w-3.5" />
              Watchlist
            </button>
            <button
              type="button"
              className={chipClass(personalFilter.following)}
              onClick={() => setPersonalFilter((f) => ({ ...f, following: !f.following }))}
              title="Only films you asked to be notified about"
            >
              <BellRing className="h-3.5 w-3.5" />
              Following
            </button>
          </div>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search movies…"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-2 pl-10 pr-3 text-sm text-white placeholder:text-pitflix-muted focus:border-pitflix-primary focus:outline-none focus:ring-1 focus:ring-pitflix-primary/40"
            />
          </div>
        </div>
        {/* Showtimes views portal their date/branch filters in here so they stick too. */}
        <div id="cinemas-toolbar-slot" />
      </div>

      {!isTauri() ? (
        <p className="text-sm text-pitflix-muted">Cinemas Schedule needs the Pitflix desktop app.</p>
      ) : null}
      {errors[source]?.includes(LAYOUT_CHANGED) ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {source === "vox" ? "VOX" : "Premiere"}'s website seems to have changed, so the schedule couldn't be read
            {fetchedAt ? ` (showing what loaded ${timeAgo(fetchedAt)})` : ""}. The scraper needs updating.
            <span className="block text-[11px] text-amber-100/70">{errors[source]}</span>
          </p>
        </div>
      ) : errors[source] ? (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          Couldn't refresh from {source === "vox" ? "VOX" : "Premiere"}: {errors[source]}
        </p>
      ) : null}
      {source === "vox" && schedule && schedule.failedDates.length > 0 ? (
        <p className="text-[11px] text-pitflix-muted">
          Some dates didn't load ({schedule.failedDates.map((d) => dayLabel(d, today)).join(", ")}). Refresh to retry.
        </p>
      ) : null}

      {!hasData && busy ? (
        <div className="space-y-3">
          <p className="text-sm text-pitflix-muted">
            {source === "vox"
              ? "Loading the VOX schedule — the first load takes about half a minute…"
              : "Loading Premiere's listings…"}
          </p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      ) : null}

      {source === "vox" && schedule ? (
        tab === "showtimes" ? (
          <VoxShowtimes schedule={schedule} today={today} q={q} personal={personal} filter={personalFilter} />
        ) : (
          <ComingSoonTimeline
            items={voxComingSoonItems(schedule, q, personal).filter((i) => passesPersonal(i.personal, personalFilter))}
            today={today}
          />
        )
      ) : null}

      {source === "premiere" && premiere ? (
        tab === "showtimes" ? (
          <PremiereShowtimesView listings={premiere} today={today} q={q} personal={personal} filter={personalFilter} />
        ) : (
          <ComingSoonTimeline
            items={premiereComingSoonItems(premiere, schedule, q, personal).filter((i) =>
              passesPersonal(i.personal, personalFilter),
            )}
            today={today}
          />
        )
      ) : null}
    </div>
  );
}

// ── Filters ──────────────────────────────────────────────────────────────────

function DateTiles({
  dates,
  active,
  today,
  onPick,
}: {
  dates: string[];
  active: string | undefined;
  today: string;
  onPick: (d: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {dates.map((d) => {
        const on = d === active;
        const rel = d === today ? "Today" : d === addDays(today, 1) ? "Tomorrow" : fmtDate(d, { weekday: "short" });
        return (
          <button
            key={d}
            type="button"
            onClick={() => onPick(d)}
            className={cn(
              "flex w-[68px] shrink-0 flex-col items-center rounded-xl border py-1.5 transition-colors",
              on
                ? "border-pitflix-primary bg-pitflix-primary/25 text-white"
                : "border-white/10 bg-white/[0.03] text-pitflix-muted hover:border-white/25 hover:text-white",
            )}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide">{rel}</span>
            <span className="text-lg font-bold leading-tight text-white">{fmtDate(d, { day: "numeric" })}</span>
            <span className="text-[10px] uppercase">{fmtDate(d, { month: "short" })}</span>
          </button>
        );
      })}
    </div>
  );
}

function ChipRow({
  icon,
  allLabel,
  options,
  active,
  onPick,
}: {
  icon: React.ReactNode;
  allLabel: string;
  options: string[];
  active: string;
  onPick: (v: string) => void;
}) {
  if (options.length < 2) return null;
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
      <span className="shrink-0 text-pitflix-muted">{icon}</span>
      <button type="button" className={chipClass(active === "all")} onClick={() => onPick("all")}>
        {allLabel}
      </button>
      {options.map((o) => (
        <button key={o} type="button" className={chipClass(active === o)} onClick={() => onPick(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

/** Renders the showtimes filters into the sticky toolbar. */
function ToolbarSlot({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("cinemas-toolbar-slot")), []);
  return slot ? createPortal(<div className="space-y-2.5">{children}</div>, slot) : null;
}

// ── Showtime cards ───────────────────────────────────────────────────────────

type TimesBranch = {
  name: string;
  formats: { name: string; times: { time: string; bookingUrl?: string | null; id?: string | null }[] }[];
};

const FORMAT_STYLES: [RegExp, string][] = [
  [/imax/i, "bg-sky-500/20 text-sky-200 ring-sky-400/30"],
  [/4dx|screenx|d-box/i, "bg-amber-500/20 text-amber-200 ring-amber-400/30"],
  [/^max$/i, "bg-violet-500/20 text-violet-200 ring-violet-400/30"],
  [/gold|luxe|vip/i, "bg-yellow-500/20 text-yellow-200 ring-yellow-400/30"],
  [/premium|plus/i, "bg-fuchsia-500/20 text-fuchsia-200 ring-fuchsia-400/30"],
  [/kids/i, "bg-pink-500/20 text-pink-200 ring-pink-400/30"],
  [/3d/i, "bg-emerald-500/20 text-emerald-200 ring-emerald-400/30"],
];

function FormatBadges({ name }: { name: string }) {
  // Premiere's are "2D · PREMIUM" (format · experience); VOX's are a single word.
  return (
    <span className="flex shrink-0 flex-wrap gap-1">
      {name.split("·").map((part) => {
        const label = part.trim();
        const style = FORMAT_STYLES.find(([re]) => re.test(label))?.[1] ?? "bg-white/[0.06] text-pitflix-muted ring-white/10";
        return (
          <span key={label} className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1", style)}>
            {label}
          </span>
        );
      })}
    </span>
  );
}

function BranchPanel({
  branch,
  nowMinutes,
  fallbackUrl,
  bookLabel,
  wide = false,
}: {
  branch: TimesBranch;
  nowMinutes: number | null;
  fallbackUrl: string | null;
  bookLabel: string;
  /** The only branch shown: spread its formats across the row instead of stacking them. */
  wide?: boolean;
}) {
  return (
    <div className="space-y-2.5 rounded-xl border border-white/[0.06] bg-black/30 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-white">
        <MapPin className="h-3.5 w-3.5 text-pitflix-primary" />
        {branch.name}
      </p>
      <div className={wide ? "grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3" : "space-y-2.5"}>
      {branch.formats.map((f) => (
        <div key={f.name} className="space-y-1.5">
          <FormatBadges name={f.name} />
          <div className="flex flex-wrap gap-1.5">
            {f.times.map((t) => {
              const mins = showtimeMinutes(t.time);
              const past = nowMinutes !== null && mins !== null && mins < nowMinutes;
              const late = mins !== null && mins >= 24 * 60;
              return (
                <button
                  key={t.id ?? t.time}
                  type="button"
                  disabled={past}
                  onClick={() => openExternal(t.bookingUrl ?? fallbackUrl)}
                  title={past ? "Already started" : late ? `${bookLabel} — after midnight` : bookLabel}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold tabular-nums transition-colors",
                    past
                      ? "cursor-default text-pitflix-muted/40 line-through"
                      : "bg-white/[0.07] text-white hover:bg-pitflix-primary/50",
                  )}
                >
                  {late && !past ? <Moon className="h-3 w-3 text-indigo-300" /> : null}
                  {displayTime(t.time)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

/** Soonest show still ahead today across the given branches. */
function nextShow(cinemas: TimesBranch[], nowMinutes: number | null): { time: string; branch: string; mins: number } | null {
  if (nowMinutes === null) return null;
  let best: { time: string; branch: string; mins: number } | null = null;
  for (const c of cinemas)
    for (const f of c.formats)
      for (const t of f.times) {
        const m = showtimeMinutes(t.time);
        if (m !== null && m >= nowMinutes && (!best || m < best.mins)) best = { time: t.time, branch: c.name, mins: m };
      }
  return best;
}

function MovieCard({
  title,
  posterUrl,
  backdropUrl,
  meta,
  url,
  linkLabel,
  next,
  personal,
  children,
}: {
  title: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  meta: (string | null | undefined)[];
  url: string | null;
  linkLabel: string;
  next: { time: string; branch: string; mins: number } | null;
  personal: Personal;
  children: React.ReactNode;
}) {
  const nowMinutes = next ? cairoNowMinutes() : 0;
  const backdrop = backdropUrl ?? posterUrl;
  return (
    <article className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-pitflix-surface/60">
      {backdrop ? (
        <img
          src={backdrop}
          alt=""
          aria-hidden
          loading="lazy"
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-[0.12] blur-2xl"
        />
      ) : null}
      <div className="relative flex gap-4 p-4 md:gap-5">
        {/* The poster opens the same place as the title: Pitflix when matched, else the cinema's page. */}
        <button
          type="button"
          onClick={personal.openInPitflix ?? (() => openExternal(url))}
          title={personal.openInPitflix ? "Open in Pitflix" : linkLabel}
          className="group/poster shrink-0 self-start overflow-hidden rounded-lg shadow-lg shadow-black/50 ring-pitflix-primary/60 transition hover:ring-2 focus-visible:outline-none focus-visible:ring-2"
        >
          <MediaImage
            src={posterUrl}
            alt={title}
            className="aspect-[2/3] w-24 md:w-28"
            imgClassName="h-full w-full object-cover transition-transform duration-300 group-hover/poster:scale-[1.04]"
            fallbackText="🎬"
            loading="lazy"
          />
        </button>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-lg font-bold leading-snug text-white">
                {personal.openInPitflix ? (
                  <button type="button" onClick={personal.openInPitflix} className="text-left hover:underline">
                    {title}
                  </button>
                ) : (
                  title
                )}
              </h3>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                {personal.openInPitflix ? (
                  <button
                    type="button"
                    onClick={personal.openInPitflix}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-pitflix-muted hover:bg-white/5 hover:text-white"
                  >
                    <Film className="h-3 w-3" />
                    Open in Pitflix
                  </button>
                ) : null}
                <FollowButton personal={personal} />
                <button
                  type="button"
                  onClick={() => openExternal(url)}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-pitflix-muted hover:bg-white/5 hover:text-white"
                >
                  <ExternalLink className="h-3 w-3" />
                  {linkLabel}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {personal.onWatchlist ? <WatchlistBadge /> : null}
              <RatingChip match={personal.match} />
              {meta.filter(Boolean).map((t) => (
                <span key={t} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-pitflix-muted">
                  {t}
                </span>
              ))}
              {next ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-400/25">
                  <Clock className="h-3 w-3" />
                  Next {displayTime(next.time)} · {inMinutes(next.mins - nowMinutes)}
                  <span className="font-normal text-emerald-300/70">· {next.branch}</span>
                </span>
              ) : null}
            </div>
          </div>
          {children}
        </div>
      </div>
    </article>
  );
}

/** Columns follow the branch count, so one or two branches still use the card's full width. */
const branchGrid = (count: number) =>
  count <= 1 ? "grid gap-3" : count === 2 ? "grid gap-3 md:grid-cols-2" : "grid gap-3 md:grid-cols-2 xl:grid-cols-3";

// ── VOX showtimes ────────────────────────────────────────────────────────────

function VoxShowtimes({
  schedule,
  today,
  q,
  personal,
  filter,
}: {
  schedule: CinemaSchedule;
  today: string;
  q: string;
  personal: PersonalFn;
  filter: PersonalFilter;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [branch, setBranch] = useStoredState<string>(BRANCH_STORAGE_KEYS.vox, "all");
  const [format, setFormat] = useState("all");

  const days = useMemo(() => schedule.days.filter((d) => d.date >= today), [schedule, today]);
  const activeDate = selectedDate && days.some((d) => d.date === selectedDate) ? selectedDate : days[0]?.date;
  const activeDay = days.find((d) => d.date === activeDate);

  /** Showtimes only carry a wide hero image; borrow the poster from the listings by slug. */
  const posters = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of [...schedule.nowShowing, ...schedule.comingSoon]) if (m.posterUrl) map.set(m.slug, m.posterUrl);
    return map;
  }, [schedule]);

  const branches = useMemo(() => {
    const names = new Set<string>();
    for (const d of days) for (const m of d.movies) for (const c of m.cinemas) names.add(c.name);
    return [...names].sort();
  }, [days]);

  const formats = useMemo(() => {
    const names = new Set<string>();
    for (const m of activeDay?.movies ?? []) for (const c of m.cinemas) for (const f of c.formats) names.add(f.name);
    return [...names].sort((a, b) => (a === "Standard" ? -1 : b === "Standard" ? 1 : a.localeCompare(b)));
  }, [activeDay]);

  // A remembered branch/format that isn't in today's data just means "all".
  const activeBranch = branch !== "all" && branches.includes(branch) ? branch : "all";
  const activeFormat = format !== "all" && formats.includes(format) ? format : "all";

  const screenings = useMemo(
    () =>
      (activeDay?.movies ?? [])
        .filter((m) => !q || m.title.toLowerCase().includes(q))
        .filter((m) => passesPersonal(personal(m.title, voxYearFor(m.title, schedule)), filter))
        .map((m) => ({
          ...m,
          cinemas: m.cinemas
            .filter((c) => activeBranch === "all" || c.name === activeBranch)
            .map((c) => ({ ...c, formats: c.formats.filter((f) => activeFormat === "all" || f.name === activeFormat) }))
            .filter((c) => c.formats.length > 0),
        }))
        .filter((m) => m.cinemas.length > 0),
    [activeDay, q, activeBranch, activeFormat, personal, filter, schedule],
  );

  const nowMinutes = activeDate === today ? cairoNowMinutes() : null;

  return (
    <>
      <ToolbarSlot>
        <DateTiles dates={days.map((d) => d.date)} active={activeDate} today={today} onPick={setSelectedDate} />
        <ChipRow icon={<MapPin className="h-3.5 w-3.5" />} allLabel="All branches" options={branches} active={activeBranch} onPick={setBranch} />
        <ChipRow icon={<Ticket className="h-3.5 w-3.5" />} allLabel="All formats" options={formats} active={activeFormat} onPick={setFormat} />
      </ToolbarSlot>

      {activeDate ? (
        <h2 className="text-sm font-semibold text-pitflix-muted">
          {longDate(activeDate)} · {screenings.length} {screenings.length === 1 ? "movie" : "movies"}
        </h2>
      ) : null}

      {screenings.length === 0 ? (
        <p className="py-8 text-center text-sm text-pitflix-muted">
          {days.length === 0 ? "No upcoming showtimes — try refreshing." : "No showtimes match these filters."}
        </p>
      ) : (
        <div className="space-y-4">
          {screenings.map((m) => (
            <MovieCard
              key={m.slug}
              title={m.title}
              posterUrl={posters.get(m.slug) ?? null}
              backdropUrl={m.heroUrl}
              meta={[m.classification, m.language, m.durationMins ? `${m.durationMins} min` : null]}
              url={m.url}
              linkLabel="VOX page"
              next={nextShow(m.cinemas, nowMinutes)}
              personal={personal(m.title, voxYearFor(m.title, schedule))}
            >
              <div className={branchGrid(m.cinemas.length)}>
                {m.cinemas.map((c) => (
                  <BranchPanel
                    key={c.name}
                    branch={c}
                    nowMinutes={nowMinutes}
                    fallbackUrl={m.url}
                    bookLabel="Book on VOX"
                    wide={m.cinemas.length === 1}
                  />
                ))}
              </div>
            </MovieCard>
          ))}
        </div>
      )}
    </>
  );
}

// ── Premiere showtimes ───────────────────────────────────────────────────────


function PremiereShowtimesView({
  listings,
  today,
  q,
  personal,
  filter,
}: {
  listings: PremiereListings;
  today: string;
  q: string;
  personal: PersonalFn;
  filter: PersonalFilter;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [branch, setBranch] = useStoredState<string>(BRANCH_STORAGE_KEYS.premiere, "all");
  useEffect(() => markPremiereViewed(), []);
  /** "Load all" for the current date+branch; resets when either changes. */
  const [loadAllKey, setLoadAllKey] = useState<string | null>(null);
  const loadingCount = useIsFetching({ queryKey: ["premiere-times"] });

  const dates = useMemo(() => premiereWeekDates(today), [today]);
  const date = selectedDate && dates.includes(selectedDate) ? selectedDate : dates[0];

  const branches = useMemo(() => [...new Set(listings.nowShowing.flatMap((m) => m.cinemas))].sort(), [listings]);
  const activeBranch = branch !== "all" && branches.includes(branch) ? branch : "all";
  const viewKey = `${date}|${activeBranch}`;
  // One branch is ~2s a movie, so just load them; all branches is ~6s each, so wait to be asked.
  const autoLoad = activeBranch !== "all" || loadAllKey === viewKey;

  const movies = useMemo(
    () =>
      listings.nowShowing.filter(
        (m) =>
          (!q || m.title.toLowerCase().includes(q)) &&
          (activeBranch === "all" || m.cinemas.includes(activeBranch)) &&
          passesPersonal(personal(m.title, premiereNowShowingYear(m.info)), filter),
      ),
    [listings, q, activeBranch, personal, filter],
  );

  return (
    <>
      <ToolbarSlot>
        <DateTiles dates={dates} active={date} today={today} onPick={setSelectedDate} />
        <ChipRow icon={<MapPin className="h-3.5 w-3.5" />} allLabel="All branches" options={branches} active={activeBranch} onPick={setBranch} />
      </ToolbarSlot>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-pitflix-muted">
          {longDate(date)} · {movies.length} {movies.length === 1 ? "movie" : "movies"}
          {loadingCount > 0 ? (
            <span className="ml-2 inline-flex items-center gap-1 font-normal">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              loading {loadingCount} more…
            </span>
          ) : null}
        </h2>
        {!autoLoad && movies.length > 0 ? (
          <button
            type="button"
            disabled={!isTauri()}
            onClick={() => setLoadAllKey(viewKey)}
            title="Premiere's times load per movie — about 6 seconds each for all branches"
            className="inline-flex items-center gap-1.5 rounded-lg border border-pitflix-card bg-pitflix-surface px-3 py-1.5 text-xs font-semibold text-white hover:border-pitflix-primary/50 disabled:opacity-50"
          >
            <ListChecks className="h-3.5 w-3.5" />
            Load all times
          </button>
        ) : null}
      </div>
      {!autoLoad ? (
        <p className="-mt-2 text-[11px] text-pitflix-muted">
          Tip: pick a branch to load its times automatically — it's about 3× faster than all branches.
        </p>
      ) : null}

      {movies.length === 0 ? (
        <p className="py-8 text-center text-sm text-pitflix-muted">No movies match these filters.</p>
      ) : (
        <div className="space-y-4">
          {movies.map((m) => (
            <PremiereCard
              key={`${m.id}|${viewKey}`}
              movie={m}
              date={date}
              cinema={activeBranch === "all" ? null : activeBranch}
              autoLoad={autoLoad}
              nowMinutes={date === today ? cairoNowMinutes() : null}
              personal={personal(m.title, premiereNowShowingYear(m.info))}
            />
          ))}
        </div>
      )}
    </>
  );
}

function PremiereCard({
  movie,
  date,
  cinema,
  autoLoad,
  nowMinutes,
  personal,
}: {
  movie: PremiereMovie;
  date: string;
  cinema: string | null;
  autoLoad: boolean;
  nowMinutes: number | null;
  personal: Personal;
}) {
  const [requested, setRequested] = useState(false);
  const queryClient = useQueryClient();
  const times = useQuery({
    queryKey: ["premiere-times", movie.id, date, cinema],
    queryFn: async ({ signal }) => {
      const byDate = await fetchPremiereShowtimes(movie.id, [date], cinema, signal);
      // This day first so it shows quickly; then the rest of this movie's week at background
      // priority, so flipping to another day is instant.
      fetchPremiereShowtimes(movie.id, premiereWeekDates(cairoToday()), cinema, undefined, "background")
        .then((week) => {
          for (const [d, t] of Object.entries(week)) queryClient.setQueryData(["premiere-times", movie.id, d, cinema], t);
        })
        .catch(() => undefined);
      return byDate[date];
    },
    enabled: requested || autoLoad,
    initialData: () => readCachedPremiereShowtimes(movie.id, date, cinema) ?? undefined,
    staleTime: 60 * 60_000,
    retry: false,
  });

  const [infoDate, ...genres] = (movie.info ?? "").split("|").map((s) => s.trim());
  const expectedBranches = cinema ? [cinema] : movie.cinemas;

  return (
    <MovieCard
      title={movie.title}
      posterUrl={movie.posterUrl}
      backdropUrl={null}
      meta={[infoDate || null, ...genres.slice(0, 3)]}
      url={movie.url}
      linkLabel="Premiere page"
      next={times.data ? nextShow(times.data.cinemas, nowMinutes) : null}
      personal={personal}
    >
      {times.data ? (
        times.data.cinemas.length > 0 ? (
          <div className={branchGrid(times.data.cinemas.length)}>
            {times.data.cinemas.map((c) => (
              <BranchPanel
                key={c.name}
                branch={c}
                nowMinutes={nowMinutes}
                fallbackUrl={movie.url}
                bookLabel="Book on Premiere"
                wide={times.data.cinemas.length === 1}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-pitflix-muted">No shows {cinema ? `at ${cinema} ` : ""}on this day.</p>
        )
      ) : times.isFetching || (times.isPending && times.fetchStatus !== "idle") ? (
        <div className={branchGrid(expectedBranches.length)}>
          {expectedBranches.map((b) => (
            <div key={b} className="space-y-2.5 rounded-xl border border-white/[0.06] bg-black/30 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-pitflix-muted">
                <MapPin className="h-3.5 w-3.5" />
                {b}
              </p>
              <div className="h-4 w-20 animate-pulse rounded bg-white/[0.06]" />
              <div className="flex gap-1.5">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-6 w-16 animate-pulse rounded-md bg-white/[0.06]" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {movie.synopsis ? <p className="line-clamp-2 text-sm text-pitflix-muted">{movie.synopsis}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!isTauri()}
              onClick={() => (times.isError ? void times.refetch() : setRequested(true))}
              className="inline-flex items-center gap-1.5 rounded-lg bg-pitflix-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-pitflix-primary/80 disabled:opacity-50"
            >
              <Clock className="h-3.5 w-3.5" />
              {times.isError ? "Try again" : "Show times"}
            </button>
            <span className="text-[11px] text-pitflix-muted">{expectedBranches.join(" · ")}</span>
          </div>
          {times.isError ? (
            <p className="text-xs text-rose-200">
              Couldn't load times: {times.error instanceof Error ? times.error.message : String(times.error)}
            </p>
          ) : null}
        </div>
      )}
    </MovieCard>
  );
}

// ── Coming soon ──────────────────────────────────────────────────────────────

type ComingSoonItem = {
  key: string;
  title: string;
  posterUrl: string | null;
  /** yyyy-mm-dd when known. */
  date: string | null;
  /** Shown when there's no exact date, e.g. "Expected 2026". */
  undatedLabel: string;
  lines: (string | null)[];
  hint: string | null;
  url: string | null;
  linkLabel: string;
  /** Already has showtimes, i.e. tickets are on sale even though it isn't released yet. */
  bookingOpen: boolean;
  personal: Personal;
};

function voxComingSoonItems(schedule: CinemaSchedule, q: string, personal: PersonalFn): ComingSoonItem[] {
  const bookable = new Set(schedule.days.flatMap((d) => d.movies.map((m) => m.slug)));
  return schedule.comingSoon
    .filter((m) => !q || m.title.toLowerCase().includes(q))
    .map((m) => ({
      key: m.slug,
      title: m.title,
      posterUrl: m.posterUrl,
      date: m.releaseDate,
      undatedLabel: "Date to be announced",
      lines: [[m.classification, m.language].filter(Boolean).join(" · ") || null, m.starring],
      hint: m.synopsis,
      url: m.url,
      linkLabel: "VOX page",
      bookingOpen: bookable.has(m.slug),
      personal: personal(m.title, voxYearFor(m.title, schedule)),
    }));
}

function premiereComingSoonItems(
  listings: PremiereListings,
  vox: CinemaSchedule | null,
  q: string,
  personal: PersonalFn,
): ComingSoonItem[] {
  // Premiere only gives a year; VOX often lists the same film with an exact Egypt date. Same film
  // = same TMDB match when both are matched, else the same normalized title.
  const voxByTmdb = new Map<number, string>();
  const voxByTitle = new Map<string, string>();
  for (const m of vox?.comingSoon ?? []) {
    if (!m.releaseDate) continue;
    voxByTitle.set(normTitle(m.title), m.releaseDate);
    const id = personal(m.title, voxYearFor(m.title, vox)).match?.tmdbId;
    if (id) voxByTmdb.set(id, m.releaseDate);
  }
  return listings.comingSoon
    .filter((m) => !q || m.title.toLowerCase().includes(q))
    .map((m) => {
      const p = personal(m.title, m.year ? Number(m.year) : null);
      const voxDate = (p.match && voxByTmdb.get(p.match.tmdbId)) ?? voxByTitle.get(normTitle(m.title)) ?? null;
      return {
        key: m.id,
        title: m.title,
        posterUrl: m.posterUrl,
        date: voxDate,
        undatedLabel: m.year ? `Expected ${m.year}` : "Date to be announced",
        lines: [m.genres?.split("|").map((g) => g.trim()).join(" · ") ?? null, voxDate ? "Date from VOX's listing" : null],
        hint: m.title,
        url: m.url,
        linkLabel: "Premiere page",
        bookingOpen: false,
        personal: p,
      };
    });
}

/** "This week" / "Next week" / month buckets, then undated ones last. */
function timelineGroup(date: string | null, undatedLabel: string, today: string): { key: string; label: string } {
  if (!date) return { key: `~${undatedLabel}`, label: undatedLabel };
  const diff = daysBetween(today, date);
  if (diff < 0) return { key: "0-out", label: "Out now" };
  // Weeks run Thursday→Wednesday, matching Egypt's release day.
  const toWednesday = (3 - utcDate(today).getUTCDay() + 7) % 7;
  if (diff <= toWednesday) return { key: "1-this", label: "This week" };
  if (diff <= toWednesday + 7) return { key: "2-next", label: "Next week" };
  return { key: `3-${date.slice(0, 7)}`, label: fmtDate(date, { month: "long", year: "numeric" }) };
}

function ComingSoonTimeline({ items, today }: { items: ComingSoonItem[]; today: string }) {
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: ComingSoonItem[] }>();
    for (const item of [...items].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"))) {
      const g = timelineGroup(item.date, item.undatedLabel, today);
      const entry = map.get(g.key) ?? { label: g.label, items: [] };
      entry.items.push(item);
      map.set(g.key, entry);
    }
    // Plain code-point order: the "~" prefix on undated keys must sort after the digits.
    return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
  }, [items, today]);

  if (groups.length === 0) return <p className="py-8 text-center text-sm text-pitflix-muted">Nothing coming soon matches.</p>;

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.label} className="space-y-3">
          <h2 className="flex items-center gap-3 text-base font-bold text-white">
            {g.label}
            <span className="text-xs font-normal text-pitflix-muted">{g.items.length}</span>
            <span className="h-px flex-1 bg-white/[0.06]" />
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
            {g.items.map((m) => {
              const diff = m.date ? daysBetween(today, m.date) : null;
              const open = m.personal.openInPitflix ?? (() => openExternal(m.url));
              return (
                <div
                  key={m.key}
                  role="button"
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") open();
                  }}
                  title={m.hint ?? m.title}
                  className="group cursor-pointer text-left"
                >
                  <div className="relative overflow-hidden rounded-xl border border-white/[0.07] shadow-lg shadow-black/40 transition-all group-hover:border-pitflix-primary/50 group-hover:shadow-pitflix-primary/10">
                    <MediaImage
                      src={m.posterUrl}
                      alt={m.title}
                      className="aspect-[2/3] w-full"
                      imgClassName="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      fallbackText="🎬"
                      loading="lazy"
                    />
                    {m.date ? (
                      <div className="absolute left-2 top-2 flex flex-col items-center rounded-lg bg-black/75 px-2 py-1 text-white backdrop-blur-sm">
                        <span className="text-[9px] font-semibold uppercase text-pitflix-muted">{fmtDate(m.date, { weekday: "short" })}</span>
                        <span className="text-base font-bold leading-none">{fmtDate(m.date, { day: "numeric" })}</span>
                        <span className="text-[9px] uppercase">{fmtDate(m.date, { month: "short" })}</span>
                      </div>
                    ) : null}
                    {m.personal.onWatchlist ? (
                      <span
                        className="absolute right-2 top-2 rounded-md bg-pitflix-primary p-1 text-white shadow"
                        title="On your watchlist"
                      >
                        <Bookmark className="h-3.5 w-3.5 fill-current" />
                      </span>
                    ) : null}
                    <span className="absolute bottom-2 left-2">
                      <FollowButton personal={m.personal} compact />
                    </span>
                    {m.bookingOpen ? (
                      <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white shadow">
                        <Ticket className="h-3 w-3" />
                        Booking open
                      </span>
                    ) : diff !== null && diff >= 0 && diff <= 14 ? (
                      <span className="absolute bottom-2 right-2 rounded-full bg-pitflix-primary px-2 py-0.5 text-[10px] font-bold text-white shadow">
                        {diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : `In ${diff} days`}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-0.5 px-0.5 pt-2">
                    <p className="line-clamp-2 text-sm font-semibold text-white">{m.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <RatingChip match={m.personal.match} />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openExternal(m.url);
                        }}
                        className="inline-flex items-center gap-0.5 text-[10px] text-pitflix-muted hover:text-white"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {m.linkLabel}
                      </button>
                    </div>
                    {m.lines.filter(Boolean).map((l, i) => (
                      <p key={i} className="line-clamp-1 text-[11px] text-pitflix-muted">
                        {l}
                      </p>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
