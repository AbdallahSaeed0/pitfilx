/**
 * Normalizes `player2_get_state().backend` from the Windows host.
 *
 * Backend values:
 *   "external_mpv"    — mpv in a detached window with uosc/scripts, companion UI
 *   "libmpv"          — mpv embedded as a child HWND (--wid mode)
 */

export function isNativeBackendExternal(backend: string | undefined | null): boolean {
  if (!backend) return false;
  if (backend === "none") return false;
  return backend === "external_mpv" || backend.startsWith("external_mpv");
}

export function isNativeBackendEmbeddedLibmpv(backend: string | undefined | null): boolean {
  if (!backend) return false;
  return backend === "libmpv" || backend.includes("libmpv");
}
