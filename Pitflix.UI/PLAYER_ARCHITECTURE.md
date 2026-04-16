# Pitflix built-in media player (mpv)

## Why mpv

mpv is a mature, LGPL-licensed playback engine with a stable JSON IPC protocol (`--input-ipc-server`). Pitflix bundles it as a **sidecar** (same pattern as the bundled `pitflix-api` .NET host) so users are not required to install a player. The React UI and SQLite library remain the **source of truth** for watch history, resume position, completion, and next-episode logic; mpv only renders A/V and reports playback properties.

## Where the binary is configured

- Tauri: [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) — `bundle.externalBin` includes `binaries/mpv` (resolved at build time to `mpv-{target-triple}.exe` on Windows).
- Prepare script: [`scripts/prepare-mpv-sidecar.mjs`](scripts/prepare-mpv-sidecar.mjs) materializes `src-tauri/binaries/mpv-{host-triple}.exe` and copies **every `*.dll` from the same folder** as that `mpv.exe` (Windows portable builds need FFmpeg/LAV DLLs next to the exe).
  - **Windows default:** downloads a **pinned** [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild/releases) `.7z` (see `MPV_WINBUILD_TAG` / `MPV_ARCHIVE_BY_TRIPLE` in the script), extracts with bundled **7-Zip** (`7zip-bin`), then copies `mpv.exe` (renamed) + DLLs. Override archive URL: `PITFLIX_MPV_ARCHIVE_URL`.
  - **Local override:** place `mpv.exe` at [`../third_party/mpv/mpv.exe`](../third_party/mpv/mpv.exe) or set `PITFLIX_MPV_EXE` to a full path (DLLs are copied from that exe’s directory when present).
  - Or rely on `where mpv` / `command -v mpv` when no local path and no Windows archive mapping.
  - **Dev-only placeholder (non-functional playback):** `PITFLIX_MPV_DEV_PLACEHOLDER=1` copies `notepad.exe`; never ship this.
- **Bundling:** `bundle.externalBin` ships `mpv-{triple}.exe`. The pinned zhongfly Windows archive is **statically linked** (no separate `*.dll` next to `mpv.exe`). If you switch to a portable build that ships DLLs beside `mpv.exe`, copy those DLLs into `src-tauri/binaries/` and add `"bundle.resources": ["binaries/*.dll"]` to `tauri.conf.json` before building — Tauri fails the glob if it matches nothing, so only add that line when at least one DLL is present.
- **Sanity check:** A real `mpv-*.exe` is typically **many MB**, not ~300 KB. If `--version` prints nothing or the process exits instantly, the file is not a usable mpv build (often a stale placeholder). After `npm run bundle:prepare`, run `.\src-tauri\binaries\mpv-x86_64-pc-windows-msvc.exe --version` from `Pitflix.UI` and confirm mpv banner output.
- `npm run bundle:prepare` runs both the API publisher and the mpv prepare script.

### License / compliance

Ship license texts required by your chosen mpv build (e.g. LGPL/GPL components). The upstream project’s notices should accompany redistribution; this file does not substitute for legal review.

## Rust bridge

- Module: [`src-tauri/src/mpv.rs`](src-tauri/src/mpv.rs)
- **Windows IPC path:** Pass a **short pipe name** to mpv (e.g. `pitflix-mpv-<uuid>`), not `\\.\pipe\...`. mpv prepends `\\.\pipe\` internally (`input/ipc-win.c`); putting backslashes in the process command line can break quoting so the server and client disagree — leading to “The system cannot find the file specified” when opening the pipe. The client still connects with the full `\\.\pipe\<name>` path.
- mpv **stderr** is appended to `%LOCALAPPDATA%\Pitflix\mpv.log` on Windows when logging can be opened (useful if the binary is wrong or mpv exits early).
- Commands: `player_open` (path + optional `start_seconds`), `player_send` (raw JSON IPC object), `player_close`.
- Events: JSON lines from mpv are emitted to the webview as `player-ipc` (payload = one decoded JSON value per line).
- Process lifetime: `MpvChild` is stopped on app exit and in `prepare_update_exit` so updater installs do not lock `mpv-*.exe` (same rationale as the API sidecar).

### Windows embedding

The first release uses mpv’s **own video window** (`--force-window=yes`) plus the Pitflix `/player` route as a **control surface**. A future improvement is optional `--wid` embedding via a child `HWND` aligned with the webview.

## Frontend

- Route: `/player` — [`src/pages/PlayerPage.tsx`](src/pages/PlayerPage.tsx).
- Entry: [`src/hooks/usePlayback.ts`](src/hooks/usePlayback.ts) — when `isTauri()` and **Use bundled Pitflix player** is enabled in settings, Play navigates here instead of calling `POST /api/play`.
- Settings: `UseBuiltinPlayer` in SQLite (`/api/settings`), toggled in **Settings → Playback** on desktop.

## Watch / resume state (API + SQLite)

- Model: `WatchHistory` (`EstimatedSeconds`, `FileDurationSeconds`, `IsCompleted`, …) in [`Pitflix.Core`](../Pitflix.Core).
- **Progress:** `POST /api/history/{id}/progress` — `{ positionSeconds, durationSeconds?, markWatching? }` updates history and, near the end (≥90% of known duration), marks library movies/episodes completed.
- **Stop:** `POST /api/history/{id}/stopped` — optional `positionSeconds` for the built-in player (replaces wall-clock-only estimates when absent).
- Repository helpers: `UpdateWatchHistoryProgressAsync`, `FinalizeWatchHistoryStoppedWithPositionAsync`, `ApplyCompletedFromHistoryAsync` in [`LibraryRepository.cs`](../Pitflix.Core/Database/LibraryRepository.cs).

## Subtitles and audio

mpv observes `track-list`, `sid`, `aid`, `sub-visibility`. The UI exposes track cycling and visibility toggles via `player_send` and IPC-driven state. External subtitle files can be added later by extending `player_open` (e.g. `--sub-file=`) without changing the ownership model.

## Next episode

Pitflix resolves the next library episode with `GetNextEpisodeForShow` and exposes `GET /api/series/{id}/next-episode`. The player page uses this for a **Next** action; mpv is not aware of series structure.

## Updater compatibility

[`prepare_update_exit`](src-tauri/src/lib.rs) stops both the **API** and **mpv** child processes before the Windows installer runs, matching [`UPDATER_SETUP.md`](UPDATER_SETUP.md).

## Limitations / follow-ups

- **HWND embedding** for a single-window experience on Windows.
- **macOS / Linux** IPC paths differ from Windows named pipes; the Rust module uses `cfg` for the socket/pipe path.
- Bump the pinned winbuild tag in `prepare-mpv-sidecar.mjs` when upgrading mpv; use `PITFLIX_MPV_ARCHIVE_URL` for one-off CI or mirrors.
