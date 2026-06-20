import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Trophy, Globe, Tv, Star, Award, Film, Camera, PenLine } from "lucide-react";
import { getPerson, getPersonStreamCredits, getBatchCachedRatings, type CreditRatings } from "../api/people";
import { getPersonAwards, type PersonNomination } from "../api/awards";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../utils/cn";
import type { StreamingDetailsLocationState } from "./StreamingDetailsPage";

type LocalAppearance = {
  mediaKind: string;
  databaseId: number;
  tmdbId?: number | null;
  posterLocalPath?: string | null;
  title?: string;
  year?: number | null;
};

function PersonCard({
  item,
  href,
  onNavigate,
}: {
  item: LocalAppearance;
  href: string;
  onNavigate: (href: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(href)}
      className="group cursor-pointer text-left"
    >
      <div className="w-32 overflow-hidden rounded-lg transition-all group-hover:ring-2 group-hover:ring-pitflix-primary">
        <img
          src={item.posterLocalPath ?? ""}
          alt={item.title ?? ""}
          className="aspect-[2/3] w-full object-cover"
          onError={(e) => {
            e.currentTarget.src = "";
            e.currentTarget.className = "hidden";
          }}
        />
      </div>
      <p className="mt-2 w-32 truncate text-center text-xs font-medium text-white">{item.title}</p>
      {item.year != null ? (
        <p className="text-center text-xs text-pitflix-muted">{item.year}</p>
      ) : null}
    </button>
  );
}


// ── Award ceremony trophy images — locally downloaded to /awards/ ─────────────
const CEREMONY_IMAGE: Record<string, string> = {
  "academy-awards": "/awards/oscar.svg",
  "bafta":          "/awards/bafta.svg",
  "golden-globes":  "/awards/golden-globe.svg",
  "emmys":          "/awards/emmy.svg",
  "sag":            "/awards/sag.svg",
  "critics-choice": "/awards/critics-choice.svg",
};

// Lucide fallback icons when no local image exists
function FallbackIcon({ id, color }: { id: string; color: string }) {
  const p = { size: 18, color, strokeWidth: 1.8 } as const;
  switch (id) {
    case "academy-awards": return <Trophy {...p} />;
    case "bafta":          return <Film {...p} />;
    case "golden-globes":  return <Globe {...p} />;
    case "emmys":          return <Tv {...p} />;
    case "sag":            return <Star {...p} />;
    case "critics-choice": return <Award {...p} />;
    case "dga":            return <Camera {...p} />;
    case "wga":            return <PenLine {...p} />;
    default:               return <Trophy {...p} />;
  }
}

function CeremonyIcon({ id, color }: { id: string; color: string }) {
  const [failed, setFailed] = useState(false);
  const imgSrc = CEREMONY_IMAGE[id];

  if (!imgSrc || failed) {
    return <FallbackIcon id={id} color={color} />;
  }

  return (
    <img
      src={imgSrc}
      alt={id}
      className="h-[28px] w-auto object-contain drop-shadow-sm"
      onError={() => setFailed(true)}
    />
  );
}

const CEREMONY_ACCENT: Record<string, string> = {
  "academy-awards": "#c9a227",
  bafta: "#f97316",
  "golden-globes": "#eab308",
  emmys: "#3b82f6",
  sag: "#a78bfa",
  "critics-choice": "#10b981",
  cesar: "#e2c27d",
  saturn: "#818cf8",
};

const CEREMONY_SHORT: Record<string, string> = {
  "academy-awards": "OSCAR",
  bafta: "BAFTA",
  "golden-globes": "GOLDEN GLOBE",
  emmys: "EMMY",
  sag: "SAG",
  "critics-choice": "CRITICS' CHOICE",
  dga: "DGA",
  wga: "WGA",
  pga: "PGA",
  cesar: "CÉSAR",
  saturn: "SATURN",
};

type AwardGroup = {
  awardId: string;
  awardName: string;
  wins: number;
  noms: number;
  entries: PersonNomination[];
};

function groupNominations(nominations: PersonNomination[]): AwardGroup[] {
  const map = new Map<string, AwardGroup>();
  for (const n of nominations) {
    if (!map.has(n.awardId))
      map.set(n.awardId, { awardId: n.awardId, awardName: n.awardName, wins: 0, noms: 0, entries: [] });
    const g = map.get(n.awardId)!;
    if (n.winner) g.wins++;
    else g.noms++;
    g.entries.push(n);
  }
  return [...map.values()].sort((a, b) => b.wins - a.wins || b.noms - a.noms);
}

function AwardAccordionPanel({
  group,
  localByTmdbId,
  navigate,
}: {
  group: AwardGroup;
  localByTmdbId: Map<number, LocalAppearance>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const accent = CEREMONY_ACCENT[group.awardId] ?? "#6366f1";
  return (
    <div
      className="overflow-hidden rounded-xl border border-white/[0.07] bg-[#141414] shadow-xl shadow-black/50"
      style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
    >
      <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.05]">
        {group.entries.map((n, i) => {
          const tmdbId = n.workTmdbMovieId ?? n.workTmdbTvId ?? null;
          const libEntry = tmdbId ? localByTmdbId.get(tmdbId) : null;
          const canNav = !!libEntry;
          const posterSrc = libEntry?.posterLocalPath ?? n.posterUrl ?? null;
          return (
            <div
              key={i}
              role={canNav ? "button" : undefined}
              tabIndex={canNav ? 0 : undefined}
              onClick={() => {
                if (!libEntry) return;
                navigate(n.workTmdbMovieId ? `/movie/${libEntry.databaseId}` : `/series/${libEntry.databaseId}`);
              }}
              className={cn(
                "group flex items-center gap-3 px-3 py-2",
                canNav && "cursor-pointer hover:bg-white/[0.04]",
              )}
            >
              {/* Poster — wider than before, proper 2:3 ratio */}
              <div className="relative h-[66px] w-11 shrink-0 overflow-hidden rounded bg-pitflix-card/60">
                {posterSrc ? (
                  <img src={posterSrc} alt={n.workTitle ?? ""} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <CeremonyIcon id={group.awardId} color={`${accent}44`} />
                  </div>
                )}
              </div>
              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-1.5">
                  {n.year && <span className="text-[10px] font-semibold text-pitflix-muted">{n.year}</span>}
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider",
                      n.winner ? "bg-amber-500/20 text-amber-300" : "bg-white/[0.07] text-pitflix-subtle",
                    )}
                  >
                    {n.winner ? "WON" : "NOM"}
                  </span>
                </div>
                <p className="line-clamp-1 text-[12px] font-semibold text-white">{n.workTitle ?? "—"}</p>
                <p className="line-clamp-1 text-[10px] text-pitflix-muted">{n.categoryName}</p>
              </div>
              {canNav && <span className="shrink-0 text-[10px] text-pitflix-subtle opacity-0 transition group-hover:opacity-100">↗</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PersonAwardsBadges({
  tmdbId,
  localByTmdbId,
  navigate,
}: {
  tmdbId: number;
  localByTmdbId: Map<number, LocalAppearance>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: nominations } = useQuery({
    queryKey: ["person-awards", tmdbId],
    queryFn: () => getPersonAwards(tmdbId),
    enabled: tmdbId > 0,
    staleTime: 24 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });

  if (!nominations || nominations.length === 0) return null;

  const groups = groupNominations(nominations);

  return (
    <div className="relative mb-4 mt-3">
      <div className="flex flex-wrap gap-2.5">
        {groups.map((g) => {
          const accent = CEREMONY_ACCENT[g.awardId] ?? "#6366f1";
          const short = CEREMONY_SHORT[g.awardId] ?? g.awardName.replace(" Awards", "").replace(" Award", "").toUpperCase();
          const isOpen = openId === g.awardId;
          return (
            <button
              key={g.awardId}
              type="button"
              onClick={() => setOpenId(isOpen ? null : g.awardId)}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2 transition",
                isOpen
                  ? "border-white/20 bg-white/[0.09]"
                  : "border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.07]",
              )}
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                style={{ background: `${accent}18` }}
              >
                <CeremonyIcon id={g.awardId} color={accent} />
              </div>
              <div className="text-left">
                <p className="text-[12px] font-bold leading-none text-white">
                  {g.wins > 0 && <span style={{ color: accent }}>{g.wins} win{g.wins > 1 ? "s" : ""}</span>}
                  {g.wins > 0 && g.noms > 0 && <span className="text-pitflix-muted"> · </span>}
                  {g.noms > 0 && <span className="text-pitflix-muted">{g.noms} nom{g.noms > 1 ? "s" : ""}</span>}
                </p>
                <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-pitflix-subtle">{short}</p>
              </div>
              <span className={cn("ml-1 text-[10px] text-pitflix-subtle transition-transform", isOpen && "rotate-180")}>▾</span>
            </button>
          );
        })}
      </div>

      {/* Absolute panel — floats over bio without pushing it down */}
      {openId && (
        <>
          {/* backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpenId(null)}
            aria-hidden
          />
          {groups.map((g) =>
            openId === g.awardId ? (
              <div key={g.awardId} className="absolute left-0 right-0 top-full z-50 mt-1.5">
                <AwardAccordionPanel
                  group={g}
                  localByTmdbId={localByTmdbId}
                  navigate={navigate}
                />
              </div>
            ) : null,
          )}
        </>
      )}
    </div>
  );
}

type CreditGridProps = {
  credits: import("../api/people").PersonStreamCredit[];
  localByTmdbId: Map<number, LocalAppearance>;
  ratingsMap: Map<string, CreditRatings>;
  navigate: ReturnType<typeof useNavigate>;
};

function CreditGrid({ credits, localByTmdbId, ratingsMap, navigate }: CreditGridProps) {
  if (credits.length === 0)
    return <p className="mt-4 text-sm text-pitflix-subtle">No credits in this category.</p>;
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
      {credits.map((credit) => {
        const libEntry = localByTmdbId.get(credit.id);
        const role = credit.character || credit.job;
        const rKey = `${credit.mediaType === "Movie" ? "movie" : "tv"}:${credit.id}`;
        const r = ratingsMap.get(rKey);
        const imdb = r?.imdbRating ? parseFloat(r.imdbRating) : null;
        const rt = r?.rtCritics ?? null;
        const mc = r?.metacritic ?? null;
        const lb = r?.letterboxd ?? null;
        return (
          <button
            key={`${credit.creditType}-${credit.id}-${credit.job ?? credit.character ?? ""}`}
            type="button"
            onClick={() =>
              libEntry
                ? navigate(credit.mediaType === "Movie" ? `/movie/${libEntry.databaseId}` : `/series/${libEntry.databaseId}`)
                : navigate("/stream-details", {
                    state: { tmdbId: credit.id, mediaType: credit.mediaType, title: credit.title, posterUrl: credit.posterUrl, year: credit.year } satisfies StreamingDetailsLocationState,
                  })
            }
            className="group relative flex flex-col overflow-hidden rounded-xl border border-pitflix-card/60 bg-pitflix-surface/60 text-left shadow hover:border-pitflix-primary/50"
          >
            <div className="aspect-[2/3] w-full bg-pitflix-card/40 relative overflow-hidden">
              <MediaImage
                src={credit.posterUrl}
                alt={credit.title}
                className="h-full w-full object-cover transition-opacity group-hover:opacity-80"
                fallbackText={credit.mediaType === "Movie" ? "M" : "TV"}
              />
              {libEntry && (
                <div className="absolute left-1.5 top-1.5 rounded-full bg-pitflix-primary/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow">
                  In Library
                </div>
              )}
            </div>
            <div className="p-2">
              <p className="line-clamp-2 text-[10px] font-semibold leading-snug text-white">{credit.title}</p>
              {role && <p className="mt-0.5 line-clamp-1 text-[9px] text-pitflix-subtle italic">{role}</p>}
              <div className="mt-0.5 flex items-center justify-between">
                {credit.year && <span className="text-[9px] text-pitflix-muted">{credit.year}</span>}
                {imdb !== null && !isNaN(imdb)
                  ? <span className="rounded bg-[#F5C518]/15 px-1 py-px text-[8px] font-black text-[#F5C518]">IMDb {imdb.toFixed(1)}</span>
                  : credit.voteAverage > 0
                  ? <span className="text-[9px] text-amber-400">★ {credit.voteAverage.toFixed(1)}</span>
                  : null}
              </div>
              {(rt || mc !== null || lb !== null) && (
                <div className="mt-1 flex flex-wrap gap-x-1.5 gap-y-0.5">
                  {rt && <span className="text-[8px] text-red-400">🍅 {rt}</span>}
                  {mc !== null && <span className="text-[8px] text-green-400">MC {mc}</span>}
                  {lb !== null && <span className="text-[8px] text-blue-300">LB {lb.toFixed(1)}</span>}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

type FilmographyTab = "acting" | "directing" | "writing" | "producing" | "crew";

function FilmographyTabs({
  castCredits, directors, writers, producers, otherCrew, localByTmdbId, ratingsMap, navigate,
}: {
  castCredits: import("../api/people").PersonStreamCredit[];
  directors: import("../api/people").PersonStreamCredit[];
  writers: import("../api/people").PersonStreamCredit[];
  producers: import("../api/people").PersonStreamCredit[];
  otherCrew: import("../api/people").PersonStreamCredit[];
  localByTmdbId: Map<number, LocalAppearance>;
  ratingsMap: Map<string, CreditRatings>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const tabs: { key: FilmographyTab; label: string; count: number }[] = (
    [
      { key: "acting",    label: "Acting",    count: castCredits.length },
      { key: "directing", label: "Directing", count: directors.length },
      { key: "writing",   label: "Writing",   count: writers.length },
      { key: "producing", label: "Producing", count: producers.length },
      { key: "crew",      label: "Crew",      count: otherCrew.length },
    ] as { key: FilmographyTab; label: string; count: number }[]
  ).filter((t) => t.count > 0);

  const [tab, setTab] = useState<FilmographyTab>(tabs[0]?.key ?? "acting");

  const activeCredits =
    tab === "acting"    ? castCredits :
    tab === "directing" ? directors :
    tab === "writing"   ? writers :
    tab === "producing" ? producers : otherCrew;

  return (
    <div className="mt-10">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold text-white">Filmography</h2>
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
                tab === t.key
                  ? "bg-pitflix-primary text-white shadow-sm"
                  : "border border-white/10 text-pitflix-muted hover:border-white/25 hover:text-white"
              }`}
            >
              {t.label} <span className="opacity-60">({t.count})</span>
            </button>
          ))}
        </div>
      </div>
      <p className="mb-4 text-xs text-pitflix-muted">From TMDB · sorted by rating</p>
      <CreditGrid credits={activeCredits} localByTmdbId={localByTmdbId} ratingsMap={ratingsMap} navigate={navigate} />
    </div>
  );
}

export function PersonPage() {
  const { tmdbId } = useParams();
  const navigate = useNavigate();
  const id = Number(tmdbId);

  const { data, isLoading } = useQuery({
    queryKey: ["person", id],
    queryFn: () => getPerson(id),
    enabled: Number.isFinite(id) && id > 0,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });

  const creditsQ = useQuery({
    queryKey: ["person-stream-credits", id],
    queryFn: () => getPersonStreamCredits(id),
    enabled: Number.isFinite(id) && id > 0,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });

  const allCredits = useMemo(() => {
    const cast = creditsQ.data?.cast ?? [];
    const crew = creditsQ.data?.crew ?? [];
    return [...cast, ...crew];
  }, [creditsQ.data]);

  const batchIds = useMemo(
    () => [...new Set(allCredits.map((c) => `${c.mediaType === "Movie" ? "movie" : "tv"}:${c.id}`))],
    [allCredits],
  );

  const ratingsQ = useQuery({
    queryKey: ["credit-ratings-batch", id],
    queryFn: () => getBatchCachedRatings(batchIds),
    enabled: batchIds.length > 0,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });

  const ratingsMap = useMemo(() => {
    const m = new Map<string, CreditRatings>();
    for (const r of ratingsQ.data ?? []) m.set(r.key, r);
    return m;
  }, [ratingsQ.data]);

  if (!Number.isFinite(id) || id <= 0) return <p className="text-pitflix-muted">Invalid person</p>;
  if (isLoading)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  const person = data?.person as {
    name?: string;
    biography?: string;
    profileImageUrl?: string | null;
    birthday?: string | null;
    placeOfBirth?: string | null;
  } | null;

  const localAppearances = (data?.localAppearances ?? []) as LocalAppearance[];
  // Build a map from TMDB ID → library entry for exact ID-based matching
  const localByTmdbId = new Map<number, LocalAppearance>();
  for (const a of localAppearances) {
    if (a.tmdbId) localByTmdbId.set(a.tmdbId, a);
  }

  const castCredits = creditsQ.data?.cast ?? [];
  const crewCredits = creditsQ.data?.crew ?? [];
  const totalCredits = castCredits.length + crewCredits.length;

  const directors = crewCredits.filter((c) => c.job?.toLowerCase() === "director");
  const writers   = crewCredits.filter((c) => {
    const j = c.job?.toLowerCase() ?? "";
    return j === "writer" || j === "screenplay" || j === "story" || j.includes("writer");
  });
  const producers = crewCredits.filter((c) => c.job?.toLowerCase().includes("producer"));
  const otherCrew = crewCredits.filter((c) => {
    const j = c.job?.toLowerCase() ?? "";
    return !j.includes("director") && !j.includes("writer") && j !== "screenplay" && j !== "story" && !j.includes("producer");
  });

  const libraryMovies = localAppearances.filter((a) => (a.mediaKind || "").toLowerCase() !== "series");
  const librarySeries = localAppearances.filter((a) => (a.mediaKind || "").toLowerCase() === "series");

  return (
    <div className="pb-12">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 text-sm text-pitflix-muted hover:text-white"
      >
        ← Back
      </button>

      {/* Hero */}
      <div className="flex flex-wrap gap-8">
        <MediaImage
          src={person?.profileImageUrl ?? undefined}
          alt={person?.name ?? ""}
          className="h-48 w-48 shrink-0 overflow-hidden rounded-full bg-pitflix-card object-cover object-top"
          fallbackText={person?.name?.slice(0, 3) ?? "?"}
        />
        <div className="min-w-0 flex-1">
          <h1 className="mb-1 text-3xl font-bold text-white">{person?.name ?? "Person"}</h1>
          {person?.birthday || person?.placeOfBirth ? (
            <p className="mb-3 text-sm text-pitflix-muted">
              {[person.birthday, person.placeOfBirth].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          <PersonAwardsBadges tmdbId={id} localByTmdbId={localByTmdbId} navigate={navigate} />
          {person?.biography && (
            <p className="max-w-3xl text-sm leading-relaxed text-pitflix-muted">{person.biography}</p>
          )}
        </div>
      </div>

      {/* Library appearances */}
      {localAppearances.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-4 text-xl font-bold text-white">In Your Library</h2>
          {libraryMovies.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-pitflix-muted">Movies</h3>
              <div className="flex flex-wrap gap-4">
                {libraryMovies.map((item) => (
                  <PersonCard
                    key={`${item.databaseId}-${item.mediaKind}`}
                    item={item}
                    href={`/movie/${item.databaseId}`}
                    onNavigate={navigate}
                  />
                ))}
              </div>
            </div>
          )}
          {librarySeries.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-pitflix-muted">TV Shows</h3>
              <div className="flex flex-wrap gap-4">
                {librarySeries.map((item) => (
                  <PersonCard
                    key={`${item.databaseId}-${item.mediaKind}`}
                    item={item}
                    href={`/series/${item.databaseId}`}
                    onNavigate={navigate}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {localAppearances.length === 0 && (
        <div className="mt-10">
          <h2 className="mb-2 text-xl font-bold text-white">In Your Library</h2>
          <p className="text-sm text-pitflix-muted">Not found in your local library.</p>
        </div>
      )}

      {/* Full filmography from TMDB */}
      {creditsQ.isLoading ? (
        <div className="mt-10 flex justify-center py-8"><Spinner /></div>
      ) : creditsQ.isError || (totalCredits === 0 && !creditsQ.isLoading) ? (
        <div className="mt-10 rounded-2xl border border-white/[0.07] bg-pitflix-surface/40 p-5 text-center">
          <p className="text-sm font-medium text-pitflix-muted">Filmography unavailable</p>
          <p className="mt-1 text-xs text-pitflix-subtle">
            {creditsQ.isError ? "Could not reach the server." : creditsQ.data?.error ?? "No credits found."}
          </p>
        </div>
      ) : (
        <FilmographyTabs
          castCredits={castCredits}
          directors={directors}
          writers={writers}
          producers={producers}
          otherCrew={otherCrew}
          localByTmdbId={localByTmdbId}
          ratingsMap={ratingsMap}
          navigate={navigate}
        />
      )}
    </div>
  );
}
