import axios from "axios";

export type SettingsTab =
  | "library"
  | "stats"
  | "providers"
  | "trakt"
  | "playback"
  | "layout"
  | "app"
  | "maintenance"
  | "help";

export function formatScanOrApiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const raw = err.response?.data;
    const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const message = data?.message;
    if (typeof message === "string" && message.trim()) return message;
    const code = data?.error;
    if (code === "NO_LIBRARY_FOLDERS") {
      return "No library folders are saved yet. Add at least one folder under “Library folders” above, save it, then run the scan again.";
    }
    if (typeof code === "string" && code.length > 0 && (code.includes(" ") || code.length < 32))
      return code;
    if (err.message?.toLowerCase().includes("network") || err.code === "ECONNABORTED") {
      return "Cannot reach Pitflix API. If you use a custom port, set VITE_API_ORIGIN and restart the app.";
    }
  }
  if (err instanceof Error) return err.message;
  return "Request failed.";
}
