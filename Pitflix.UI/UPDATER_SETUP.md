# Pitflix — Tauri in-app updater

This document describes how the Pitflix desktop app checks for updates, verifies signatures, and how you publish new versions. It is specific to this repo (`Pitflix.UI`).

## How it works (runtime)

1. **Configuration** lives in `src-tauri/tauri.conf.json` under `plugins.updater`:
   - **`pubkey`** — minisign **public** key (safe to commit). The app uses it to verify every update before install.
   - **`endpoints`** — HTTPS URLs Tauri tries in order until one returns HTTP 2xx with update JSON (or 204 = no update).
2. The **frontend** calls `check()`, then **`download` → `prepare_update_exit` (Rust) → `install`** (not a single `downloadAndInstall`) so the bundled API sidecar can exit before the Windows installer runs — see below. Update URLs are **not** embedded in the UI; they come from the **built** `tauri.conf.json`.
3. **Signing** uses Tauri’s built-in minisign integration. **Windows Authenticode / paid code signing is separate** and not covered here.
4. **User control**: Nothing downloads or installs unless the user uses **Settings → App updates** or confirms from the **startup banner** (when “check on launch” is enabled).

### Windows and the bundled API sidecar

On Windows, after the updater launches the installer it ends the app with `std::process::exit(0)`, so **`RunEvent::Exit` does not run** and handlers that only run there never fire. The bundled `pitflix-api-*.exe` process would otherwise keep running and **lock files** under `binaries/`, which often triggers NSIS/MSI “retry / abort” prompts. Pitflix calls the Rust command **`prepare_update_exit`** after the update package is downloaded and **before** `install()`: it stops the sidecar (same logic as normal exit) and briefly waits so handles can be released.

## Configure the update source

### Replace the placeholder endpoint

Edit `src-tauri/tauri.conf.json` and replace:

```text
https://github.com/OWNER/REPO/releases/latest/download/latest.json
```

with your real URL, for example:

- **GitHub Releases (static asset)**  
  `https://github.com/<org>/<repo>/releases/latest/download/latest.json`  
  Upload a `latest.json` (see below) plus your signed bundles as release assets.

- **Any HTTPS static host** (S3, Cloudflare R2, static site)  
  Same idea: one JSON file the app can GET over HTTPS.

You can list **multiple** `endpoints`; Tauri tries each until one succeeds (non-2xx moves to the next).

### Static `latest.json` (Windows x64 example)

After `tauri build`, Tauri emits `.exe` / `.msi` (and `.sig` files) under `src-tauri/target/release/bundle/`. Your `latest.json` must reference the **URL** of the installer and the **raw signature string** from the matching `.sig` file.

Example shape (adjust version, URLs, and signature):

```json
{
  "version": "0.3.0",
  "notes": "Bug fixes and UI polish.",
  "pub_date": "2026-04-12T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "PASTE_CONTENT_OF_SETUP_OR_MSI_SIG_FILE",
      "url": "https://github.com/org/repo/releases/download/v0.3.0/Pitflix_0.3.0_x64-setup.exe"
    }
  }
}
```

Use the platform key Tauri expects for your build (`windows-x86_64` for typical Windows x64 NSIS/MSI flows). If you ship other targets, add the corresponding `platforms` entries (see [Tauri updater docs](https://v2.tauri.app/plugin/updater/)).

## Generate updater signing keys

From `Pitflix.UI`:

```bash
npx tauri signer generate -w src-tauri/.tauri-updater.key
```

- **Private key** (`src-tauri/.tauri-updater.key`): **never commit** — it is listed in `.gitignore`. Store in a password manager, vault, or CI secret.
- **Public key** (`.pub` file): paste the **entire** contents of the public key into `tauri.conf.json` → `plugins.updater.pubkey` (single string, as Tauri expects).

If you lose the **private** key, you cannot ship signed updates that existing users will accept; you would need a new keypair and a new app build that ships the new **public** key.

## Provide the private key when building releases

### Windows: `npm run tauri:build:win`

If `src-tauri/.tauri-updater.key` exists locally, `scripts/tauri-build-windows.ps1` injects its contents into `TAURI_SIGNING_PRIVATE_KEY` for the `npx tauri build` step (so MSVC + updater signing work without you exporting variables by hand). **CI** should still supply the key via secrets (`TAURI_SIGNING_PRIVATE_KEY` or a protected file), not rely on a committed file.

`.env` is **not** loaded for signing. Otherwise use environment variables in the shell or CI:

**Windows (PowerShell):**

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$HOME\.tauri\pitflix.key"
# Or point to a file:
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "C:\secure\pitflix-updater.key"
# If the key has a password:
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."
```

**macOS / Linux:**

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/pitflix.key)"
# or
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/pitflix.key"
```

Then run your normal Tauri release build, e.g.:

```bash
npm run tauri:build:win
```

## Build settings in this repo

- `src-tauri/tauri.conf.json` → `bundle.createUpdaterArtifacts` is **`true`**, so release builds produce updater-related artifacts (including `.sig` files where applicable).
- **Public key** is in `plugins.updater.pubkey` (not a path — the key material itself).

## Where to upload files

1. Build the app with signing env vars set.
2. Collect from `src-tauri/target/release/bundle/` (paths vary by target):
   - Installer(s) (e.g. NSIS `*-setup.exe`, MSI).
   - Matching `*.sig` files.
3. Write `latest.json` with `version`, `notes`, `platforms[...].url` and `platforms[...].signature` (signature = **contents** of the `.sig` file, not a path).
4. Upload `latest.json` and installers to your chosen host (e.g. GitHub Release assets). Ensure the URL in `tauri.conf.json` `endpoints` matches where `latest.json` is served over **HTTPS**.

## How users update inside the app

- **Settings → App updates**: current version, **Check for updates**, optional **Download & install** (and release notes when provided by the server).
- Optional: **Check for updates when Pitflix opens** — only performs a **check**; install still requires explicit action from the banner or Settings.

## Test locally

1. **Dev**: `npm run tauri:dev` — updater may hit your configured URL; use a test `latest.json` with a version **higher** than `package.json` / `tauri.conf.json` `version` and valid signature for the built artifact.
2. **Offline / wrong URL**: expect clear errors on manual check in Settings (startup check stays quiet on failure).
3. **Full loop**: Host `latest.json` + signed installer on a local HTTPS server or a throwaway GitHub release; bump version in JSON; run the **installed** app (not only `tauri dev`) to match production behavior.

## Common failures

| Symptom | Likely cause |
|--------|----------------|
| “Could not reach the update server” | Bad URL, offline, firewall, or TLS issue. |
| Signature / verification errors | Wrong `.sig` for that file, wrong private key used when signing, or `pubkey` in `tauri.conf.json` does not match the key that signed the artifact. |
| 404 on manifest | `endpoints` URL wrong, or `latest.json` not uploaded to that path. |
| Update never offered | `latest.json` `version` not newer than installed app (semver), or manifest invalid / incomplete `platforms` entry. |
| Works in dev but not installed build | Testing wrong binary, or dev bypassing update channel. |

## Files to know

| File | Role |
|------|------|
| `src-tauri/tauri.conf.json` | `plugins.updater.pubkey`, `endpoints`, `bundle.createUpdaterArtifacts` |
| `src-tauri/src/lib.rs` | Plugins, `ApiChild` sidecar, `prepare_update_exit` command |
| `src-tauri/capabilities/default.json` | Includes `allow-prepare-update-exit` |
| `src-tauri/permissions/allow-prepare-update-exit.json` | ACL for `prepare_update_exit` |
| `src/updater/updaterService.ts` | `download` → `prepare_update_exit` → `install` + `relaunch` |
| `src/hooks/useAppUpdater.ts` | Settings UI state machine |
| `src/components/updater/AppUpdateSection.tsx` | Settings UI |
| `src/components/updater/UpdateStartupBanner.tsx` | Optional startup notification |
| `src/config/updater.ts` | Pointer to where URLs are configured (no secrets) |

## New clone / new maintainer

If you did not receive the team’s private key, generate a **new** keypair (`tauri signer generate`), put the **new public key** in `tauri.conf.json`, and keep the **private** key only in secure storage / CI. Existing users on an old public key cannot take updates signed only with the new private key until they install a build that already contains the new public key.
