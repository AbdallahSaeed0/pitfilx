/**
 * Copies Pitflix.API/Data → src-tauri/binaries/Data so Tauri can find the
 * awards JSON files at build time (glob pattern "binaries/Data/**" in tauri.conf.json).
 *
 * This script is intentionally lightweight — no dotnet publish required.
 * Run it any time binaries/Data is missing (e.g. after a clean checkout).
 *
 * It is called automatically by:
 *   npm run bundle:prepare   (full build pipeline)
 *   npm run tauri:dev        (dev mode, before tauri dev starts)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot    = path.join(__dirname, "..");
const repoRoot  = path.join(uiRoot, "..");

const src  = path.join(repoRoot, "Pitflix.API", "Data");
const dest = path.join(uiRoot, "src-tauri", "binaries", "Data");

if (!fs.existsSync(src)) {
  console.warn("prepare-awards-data: source not found:", src);
  process.exit(0); // non-fatal — awards feature just won't work
}

copyDirSync(src, dest);
console.log("prepare-awards-data: OK ->", dest);

function copyDirSync(s, d) {
  fs.mkdirSync(d, { recursive: true });
  for (const entry of fs.readdirSync(s, { withFileTypes: true })) {
    const sp = path.join(s, entry.name);
    const dp = path.join(d, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(sp, dp);
    } else {
      // Only overwrite when source is newer — keeps incremental rebuilds fast.
      let overwrite = true;
      if (fs.existsSync(dp)) {
        const srcMtime  = fs.statSync(sp).mtimeMs;
        const destMtime = fs.statSync(dp).mtimeMs;
        overwrite = srcMtime > destMtime;
      }
      if (overwrite) fs.copyFileSync(sp, dp);
    }
  }
}
