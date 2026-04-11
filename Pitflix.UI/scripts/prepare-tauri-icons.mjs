/**
 * Normalizes the branding bitmap to a centered square, then invokes the Tauri icon generator
 * so Windows .ico / PNG targets are consistent (avoids a small-looking taskbar glyph when the
 * source art has excessive internal padding or non-square aspect ratio).
 *
 * Usage (from Pitflix.UI): npm run icons:prepare
 * (Also runs automatically via tauri.conf.json `beforeBuildCommand`.)
 *
 * Windows note: if the taskbar still shows an old glyph after a rebuild, the OS icon cache may
 * be stale. Sign out / restart, or reinstall the app / use a bumped `version` in tauri.conf.json
 * so Windows treats the shortcut as a new app identity — then verify again.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");
const tauriRoot = path.join(uiRoot, "src-tauri");
const sourcePng = path.join(tauriRoot, "icons", "icon.png");
const generatedDir = path.join(tauriRoot, "icons", ".generated");
const masterOut = path.join(generatedDir, "icon-master-1024.png");

const SIZE = 1024;
const SAFE = 0.86; // leave ~7% margin on each side inside the square

async function main() {
  if (!fs.existsSync(sourcePng)) {
    console.error("Missing source:", sourcePng);
    process.exit(1);
  }

  fs.mkdirSync(generatedDir, { recursive: true });

  const trimmed = await sharp(sourcePng).trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const w = meta.width ?? SIZE;
  const h = meta.height ?? SIZE;
  const scale = (SIZE * SAFE) / Math.max(w, h);
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));

  const resized = await sharp(trimmed)
    .resize(nw, nh, { fit: "inside", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 15, g: 15, b: 18, alpha: 0 },
    },
  })
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toFile(masterOut);

  console.log("Wrote", masterOut);
  execSync(`npx --yes @tauri-apps/cli icon "${masterOut}"`, {
    cwd: tauriRoot,
    stdio: "inherit",
    shell: true,
  });
  console.log("Tauri icon bundle regenerated (see src-tauri/icons).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
