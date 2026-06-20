import { useGitHubUpdater } from "../../context/GitHubUpdaterContext";
import { GitHubUpdateModal } from "./GitHubUpdateModal";

/**
 * Renders the GitHub release update modal. Startup check is handled inside `GitHubUpdaterProvider`.
 */
export function GitHubUpdaterHost() {
  const {
    modalOpen,
    pendingOffer,
    phase,
    downloadPercent,
    errorMessage,
    dismissModal,
    confirmDownloadAndInstall,
  } = useGitHubUpdater();

  return (
    <GitHubUpdateModal
      open={modalOpen}
      offer={pendingOffer}
      phase={phase}
      downloadPercent={downloadPercent}
      errorMessage={errorMessage}
      onLater={dismissModal}
      onUpdateNow={confirmDownloadAndInstall}
    />
  );
}
