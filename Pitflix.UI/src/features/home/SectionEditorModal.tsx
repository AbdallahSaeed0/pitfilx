import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLists } from "../../api/lists";
import { formatListMenuLabel } from "../../utils/listMarks";
import type {
  HomeCardVariant,
  HomeLayoutStyle,
  HomeSectionConfig,
  HomeSourceType,
} from "../../types/homeSection";

const SOURCE_OPTIONS: { value: HomeSourceType; label: string }[] = [
  { value: "continue_watching", label: "Continue watching" },
  { value: "watching_currently", label: "Watching currently (series progress)" },
  { value: "coming_soon", label: "Coming soon (TMDB)" },
  { value: "next_episodes", label: "Next episodes (library + TMDB)" },
  { value: "next_episodes_all", label: "All upcoming episodes (wide TMDB schedule)" },
  { value: "latest_trailers", label: "Latest trailers (upcoming-first, same as Trailers › Latest)" },
  { value: "coming_soon_trailers", label: "Coming soon with trailer" },
  { value: "upcoming_trending_trailers", label: "Upcoming trailers (legacy)" },
  { value: "recently_added", label: "Recently added" },
  { value: "top_rated", label: "Top rated (library)" },
  { value: "unfinished_series", label: "Unfinished series" },
  { value: "movie_night", label: "Movie night (shuffle)" },
  { value: "genre_spotlight", label: "Genre spotlight" },
  { value: "hidden_gems", label: "Hidden gems" },
  { value: "favorites_list", label: "Favorites list" },
  { value: "list_spotlight", label: "Custom list" },
  { value: "arabic_picks", label: "Arabic picks" },
  { value: "binge_series", label: "Series to binge" },
  { value: "custom", label: "Custom (filters)" },
];

const LAYOUT_OPTIONS: { value: HomeLayoutStyle; label: string }[] = [
  { value: "poster-row", label: "Poster row" },
  { value: "grid", label: "Grid" },
  { value: "landscape-row", label: "Landscape row" },
  { value: "ranked-row", label: "Ranked row" },
];

const CARD_OPTIONS: { value: HomeCardVariant; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "compact", label: "Compact" },
  { value: "landscape", label: "Landscape" },
  { value: "ranked", label: "Ranked" },
];

function makeNewSection(): HomeSectionConfig {
  return {
    id: `custom-${crypto.randomUUID()}`,
    title: "Custom section",
    subtitle: "",
    enabled: true,
    order: 0,
    sourceType: "custom",
    mediaType: "all",
    sortBy: "dateadded",
    limit: 20,
    layoutStyle: "poster-row",
    cardVariant: "default",
    filters: {
      genres: [],
      categories: [],
      languages: [],
      watched: "all",
      tags: [],
    },
    metadata: {
      showTitle: true,
      showYear: true,
      showRating: true,
      showGenres: false,
      showLang: true,
      showWatchBadge: true,
    },
  };
}

function parseCsv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function canonicalHomeSectionId(sourceType: HomeSourceType, currentId: string): string {
  if (sourceType === "coming_soon") return "home_coming_soon";
  if (sourceType === "next_episodes") return "home_next_episodes";
  if (sourceType === "next_episodes_all") return "home_next_episodes_all";
  if (sourceType === "watching_currently") return "home_watching_currently";
  if (sourceType === "latest_trailers") return "home_latest_trailers";
  if (sourceType === "coming_soon_trailers" || sourceType === "upcoming_trending_trailers")
    return "home_coming_soon_trailers";
  return currentId;
}

export function SectionEditorModal({
  open,
  existing,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  existing: HomeSectionConfig | null;
  onClose: () => void;
  onSave: (s: HomeSectionConfig) => void;
  onDelete?: (id: string) => void;
}) {
  const [form, setForm] = useState<HomeSectionConfig | null>(null);
  const listsQ = useQuery({ queryKey: ["lists"], queryFn: getLists, enabled: open });

  useEffect(() => {
    if (!open) return;
    setForm(existing ? structuredClone(existing) : makeNewSection());
  }, [open, existing]);

  if (!open || !form) return null;

  const isNew = existing == null;
  const canDelete = !isNew && form.id.startsWith("custom-");

  const setF = (patch: Partial<HomeSectionConfig>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const setFilter = (patch: NonNullable<HomeSectionConfig["filters"]>) =>
    setForm((f) => (f ? { ...f, filters: { ...f.filters, ...patch } } : f));

  return (
    <div
      className="fixed inset-0 z-[250] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="home-section-editor-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-pitflix-surface p-5 shadow-2xl shadow-black/80 ring-1 ring-white/5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="home-section-editor-title" className="text-lg font-semibold text-white">
          {isNew ? "Add home section" : "Edit home section"}
        </h2>
        <p className="mt-1 text-sm text-pitflix-muted">Title, source, layout, and filters for this row.</p>

        <div className="mt-5 flex flex-col gap-4">
          <label className="block">
            <span className="text-xs font-medium text-pitflix-muted">Title</span>
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
              value={form.title}
              onChange={(e) => setF({ title: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-pitflix-muted">Subtitle</span>
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
              value={form.subtitle ?? ""}
              onChange={(e) => setF({ subtitle: e.target.value || undefined })}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-pitflix-muted">Source</span>
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
              value={form.sourceType}
              onChange={(e) => setF({ sourceType: e.target.value as HomeSourceType })}
            >
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-pitflix-muted">Media type</span>
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
                value={form.mediaType ?? "all"}
                onChange={(e) => setF({ mediaType: e.target.value as HomeSectionConfig["mediaType"] })}
              >
                <option value="all">All</option>
                <option value="movie">Movies</option>
                <option value="series">Series</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-pitflix-muted">Limit</span>
              <input
                type="number"
                min={1}
                max={80}
                className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
                value={form.limit ?? 20}
                onChange={(e) => setF({ limit: Math.max(1, Number(e.target.value) || 20) })}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-pitflix-muted">Layout</span>
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
                value={form.layoutStyle}
                onChange={(e) => setF({ layoutStyle: e.target.value as HomeLayoutStyle })}
              >
                {LAYOUT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-pitflix-muted">Card style</span>
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
                value={form.cardVariant ?? "default"}
                onChange={(e) => setF({ cardVariant: e.target.value as HomeCardVariant })}
              >
                {CARD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-pitflix-muted">Sort (custom source)</span>
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
              value={form.sortBy ?? "dateadded"}
              onChange={(e) => setF({ sortBy: e.target.value as HomeSectionConfig["sortBy"] })}
            >
              <option value="dateadded">Date added</option>
              <option value="rating">Rating</option>
              <option value="year">Year</option>
              <option value="title">Title</option>
              <option value="random">Random</option>
            </select>
          </label>

          {form.sourceType === "list_spotlight" && (
            <label className="block">
              <span className="text-xs font-medium text-pitflix-muted">List (custom list source)</span>
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
                value={form.filters?.customListId ?? ""}
                onChange={(e) =>
                  setFilter({
                    customListId: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              >
                <option value="">Default / Favorites</option>
                {(listsQ.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {formatListMenuLabel(l.name)} ({l.itemCount})
                  </option>
                ))}
              </select>
            </label>
          )}

          {form.sourceType === "genre_spotlight" && (
            <label className="block">
              <span className="text-xs font-medium text-pitflix-muted">Spotlight genre (optional)</span>
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
                placeholder="e.g. Action"
                value={form.filters?.spotlightGenre ?? ""}
                onChange={(e) => setFilter({ spotlightGenre: e.target.value || undefined })}
              />
            </label>
          )}

          <label className="block">
            <span className="text-xs font-medium text-pitflix-muted">Genres (comma-separated, any match)</span>
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
              placeholder="Action, Drama"
              value={(form.filters?.genres ?? []).join(", ")}
              onChange={(e) => setFilter({ genres: parseCsv(e.target.value) })}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-pitflix-muted">Language focus</span>
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
              value={
                form.filters?.categories?.includes("arabic")
                  ? "ar"
                  : form.filters?.categories?.includes("english")
                    ? "en"
                    : "all"
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === "ar") setFilter({ categories: ["arabic"], languages: ["ar"] });
                else if (v === "en") setFilter({ categories: ["english"], languages: ["en"] });
                else setFilter({ categories: [], languages: [] });
              }}
            >
              <option value="all">All languages</option>
              <option value="en">English library</option>
              <option value="ar">Arabic library</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-pitflix-muted">Watch state</span>
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
              value={form.filters?.watched ?? "all"}
              onChange={(e) =>
                setFilter({ watched: e.target.value as NonNullable<HomeSectionConfig["filters"]>["watched"] })
              }
            >
              <option value="all">All</option>
              <option value="unwatched">Unwatched</option>
              <option value="watching">Watching</option>
              <option value="completed">Completed</option>
              <option value="watched">Watched (any progress)</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-pitflix-muted">Min rating</span>
              <input
                type="number"
                step="0.1"
                className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
                value={form.filters?.minRating ?? ""}
                onChange={(e) =>
                  setFilter({ minRating: e.target.value === "" ? undefined : Number(e.target.value) })
                }
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-pitflix-muted">Year from</span>
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
                value={form.filters?.yearFrom ?? ""}
                onChange={(e) =>
                  setFilter({ yearFrom: e.target.value === "" ? undefined : Number(e.target.value) })
                }
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-pitflix-muted">Year to</span>
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
                value={form.filters?.yearTo ?? ""}
                onChange={(e) =>
                  setFilter({ yearTo: e.target.value === "" ? undefined : Number(e.target.value) })
                }
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-pitflix-muted">Runtime min (movies)</span>
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
                value={form.filters?.runtimeMin ?? ""}
                onChange={(e) =>
                  setFilter({ runtimeMin: e.target.value === "" ? undefined : Number(e.target.value) })
                }
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-pitflix-muted">Tags (comma — matches title or overview)</span>
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-pitflix-bg px-3 py-2 text-sm text-white outline-none ring-pitflix-primary focus:ring-2"
              value={(form.filters?.tags ?? []).join(", ")}
              onChange={(e) => setFilter({ tags: parseCsv(e.target.value) })}
            />
          </label>

          <fieldset className="rounded-lg border border-white/10 p-3">
            <legend className="px-1 text-xs font-medium text-pitflix-muted">Metadata on cards</legend>
            <div className="mt-2 flex flex-col gap-2 text-sm text-pitflix-muted">
              {(
                [
                  ["showTitle", "Title"],
                  ["showYear", "Year"],
                  ["showRating", "Rating"],
                  ["showGenres", "Genres (where supported)"],
                  ["showLang", "EN/AR"],
                  ["showWatchBadge", "Watched badge"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="rounded border-white/20 bg-pitflix-bg accent-pitflix-primary"
                    checked={form.metadata?.[k] !== false}
                    onChange={(e) =>
                      setF({
                        metadata: { ...form.metadata, [k]: e.target.checked },
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="mt-6 flex flex-wrap gap-2 border-t border-white/10 pt-4">
          <button
            type="button"
            className="rounded-lg bg-pitflix-primary px-4 py-2 text-sm font-semibold text-white hover:bg-pitflix-light"
            onClick={() =>
              onSave({
                ...form,
                id: canonicalHomeSectionId(form.sourceType, form.id),
                layoutStyle: form.layoutStyle ?? "poster-row",
              })
            }
          >
            Save section
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-pitflix-muted hover:text-white"
            onClick={onClose}
          >
            Cancel
          </button>
          {canDelete && onDelete ? (
            <button
              type="button"
              className="ml-auto rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10"
              onClick={() => onDelete(form.id)}
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
