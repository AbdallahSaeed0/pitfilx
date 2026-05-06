/** Set localStorage `pitflix:debugAwards` = `1` to log awards routing state (dev aid only). */
export function debugAwards(...args: unknown[]) {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("pitflix:debugAwards") === "1") {
      console.log("[pitflix:awards]", ...args);
    }
  } catch {
    /* ignore */
  }
}
