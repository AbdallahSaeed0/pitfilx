# Media Player Path B (Windows Phase 1)

Pitflix is moving away from the previous **mpv `--wid` embedded child window inside the WebView** approach.

This document explains:
- why the old approach was rejected
- what the new “Path B” architecture is
- what is implemented now (Phase 1)
- what is staged next

## Why the old `--wid` WebView embedding was rejected

The old player attempted to:
- create a Win32 child `HWND` aligned to a DOM rect
- force that native surface above the WebView (`HWND_TOP`) so video becomes visible
- keep keyboard/mouse routing in the WebView using focus + activation workarounds

In practice this is unstable because:

- **Z-order vs input conflict**: if the native surface is above WebView2 to be visible, it becomes the top hit-test target. Mouse clicks and activation naturally prefer the native HWND rather than DOM.
- **Two input systems fight**: WebView2 expects to own keyboard focus for the React page. mpv (and its descendant child windows) still participate in Windows activation and message routing. Small differences (timing, window styles, focus transitions) break shortcuts.
- **IPC can wedge when the backend stalls**: with mpv as an external process, pipe behavior can become unreliable under stalls/exits, and UI state can become stale if property updates are missed.
- **Composition pitfalls**: DWM/WebView composition settings (e.g. transparency/blur-behind) create additional edge cases and rendering artifacts.

Bottom line: the WebView-embedded-child model forces Pitflix to fight Windows window-manager behavior and WebView2 composition. It’s not a maintainable foundation.

## Path B architecture (goal)

Path B is a more native player foundation:

- **Pitflix owns the playback UX and state** (React still drives watch history, resume, series flow).
- **Pitflix owns input** (keyboard/mouse shortcuts should not rely on WebView focus hacks).
- mpv is treated as a backend engine, not a UI window glued into the WebView.

### Ownership boundaries

- **Frontend (React)** owns:
  - player UI, controls, menus
  - watch state (progress, stopped, completion, continue watching)
  - series logic (next/previous episode, end-of-episode prompt)
- **Native host (Rust)** owns:
  - player surface lifecycle
  - robust command execution boundary
  - input routing (Phase 1: native player window shortcuts)
- **Backend engine** owns:
  - A/V decode and render
  - emitting playback properties/events

## What is implemented now (Phase 1)

Windows-only Phase 1 implements a **Pitflix-owned native player window** and uses mpv as the playback backend.

### What changed

- Added a new Path B subsystem under:
  - `Pitflix.UI/src-tauri/src/player/`
- Added new Tauri commands:
  - `player2_open`
  - `player2_send`
  - `player2_close`
- Updated the React player page to use Path B commands.
- Removed the WebView embedding plumbing (`useMpvEmbedBounds`, `player_set_embed_bounds`, Win32 embed host file).

### Current backend choice (Phase 1)

Phase 1 uses the **bundled mpv executable** as the backend, embedded into the dedicated native Pitflix player window via `--wid`.

Important: this is **not** the rejected model. The rejected model was **embedding into the WebView window**. Here, mpv is hosted inside a **dedicated native player window** that Pitflix owns, which avoids the WebView/native-child conflict for input.

### Input (Phase 1)

Keyboard shortcuts are handled in the native player window procedure for:
- Space (toggle pause)
- Left/Right (seek ±5s)
- M (mute)

Additional shortcuts and fullscreen handling are staged next.

## What is staged next

### Phase 2
- Subtitle/audio track menus and selection
- next/previous episode commands and end-of-episode flow polish
- tighten state machine (loading/playing/paused/ended/error) with explicit typed events

### Phase 3 (deeper native integration)
- Replace external mpv process with **in-process libmpv + render API** (D3D11), removing Windows IPC/pipe concerns entirely.
- Consider a single-window “premium player” experience (native overlay or a dedicated Tauri window with a stable render surface).

#### Phase 3 status: foundation started

- **libmpv dynamic-load scaffold**: the backend can attempt to load **`libmpv-2.dll`** at runtime (no IPC). If the DLL is missing, it falls back to external `mpv.exe`.
- **mpv render API (OpenGL / WGL)**: when libmpv is active, video is drawn via **`mpv_render_context_*`** into the child video `HWND` using a **WGL** context (`src-tauri/src/player/mpv_gl_win.rs`). The `D3D11` helper (`d3d11.rs`) remains optional scaffolding for a future D3D-backed path.
- **Threading**: all `MpvClient` + `MpvGlRenderer` state stays on the **player window thread**; `player2_send` queues JSON-style commands and wakes the loop with `WM_LIBMPV_CMD`.

#### Windows binaries required

To actually run in-process mpv you must ship/provide:

- `libmpv-2.dll` (must be discoverable via Windows DLL search order)
- Any dependent DLLs for your mpv build (often ffmpeg-related)

Recommended during development: place `libmpv-2.dll` next to the app executable.

## Files overview

### New / updated
- `Pitflix.UI/src-tauri/src/player/mod.rs`
- `Pitflix.UI/src-tauri/src/player/commands.rs`
- `Pitflix.UI/src-tauri/src/player/events.rs`
- `Pitflix.UI/src-tauri/src/player/windows_host.rs`
- `Pitflix.UI/src-tauri/src/player/mpv_gl_win.rs` (WGL + `mpv_render_context_*`)
- `Pitflix.UI/src-tauri/src/player/libmpv.rs`
- `Pitflix.UI/src-tauri/src/player/tauri_commands.rs`
- `Pitflix.UI/src-tauri/src/lib.rs`
- `Pitflix.UI/src/pages/PlayerPage.tsx`
- `Pitflix.UI/src-tauri/permissions/allow-player.json`

### Removed
- `Pitflix.UI/src-tauri/src/mpv.rs`
- `Pitflix.UI/src-tauri/src/mpv/mpv_embed_win.rs`
- `Pitflix.UI/src/hooks/useMpvEmbedBounds.ts`

