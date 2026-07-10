import { BarChart3, Clapperboard, FolderOpen, HelpCircle, Key, LayoutGrid, Play, RefreshCw, Wrench } from "lucide-react";
import { ApiHealthCheck } from "../components/ApiHealthCheck";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ApiKeyGuideCopyBlock, ApiKeyGuideModal } from "../components/ui/ApiKeyGuideModal";
import { RemoveTitleBrowseModal } from "../components/RemoveTitleBrowseModal";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../utils/cn";
import { useSettingsPageModel } from "../features/settings/useSettingsPageModel";
import { SettingsLibraryTab } from "../features/settings/SettingsLibraryTab";
import { SettingsPlaybackTab } from "../features/settings/SettingsPlaybackTab";
import { SettingsAppTab } from "../features/settings/SettingsAppTab";
import { SettingsStatsTab } from "../features/settings/SettingsStatsTab";
import { SettingsProvidersTab } from "../features/settings/SettingsProvidersTab";
import { SettingsTraktTab } from "../features/settings/SettingsTraktTab";
import { SettingsMaintenanceTab } from "../features/settings/SettingsMaintenanceTab";
import { SettingsHelpTab } from "../features/settings/SettingsHelpTab";
import { SettingsPlayerLayoutTab } from "../features/settings/SettingsPlayerLayoutTab";
import { formatScanOrApiError } from "../features/settings/settingsTypes";

export function SettingsPage() {
  const model = useSettingsPageModel();
  const {
    isPageLoading,
    settingsTab,
    setSettingsTab,
    requestAwardsClear,
    setMaintMessage,
    setAwardsClearConfirmOpen,
    awardsClearConfirmOpen,
    pendingRemove,
    setPendingRemove,
    executeConfirmedRemove,
    resetDbInfoOpen,
    setResetDbInfoOpen,
    apiKeyGuide,
    setApiKeyGuide,
    removeOpen,
    setRemoveOpen,
    removeBrowseKind,
    setRemoveBrowseKind,
    removeQuery,
    setRemoveQuery,
    removeQ,
    combinedHits,
    libraryRowToPick,
    removeBrowseRefresh,
    toast,
  } = model;

  if (isPageLoading)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-8">
      <header className="border-b border-white/[0.08] pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-white">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-pitflix-muted">
          Manage your library, integrations, playback, and app preferences.
        </p>
      </header>

      <nav className="sticky top-2 z-20 flex flex-wrap gap-1.5 rounded-2xl border border-white/[0.12] bg-pitflix-bg/95 px-2.5 py-2.5 shadow-xl shadow-black/40 backdrop-blur-md">
        {(
          [
            ["library",     "Library",      FolderOpen,  "text-violet-400",  "bg-violet-500/15 text-violet-200  border-violet-500/30"],
            ["providers",   "API keys",     Key,         "text-amber-400",   "bg-amber-500/15  text-amber-200   border-amber-500/30"],
            ["playback",    "Playback",     Play,        "text-green-400",   "bg-green-500/15  text-green-200   border-green-500/30"],
            ["app",         "App",          RefreshCw,   "text-orange-400",  "bg-orange-500/15 text-orange-200  border-orange-500/30"],
            ["trakt",       "Trakt",        Clapperboard,"text-red-400",     "bg-red-500/15    text-red-200     border-red-500/30"],
            ["layout",      "Layout",       LayoutGrid,  "text-violet-400",  "bg-violet-500/15 text-violet-200  border-violet-500/30"],
            ["stats",       "Stats",        BarChart3,   "text-sky-400",     "bg-sky-500/15    text-sky-200     border-sky-500/30"],
            ["maintenance", "Maintenance",  Wrench,      "text-rose-400",    "bg-rose-500/15   text-rose-200    border-rose-500/30"],
            ["help",        "Help",         HelpCircle,  "text-teal-400",    "bg-teal-500/15   text-teal-200    border-teal-500/30"],
          ] as const
        ).map(([id, label, Icon, iconClass, activeClass]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSettingsTab(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[11px] font-semibold transition-all duration-200 sm:text-xs",
              settingsTab === id
                ? `${activeClass} shadow-md`
                : "border-transparent text-pitflix-muted hover:bg-white/[0.07] hover:text-white",
            )}
          >
            <Icon className={cn("h-3.5 w-3.5 shrink-0", settingsTab === id ? "" : iconClass)} strokeWidth={2} />
            {label}
          </button>
        ))}
      </nav>

      <div>
        <ApiHealthCheck />
      </div>

      <div className="space-y-4">
        <div className={cn(settingsTab !== "library" && "hidden", "space-y-4")}>
          <SettingsLibraryTab model={model} />
        </div>
        <div className={cn(settingsTab !== "playback" && "hidden", "space-y-4")}>
          <SettingsPlaybackTab model={model} />
        </div>
        <div className={cn(settingsTab !== "layout" && "hidden", "space-y-4")}>
          <SettingsPlayerLayoutTab />
        </div>
        <div className={cn(settingsTab !== "app" && "hidden", "space-y-4")}>
          <SettingsAppTab model={model} />
        </div>
        <div className={cn(settingsTab !== "stats" && "hidden", "space-y-4")}>
          <SettingsStatsTab model={model} />
        </div>
        <div className={cn(settingsTab !== "providers" && "hidden", "space-y-4")}>
          <SettingsProvidersTab model={model} />
        </div>
        <div className={cn(settingsTab !== "trakt" && "hidden", "space-y-4")}>
          <SettingsTraktTab />
        </div>
        <div className={cn(settingsTab !== "maintenance" && "hidden", "space-y-4")}>
          <SettingsMaintenanceTab model={model} />
        </div>
        <div className={cn(settingsTab !== "help" && "hidden", "space-y-4")}>
          <SettingsHelpTab model={model} />
        </div>
      </div>

      {removeOpen ? (
        <div className="mt-6 rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-5">
          <h3 className="text-sm font-semibold text-white">Remove a title</h3>
          <p className="mt-1 text-[11px] text-pitflix-subtle">
            Open a poster grid for movies or series, or search by any part of the title (capitalization doesn&apos;t
            matter).
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-xl border border-white/[0.08] bg-pitflix-bg px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50"
              onClick={() => {
                setRemoveQuery("");
                setRemoveBrowseKind("movies");
              }}
            >
              Browse movies
            </button>
            <button
              type="button"
              className="rounded-xl border border-white/[0.08] bg-pitflix-bg px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50"
              onClick={() => {
                setRemoveQuery("");
                setRemoveBrowseKind("series");
              }}
            >
              Browse series
            </button>
          </div>
          <input
            autoFocus
            value={removeQuery}
            onChange={(e) => {
              setRemoveQuery(e.target.value);
              setRemoveBrowseKind(null);
            }}
            placeholder="Or search (2+ chars)…"
            className="mt-2 w-full rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-sm text-white focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
          />
          {combinedHits.length > 0 ? (
            <div className="mt-3 grid max-h-[min(55vh,480px)] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {combinedHits.map((row) => (
                <div
                  key={`${row.kind}-${row.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-pitflix-bg/60 px-3 py-2.5 transition-colors hover:border-pitflix-primary/20 hover:bg-pitflix-primary/[0.04]"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-pitflix-primary">
                      {row.kind === "movie" ? "Movie" : "Series"}
                    </p>
                    <p className="truncate text-sm font-medium text-white">{row.title}</p>
                    {row.year != null ? <p className="text-xs text-pitflix-subtle">{row.year}</p> : null}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg bg-red-600/85 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
                    onClick={() => setPendingRemove(libraryRowToPick(row))}
                  >
                    Remove…
                  </button>
                </div>
              ))}
            </div>
          ) : removeQ.trim().length >= 2 ? (
            <p className="mt-2 text-xs text-pitflix-subtle">No matches.</p>
          ) : null}
          <button
            type="button"
            className="mt-3 text-xs text-pitflix-muted hover:text-white"
            onClick={() => {
              setRemoveOpen(false);
              setRemoveBrowseKind(null);
            }}
          >
            Close
          </button>
        </div>
      ) : null}

      <RemoveTitleBrowseModal
        open={removeBrowseKind != null}
        kind={removeBrowseKind ?? "movies"}
        onClose={() => setRemoveBrowseKind(null)}
        onRequestRemove={(row) => setPendingRemove(row)}
        refreshToken={removeBrowseRefresh}
      />

      <ConfirmDialog
        open={awardsClearConfirmOpen}
        title="Clear awards cache?"
        description="This removes all precomputed awards nominee rows from your library database. Award pages will load more slowly until you run “Update awards cache” again."
        confirmLabel="Clear cache"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          void requestAwardsClear()
            .then(() => {
              setMaintMessage("Awards cache cleared.");
              setAwardsClearConfirmOpen(false);
            })
            .catch((err) => {
              setMaintMessage(formatScanOrApiError(err));
              setAwardsClearConfirmOpen(false);
            });
        }}
        onCancel={() => setAwardsClearConfirmOpen(false)}
      />

      <ConfirmDialog
        open={pendingRemove != null}
        title="Remove from library?"
        description={
          pendingRemove
            ? `Remove “${pendingRemove.title}” from your library? This cannot be undone.`
            : ""
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={executeConfirmedRemove}
        onCancel={() => setPendingRemove(null)}
      />

      <ConfirmDialog
        open={resetDbInfoOpen}
        confirmOnly
        title="Reset database"
        description="Quit Pitflix.API, then delete the Pitflix SQLite file from your AppData Pitflix folder. Restart the API to recreate an empty library."
        confirmLabel="Got it"
        variant="default"
        onConfirm={() => setResetDbInfoOpen(false)}
        onCancel={() => setResetDbInfoOpen(false)}
      />

      <ApiKeyGuideModal
        open={apiKeyGuide === "tmdb"}
        title="How to get a TMDB API key"
        onClose={() => setApiKeyGuide(null)}
        steps={[
          <>
            Go to{" "}
            <a
              href="https://www.themoviedb.org/settings/api"
              target="_blank"
              rel="noreferrer"
              className="text-pitflix-primary hover:underline"
            >
              themoviedb.org/settings/api
            </a>
          </>,
          "Create a free account, then request an API key — choose “Developer” when asked for the use case.",
          <>
            Fill in the application form with these values — TMDB accepts them for personal,
            non-commercial use. Click a field to copy it, or use Copy all:
            <ApiKeyGuideCopyBlock
              fields={[
                { label: "Application Name", value: "Pitflix" },
                { label: "Application URL", value: "http://localhost" },
                {
                  label: "Application Summary",
                  value:
                    "Personal home media server for organizing my own movie and TV library. Used solely for non-commercial, personal use to match local files with metadata.",
                },
              ]}
            />
          </>,
          "Copy the “API Key (v3 auth)” value from the result page.",
          "Paste it into the TMDB API key field above and click “Save keys”.",
        ]}
      />

      <ApiKeyGuideModal
        open={apiKeyGuide === "opensubtitles"}
        title="How to get an OpenSubtitles API key"
        onClose={() => setApiKeyGuide(null)}
        steps={[
          <>
            Go to{" "}
            <a
              href="https://www.opensubtitles.com/en/consumers"
              target="_blank"
              rel="noreferrer"
              className="text-pitflix-primary hover:underline"
            >
              opensubtitles.com/en/consumers
            </a>{" "}
            and register a free account.
          </>,
          "Sign in, then go to your profile → API Consumers and add a new consumer (this is your app registration).",
          "Copy the “API key” shown for that consumer — it's free for personal use.",
          "Paste it into the OpenSubtitles API key field above and click “Save keys”.",
        ]}
      />

      <ApiKeyGuideModal
        open={apiKeyGuide === "subdl"}
        title="How to get a SubDL API key"
        onClose={() => setApiKeyGuide(null)}
        steps={[
          <>
            Go to{" "}
            <a
              href="https://subdl.com/login"
              target="_blank"
              rel="noreferrer"
              className="text-pitflix-primary hover:underline"
            >
              subdl.com
            </a>{" "}
            and register a free account.
          </>,
          "Log in, then open your profile → API keys.",
          "Click “Generate” to create a new key.",
          "Paste it into the SubDL API key field above and click “Save keys”.",
        ]}
      />

      <ApiKeyGuideModal
        open={apiKeyGuide === "subsource"}
        title="How to get a SubSource API key"
        onClose={() => setApiKeyGuide(null)}
        steps={[
          <>
            Go to{" "}
            <a
              href="https://api.subsource.net"
              target="_blank"
              rel="noreferrer"
              className="text-pitflix-primary hover:underline"
            >
              subsource.net
            </a>{" "}
            and register a free account.
          </>,
          "Log in, then open your profile → API keys.",
          "Click “Generate” to create a new key.",
          "Paste it into the SubSource API key field above and click “Save keys”.",
        ]}
      />

      <ApiKeyGuideModal
        open={apiKeyGuide === "mdblist"}
        title="How to get an MDBList API key"
        onClose={() => setApiKeyGuide(null)}
        steps={[
          <>
            Go to{" "}
            <a
              href="https://mdblist.com"
              target="_blank"
              rel="noreferrer"
              className="text-pitflix-primary hover:underline"
            >
              mdblist.com
            </a>{" "}
            and create a free account (or sign in).
          </>,
          <>
            Open{" "}
            <a
              href="https://mdblist.com/preferences/"
              target="_blank"
              rel="noreferrer"
              className="text-pitflix-primary hover:underline"
            >
              mdblist.com/preferences
            </a>{" "}
            — your API key is shown on that page.
          </>,
          "Copy the API key.",
          "Expand “Additional Sources” above, paste it into the MDBList field, and click “Save & Test”.",
          "The free tier allows about 1,000 requests per day.",
        ]}
      />

      <ApiKeyGuideModal
        open={apiKeyGuide === "tvdb"}
        title="How to get a TVDB API key"
        onClose={() => setApiKeyGuide(null)}
        steps={[
          <>
            Go to{" "}
            <a
              href="https://www.thetvdb.com/signup"
              target="_blank"
              rel="noreferrer"
              className="text-pitflix-primary hover:underline"
            >
              thetvdb.com
            </a>{" "}
            and create a free account (or sign in).
          </>,
          <>
            Open the{" "}
            <a
              href="https://www.thetvdb.com/dashboard/account/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-pitflix-primary hover:underline"
            >
              API keys page
            </a>{" "}
            on your dashboard and click “Get Started”.
          </>,
          <>
            Fill in the application form for personal, non-commercial use. Click a field to copy
            it, or use Copy all:
            <ApiKeyGuideCopyBlock
              fields={[
                { label: "Company / Project Name", value: "Pitflix" },
                {
                  label: "Description",
                  value:
                    "Personal home media server for organizing my own movie and TV library. Used solely for non-commercial, personal use to enrich local files with artwork and metadata.",
                },
              ]}
            />
          </>,
          "Submit the form — your v4 API key appears in the dashboard once approved.",
          "Expand “Additional Sources” above, paste it into the TVDB field, and click “Save & Test”.",
        ]}
      />

      <footer className="mt-20 border-t border-white/[0.08] pt-10 text-center">
        <p className="text-xs font-medium tracking-wider text-pitflix-subtle uppercase">Crafted with care</p>
        <p className="mt-2 text-base font-semibold text-white/90">
          Abdallah Saeed <span aria-hidden="true">🍕</span>
        </p>
        <p className="mt-1.5 text-xs text-pitflix-subtle/70">Pitflix · premium library experience</p>
      </footer>

      {toast ? (
        <div
          className="fixed bottom-5 left-1/2 z-[235] max-w-md -translate-x-1/2 rounded-2xl border border-pitflix-primary/40 bg-pitflix-surface px-5 py-3.5 text-sm text-white shadow-2xl shadow-black/60 backdrop-blur-sm animate-slide-in-from-bottom"
          role="status"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
