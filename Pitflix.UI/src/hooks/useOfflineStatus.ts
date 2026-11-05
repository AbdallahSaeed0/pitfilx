import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOfflineStatus, setBackendOfflineMode } from "../api/offline";
import { useAppPrefsStore } from "../store/appPrefsStore";

/** Backend offline / preload / IMDb-ratings status. Polls faster while a preload is running. */
export function useOfflineStatusQuery() {
  return useQuery({
    queryKey: ["offline-status"],
    queryFn: getOfflineStatus,
    refetchInterval: (q) => (q.state.data?.preload.running || q.state.data?.imdbRatings.refreshing ? 2_000 : 30_000),
    staleTime: 1_000,
    retry: false,
  });
}

/**
 * Keeps the app's offline state in step with the backend (mount once, in an always-rendered component):
 * mirrors the backend's detected outage into the store, and on the first answer of a session pushes the
 * Settings toggle to the backend — the toggle used to be UI-only, so the saved preference wins.
 */
export function useOfflineStatusSync() {
  const { data } = useOfflineStatusQuery();
  const offlineMode = useAppPrefsStore((s) => s.offlineMode);
  const setDetectedOffline = useAppPrefsStore((s) => s.setDetectedOffline);
  const pushedRef = useRef(false);

  useEffect(() => {
    if (!data) return;
    setDetectedOffline(data.detectedOffline && !data.forcedOffline);
    if (!pushedRef.current) {
      pushedRef.current = true;
      if (data.forcedOffline !== offlineMode) void setBackendOfflineMode(offlineMode).catch(() => {});
    }
  }, [data, offlineMode, setDetectedOffline]);
}
