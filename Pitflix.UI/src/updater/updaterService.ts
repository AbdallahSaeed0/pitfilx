import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

export function formatUpdaterError(err: unknown): string {
  if (err instanceof Error) {
    const m = err.message;
    const lower = m.toLowerCase();
    if (lower.includes("could not fetch") || lower.includes("network") || lower.includes("dns"))
      return "Could not reach the update server. Check your connection and that the update URL in the app build is correct.";
    if (lower.includes("signature") || lower.includes("verify") || lower.includes("minisign"))
      return "The update could not be verified (signature mismatch). Do not install; contact the Pitflix distributor.";
    if (lower.includes("404") || lower.includes("not found"))
      return "No update manifest was found at the configured URL. Ensure latest.json is published for this release.";
    if (lower.includes("resource id") && lower.includes("invalid"))
      return "Installer launched, but app relaunch failed on Windows. Close Pitflix manually and open it again.";
    return m;
  }
  return "Update failed.";
}

export async function getDesktopAppVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

export async function fetchUpdateIfAny(): Promise<Update | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  return check();
}

/**
 * Download the update, stop the bundled API sidecar (Windows: avoids file locks), then run the installer.
 * On Windows the app exits from `install()` and does not return — `relaunch` only runs on platforms where install returns.
 */
export async function downloadUpdateThenInstall(
  update: Update,
  onEvent: (e: DownloadEvent) => void,
): Promise<void> {
  await update.download(onEvent);
  await invoke("prepare_update_exit");
  await update.install();
  // On Windows, updater install typically exits/restarts outside this process.
  // For some setups relaunch can throw "The resource id ... is invalid."
  // Treat that as non-fatal and let user reopen app manually.
  const { relaunch } = await import("@tauri-apps/plugin-process");
  try {
    await relaunch();
  } catch (e) {
    const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
    if (msg.includes("resource id") && msg.includes("invalid")) {
      return;
    }
    throw e;
  }
}
