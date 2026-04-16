# Pitflix media player (Path B) — architecture handoff

This document describes how the **native Windows media player** works in the Pitflix app so you can reason about it without reading the whole tree. Paths are relative to the repo root `PitFilx-app/`.

---

## High-level picture

- **UI:** React (`Pitflix.UI/src/pages/PlayerPage.tsx`) drives playback via Tauri **`invoke("player2_*")`** commands and listens for **`player2-event`** (Tauri events) for state updates.
- **Native layer (Rust):** `Pitflix.UI/src-tauri/src/player/` — Windows-only for the full player today (`PlayerHost` stubs non-Windows).
- **Two backends** exist in `windows_host.rs` as `BackendSession`:
  1. **`External`** — spawn **`mpv.exe`** in a **normal top-level window** (**no `--wid`**), **JSON IPC** over a named pipe for state/commands. This is the **default `WindowsPlayerHost::open()`** path (`open_detached_impl`).
  2. **`LibMpv`** — in-process **`libmpv-2.dll`** + **mpv render API** + **OpenGL (WGL)** into a dedicated child `HWND`. Still in the tree for diagnostics / future use; **not** what `open()` uses today.

**Performance / IPC:** External playback used to stress the whole machine because of **Tauri `player-ipc` spam** and **high-frequency `observe_property`** (especially `time-pos`). See **[PLAYER_PERFORMANCE_AND_EXTERNAL_IPC.md](./PLAYER_PERFORMANCE_AND_EXTERNAL_IPC.md)** for the full story and fixes.

---

## File map (Rust player)

| File | Role |
|------|------|
| `Pitflix.UI/src-tauri/src/player/mod.rs` | `PlayerHost` / `PlayerHostState` — façade used by `lib.rs`; delegates to `WindowsPlayerHost` on Windows. |
| `Pitflix.UI/src-tauri/src/player/windows_host.rs` | **Main orchestration:** session lifecycle, `HWND` embedding, z-order vs WebView2, bounds, pause/resume (external IPC path), recover, detached/minimal modes, `video_wnd_proc`. |
| `Pitflix.UI/src-tauri/src/player/windows_libmpv_host.rs` | **Embedded libmpv session:** load DLL, create WGL + `mpv_render_context`, property observe loop thread, `WM_MPV_RENDER` render handler `on_wm_mpv_render`, command channel. |
| `Pitflix.UI/src-tauri/src/player/mpv_gl_win.rs` | **WGL:** `GlContext`, `MpvGlRenderer`, `WM_MPV_RENDER` constant, `mpv_on_update` → `PostMessageW(WM_MPV_RENDER)`, render-path diagnostics, safe `glGetError` via `opengl32!GetProcAddress`. |
| `Pitflix.UI/src-tauri/src/player/libmpv.rs` | **Dynamic libmpv:** `libloading::Library`, function pointers, `MpvClient`, `create_for_render` (`vo=libmpv` etc.), render API types. |
| `Pitflix.UI/src-tauri/src/player/tauri_commands.rs` | Tauri **`player2_*`** command handlers → `PlayerHost` / `append_player_debug_log` (mutex-serialized file log). |
| `Pitflix.UI/src-tauri/src/player/commands.rs` | `PlayerOpen`, `PlayerCommand` (play/pause/seek/volume/subs/…). |
| `Pitflix.UI/src-tauri/src/player/events.rs` | `PlayerEvent`, `PlayerState`, `Player2NativeState`, tracks types — serialized to the frontend. |
| `Pitflix.UI/src-tauri/src/player/d3d11.rs` | Placeholder / future use (not the active libmpv render path today). |

Tauri registers commands in `Pitflix.UI/src-tauri/src/lib.rs` (`player2_open`, `player2_send`, …).

---

## Frontend contract

- **Open:** `invoke("player2_open", { path, start_seconds? })`.
- **Layout:** React measures the video strip and calls **`player2_set_video_bounds`** with coordinates relative to the **webview / window client** logic the Rust side expects (see `set_video_bounds` in `windows_host.rs` — includes `MapWindowPoints` when video parent ≠ main HWND for libmpv).
- **Transport:** `invoke("player2_send", { cmd: PlayerCommand })` for discrete controls.
- **Pause / resume:** `player2_pause` / `player2_resume` (external path does IPC correlation; libmpv path uses property observation + commands).
- **State:** Native code emits **`player2-event`** with `PlayerEvent::State(PlayerState)` (and optionally tracks/errors). `player2_get_state` returns **`Player2NativeState`** (session id, `backend`, optional `video_hwnd`, IPC mirror vs libmpv-specific fields).
- **Debug:** Logs append to `%LOCALAPPDATA%\Pitflix\pitflix-player-debug.log` (and app log dir when `AppHandle` is available). Lines tagged e.g. `[libmpv-render-path]`, `[input-layer]`, `[embed-op]`.

---

## Window model (Windows)

1. **Tauri main window** — contains WebView2 (wry).
2. **Video child** — class `PitflixVideoEmbed`, **`CS_OWNDC`**, created under the main window initially, then **reparented under the WebView host** (`WRY_WEBVIEW`) for correct stacking so GL draws “under” the transparent web UI region while video shows through transparent areas (layout-dependent).
3. **Z-order:** For libmpv, the video child is often placed **`HWND_BOTTOM`** under the Edge child so WebView2 stays on top for chrome; **`WM_NCHITTEST` → `HTTRANSPARENT`** on the video child passes clicks through to the web layer (avoid relying only on `WS_EX_TRANSPARENT` / `WS_DISABLED` for GL).
4. **`WM_MPV_RENDER` (`WM_USER+101`):** `mpv_render_context_set_update_callback` runs on mpv’s thread and **posts** this message to the video `HWND`. The window thread handles it in **`video_wnd_proc`** → **`windows_libmpv_host::on_wm_mpv_render`**: `wglMakeCurrent`, `mpv_render_context_update`, optional `mpv_render_context_render`, `SwapBuffers`, `mpv_render_context_report_swap`.

---

## libmpv embedded pipeline (detail)

1. **`find_libmpv_dll`** (in `windows_host.rs`) locates bundled **`libmpv-2.dll`** next to the app.
2. **`create_embed_video_child`** registers `PitflixVideoEmbed` and creates a small initial child (bounds updated when React calls `player2_set_video_bounds`).
3. **`create_embedded_libmpv_session`** (`windows_libmpv_host.rs`):
   - `MpvClient::create_for_render` — `mpv_create`, options (`vo=libmpv`, etc.), **no** `mpv_initialize` yet.
   - **`GlContext::create(video_hwnd)`** — pixel format, legacy context, optional **`wglCreateContextAttribsARB`** for OpenGL 3.2 compatibility.
   - **`MpvGlRenderer::new`** — `mpv_render_context_create` with OpenGL init params (`get_proc_address` trampoline → `wglGetProcAddress` / `GetProcAddress(opengl32)`).
   - Store **`MpvGlRenderer` raw pointer in `GWLP_USERDATA`** of the video window.
   - **`mpv.initialize()`** then observe properties, **`loadfile`**, spawn **mpv event thread** (`mpv_wait_event` + property changes → emit `player2-event`), spawn **command drainer** on same thread model (see file for `cmd_rx`).
4. **Rendering** is **not** driven from the mpv event thread; it is **only** via **`WM_MPV_RENDER`** on the window that owns the GL context.

---

## External mpv pipeline (default)

- **`open_detached_impl`** / **`spawn_mpv_embedded`**: start **`mpv.exe`** **without** `--wid` (detached window), with **`--input-ipc-server=<pipe>`**, custom **`--config-dir`** next to the mpv binary when present, etc.
- **Writer thread** sends JSON lines on the pipe; **reader thread** parses replies, updates `PlayerState`, implements pause/resume **`request_id`** verification for some flows.
- **External-only optimization:** high-frequency properties (`time-pos`, `audio-pts/full`, `time-pos/full`) are **not** observed; **`time-pos` is polled** ~every 1.5s via `get_property`, and raw **`player-ipc`** Tauri emits are **off by default** (see performance doc).

## Embedded external mpv (`--wid`) and libmpv (legacy / diagnostic)

- **`open_impl`** / **`open_embedded_minimal_*`**: **`mpv.exe`** with **`--wid=<video_hwnd>`** + IPC — still available for tests.
- **`open_libmpv_impl`**: in-process libmpv + GL — not the default `open()`.

---

## Diagnostics and known pivots

- **`[libmpv-render-path]`** logs: update callback, `PostMessageW`, `WM_MPV_RENDER` receive, client size, `make_current`, `mpv_render_context_update` flags, `mpv_render_context_render` begin/end, `SwapBuffers`, `glGetError` (loaded from **`opengl32.dll`**, not `wglGetProcAddress("glGetError")`** — avoids bad pointers / FastFail).
- **SUMMARY** lines aggregate counters (update vs WM receive vs successful render) to see “render never vs repeated”.
- If WGL reports success but pixels stay black: planned pivot is **ANGLE (OpenGL ES)** or **mpv D3D11 render API** — not reverting to external `--wid` as the primary fix.
- **`tauri.conf.json`**: main window **`transparent: false`** was used to avoid WebView2 / layered-window crashes (`STATUS_STACK_BUFFER_OVERRUN`) in some setups.

---

## Commands reference (Tauri)

Registered in `lib.rs`:  
`player2_open`, `player2_send`, `player2_pause`, `player2_resume`, `player2_close`, `player2_set_video_bounds`, `player2_debug_log`, `player2_get_state`, `player2_list_external_subtitle_files`, `player2_test_ipc_osd`, `player2_test_toggle_pause`, `player2_recover`, `player2_recover_no_config`, `player2_get_last_mpv_exit_report`, `player2_open_detached_no_wid`, `player2_set_embedded_safe_mode`, `player2_open_detached`, `player2_open_embedded_minimal_no_config`.

---

## Non-player pieces (context)

- **`Pitflix.UI/src-tauri/src/lib.rs`** — Tauri app setup, **`ApiChild`** for bundled **Pitflix.API** process, updater hook **`prepare_update_exit`**.
- **API** is separate (`Pitflix.API/` .NET); the UI talks to it over HTTP as usual; the player is **local** to the Tauri binary + optional **`mpv.exe`** / **`libmpv-2.dll`**.

---

## Quick glossary

| Term | Meaning |
|------|---------|
| Path B | Native player path (vs any older/browser-only approach). |
| `--wid` | mpv embeds into an existing Win32 `HWND`. |
| Render API | libmpv’s `mpv_render_context_*` + OpenGL FBO 0 into the child window’s framebuffer. |
| `player2-event` | Tauri event carrying `PlayerEvent` JSON to the React app. |

---

*Generated for handoff to other assistants / Claude. Update this file if the default backend or window strategy changes.*
