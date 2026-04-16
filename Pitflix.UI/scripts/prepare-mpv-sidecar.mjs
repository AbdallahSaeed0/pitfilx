/**
 * Produces src-tauri/binaries/mpv-{host-triple}.exe plus companion DLLs for Tauri externalBin "binaries/mpv".
 *
 * Windows (recommended): downloads a pinned zhongfly/mpv-winbuild .7z, extracts with 7-Zip (7zip-bin),
 * copies mpv.exe (renamed) and every *.dll from the same folder next to it.
 *
 * Optional (for Path B Option 2 / libmpv): copy libmpv-2.dll (and deps) into src-tauri/binaries/.
 * - PITFLIX_LIBMPV_DIR: directory containing libmpv-2.dll (copies ALL *.dll from that directory)
 * - PITFLIX_LIBMPV_DLL: full path to libmpv-2.dll (copies it plus sibling *.dll)
 * - PITFLIX_REQUIRE_LIBMPV=1: fail if libmpv-2.dll is not produced
 *
 * Override archive URL: PITFLIX_MPV_ARCHIVE_URL
 * Use existing file instead: PITFLIX_MPV_EXE or third_party/mpv/mpv.exe (copy .dll from same directory if present)
 * Skip: PITFLIX_SKIP_MPV_PREPARE=1
 * Non-functional stub (not for real playback): PITFLIX_MPV_DEV_PLACEHOLDER=1 copies notepad.exe — strongly discouraged.
 */
import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { path7za } = require("7zip-bin");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.join(__dirname, "..");
const repoRoot = path.join(uiRoot, "..");
const binDir = path.join(uiRoot, "src-tauri", "binaries");

/** Pinned release (reproducible builds). Bump when upgrading mpv. */
const MPV_WINBUILD_TAG = "2026-04-12-062f4bf";
const MPV_ARCHIVE_BY_TRIPLE = {
  "x86_64-pc-windows-msvc": `mpv-x86_64-20260412-git-062f4bf.7z`,
  "aarch64-pc-windows-msvc": `mpv-aarch64-20260412-git-062f4bf.7z`,
};

const DEFAULT_ARCHIVE_BASE = `https://github.com/zhongfly/mpv-winbuild/releases/download/${MPV_WINBUILD_TAG}`;

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const tmp = `${dest}.part`;
    const file = fs.createWriteStream(tmp);
    const req = (u) => {
      https
        .get(u, { headers: { "User-Agent": "pitflix-bundle-script" } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            req(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`GET ${u} -> HTTP ${res.statusCode}`));
            return;
          }
          res.pipe(file);
          file.on("finish", () => {
            file.close(() => {
              fs.renameSync(tmp, dest);
              resolve();
            });
          });
        })
        .on("error", (e) => {
          try {
            fs.unlinkSync(tmp);
          } catch {
            /* ignore */
          }
          reject(e);
        });
    };
    req(url);
  });
}

function findMpvExeUnder(root) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.toLowerCase() === "mpv.exe") return p;
    }
  }
  return null;
}

function listDlls(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".dll"));
  } catch {
    return [];
  }
}

function removeOldMpvDlls() {
  if (!fs.existsSync(binDir)) return;
  for (const name of fs.readdirSync(binDir)) {
    if (!name.toLowerCase().endsWith(".dll")) continue;
    if (name.toLowerCase().startsWith("pitflix")) continue;
    try {
      fs.unlinkSync(path.join(binDir, name));
    } catch {
      /* ignore */
    }
  }
}

function copyDllFolder(srcDir) {
  const dlls = listDlls(srcDir);
  if (!dlls.length) return 0;
  fs.mkdirSync(binDir, { recursive: true });
  for (const dll of dlls) {
    fs.copyFileSync(path.join(srcDir, dll), path.join(binDir, dll));
  }
  return dlls.length;
}

function prepareLibMpvDllsMaybe() {
  const envDll = process.env.PITFLIX_LIBMPV_DLL?.trim();
  const envDir = process.env.PITFLIX_LIBMPV_DIR?.trim();

  let srcDir = null;
  if (envDll && fs.existsSync(envDll) && fs.statSync(envDll).isFile()) {
    srcDir = path.dirname(envDll);
  } else if (envDir && fs.existsSync(envDir) && fs.statSync(envDir).isDirectory()) {
    srcDir = envDir;
  }

  // Deterministic defaults (repo-local) when env is not provided.
  if (!srcDir) {
    const candidates = [
      path.join(repoRoot, "third_party", "libmpv"),
      path.join(repoRoot, "third_party", "mpv"),
    ];
    for (const c of candidates) {
      const lib = path.join(c, "libmpv-2.dll");
      if (fs.existsSync(lib) && fs.statSync(lib).isFile()) {
        srcDir = c;
        break;
      }
    }
  }

  if (!srcDir) return;

  const libmpv = path.join(srcDir, "libmpv-2.dll");
  if (!fs.existsSync(libmpv)) {
    console.warn(
      "prepare-mpv-sidecar: PITFLIX_LIBMPV_* set but libmpv-2.dll not found in:",
      srcDir,
    );
    return;
  }

  const count = copyDllFolder(srcDir);
  console.log(`prepare-mpv-sidecar: copied libmpv dll folder (${count} DLL(s)) -> ${binDir}`);
}

function ensureLibMpvPresentOrFail() {
  const required = process.env.PITFLIX_REQUIRE_LIBMPV === "1";
  if (!required) return;
  const lib = path.join(binDir, "libmpv-2.dll");
  if (fs.existsSync(lib) && fs.statSync(lib).isFile()) return;
  console.error("prepare-mpv-sidecar: PITFLIX_REQUIRE_LIBMPV=1 but libmpv-2.dll was not produced.");
  console.error("Provide PITFLIX_LIBMPV_DLL or PITFLIX_LIBMPV_DIR pointing at a folder containing libmpv-2.dll (+ deps).");
  process.exit(1);
}

function verifyMpvResponds(exePath) {
  try {
    execFileSync(exePath, ["--version"], {
      stdio: "pipe",
      timeout: 15_000,
      windowsHide: true,
    });
  } catch (e) {
    throw new Error(`mpv sanity check failed (${exePath} --version): ${e?.message ?? e}`);
  }
}

function copyDirectoryRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyPortableMpvFolder(mpvExeSrc, destExePath) {
  const dir = path.dirname(mpvExeSrc);
  removeOldMpvDlls();
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(mpvExeSrc, destExePath);
  for (const dll of listDlls(dir)) {
    fs.copyFileSync(path.join(dir, dll), path.join(binDir, dll));
  }
  // If the mpv distribution includes libmpv-2.dll alongside mpv.exe, copy it as well.
  // (Some builds ship it; others do not.)
  const maybeLibMpv = path.join(dir, "libmpv-2.dll");
  if (fs.existsSync(maybeLibMpv) && fs.statSync(maybeLibMpv).isFile()) {
    fs.copyFileSync(maybeLibMpv, path.join(binDir, "libmpv-2.dll"));
  }
  // Copy mpv-config directory with uosc and premium settings
  const mpvConfigSrc = path.join(uiRoot, "src-tauri", "mpv-config");
  const mpvConfigDest = path.join(binDir, "mpv-config");
  if (fs.existsSync(mpvConfigSrc)) {
    copyDirectoryRecursive(mpvConfigSrc, mpvConfigDest);
    console.log("prepare-mpv-sidecar: copied mpv-config (uosc + premium settings)");
  }
  // Optional: allow providing libmpv DLLs from a separate directory.
  prepareLibMpvDllsMaybe();
  ensureLibMpvPresentOrFail();
  // Verify after DLLs: Windows mpv needs companion DLLs beside the exe.
  verifyMpvResponds(destExePath);
  const dllCount = listDlls(dir).length;
  console.log(`prepare-mpv-sidecar: copied mpv + ${dllCount} DLL(s) beside sidecar.`);
}

async function downloadAndExtractWindows(triple) {
  const name = MPV_ARCHIVE_BY_TRIPLE[triple];
  if (!name) {
    console.error("prepare-mpv-sidecar: no bundled archive mapping for triple:", triple);
    console.error("Use PITFLIX_MPV_EXE or place third_party/mpv/mpv.exe");
    process.exit(1);
  }
  const url = process.env.PITFLIX_MPV_ARCHIVE_URL?.trim() || `${DEFAULT_ARCHIVE_BASE}/${name}`;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pitflix-mpv-"));
  const archivePath = path.join(tmpRoot, name);
  console.log("prepare-mpv-sidecar: downloading", url);
  await downloadToFile(url, archivePath);
  console.log("prepare-mpv-sidecar: extracting with", path7za);
  execFileSync(path7za, ["x", archivePath, `-o${tmpRoot}`, "-y"], { stdio: "inherit" });

  const mpvExe = findMpvExeUnder(tmpRoot);
  if (!mpvExe) {
    console.error("prepare-mpv-sidecar: mpv.exe not found inside archive");
    process.exit(1);
  }

  const ext = ".exe";
  const destName = `mpv-${triple}${ext}`;
  const dest = path.join(binDir, destName);
  copyPortableMpvFolder(mpvExe, dest);

  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  console.log("prepare-mpv-sidecar: OK ->", dest);
}

async function main() {
  if (process.env.PITFLIX_SKIP_MPV_PREPARE === "1") {
    console.warn(
      "prepare-mpv-sidecar: PITFLIX_SKIP_MPV_PREPARE=1 — skipping. Tauri build may fail if mpv-{triple}.exe is missing.",
    );
    return;
  }

  let triple;
  try {
    triple = execSync("rustc --print host-tuple", { encoding: "utf8" }).trim();
  } catch {
    console.error("prepare-mpv-sidecar: rustc not found (install Rust toolchain)");
    process.exit(1);
  }

  const ext = process.platform === "win32" ? ".exe" : "";
  const destName = `mpv-${triple}${ext}`;
  const dest = path.join(binDir, destName);

  const candidates = [];
  const envExe = process.env.PITFLIX_MPV_EXE?.trim();
  if (envExe) candidates.push(envExe);
  candidates.push(path.join(repoRoot, "third_party", "mpv", `mpv${ext}`));

  let src = null;
  for (const c of candidates) {
    if (c && fs.existsSync(c) && fs.statSync(c).isFile()) {
      src = c;
      break;
    }
  }

  if (src) {
    fs.mkdirSync(binDir, { recursive: true });
    copyPortableMpvFolder(src, dest);
    console.log("prepare-mpv-sidecar: OK (local) ->", dest);
    return;
  }

  if (process.platform === "win32" && MPV_ARCHIVE_BY_TRIPLE[triple]) {
    await downloadAndExtractWindows(triple);
    return;
  }

  if (process.env.PITFLIX_MPV_DEV_PLACEHOLDER === "1" && process.platform === "win32") {
    const windir = process.env.SystemRoot || process.env.windir || "C:\\Windows";
    const notepad = path.join(windir, "System32", "notepad.exe");
    if (fs.existsSync(notepad)) {
      console.warn(
        "prepare-mpv-sidecar: PITFLIX_MPV_DEV_PLACEHOLDER=1 — writing a NON-PLAYBACK stub. Do not ship this.",
      );
      fs.mkdirSync(binDir, { recursive: true });
      fs.copyFileSync(notepad, dest);
      console.log("prepare-mpv-sidecar: stub ->", dest);
      return;
    }
  }

  try {
    if (process.platform === "win32") {
      const w = execSync("where mpv", { encoding: "utf8" }).split(/\r?\n/)[0]?.trim();
      if (w && fs.existsSync(w)) src = w;
    } else {
      const w = execSync("command -v mpv", { encoding: "utf8", shell: "/bin/sh" }).trim();
      if (w && fs.existsSync(w)) src = w;
    }
  } catch {
    /* ignore */
  }

  if (src) {
    fs.mkdirSync(binDir, { recursive: true });
    copyPortableMpvFolder(src, dest);
    console.log("prepare-mpv-sidecar: OK (PATH) ->", dest);
    return;
  }

  console.error(
    "prepare-mpv-sidecar: no mpv found. On Windows, run without PITFLIX_MPV_EXE to download a pinned build, or set PITFLIX_MPV_EXE / third_party/mpv/mpv.exe",
  );
  console.error("See Pitflix.UI/PLAYER_ARCHITECTURE.md");
  process.exit(1);
}

main().catch((e) => {
  console.error("prepare-mpv-sidecar:", e);
  process.exit(1);
});
