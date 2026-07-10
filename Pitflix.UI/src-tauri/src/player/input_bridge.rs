//! Bridges mouse input over the embedded player window back to the UI.
//!
//! WebView2 often never sees `contextmenu` / right-click over embedded video pixels.
//! While the player session is active we track the main window in screen space and use a
//! low-level mouse hook to emit `player2-video-contextmenu` for any right-click inside it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;

use tauri::{AppHandle, Emitter};
use windows::Win32::{
  Foundation::{HWND, HINSTANCE, LPARAM, LRESULT, POINT, RECT, WPARAM},
  Graphics::Gdi::ClientToScreen,
  System::LibraryLoader::GetModuleHandleW,
  UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
  UI::WindowsAndMessaging::{
    CallNextHookEx, GetWindowRect, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION, HHOOK,
    MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_CONTEXTMENU, WM_RBUTTONDOWN, WM_RBUTTONUP,
  },
};

static BRIDGE_APP: Mutex<Option<AppHandle>> = Mutex::new(None);
static MAIN_HWND: Mutex<isize> = Mutex::new(0);
static VIDEO_SCREEN_RECT: Mutex<Option<RECT>> = Mutex::new(None);
static MOUSE_HOOK: Mutex<isize> = Mutex::new(0);
static HOOK_INSTALLED: AtomicBool = AtomicBool::new(false);

const MAIN_INPUT_SUBCLASS_ID: usize = 0xA1B2_C3D6;

#[derive(Clone, Serialize)]
struct ContextMenuPoint {
  x: i32,
  y: i32,
}

fn emit_video_context_menu_at(pt: POINT) {
  if let Ok(g) = BRIDGE_APP.lock() {
    if let Some(app) = g.as_ref() {
      let _ = app.emit(
        "player2-video-contextmenu",
        ContextMenuPoint { x: pt.x, y: pt.y },
      );
    }
  }
}

fn emit_video_context_menu() {
  emit_video_context_menu_at(POINT { x: 0, y: 0 });
}

fn main_window_screen_rect() -> Option<RECT> {
  let hwnd = MAIN_HWND.lock().map(|g| *g).unwrap_or(0);
  if hwnd == 0 {
    return None;
  }
  unsafe {
    let hwnd = HWND(hwnd as *mut _);
    let mut rect = RECT::default();
    if GetWindowRect(hwnd, &mut rect).is_err() {
      return None;
    }
    Some(rect)
  }
}

fn point_in_rect(pt: POINT, r: &RECT) -> bool {
  pt.x >= r.left && pt.x < r.right && pt.y >= r.top && pt.y < r.bottom
}

fn point_in_player_surface(pt: POINT) -> bool {
  if let Some(r) = main_window_screen_rect() {
    if point_in_rect(pt, &r) {
      return true;
    }
  }
  if let Ok(g) = VIDEO_SCREEN_RECT.lock() {
    if let Some(r) = g.as_ref() {
      return point_in_rect(pt, r);
    }
  }
  false
}

unsafe extern "system" fn low_level_mouse_proc(
  code: i32,
  wparam: WPARAM,
  lparam: LPARAM,
) -> LRESULT {
  if code == HC_ACTION as i32 {
    let msg = wparam.0 as u32;
    if msg == WM_RBUTTONUP || msg == WM_RBUTTONDOWN {
      let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
      if point_in_player_surface(info.pt) {
        if msg == WM_RBUTTONUP {
          emit_video_context_menu_at(info.pt);
        }
      }
    }
  }
  let hook = MOUSE_HOOK.lock().map(|g| *g).unwrap_or(0);
  if hook != 0 {
    CallNextHookEx(Some(HHOOK(hook as *mut _)), code, wparam, lparam)
  } else {
    LRESULT(0)
  }
}

fn install_mouse_hook() {
  if HOOK_INSTALLED.swap(true, Ordering::SeqCst) {
    return;
  }
  unsafe {
    let module = GetModuleHandleW(None).ok().map(|m| HINSTANCE(m.0));
    let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(low_level_mouse_proc), module, 0);
    match hook {
      Ok(h) => {
        if let Ok(mut g) = MOUSE_HOOK.lock() {
          *g = h.0 as isize;
        }
      }
      Err(_) => {
        HOOK_INSTALLED.store(false, Ordering::SeqCst);
      }
    }
  }
}

fn uninstall_mouse_hook() {
  if !HOOK_INSTALLED.swap(false, Ordering::SeqCst) {
    return;
  }
  if let Ok(mut g) = MOUSE_HOOK.lock() {
    let hook = *g;
    *g = 0;
    if hook != 0 {
      unsafe {
        let _ = UnhookWindowsHookEx(HHOOK(hook as *mut _));
      }
    }
  }
  clear_video_hit_rect();
  if let Ok(mut g) = MAIN_HWND.lock() {
    *g = 0;
  }
}

/// Screen-space hit target for the embedded video (physical client pixels).
pub fn update_video_hit_rect(parent_hwnd: HWND, x: i32, y: i32, w: i32, h: i32) {
  if w <= 0 || h <= 0 {
    return;
  }
  unsafe {
    let mut tl = POINT { x, y };
    let mut br = POINT { x: x + w, y: y + h };
    let _ = ClientToScreen(parent_hwnd, &mut tl);
    let _ = ClientToScreen(parent_hwnd, &mut br);
    if let Ok(mut g) = VIDEO_SCREEN_RECT.lock() {
      *g = Some(RECT {
        left: tl.x,
        top: tl.y,
        right: br.x,
        bottom: br.y,
      });
    }
  }
}

pub fn clear_video_hit_rect() {
  if let Ok(mut g) = VIDEO_SCREEN_RECT.lock() {
    *g = None;
  }
}

unsafe extern "system" fn main_input_subclass_proc(
  hwnd: HWND,
  msg: u32,
  wparam: WPARAM,
  lparam: LPARAM,
  _id: usize,
  _data: usize,
) -> LRESULT {
  if msg == WM_RBUTTONUP || msg == WM_CONTEXTMENU {
    emit_video_context_menu();
  }
  DefSubclassProc(hwnd, msg, wparam, lparam)
}

pub fn install_main_input_bridge(app: AppHandle, main_hwnd: HWND) {
  if let Ok(mut g) = BRIDGE_APP.lock() {
    *g = Some(app);
  }
  if let Ok(mut g) = MAIN_HWND.lock() {
    *g = main_hwnd.0 as isize;
  }
  install_mouse_hook();
  unsafe {
    let _ = SetWindowSubclass(
      main_hwnd,
      Some(main_input_subclass_proc),
      MAIN_INPUT_SUBCLASS_ID,
      0,
    );
  }
}

pub fn uninstall_main_input_bridge(main_hwnd: HWND) {
  unsafe {
    let _ = RemoveWindowSubclass(
      main_hwnd,
      Some(main_input_subclass_proc),
      MAIN_INPUT_SUBCLASS_ID,
    );
  }
  uninstall_mouse_hook();
  if let Ok(mut g) = BRIDGE_APP.lock() {
    *g = None;
  }
}
