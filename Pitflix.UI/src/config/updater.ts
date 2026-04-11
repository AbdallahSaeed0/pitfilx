/**
 * Pitflix in-app updates use Tauri’s updater plugin. The **remote URL(s)** and **public signing key**
 * are configured only in `src-tauri/tauri.conf.json` under `plugins.updater` (`endpoints`, `pubkey`).
 *
 * The frontend calls `@tauri-apps/plugin-updater` `check()` — it does not embed update URLs, so
 * switching staging vs production is a **build-time** change in `tauri.conf.json` (or separate
 * config files / branches), not scattered constants in the UI.
 */
export const UPDATER_CONFIG_FILE = "src-tauri/tauri.conf.json" as const;
