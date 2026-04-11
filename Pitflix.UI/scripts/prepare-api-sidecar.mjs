/**
 * Publishes Pitflix.API as a self-contained single-file binary and copies it to
 * src-tauri/binaries/ with the name Tauri expects for externalBin "binaries/pitflix-api".
 */
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.join(__dirname, "..");
const repoRoot = path.join(uiRoot, "..");
const apiCsproj = path.join(repoRoot, "Pitflix.API", "Pitflix.API.csproj");
const binDir = path.join(uiRoot, "src-tauri", "binaries");
const stage = path.join(binDir, "publish-stage");

const RID_BY_TRIPLE = {
  "x86_64-pc-windows-msvc": "win-x64",
  "aarch64-pc-windows-msvc": "win-arm64",
  "x86_64-apple-darwin": "osx-x64",
  "aarch64-apple-darwin": "osx-arm64",
  "x86_64-unknown-linux-gnu": "linux-x64",
  "aarch64-unknown-linux-gnu": "linux-arm64",
};

function main() {
  if (!fs.existsSync(apiCsproj)) {
    console.error("prepare-api-sidecar: missing", apiCsproj);
    process.exit(1);
  }

  let triple;
  try {
    triple = execSync("rustc --print host-tuple", { encoding: "utf8" }).trim();
  } catch {
    console.error("prepare-api-sidecar: rustc not found (install Rust toolchain)");
    process.exit(1);
  }

  const rid = RID_BY_TRIPLE[triple];
  if (!rid) {
    console.error(
      "prepare-api-sidecar: unsupported host triple for dotnet publish:",
      triple,
    );
    process.exit(1);
  }

  fs.mkdirSync(stage, { recursive: true });

  const publishArgs = [
    "publish",
    apiCsproj,
    "-c",
    "Release",
    "-r",
    rid,
    "--self-contained",
    "true",
    "-p:PublishSingleFile=true",
    "-p:IncludeNativeLibrariesForSelfExtract=true",
    "-p:IncludeAllContentForSelfExtract=true",
    "-p:PublishTrimmed=false",
    "-p:DebugType=None",
    "-o",
    stage,
  ];

  console.log("prepare-api-sidecar: dotnet", publishArgs.join(" "));
  const pub = spawnSync("dotnet", publishArgs, {
    stdio: "inherit",
    cwd: repoRoot,
    shell: false,
  });
  if (pub.status !== 0) {
    process.exit(pub.status ?? 1);
  }

  const ext = process.platform === "win32" ? ".exe" : "";
  const published = path.join(stage, `Pitflix.API${ext}`);
  if (!fs.existsSync(published)) {
    console.error("prepare-api-sidecar: expected output missing:", published);
    process.exit(1);
  }

  const destName = `pitflix-api-${triple}${ext}`;
  const dest = path.join(binDir, destName);
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(published, dest);
  fs.rmSync(stage, { recursive: true, force: true });
  console.log("prepare-api-sidecar: OK ->", dest);
}

main();
