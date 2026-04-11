import { isTauri } from "@tauri-apps/api/core";
import { Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Update } from "@tauri-apps/plugin-updater";
import { useAppPrefsStore } from "../../store/appPrefsStore";
import { downloadInstallAndRelaunch, fetchUpdateIfAny, formatUpdaterError } from "../../updater/updaterService";

/**
 * One-time check after launch when `checkUpdatesOnStartup` is enabled. Never downloads without user action.
 * Network errors are ignored here so offline launches stay quiet; use Settings for a full error message.
 */
export function UpdateStartupBanner() {
  const enabled = useAppPrefsStore((s) => s.checkUpdatesOnStartup);
  const [update, setUpdate] = useState<Update | null>(null);
  const [busy, setBusy] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (!isTauri() || !enabled || ran.current) return;
    ran.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const u = await fetchUpdateIfAny();
        if (!cancelled && u) setUpdate(u);
      } catch {
        /* offline / bad URL — user can check manually in Settings */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    return () => {
      void update?.close();
    };
  }, [update]);

  const dismiss = () => {
    void update?.close();
    setUpdate(null);
  };

  const install = async () => {
    if (!update) return;
    setBusy(true);
    try {
      await downloadInstallAndRelaunch(update, () => {});
      setUpdate(null);
    } catch (e) {
      console.warn("[pitflix updater]", formatUpdaterError(e));
      void update.close();
      setUpdate(null);
    } finally {
      setBusy(false);
    }
  };

  if (!isTauri() || !enabled) return null;
  if (!update) return null;

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-pitflix-primary/30 bg-pitflix-bg/90 px-4 py-3 ring-1 ring-white/5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">
          Pitflix <span className="font-mono text-pitflix-primary">{update.version}</span> is available
        </p>
        {update.body?.trim() ? (
          <p className="mt-1 line-clamp-2 text-[11px] text-pitflix-muted">{update.body.trim()}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void install()}
          className="inline-flex items-center gap-2 rounded-lg bg-pitflix-primary px-3 py-2 text-xs font-semibold text-white hover:bg-pitflix-light disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {busy ? "Installing…" : "Install"}
        </button>
        <Link
          to="/settings#app-updates"
          className="rounded-lg border border-pitflix-card px-3 py-2 text-xs text-pitflix-muted hover:text-white"
        >
          Details
        </Link>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="rounded-lg p-2 text-pitflix-muted hover:bg-white/5 hover:text-white disabled:opacity-50"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
