/**
 * Publishes PitflixPlayer (the WPF companion window that gives mpv its custom
 * chrome/controls) as a self-contained build and copies it to
 * src-tauri/binaries/PitflixPlayer/ so it ships with the Tauri bundle.
 *
 * Declared in tauri.conf.json under "resources" as "binaries/PitflixPlayer/**\/*",
 * which lands at <install_root>/binaries/PitflixPlayer/PitflixPlayer.exe at
 * runtime — Pitflix.API's FindPitflixPlayerExe() looks for it there.
 *
 * Without this, production builds have no PitflixPlayer.exe anywhere in the
 * install, FindPitflixPlayerExe() always returns null, and PlayerService falls
 * back to a bare standalone mpv window with no custom UI.
 */
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.join(__dirname, "..");
const repoRoot = path.join(uiRoot, "..");
const playerCsproj = path.join(repoRoot, "PitflixPlayer", "PitflixPlayer.csproj");
const binDir = path.join(uiRoot, "src-tauri", "binaries");
const destDir = path.join(binDir, "PitflixPlayer");
const stage = path.join(binDir, "publish-stage-pitflixplayer");

const RID_BY_TRIPLE = {
  "x86_64-pc-windows-msvc": "win-x64",
  "aarch64-pc-windows-msvc": "win-arm64",
};

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function main() {
  if (process.platform !== "win32") {
    console.log("prepare-pitflixplayer-sidecar: non-Windows platform, skipping (WPF is Windows-only).");
    return;
  }

  if (!fs.existsSync(playerCsproj)) {
    console.error("prepare-pitflixplayer-sidecar: missing", playerCsproj);
    process.exit(1);
  }

  let triple;
  try {
    triple = execSync("rustc --print host-tuple", { encoding: "utf8" }).trim();
  } catch {
    console.error("prepare-pitflixplayer-sidecar: rustc not found (install Rust toolchain)");
    process.exit(1);
  }

  const rid = RID_BY_TRIPLE[triple];
  if (!rid) {
    console.error("prepare-pitflixplayer-sidecar: unsupported host triple:", triple);
    process.exit(1);
  }

  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  const publishArgs = [
    "publish",
    playerCsproj,
    "-c",
    "Release",
    "-r",
    rid,
    "--self-contained",
    "true",
    "-p:DebugType=None",
    "-o",
    stage,
  ];

  console.log("prepare-pitflixplayer-sidecar: dotnet", publishArgs.join(" "));
  const pub = spawnSync("dotnet", publishArgs, {
    stdio: "inherit",
    cwd: repoRoot,
    shell: false,
  });
  if (pub.status !== 0) {
    process.exit(pub.status ?? 1);
  }

  const published = path.join(stage, "PitflixPlayer.exe");
  if (!fs.existsSync(published)) {
    console.error("prepare-pitflixplayer-sidecar: expected output missing:", published);
    process.exit(1);
  }

  fs.rmSync(destDir, { recursive: true, force: true });
  copyDirSync(stage, destDir);
  fs.rmSync(stage, { recursive: true, force: true });

  console.log("prepare-pitflixplayer-sidecar: OK ->", path.join(destDir, "PitflixPlayer.exe"));
}

main();
