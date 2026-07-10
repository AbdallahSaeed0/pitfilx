/** Built-in playback engines selected in Settings → Playback. */
export type PlayerEngineId = "libmpv-embedded" | "external-mpv";

export function normalizePlayerEngine(raw: string | null | undefined): PlayerEngineId {
  switch (raw) {
    case "external-mpv":
    case "pitflix2":
    case "pitflix":
      // pitflix / pitflix2 were older ids for detached mpv + in-app PlayerPage companion.
      return "external-mpv";
    default:
      return "libmpv-embedded";
  }
}

export function usesPlayerPage(engine: PlayerEngineId): boolean {
  return engine === "libmpv-embedded" || engine === "external-mpv";
}
