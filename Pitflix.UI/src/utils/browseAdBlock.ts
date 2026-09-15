import { invoke, isTauri } from "@tauri-apps/api/core";

/** Applies the network-level ad-block setting to the Browse tab's Rust-side
 * `NetworkState`. A no-op outside the desktop app (the Browse tab itself is
 * desktop-only). */
export async function setBrowseAdBlockEnabled(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("browse_set_ad_block_enabled", { enabled });
}
