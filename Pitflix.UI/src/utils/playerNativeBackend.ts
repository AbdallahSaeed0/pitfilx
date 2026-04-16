/**
 * Normalizes `player2_get_state().backend` from the Windows host.
 * Rust historically used `external_mpv_fallback` / `libmpv_embedded`; the UI must accept all aliases.
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
