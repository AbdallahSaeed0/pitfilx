import { isTauri } from "@tauri-apps/api/core";

export function isWindowsHost(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const p = navigator.platform || "";
  return /windows/i.test(ua) || /^win/i.test(p);
}

/** Windows desktop shell only; uses the real app exe (not the API process). */
export async function getDesktopAutostartState(): Promise<{ enabled: boolean; supported: boolean }> {
  if (!isTauri() || !isWindowsHost()) {
    return { enabled: false, supported: false };
  }
  const { isEnabled } = await import("@tauri-apps/plugin-autostart");
  return { enabled: await isEnabled(), supported: true };
}

export async function setDesktopAutostart(turnOn: boolean): Promise<void> {
  if (!isTauri() || !isWindowsHost()) {
    throw new Error("Startup launch is only available in the Pitflix desktop app on Windows.");
  }
  const mod = await import("@tauri-apps/plugin-autostart");
  if (turnOn) await mod.enable();
  else await mod.disable();
}
