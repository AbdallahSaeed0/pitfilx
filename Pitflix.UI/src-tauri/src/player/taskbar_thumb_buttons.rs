//! Windows taskbar thumbnail-toolbar buttons (Previous, Rewind, Play/Pause,
//! Forward, Next, Stop) shown when hovering the main Pitflix taskbar icon
//! during playback.
//!
//! Mirrors `PitflixPlayer/TaskbarThumbButtons.cs` (the WPF companion's own
//! implementation) but targets the main Tauri window's HWND, since that is
//! the only window that actually gets a taskbar button/thumbnail for this
//! app — the WPF companion is attached/owned and never shows its own.

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateBitmap, CreateDIBSection, DeleteObject, GetDC, ReleaseDC, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, TBPF_NOPROGRESS, TBPF_NORMAL,
    TBPF_PAUSED, THBF_ENABLED, THBF_HIDDEN, THBN_CLICKED, THB_FLAGS, THB_ICON, THB_TOOLTIP,
    THUMBBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, CreateIconIndirect, GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
    SetForegroundWindow, ShowWindow, HICON, ICONINFO, SW_RESTORE, WM_COMMAND,
};

const ID_PREVIOUS: u32 = 1;
const ID_PLAY_PAUSE: u32 = 2;
const ID_NEXT: u32 = 3;
const ID_REWIND: u32 = 4;
const ID_FORWARD: u32 = 5;
const ID_STOP: u32 = 6;
const ID_FULLSCREEN: u32 = 7;

const THUMB_SUBCLASS_ID: usize = 0xA1B2_C3E1;

static THUMB_APP: Mutex<Option<AppHandle>> = Mutex::new(None);
static THUMB_HWND: AtomicIsize = AtomicIsize::new(0);
/// Subclass + icons are set up once at startup.
static THUMB_INSTALLED: AtomicBool = AtomicBool::new(false);
/// `ThumbBarAddButtons` itself is deferred until the first real session, so
/// an app that's never played anything never reserves the thumbnail's
/// button-row space at all. It can only be called once per window, so once
/// true it stays true for the rest of the process.
static BUTTONS_ADDED: AtomicBool = AtomicBool::new(false);

static ICON_PREV: AtomicIsize = AtomicIsize::new(0);
static ICON_PLAY: AtomicIsize = AtomicIsize::new(0);
static ICON_PAUSE: AtomicIsize = AtomicIsize::new(0);
static ICON_NEXT: AtomicIsize = AtomicIsize::new(0);
static ICON_REWIND: AtomicIsize = AtomicIsize::new(0);
static ICON_FORWARD: AtomicIsize = AtomicIsize::new(0);
static ICON_STOP: AtomicIsize = AtomicIsize::new(0);
static ICON_FULLSCREEN: AtomicIsize = AtomicIsize::new(0);

#[derive(Clone, Serialize)]
struct ThumbClickPayload {
    action: &'static str,
}

enum ThumbIconKind {
    Previous,
    Play,
    Pause,
    Next,
    Rewind,
    Forward,
    Stop,
    Fullscreen,
}

/// Rasterizes simple vector glyphs (same style as the WPF companion's
/// `CreateVectorIcon`), at 32x32 with generous margins so they read clearly
/// at the sizes Windows actually renders thumbnail-toolbar buttons — the
/// original 20x20 art packed shapes edge-to-edge and looked cramped once
/// scaled up.
fn create_icon(kind: ThumbIconKind) -> Option<HICON> {
    const SIZE: i32 = 32;

    let in_triangle = |px: f32, py: f32, p0: (f32, f32), p1: (f32, f32), p2: (f32, f32)| -> bool {
        let sign = |ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32| {
            (ax - cx) * (by - cy) - (bx - cx) * (ay - cy)
        };
        let d1 = sign(px, py, p0.0, p0.1, p1.0, p1.1);
        let d2 = sign(px, py, p1.0, p1.1, p2.0, p2.1);
        let d3 = sign(px, py, p2.0, p2.1, p0.0, p0.1);
        let has_neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
        let has_pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
        !(has_neg && has_pos)
    };
    let in_rect = |px: f32, py: f32, x: f32, y: f32, w: f32, h: f32| -> bool {
        px >= x && px < x + w && py >= y && py < y + h
    };

    let is_lit = |px: f32, py: f32| -> bool {
        match kind {
            ThumbIconKind::Previous => {
                in_triangle(px, py, (20.0, 8.0), (20.0, 24.0), (9.0, 16.0))
                    || in_rect(px, py, 6.0, 8.0, 3.0, 16.0)
            }
            ThumbIconKind::Play => in_triangle(px, py, (10.0, 8.0), (10.0, 24.0), (24.0, 16.0)),
            ThumbIconKind::Pause => {
                in_rect(px, py, 9.0, 8.0, 6.0, 16.0) || in_rect(px, py, 19.0, 8.0, 6.0, 16.0)
            }
            ThumbIconKind::Next => {
                in_rect(px, py, 23.0, 8.0, 3.0, 16.0)
                    || in_triangle(px, py, (8.0, 8.0), (8.0, 24.0), (22.0, 16.0))
            }
            // Rewind/Forward: two clearly-separated chevrons (⏪ / ⏩ style).
            ThumbIconKind::Rewind => {
                in_triangle(px, py, (21.0, 8.0), (21.0, 24.0), (13.0, 16.0))
                    || in_triangle(px, py, (12.0, 8.0), (12.0, 24.0), (4.0, 16.0))
            }
            ThumbIconKind::Forward => {
                in_triangle(px, py, (11.0, 8.0), (11.0, 24.0), (19.0, 16.0))
                    || in_triangle(px, py, (20.0, 8.0), (20.0, 24.0), (28.0, 16.0))
            }
            ThumbIconKind::Stop => in_rect(px, py, 9.0, 9.0, 14.0, 14.0),
            // Fullscreen: four corner brackets (standard "expand" glyph).
            ThumbIconKind::Fullscreen => {
                const M: f32 = 7.0; // margin from the edge
                const L: f32 = 7.0; // stroke length
                const T: f32 = 2.5; // stroke thickness
                let far = SIZE as f32 - M;
                in_rect(px, py, M, M, L, T) // top-left horizontal
          || in_rect(px, py, M, M, T, L) // top-left vertical
          || in_rect(px, py, far - L, M, L, T) // top-right horizontal
          || in_rect(px, py, far - T, M, T, L) // top-right vertical
          || in_rect(px, py, M, far - T, L, T) // bottom-left horizontal
          || in_rect(px, py, M, far - L, T, L) // bottom-left vertical
          || in_rect(px, py, far - L, far - T, L, T) // bottom-right horizontal
          || in_rect(px, py, far - T, far - L, T, L) // bottom-right vertical
            }
        }
    };

    let mut pixels = vec![0u32; (SIZE * SIZE) as usize];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let cx = x as f32 + 0.5;
            let cy = y as f32 + 0.5;
            if is_lit(cx, cy) {
                pixels[(y * SIZE + x) as usize] = 0xFFFF_FFFFu32;
            }
        }
    }

    unsafe {
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: SIZE,
                biHeight: -SIZE, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0 as u32,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            ..Default::default()
        };

        let screen_dc = GetDC(None);
        let mut bits_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        let color_bmp_result = CreateDIBSection(
            Some(screen_dc),
            &bmi,
            DIB_RGB_COLORS,
            &mut bits_ptr,
            None,
            0,
        );
        ReleaseDC(None, screen_dc);

        let color_bmp = match color_bmp_result {
            Ok(bmp) => bmp,
            Err(e) => {
                eprintln!("[pitflix-player] [taskbar-thumb] CreateDIBSection failed: {e}");
                return None;
            }
        };
        if bits_ptr.is_null() {
            eprintln!("[pitflix-player] [taskbar-thumb] CreateDIBSection returned null bits_ptr");
            let _ = DeleteObject(HGDIOBJ(color_bmp.0));
            return None;
        }
        std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits_ptr as *mut u32, pixels.len());

        // WORD-aligned all-zero mask: real transparency comes from the color
        // bitmap's alpha channel, so the AND-mask must not black out anything.
        let mask_stride = (((SIZE + 15) / 16) * 2) as usize;
        let mask_bits = vec![0u8; mask_stride * SIZE as usize];
        let mask_bmp: HBITMAP =
            CreateBitmap(SIZE, SIZE, 1, 1, Some(mask_bits.as_ptr() as *const _));
        if mask_bmp.0.is_null() {
            eprintln!("[pitflix-player] [taskbar-thumb] CreateBitmap (mask) returned null");
            let _ = DeleteObject(HGDIOBJ(color_bmp.0));
            return None;
        }

        let icon_info = ICONINFO {
            fIcon: true.into(),
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: mask_bmp,
            hbmColor: color_bmp,
        };
        let icon = match CreateIconIndirect(&icon_info) {
            Ok(icon) => Some(icon),
            Err(e) => {
                eprintln!("[pitflix-player] [taskbar-thumb] CreateIconIndirect failed: {e}");
                None
            }
        };

        let _ = DeleteObject(HGDIOBJ(mask_bmp.0));
        let _ = DeleteObject(HGDIOBJ(color_bmp.0));

        icon
    }
}

fn ensure_icons_created() {
    if ICON_PLAY.load(Ordering::SeqCst) != 0 {
        return;
    }
    if let Some(icon) = create_icon(ThumbIconKind::Previous) {
        ICON_PREV.store(icon.0 as isize, Ordering::SeqCst);
    }
    if let Some(icon) = create_icon(ThumbIconKind::Play) {
        ICON_PLAY.store(icon.0 as isize, Ordering::SeqCst);
    }
    if let Some(icon) = create_icon(ThumbIconKind::Pause) {
        ICON_PAUSE.store(icon.0 as isize, Ordering::SeqCst);
    }
    if let Some(icon) = create_icon(ThumbIconKind::Next) {
        ICON_NEXT.store(icon.0 as isize, Ordering::SeqCst);
    }
    if let Some(icon) = create_icon(ThumbIconKind::Rewind) {
        ICON_REWIND.store(icon.0 as isize, Ordering::SeqCst);
    }
    if let Some(icon) = create_icon(ThumbIconKind::Forward) {
        ICON_FORWARD.store(icon.0 as isize, Ordering::SeqCst);
    }
    if let Some(icon) = create_icon(ThumbIconKind::Stop) {
        ICON_STOP.store(icon.0 as isize, Ordering::SeqCst);
    }
    if let Some(icon) = create_icon(ThumbIconKind::Fullscreen) {
        ICON_FULLSCREEN.store(icon.0 as isize, Ordering::SeqCst);
    }
    eprintln!(
    "[pitflix-player] [taskbar-thumb] icons created: prev=0x{:X} play=0x{:X} pause=0x{:X} next=0x{:X} rewind=0x{:X} forward=0x{:X} stop=0x{:X} fullscreen=0x{:X}",
    ICON_PREV.load(Ordering::SeqCst),
    ICON_PLAY.load(Ordering::SeqCst),
    ICON_PAUSE.load(Ordering::SeqCst),
    ICON_NEXT.load(Ordering::SeqCst),
    ICON_REWIND.load(Ordering::SeqCst),
    ICON_FORWARD.load(Ordering::SeqCst),
    ICON_STOP.load(Ordering::SeqCst),
    ICON_FULLSCREEN.load(Ordering::SeqCst),
  );
}

fn hicon_from(store: &AtomicIsize) -> HICON {
    HICON(store.load(Ordering::SeqCst) as *mut _)
}

fn make_tip(text: &str) -> [u16; 260] {
    let mut buf = [0u16; 260];
    for (i, unit) in text.encode_utf16().take(259).enumerate() {
        buf[i] = unit;
    }
    buf
}

fn make_button(id: u32, icon: HICON, tip: &str, visible: bool) -> THUMBBUTTON {
    THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        iBitmap: 0,
        hIcon: icon,
        szTip: make_tip(tip),
        dwFlags: if visible { THBF_ENABLED } else { THBF_HIDDEN },
    }
}

/// Button order: Previous, Rewind (-10s), Play/Pause, Forward (+10s), Next,
/// Stop, Fullscreen — 7 total, the max Windows allows on a thumbnail toolbar.
fn build_buttons(has_session: bool, is_playing: bool) -> [THUMBBUTTON; 7] {
    let (play_icon, play_tip) = if is_playing {
        (hicon_from(&ICON_PAUSE), "Pause")
    } else {
        (hicon_from(&ICON_PLAY), "Play")
    };
    [
        make_button(ID_PREVIOUS, hicon_from(&ICON_PREV), "Previous", has_session),
        make_button(
            ID_REWIND,
            hicon_from(&ICON_REWIND),
            "Rewind 10s",
            has_session,
        ),
        make_button(ID_PLAY_PAUSE, play_icon, play_tip, has_session),
        make_button(
            ID_FORWARD,
            hicon_from(&ICON_FORWARD),
            "Forward 10s",
            has_session,
        ),
        make_button(ID_NEXT, hicon_from(&ICON_NEXT), "Next", has_session),
        make_button(ID_STOP, hicon_from(&ICON_STOP), "Stop", has_session),
        make_button(
            ID_FULLSCREEN,
            hicon_from(&ICON_FULLSCREEN),
            "Fullscreen",
            has_session,
        ),
    ]
}

fn create_taskbar_list() -> Option<ITaskbarList3> {
    unsafe {
        let taskbar: ITaskbarList3 =
            CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER).ok()?;
        let _ = taskbar.HrInit();
        Some(taskbar)
    }
}

/// Forces the window to the true OS foreground. A plain `SetForegroundWindow`
/// is routinely ignored by Windows' foreground-lock heuristic when the
/// caller isn't already the "active" process (exactly the case right after
/// a taskbar-thumbnail click, since the shell/Explorer owned focus at that
/// moment) — the window LOOKS activated but isn't really, so
/// `setFullscreen()` doesn't get the taskbar-hiding treatment. Temporarily
/// attaching our thread's input queue to the current foreground thread's is
/// the standard workaround: it makes Windows treat the two as one input
/// context, so the restriction no longer applies.
fn force_foreground(hwnd: HWND) {
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }

        let fg = GetForegroundWindow();
        let our_tid = GetCurrentThreadId();
        let fg_tid = if fg.0.is_null() {
            0
        } else {
            GetWindowThreadProcessId(fg, None)
        };

        if fg_tid != 0 && fg_tid != our_tid {
            let _ = AttachThreadInput(our_tid, fg_tid, true);
            let _ = SetForegroundWindow(hwnd);
            let _ = BringWindowToTop(hwnd);
            let _ = AttachThreadInput(our_tid, fg_tid, false);
        } else {
            let _ = SetForegroundWindow(hwnd);
            let _ = BringWindowToTop(hwnd);
        }
    }
}

unsafe extern "system" fn thumb_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if msg == WM_COMMAND {
        let raw = wparam.0;
        let notif = (raw >> 16) & 0xFFFF;
        if notif == THBN_CLICKED as usize {
            let id = (raw & 0xFFFF) as u32;
            let action = match id {
                ID_PREVIOUS => Some("prev"),
                ID_PLAY_PAUSE => Some("pause"),
                ID_NEXT => Some("next"),
                ID_REWIND => Some("rewind"),
                ID_FORWARD => Some("forward"),
                ID_STOP => Some("stop"),
                ID_FULLSCREEN => Some("fullscreen"),
                _ => None,
            };
            if let Some(action) = action {
                eprintln!("[pitflix-player] [taskbar-thumb] click action={action}");
                // Clicking a thumbnail-toolbar button does NOT bring the window to
                // the foreground on its own (unlike clicking the taskbar icon
                // itself) — without this, `setFullscreen()` applies but Windows
                // only auto-hides the taskbar for the truly-foreground fullscreen
                // window, so the taskbar stayed visible over the video.
                force_foreground(hwnd);
                if let Ok(g) = THUMB_APP.lock() {
                    if let Some(app) = g.as_ref() {
                        match app.emit("taskbar-thumb-click", ThumbClickPayload { action }) {
                            Ok(()) => {}
                            Err(e) => {
                                eprintln!("[pitflix-player] [taskbar-thumb] emit failed: {e}")
                            }
                        }
                    }
                }
            }
        }
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// Sets up icons + the window subclass (to catch clicks) so everything is
/// ready to go, but deliberately does NOT call `ThumbBarAddButtons` yet —
/// that's deferred to the first real session (see `set_playback_state`) so
/// an idle window never reserves the thumbnail's button-row space.
pub fn install(app: AppHandle, hwnd: HWND) {
    if THUMB_INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(mut g) = THUMB_APP.lock() {
        *g = Some(app);
    }
    THUMB_HWND.store(hwnd.0 as isize, Ordering::SeqCst);

    ensure_icons_created();

    unsafe {
        let ok = SetWindowSubclass(hwnd, Some(thumb_subclass_proc), THUMB_SUBCLASS_ID, 0);
        eprintln!(
            "[pitflix-player] [taskbar-thumb] SetWindowSubclass -> {}",
            ok.as_bool()
        );
    }
}

/// Shows/hides the buttons and reflects play/pause state.
/// `has_session`: whether a playback session currently exists. `is_playing`:
/// which icon the middle button shows. Previous/Next/Rewind/Forward stay
/// enabled whenever a session exists — no playlist-position tracking on
/// this side yet, mpv no-ops harmlessly at either end of a playlist.
pub fn set_playback_state(has_session: bool, is_playing: bool) {
    if !THUMB_INSTALLED.load(Ordering::SeqCst) {
        return;
    }
    let hwnd_raw = THUMB_HWND.load(Ordering::SeqCst);
    if hwnd_raw == 0 {
        return;
    }
    let hwnd = HWND(hwnd_raw as *mut _);

    // Never reserved the taskbar's button-row space yet, and there's still
    // nothing playing — nothing to do, keep the thumbnail plain.
    if !BUTTONS_ADDED.load(Ordering::SeqCst) && !has_session {
        return;
    }

    let Some(taskbar) = create_taskbar_list() else {
        eprintln!("[pitflix-player] [taskbar-thumb] set_playback_state: CoCreateInstance failed");
        return;
    };

    let buttons = build_buttons(has_session, is_playing);

    unsafe {
        if !BUTTONS_ADDED.load(Ordering::SeqCst) {
            match taskbar.ThumbBarAddButtons(hwnd, &buttons) {
                Ok(()) => {
                    BUTTONS_ADDED.store(true, Ordering::SeqCst);
                    eprintln!(
                        "[pitflix-player] [taskbar-thumb] ThumbBarAddButtons ok (first session)"
                    );
                }
                Err(e) => {
                    eprintln!("[pitflix-player] [taskbar-thumb] ThumbBarAddButtons failed: {e}")
                }
            }
            return;
        }
        if let Err(e) = taskbar.ThumbBarUpdateButtons(hwnd, &buttons) {
            eprintln!("[pitflix-player] [taskbar-thumb] ThumbBarUpdateButtons failed: {e}");
        }
    }
}

/// Draws the PotPlayer-style playback-progress overlay on the taskbar icon itself
/// (`ITaskbarList3::SetProgressValue`) — distinct from the thumbnail-toolbar buttons above.
/// `fraction` is clamped to 0.0..=1.0; paused playback shows amber (`TBPF_PAUSED`) instead of
/// the normal green, matching how Explorer already colors paused file operations.
pub fn set_progress(has_session: bool, fraction: f64, is_paused: bool) {
    if !THUMB_INSTALLED.load(Ordering::SeqCst) {
        return;
    }
    let hwnd_raw = THUMB_HWND.load(Ordering::SeqCst);
    if hwnd_raw == 0 {
        return;
    }
    let hwnd = HWND(hwnd_raw as *mut _);

    let Some(taskbar) = create_taskbar_list() else {
        return;
    };

    unsafe {
        if !has_session {
            let _ = taskbar.SetProgressState(hwnd, TBPF_NOPROGRESS);
            return;
        }
        const TOTAL: u64 = 10_000;
        let completed = (fraction.clamp(0.0, 1.0) * TOTAL as f64) as u64;
        let _ = taskbar.SetProgressState(hwnd, if is_paused { TBPF_PAUSED } else { TBPF_NORMAL });
        let _ = taskbar.SetProgressValue(hwnd, completed, TOTAL);
    }
}
