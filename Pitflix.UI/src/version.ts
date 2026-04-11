import packageJson from "../package.json";

/** `package.json` version (UI bundle); Tauri runtime version comes from `getVersion()` in the desktop app. */
export const UI_PACKAGE_VERSION: string = packageJson.version;
