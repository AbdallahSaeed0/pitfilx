import { isTauri } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";

/** Native-style OK/Cancel when running in Tauri (matches Windows “Pitflix” dialog); falls back to `confirm` in the browser. */
export async function pitflixConfirm(message: string): Promise<boolean> {
  if (isTauri()) {
    try {
      return await confirm(message, {
        title: "Pitflix",
        kind: "info",
        okLabel: "OK",
        cancelLabel: "Cancel",
      });
    } catch {
      return window.confirm(message);
    }
  }
  return window.confirm(message);
}
