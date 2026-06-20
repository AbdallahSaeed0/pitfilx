/**
 * @deprecated — update flow is handled by GitHubUpdaterContext / useGitHubUpdater.
 * This file is kept as an empty stub to avoid import errors from any lingering references.
 */
export type AppUpdaterPhase =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "installing"
  | "success"
  | "error";
