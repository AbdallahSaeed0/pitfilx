import { isTauri } from "@tauri-apps/api/core";

export function formatUpdaterError(err: unknown): string {
  if (err instanceof Error) {
    const m = err.message;
    const lower = m.toLowerCase();
    if (lower.includes("could not fetch") || lower.includes("network") || lower.includes("dns"))
      return "Could not reach the update server. Check your connection.";
    if (lower.includes("404") || lower.includes("not found"))
      return "No release found. Ensure the release is published on GitHub.";
    return m;
  }
  return "Update failed.";
}

export async function getDesktopAppVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}
