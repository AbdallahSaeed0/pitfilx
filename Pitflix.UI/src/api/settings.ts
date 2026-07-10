import api from "./client";

export type WizardDraft = {
  tmdbKey: string;
  tmdbVerified: boolean;
  tmdbSkipped: boolean;
  osKey: string;
  osSkipped: boolean;
  folders: string[];
  foldersSkipped: boolean;
};

export type PitflixSettings = {
  tmdbApiKey: string;
  openSubtitlesApiKey?: string;
  subDlApiKey?: string;
  subSourceApiKey?: string;
  mdblistApiKey?: string;
  tvdbApiKey?: string;
  letterboxdUsername?: string;
  qbittorrentBaseUrl?: string;
  qbittorrentUsername?: string;
  qbittorrentPassword?: string;
  libraryPaths: string[];
  /** Folders scanned automatically every ~2 minutes (in addition to the hourly full library pass). */
  pinnedScanPaths?: string[];
  /** Folders excluded from all scans. */
  excludedScanPaths?: string[];
  matchedMovies?: number;
  matchedSeries?: number;
  unmatchedCount?: number;
  mediaPlayerPath?: string;
  /** When true (default), the desktop app uses bundled mpv instead of external players. */
  useBuiltinPlayer?: boolean;
  /** How the built-in player opens: 'detached' (default) = separate mpv window; 'embedded' = mpv inside the app window. */
  playerMode?: 'detached' | 'embedded';
  /** Embedded-player HDR mode. 'auto' (default) tonemaps unless capability + OS HDR are both on. */
  hdrMode?: 'auto' | 'true_hdr' | 'tonemap_sdr';
  /** Embedded-player Dolby/DTS audio passthrough. Off by default. */
  audioPassthrough?: boolean;
  /** When true (default), show corner toasts when pinned/hourly auto-scan matches or flags a file. */
  libraryScanDesktopToasts?: boolean;
  setupComplete?: boolean;
  setupWizardStep?: number | null;
  setupWizardState?: Partial<WizardDraft> | null;
};

export const getSettings = () => api.get<PitflixSettings>("/settings").then((r) => r.data);

export type MediaPlayerCandidate = { label: string; path: string };

export const getMediaPlayerCandidates = () =>
  api.get<MediaPlayerCandidate[]>("/settings/media-player-candidates").then((r) => r.data);

export const nativePickFolder = () =>
  api
    .post<{ path?: string | null; error?: string | null }>("/settings/native-pick-folder", {}, {
      timeout: 300_000,
    })
    .then((r) => r.data);

export const nativePickExecutable = () =>
  api
    .post<{ path?: string | null; error?: string | null }>("/settings/native-pick-executable", {}, {
      timeout: 300_000,
    })
    .then((r) => r.data);

export const saveSettings = (body: {
  tmdbApiKey?: string;
  openSubtitlesApiKey?: string;
  openSubtitlesAppName?: string;
  subDlApiKey?: string;
  subSourceApiKey?: string;
  mdblistApiKey?: string;
  tvdbApiKey?: string;
  letterboxdUsername?: string;
  qbittorrentBaseUrl?: string;
  qbittorrentUsername?: string;
  qbittorrentPassword?: string;
  libraryPaths?: string[];
  mediaPlayerPath?: string;
  useBuiltinPlayer?: boolean;
  playerMode?: 'detached' | 'embedded';
  libraryScanDesktopToasts?: boolean;
  hdrMode?: 'auto' | 'true_hdr' | 'tonemap_sdr';
  audioPassthrough?: boolean;
}) => api.post("/settings", body).then((r) => r.data);

export const addLibraryPath = (path: string) =>
  api.post("/settings/paths", { path }).then((r) => r.data);

export const removeLibraryPath = (path: string) =>
  api.delete("/settings/paths", { data: { path } }).then((r) => r.data);

export const addPinnedScanPath = (path: string) =>
  api.post("/settings/pinned-paths", { path }).then((r) => r.data);

export const removePinnedScanPath = (path: string) =>
  api.delete("/settings/pinned-paths", { data: { path } }).then((r) => r.data);

export const addExcludedScanPath = (path: string) =>
  api.post("/settings/excluded-paths", { path }).then((r) => r.data);

export const removeExcludedScanPath = (path: string) =>
  api.delete("/settings/excluded-paths", { data: { path } }).then((r) => r.data);

export const verifyTmdbKey = (key: string) =>
  api
    .get<{ valid: boolean; error?: string | null }>("/settings/verify-tmdb", { params: { key } })
    .then((r) => r.data);

export const verifyOpenSubtitlesKey = (key: string) =>
  api
    .get<{ valid: boolean; error?: string | null }>("/settings/verify-opensubtitles", { params: { key } })
    .then((r) => r.data);

export const verifySubDlKey = (key: string) =>
  api
    .get<{ valid: boolean; error?: string | null }>("/settings/verify-subdl", { params: { key } })
    .then((r) => r.data);

export const verifySubSourceKey = (key: string) =>
  api
    .get<{ valid: boolean; error?: string | null }>("/settings/verify-subsource", { params: { key } })
    .then((r) => r.data);

export const verifyMdblistKey = (key: string) =>
  api
    .get<{ valid: boolean; imdbScore?: number | null; rawSnippet?: string; error?: string | null }>(
      "/settings/verify-mdblist",
      { params: { key } },
    )
    .then((r) => {
      if (r.data.rawSnippet) console.debug("[MDBList verify] raw response:", r.data.rawSnippet);
      return r.data;
    });

export const verifyTvdbKey = (key: string) =>
  api
    .get<{ valid: boolean; error?: string | null }>("/settings/verify-tvdb", { params: { key } })
    .then((r) => r.data);

export const pathExistsOnServer = (path: string) =>
  api.get<{ exists: boolean }>("/settings/path-exists", { params: { path } }).then((r) => r.data);

export const saveWizardProgress = (step: number, draft: WizardDraft) =>
  api
    .post("/settings/wizard-progress", { step, stateJson: JSON.stringify(draft) })
    .then((r) => r.data);

export type CompleteSetupPayload = {
  tmdbApiKey?: string | null;
  tmdbSkipped: boolean;
  openSubtitlesApiKey?: string | null;
  openSubtitlesSkipped: boolean;
  libraryPaths?: string[];
  foldersSkipped: boolean;
};

export const completeSetup = (body: CompleteSetupPayload) =>
  api.post("/settings/complete-setup", body).then((r) => r.data);

export const getAutostartStatus = () =>
  api.get<{ enabled: boolean; supported: boolean; error?: string }>("/settings/autostart-status").then((r) => r.data);

export const setAutostart = (enable: boolean) =>
  api.post<{ success: boolean; enabled: boolean; error?: string }>("/settings/autostart", { enable }).then((r) => r.data);
