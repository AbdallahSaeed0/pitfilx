import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8")) as { version: string };

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_PITFLIX_UI_STAMP": JSON.stringify(
      `${pkg.version} · vite-load ${new Date().toISOString()}`,
    ),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,

  // Without this, Vite's dependency scanner auto-discovers every *.html under the project root as a
  // potential multi-page entry — including the dozens of generated asset copies Tauri drops under
  // src-tauri/target/**/tauri-codegen-assets on release builds. One of those isn't scannable and
  // crashes esbuild's scan worker (`write EPIPE`), which then skips dependency pre-bundling entirely.
  // Pinning the entry to just our real index.html avoids the crawl.
  optimizeDeps: {
    entries: ["index.html"],
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    // Avoid low ports and 5132–5231: Windows often excludes those (Hyper-V/WSL/VPN).
    port: 4173,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 4174,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
