# Player performance, IPC, and system lag — full record

This document explains **what we investigated**, **what we ruled out**, **root causes we found**, and **what we changed** in the Pitflix Windows player stack. It complements [MEDIA_PLAYER_ARCHITECTURE.md](./MEDIA_PLAYER_ARCHITECTURE.md).

---

## Product direction (context)

- **mpv.exe** in its **own window** is the playback surface (external player).
- The **Tauri / React app** is a **companion**: metadata, continue-watching, navigation — not a second set of heavy playback controls.
- A **legacy embedded path** (libmpv + GL child `HWND`) still exists in the codebase for diagnostics but is **not** the default `player2_open` path today.

---

## Symptoms we chased

1. **Severe system-wide lag** when an episode was playing — Task Manager sluggish, whole desktop felt stuck.
2. **High event rates** in the dev console (IPC / React rerenders) during external playback.
3. **Close path latency** (`player2_close` blocking ~700–1000 ms) — addressed separately (e.g. skipping blocking `set_focus` on the main window in external mode).
4. **Confusion with config**: edits under `src-tauri/mpv-config/` vs what **actually runs** — dev often loads config next to **`mpv.exe`** (e.g. `target/debug/mpv-config` or `binaries/mpv-config`), so stale copies could make tuning look ineffective.

---

## What we ruled out (or deprioritized)

| Hypothesis | Result |
|------------|--------|
| React “too many rerenders” as the main cause | After throttling and backend coalescing, metrics looked fine; lag could still feel awful — pointed away from UI-only. |
| mpv.conf “quality” settings alone | Many tweaks tried; **standalone mpv with the same folder was light**, so config was not the whole story. |
| Old embedded player still running in external mode | Real bugs existed (e.g. `player2_set_video_bounds` while `video_hwnd == 0`, wrong `embedReady` gating). Fixed with explicit **backend resolution** and **external vs embedded** branches. |
| “Device too weak” | Same file played fine in **VLC** and **standalone mpv** — hardware was not the primary explanation. |

---

## Decisive experiment

**Standalone bundled mpv** (same binary / config directory as the app uses):

```powershell
cd "F:\PitFilx-app\Pitflix.UI\src-tauri\target\debug"
.\mpv.exe --config-dir="mpv-config" "C:\path\to\video.mkv"
```

- Playback was **light** and responsive.
- **Inside the app**, with full JSON IPC enabled, the machine **lagged hard**.

**Conclusion:** The bottleneck was **our integration** (Rust + Tauri + how we talk to mpv), not “mpv can’t play this file” in isolation.

A second diagnostic was launching with **`PITFLIX_NO_IPC=1`** (no `--input-ipc-server`): that also pointed to **IPC-related cost** (pipe traffic + host-side handling), not only GPU settings.

---

## Root causes (confirmed)

### 1. `player-ipc` Tauri events (major)

The Rust IPC reader called **`app.emit("player-ipc", …)` for every JSON line** read from mpv.

- **No React code subscribes** to `player-ipc` (the UI uses **`player2-event`** for merged state).
- Tauri still **serializes and dispatches** each payload toward the webview/event layer.
- With **`observe_property` on `time-pos`**, mpv emits updates at **very high frequency** → enormous wasted work and **system-wide** jank.

**Fix:** Do **not** emit `player-ipc` by default. Enable only when debugging:

| Variable | Effect |
|--------|--------|
| `PITFLIX_PLAYER_IPC_DEBUG=1` | Emit raw `player-ipc` events (verbose). |

### 2. High-frequency property observation (major)

On connect we sent a batch of **`observe_property`** commands. Three subscriptions were especially “chatty”:

- `time-pos`
- `audio-pts/full`
- `time-pos/full`

Together with (1), they **flooded** the named pipe and the reader thread.

**Fix for external (detached) playback only:**

- **Do not** observe `time-pos`, `audio-pts/full`, or `time-pos/full` for **external** sessions (`video_hwnd == 0`).
- Poll **`get_property` `"time-pos"`** on a timer (~**1.5 s**) with dedicated **`request_id`** values in a reserved range (starting at **`5_000_000`**). The reader thread recognizes those replies and updates `PlayerState`, then uses existing **`emit_state_coalesced`** / **`player2-event`** behavior.

**Embedded** sessions (future / diagnostic `--wid` path) **keep** the full observe list so timeline scrubbing can stay smooth.

### 3. Other work done in the same effort (related)

- **Backend:** Coalesce noisy **`PlayerEvent::State`** emissions for external mode (immediate for pause/end/loading/duration jumps; throttle the rest).
- **Frontend:** Strict **mode separation** — do not run embed-only effects (`player2_set_video_bounds`, embed monitors) when `backend` is external.
- **Close lag:** External close path avoids **blocking `set_focus`** on the main window when that was measured at ~hundreds of ms.
- **mpv.exe location:** Bundled copy is typically under **`src-tauri/target/debug/`** (dev) next to the app — **`mpv.exe`** may **not** exist under `binaries/`; config must sit beside the binary as **`mpv-config/`** or the path logged at launch is wrong.
- **Process priority:** Optional lowering of mpv priority (`--priority=belownormal` + `SetPriorityClass`) to reduce starvation of the rest of the desktop (product decision; does not replace fixing IPC spam).

---

## Where it lives in code

| Area | File / location |
|------|-----------------|
| Default open path (external mpv) | `WindowsPlayerHost::open` → `open_detached_impl` — `windows_host.rs` |
| IPC read loop, `player-ipc` gating, poll `request_id` handling | `read_ipc_loop` — `windows_host.rs` |
| `observe_property` batch + external poll thread | `spawn_mpv_embedded` — `windows_host.rs` |
| State emission coalescing | `emit_state_coalesced` — `windows_host.rs` |
| Tauri commands / close timing logs | `tauri_commands.rs` |
| Companion UI / throttles | `PlayerPage.tsx`, `runtimeMonitor.ts` |
| mpv user config | `Pitflix.UI/src-tauri/mpv-config/` — ensure the **runtime** copy next to `mpv.exe` matches when testing |

---

## Environment variables (reference)

| Variable | Purpose |
|----------|---------|
| `PITFLIX_PLAYER_IPC_DEBUG=1` | Re-enable **`player-ipc`** emits for raw traffic debugging. |
| `PITFLIX_NO_IPC=1` | Diagnostic: launch detached mpv **without** `--input-ipc-server` (companion features that need IPC will not work; confirms pipe-related cost). |
| `PITFLIX_MPV_LOWCOST=1` | Optional low-cost mpv profile include (`mpv-lowcost.conf`) where implemented. |

---

## Trade-offs (external companion)

- **Time position in the app** updates on the **poll interval** (~1.5 s) instead of every decoded frame — acceptable for continue-watching / status copy; mpv’s own UI remains authoritative for exact seek time.
- If you ever need **second-by-second** progress in the shell only, tighten the poll interval slightly (e.g. 1 s) rather than re-enabling `observe_property` `time-pos` without fixing emit spam.

---

## Docs map

| File | Contents |
|------|----------|
| [MEDIA_PLAYER_ARCHITECTURE.md](./MEDIA_PLAYER_ARCHITECTURE.md) | File map, window model, libmpv vs external (note: default open path should match current `open()`). |
| This file | Performance investigation, IPC root cause, fixes, env vars. |
| `LAG-ROOT-CAUSE-INVESTIGATION.md` (repo root) | Short investigation notes (partially superseded by this doc). |
| `SYSTEM-LAG-DIAGNOSIS.md` (repo root) | Broader troubleshooting checklist (hardware, drivers, test files). |
| `TEST-LOWCOST-PROFILE.md` / `TEST-MPV-STANDALONE-VS-APP.md` | Targeted test procedures. |

---

*Last updated to reflect external-default player + IPC/poll fixes. Update if `open()` default or observe lists change.*
