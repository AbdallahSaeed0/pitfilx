import { useCallback, useEffect, useRef, useState } from "react";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "@tauri-apps/api/core";
import {
  downloadUpdateThenInstall,
  fetchUpdateIfAny,
  formatUpdaterError,
  getDesktopAppVersion,
} from "../updater/updaterService";
import { UI_PACKAGE_VERSION } from "../version";

export type AppUpdaterPhase =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "installing"
  | "success"
  | "error";

export function useAppUpdater() {
  const [phase, setPhase] = useState<AppUpdaterPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>(UI_PACKAGE_VERSION);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [releaseDate, setReleaseDate] = useState<string | null>(null);
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);

  const pendingUpdateRef = useRef<Update | null>(null);

  const refreshCurrentVersion = useCallback(async () => {
    const v = await getDesktopAppVersion();
    setCurrentVersion(v ?? UI_PACKAGE_VERSION);
  }, []);

  useEffect(() => {
    void refreshCurrentVersion();
  }, [refreshCurrentVersion]);

  useEffect(() => {
    return () => {
      const u = pendingUpdateRef.current;
      pendingUpdateRef.current = null;
      void u?.close();
    };
  }, []);

  const resetToIdle = useCallback(() => {
    void pendingUpdateRef.current?.close();
    pendingUpdateRef.current = null;
    setPhase("idle");
    setErrorMessage(null);
    setAvailableVersion(null);
    setReleaseNotes(null);
    setReleaseDate(null);
    setDownloadPercent(null);
  }, []);

  const check = useCallback(async () => {
    setErrorMessage(null);
    setDownloadPercent(null);
    setAvailableVersion(null);
    setReleaseNotes(null);
    setReleaseDate(null);

    if (!isTauri()) {
      setPhase("error");
      setErrorMessage("In-app updates are only available in the Pitflix desktop app.");
      return;
    }

    void pendingUpdateRef.current?.close();
    pendingUpdateRef.current = null;

    setPhase("checking");
    try {
      await refreshCurrentVersion();
      const update = await fetchUpdateIfAny();
      if (!update) {
        setPhase("up_to_date");
        return;
      }
      pendingUpdateRef.current = update;
      setAvailableVersion(update.version);
      setReleaseNotes(update.body?.trim() ? update.body : null);
      setReleaseDate(update.date ?? null);
      setPhase("available");
    } catch (e) {
      setPhase("error");
      setErrorMessage(formatUpdaterError(e));
    }
  }, [refreshCurrentVersion]);

  const installPending = useCallback(async () => {
    const update = pendingUpdateRef.current;
    if (!update) {
      setPhase("error");
      setErrorMessage("No pending update. Check for updates again.");
      return;
    }

    pendingUpdateRef.current = null;

    setErrorMessage(null);
    let downloaded = 0;
    let total: number | undefined;

    const onEvent = (event: DownloadEvent) => {
      if (event.event === "Started") {
        total = event.data.contentLength;
        downloaded = 0;
        setPhase("downloading");
        setDownloadPercent(total ? 0 : null);
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (total && total > 0) setDownloadPercent(Math.min(100, Math.round((downloaded / total) * 100)));
      } else if (event.event === "Finished") {
        setPhase("installing");
        setDownloadPercent(100);
      }
    };

    try {
      await downloadUpdateThenInstall(update, onEvent);
      setPhase("success");
    } catch (e) {
      setPhase("error");
      setErrorMessage(formatUpdaterError(e));
      void update.close();
    }
  }, []);

  return {
    phase,
    errorMessage,
    currentVersion,
    availableVersion,
    releaseNotes,
    releaseDate,
    downloadPercent,
    check,
    installPending,
    resetToIdle,
    refreshCurrentVersion,
  };
}
