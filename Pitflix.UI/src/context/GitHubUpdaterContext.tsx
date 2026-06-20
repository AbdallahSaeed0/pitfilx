import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GITHUB_RELEASES_WEB } from "../config/githubRelease";
import { useAppPrefsStore } from "../store/appPrefsStore";
import { getDesktopAppVersion } from "../updater/desktopVersion";
import {
  launchInstallerAndQuit,
  downloadInstallerWithProgress,
} from "../updater/downloadGitHubInstaller";
import {
  type GitHubUpdateOffer,
  checkGitHubReleaseNewerThan,
} from "../updater/githubReleaseUpdater";

type Phase = "idle" | "checking" | "up_to_date" | "downloading" | "error";

type GitHubUpdaterContextValue = {
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;

  pendingOffer: GitHubUpdateOffer | null;
  phase: Phase;
  downloadPercent: number | null;
  errorMessage: string | null;

  checkForUpdates: () => Promise<void>;
  dismissModal: () => void;

  confirmDownloadAndInstall: () => Promise<void>;
};

const GitHubUpdaterContext = createContext<GitHubUpdaterContextValue | null>(null);

export function GitHubUpdaterProvider({ children }: { children: ReactNode }) {
  const checkOnStartup = useAppPrefsStore((s) => s.checkUpdatesOnStartup);

  const [modalOpen, setModalOpen] = useState(false);
  const [pendingOffer, setPendingOffer] = useState<GitHubUpdateOffer | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** One silent check attempt per continuous "auto-check enabled" period (handles React StrictMode remount). */
  const silentDone = useRef(false);

  const dismissModal = useCallback(() => {
    setModalOpen(false);
    setPhase("idle");
    setDownloadPercent(null);
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    if (!checkOnStartup) {
      silentDone.current = false;
    }
  }, [checkOnStartup]);

  useEffect(() => {
    if (!isTauri() || !checkOnStartup || silentDone.current) return;

    let cancelled = false;
    void (async () => {
      try {
        const ver = await getDesktopAppVersion();
        if (!ver || cancelled) return;
        const offer = await checkGitHubReleaseNewerThan(ver);
        if (cancelled || !offer) return;
        setPendingOffer(offer);
        setModalOpen(true);
      } catch {
        /* offline / API — quiet */
      } finally {
        if (!cancelled) silentDone.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [checkOnStartup]);

  const checkForUpdates = useCallback(async () => {
    if (!isTauri()) {
      setPhase("error");
      setErrorMessage("Updates apply only to the Pitflix desktop app.");
      return;
    }
    setPhase("checking");
    setErrorMessage(null);
    setPendingOffer(null);
    setModalOpen(false);
    setDownloadPercent(null);
    try {
      const ver = await getDesktopAppVersion();
      if (!ver) {
        throw new Error("Could not read app version.");
      }
      const offer = await checkGitHubReleaseNewerThan(ver);
      if (!offer) {
        setPhase("up_to_date");
        return;
      }
      setPendingOffer(offer);
      setPhase("idle");
      setModalOpen(true);
    } catch (e) {
      setPhase("error");
      setErrorMessage(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const confirmDownloadAndInstall = useCallback(async () => {
    if (!pendingOffer) return;
    const releasePage = pendingOffer.releaseUrl || GITHUB_RELEASES_WEB;
    setPhase("downloading");
    setDownloadPercent(0);
    setErrorMessage(null);
    try {
      const path = await downloadInstallerWithProgress({
        downloadUrl: pendingOffer.downloadUrl,
        suggestedFileName: pendingOffer.assetName,
        onProgress: (p) => setDownloadPercent(p),
      });
      await launchInstallerAndQuit(path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPhase("error");
      setErrorMessage(msg);
      setDownloadPercent(null);
      try {
        await openUrl(releasePage);
      } catch {
        /* ignore */
      }
    }
  }, [pendingOffer]);

  const value = useMemo<GitHubUpdaterContextValue>(
    () => ({
      modalOpen,
      setModalOpen,
      pendingOffer,
      phase,
      downloadPercent,
      errorMessage,
      checkForUpdates,
      dismissModal,
      confirmDownloadAndInstall,
    }),
    [
      modalOpen,
      pendingOffer,
      phase,
      downloadPercent,
      errorMessage,
      checkForUpdates,
      dismissModal,
      confirmDownloadAndInstall,
    ],
  );

  return <GitHubUpdaterContext.Provider value={value}>{children}</GitHubUpdaterContext.Provider>;
}

export function useGitHubUpdater() {
  const ctx = useContext(GitHubUpdaterContext);
  if (!ctx) {
    throw new Error("useGitHubUpdater must be used within GitHubUpdaterProvider");
  }
  return ctx;
}
