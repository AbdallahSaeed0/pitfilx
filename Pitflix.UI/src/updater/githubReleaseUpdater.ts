import { GITHUB_LATEST_RELEASE_API } from "../config/githubRelease";

export type GitHubReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

export type GitHubLatestRelease = {
  tag_name: string;
  body: string | null;
  html_url: string;
  published_at: string | null;
  assets: GitHubReleaseAsset[];
};

export type GitHubUpdateOffer = {
  currentVersion: string;
  latestTag: string;
  latestVersion: string;
  releaseNotes: string;
  releaseUrl: string;
  downloadUrl: string;
  assetName: string;
  publishedAt: string | null;
};

const IGNORED_FILES_LC = new Set(["latest.json"]);

function ignoredAssetName(name: string): boolean {
  const l = name.toLowerCase().trim();
  if (IGNORED_FILES_LC.has(l)) return true;
  if (l.endsWith(".sig")) return true;
  if (l.endsWith(".zip")) return true;
  return false;
}

/** Higher is better. Null = not a candidate Windows installer. */
function windowsInstallerScore(name: string): number | null {
  if (ignoredAssetName(name)) return null;
  const l = name.toLowerCase();
  if (!l.endsWith(".exe")) return null;
  if (/(darwin|macos|linux|ubuntu|\.app)/i.test(name)) return null;

  let s = 10;
  if (l.endsWith("x64-setup.exe")) s += 200;
  else if (l.endsWith("-setup.exe")) s += 150;
  else if (l.endsWith("setup.exe")) s += 120;
  else s += 40;
  if (l.includes("x64")) s += 25;
  if (/\bwin(n|dows)?\b/i.test(name)) s += 15;
  return s;
}

export function normalizeReleaseVersion(tag: string): string {
  return tag.trim().replace(/^v+/i, "");
}

/** Semantic compare of dotted numeric segments (handles `1.2.3` vs `v1.2`). */
export function compareSemverParts(aRaw: string, bRaw: string): number {
  const aParts = normalizeReleaseVersion(aRaw)
    .split(/[.\-+_]/)
    .map((x) => parseInt(/^\d+/.exec(x)?.[0] ?? "NaN", 10));
  const bParts = normalizeReleaseVersion(bRaw)
    .split(/[.\-+_]/)
    .map((x) => parseInt(/^\d+/.exec(x)?.[0] ?? "NaN", 10));
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const av = Number.isFinite(aParts[i]) ? aParts[i] : 0;
    const bv = Number.isFinite(bParts[i]) ? bParts[i] : 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

export function pickWindowsInstallerAsset(assets: GitHubReleaseAsset[]): GitHubReleaseAsset | null {
  let best: GitHubReleaseAsset | null = null;
  let bestScore = -Infinity;
  for (const asset of assets) {
    const sc = windowsInstallerScore(asset.name);
    if (sc == null) continue;
    if (sc > bestScore) {
      bestScore = sc;
      best = asset;
    }
  }
  return best;
}

export async function fetchLatestGitHubRelease(): Promise<GitHubLatestRelease> {
  const res = await fetch(GITHUB_LATEST_RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Pitflix-Desktop",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub returned ${res.status} (${res.statusText})`);
  }
  const data = (await res.json()) as GitHubLatestRelease;
  if (!data.tag_name || !Array.isArray(data.assets)) {
    throw new Error("Unexpected GitHub API response.");
  }
  return data;
}

/** Build update offer when remote is strictly newer than `currentVersion`. */
export async function checkGitHubReleaseNewerThan(
  currentVersion: string,
): Promise<GitHubUpdateOffer | null> {
  const release = await fetchLatestGitHubRelease();
  const latestVersion = normalizeReleaseVersion(release.tag_name);
  const cur = normalizeReleaseVersion(currentVersion);
  if (compareSemverParts(latestVersion, cur) <= 0) {
    return null;
  }
  const asset = pickWindowsInstallerAsset(release.assets);
  if (!asset) {
    throw new Error(
      "Latest release has no Windows installer (.exe). Open the releases page on GitHub to download manually.",
    );
  }
  return {
    currentVersion: cur,
    latestTag: release.tag_name.trim(),
    latestVersion,
    releaseNotes: (release.body ?? "").trim(),
    releaseUrl: release.html_url,
    downloadUrl: asset.browser_download_url,
    assetName: asset.name,
    publishedAt: release.published_at,
  };
}

export function sanitizeUpdateFileName(name: string): string {
  const base = name.replace(/[/\\:?*"<>|]/g, "_").trim() || "Pitflix-setup.exe";
  return base;
}
