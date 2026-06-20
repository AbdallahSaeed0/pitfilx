import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { sanitizeUpdateFileName } from "./githubReleaseUpdater";

export const PITFLIX_UPDATES_SUBDIR = "PitflixUpdates";

export async function downloadInstallerWithProgress(params: {
  downloadUrl: string;
  suggestedFileName: string;
  onProgress: (percent: number | null) => void;
}): Promise<string> {
  const { downloadUrl, suggestedFileName, onProgress } = params;
  const safeName = sanitizeUpdateFileName(suggestedFileName);

  // Listen for progress events emitted by the Rust backend.
  // Using the Rust backend avoids the CORS block GitHub's CDN applies
  // to webview fetch() calls from tauri.localhost.
  const unlisten = await listen<number | null>(
    "installer-download-progress",
    (event) => onProgress(event.payload ?? null),
  );

  try {
    return await invoke<string>("download_installer_with_progress", {
      url: downloadUrl,
      fileName: safeName,
    });
  } finally {
    unlisten();
  }
}

export async function launchInstallerAndQuit(installerPath: string): Promise<void> {
  await invoke<void>("launch_downloaded_installer_and_exit", {
    installerPath,
  });
}
