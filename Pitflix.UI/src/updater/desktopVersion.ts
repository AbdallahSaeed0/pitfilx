import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";

/** Runtime desktop app semver from Tauri; null in browser. */
export async function getDesktopAppVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  return getVersion();
}
