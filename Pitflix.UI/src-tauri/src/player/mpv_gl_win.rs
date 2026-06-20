//! OpenGL (WGL) + mpv render API — must run on the window thread that owns the GL context.
//!
//! **Pivot (do not revert to external `mpv --wid`):** if logs show WGL + `mpv_render_context_render`
//! succeeding but the composited window stays black, the next backend to try is **OpenGL via ANGLE**
//! (EGL + `libGLESv2.dll`) or **mpv’s D3D11 render API**, not more Win32 z-order tweaks.

use std::{
  ffi::{c_char, c_int, c_void, CString},
  ptr,
  sync::atomic::{AtomicBool, AtomicU64, Ordering},
  sync::{Mutex, OnceLock},
};

use windows::Win32::{
  Foundation::{GetLastError, HWND},
  Graphics::Gdi::{GetDC, HDC, ReleaseDC},
  Graphics::OpenGL::{
    wglCreateContext, wglDeleteContext, wglGetProcAddress, wglMakeCurrent, ChoosePixelFormat, DescribePixelFormat,
    SetPixelFormat, SwapBuffers, HGLRC, PIXELFORMATDESCRIPTOR, PFD_DOUBLEBUFFER, PFD_DRAW_TO_WINDOW, PFD_SUPPORT_OPENGL,
    PFD_TYPE_RGBA,
  },
  System::LibraryLoader::{GetModuleHandleW, GetProcAddress},
  System::Threading::GetCurrentThreadId,
  UI::WindowsAndMessaging::PostMessageW,
};

use windows::core::{w, PCSTR};

use super::libmpv::{
  mpv_opengl_fbo, mpv_opengl_init_params, mpv_render_context, mpv_render_param, LibMpv, MpvClient,
  MPV_RENDER_API_TYPE_OPENGL, MPV_RENDER_PARAM_API_TYPE, MPV_RENDER_PARAM_FLIP_Y,
  MPV_RENDER_PARAM_INVALID, MPV_RENDER_PARAM_OPENGL_FBO, MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
};
use super::tauri_commands::append_player_debug_log;

pub use super::libmpv::MPV_RENDER_UPDATE_FRAME;

/// Posted to the video `HWND` when libmpv requests a new frame / redraw.
pub const WM_MPV_RENDER: u32 = windows::Win32::UI::WindowsAndMessaging::WM_USER + 101;

// --- Hard render-path counters (see `[libmpv-render-path]` logs) ---
static PATH_UPDATE_CB_FIRES: AtomicU64 = AtomicU64::new(0);
static PATH_POST_WM_OK: AtomicU64 = AtomicU64::new(0);
static PATH_POST_WM_FAIL: AtomicU64 = AtomicU64::new(0);
static PATH_WM_MPV_RENDER_RECV: AtomicU64 = AtomicU64::new(0);
static PATH_RENDER_CONTEXT_RENDER_OK: AtomicU64 = AtomicU64::new(0);
static PATH_SKIP_NO_UPDATE_FRAME: AtomicU64 = AtomicU64::new(0);
static PATH_MAKE_CURRENT_FAIL: AtomicU64 = AtomicU64::new(0);

static RENDER_FRAME_COUNT: AtomicU64 = AtomicU64::new(0);
static LAST_RENDER_ERROR: Mutex<Option<String>> = Mutex::new(None);
static FIRST_SUCCESS_RENDER_LOGGED: AtomicBool = AtomicBool::new(false);

/// For `player2_get_state` — successful full swap cycles (libmpv GL path).
pub fn render_health_snapshot() -> (u64, Option<String>) {
  let n = RENDER_FRAME_COUNT.load(Ordering::Relaxed);
  let err = LAST_RENDER_ERROR.lock().ok().and_then(|g| g.clone());
  (n, err)
}

pub fn record_render_path_error(context: &str, detail: &str) {
  let line = format!("[libmpv-render-path] {context} {detail}");
  if let Ok(mut g) = LAST_RENDER_ERROR.lock() {
    *g = Some(format!("{context}: {detail}"));
  }
  libmpv_render_diag_log(&line);
}

pub(crate) fn record_render_success_after_swap(video_hwnd: HWND, w: i32, h: i32) {
  if let Ok(mut g) = LAST_RENDER_ERROR.lock() {
    *g = None;
  }
  RENDER_FRAME_COUNT.fetch_add(1, Ordering::Relaxed);
  if !FIRST_SUCCESS_RENDER_LOGGED.swap(true, Ordering::SeqCst) {
    libmpv_render_diag_log(&format!(
      "RENDER SUCCESS: first frame rendered, size={w}x{h}"
    ));
    unsafe {
      use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOW};
      let _ = ShowWindow(video_hwnd, SW_SHOW);
    }
  }
}

/// Cumulative `WM_MPV_RENDER` deliveries (for “never vs repeated” `render_frame`).
pub fn render_path_wm_mpv_render_recv_total() -> u64 {
  PATH_WM_MPV_RENDER_RECV.load(Ordering::Relaxed)
}

/// Successful `mpv_render_context_render` completions (same as “render_frame ran to GL”).
pub fn render_path_render_complete_total() -> u64 {
  PATH_RENDER_CONTEXT_RENDER_OK.load(Ordering::Relaxed)
}

pub fn render_path_note_wm_mpv_render_received() {
  PATH_WM_MPV_RENDER_RECV.fetch_add(1, Ordering::Relaxed);
}

pub fn render_path_note_render_context_render_ok() {
  PATH_RENDER_CONTEXT_RENDER_OK.fetch_add(1, Ordering::Relaxed);
}

pub fn render_path_note_skip_no_update_frame() {
  PATH_SKIP_NO_UPDATE_FRAME.fetch_add(1, Ordering::Relaxed);
}

pub fn render_path_note_make_current_fail() {
  PATH_MAKE_CURRENT_FAIL.fetch_add(1, Ordering::Relaxed);
}

pub fn render_path_log_summary(tag: &str) {
  let u = PATH_UPDATE_CB_FIRES.load(Ordering::Relaxed);
  let recv = PATH_WM_MPV_RENDER_RECV.load(Ordering::Relaxed);
  let ok = PATH_RENDER_CONTEXT_RENDER_OK.load(Ordering::Relaxed);
  let ratio = if recv == 0 {
    "n/a".to_string()
  } else {
    format!("{:.2}", ok as f64 / recv as f64)
  };
  libmpv_render_diag_log(&format!(
    "[libmpv-render-path] SUMMARY {tag} update_cb_fires={} post_ok={} post_fail={} wm_recv={} render_ok={} render_ok_per_wm_recv={} skip_no_MPV_RENDER_UPDATE_FRAME={} make_current_fail={}",
    PATH_UPDATE_CB_FIRES.load(Ordering::Relaxed),
    PATH_POST_WM_OK.load(Ordering::Relaxed),
    PATH_POST_WM_FAIL.load(Ordering::Relaxed),
    PATH_WM_MPV_RENDER_RECV.load(Ordering::Relaxed),
    PATH_RENDER_CONTEXT_RENDER_OK.load(Ordering::Relaxed),
    ratio,
    PATH_SKIP_NO_UPDATE_FRAME.load(Ordering::Relaxed),
    PATH_MAKE_CURRENT_FAIL.load(Ordering::Relaxed),
  ));
  if u > 0 && ok == 0 {
    libmpv_render_diag_log(
      "[libmpv-render-path] SUMMARY note: render_ok=0 — mpv_render_context_render never completed successfully (check flags / make_current / zero client rect)",
    );
  } else if u > 50 && ok > 0 && ok < u / 10 {
    libmpv_render_diag_log(
      "[libmpv-render-path] SUMMARY note: many update callbacks but relatively few completed GL renders — compare update_cb_fires vs render_ok",
    );
  }
}

fn libmpv_render_diag_log(line: &str) {
  // Intentionally avoids requiring an `AppHandle` — diagnostics must work from window threads.
  append_player_debug_log(None, line);
}

type GlGetErrorFn = unsafe extern "system" fn() -> isize;

/// Resolve `glGetError` once from `opengl32.dll` (not `wglGetProcAddress`).
/// Some drivers return a non-callable pointer from `wglGetProcAddress("glGetError")`, which can
/// trigger **FastFail / `STATUS_STACK_BUFFER_OVERRUN`** when invoked.
static GL_GET_ERROR_FN: OnceLock<Option<GlGetErrorFn>> = OnceLock::new();

pub fn gl_log_get_error(tag: &str) {
  let f = GL_GET_ERROR_FN.get_or_init(|| unsafe {
    let Ok(m) = GetModuleHandleW(w!("opengl32.dll")) else {
      return None;
    };
    if m.is_invalid() {
      return None;
    }
    GetProcAddress(m, PCSTR::from_raw(b"glGetError\0".as_ptr().cast()))
  });
  let Some(proc) = *f else {
    libmpv_render_diag_log(&format!(
      "[libmpv-render-path] glGetError after {tag} skipped (GetProcAddress opengl32!glGetError failed)"
    ));
    return;
  };
  // Requires a current GL context (we only call this after make_current / render / swap).
  let code = unsafe { proc() as u32 };
  libmpv_render_diag_log(&format!(
    "[libmpv-render-path] glGetError after {tag} code=0x{code:x}"
  ));
}

/// Per-frame GL binding: **fresh `GetDC`** + `wglMakeCurrent` + `ReleaseDC` on drop (HDC is not cached across `SetParent`).
pub struct GlCurrentGuard {
  hwnd: HWND,
  hdc: HDC,
  hglrc: HGLRC,
}

impl GlCurrentGuard {
  #[inline]
  pub fn hdc(&self) -> HDC {
    self.hdc
  }

  pub fn swap_buffers(&self) -> Result<(), String> {
    unsafe {
      SwapBuffers(self.hdc).map_err(|e| format!("SwapBuffers: {e}"))?;
    }
    Ok(())
  }
}

impl Drop for GlCurrentGuard {
  fn drop(&mut self) {
    unsafe {
      let _ = wglMakeCurrent(
        windows::Win32::Graphics::Gdi::HDC::default(),
        HGLRC::default(),
      );
      let _ = ReleaseDC(Some(self.hwnd), self.hdc);
    }
  }
}

pub struct GlContext {
  hwnd: HWND,
  hglrc: HGLRC,
  /// Thread that created the GL context — must match `WM_MPV_RENDER` handler thread.
  pub window_thread_id: u32,
}

impl GlContext {
  pub fn hwnd(&self) -> HWND {
    self.hwnd
  }

  pub fn create(hwnd: HWND) -> Result<Self, String> {
    unsafe {
      let window_thread_id = GetCurrentThreadId();
      let hdc = GetDC(Some(hwnd));
      if hdc.is_invalid() {
        return Err("GetDC failed for GL".to_string());
      }

      let mut pfd: PIXELFORMATDESCRIPTOR = std::mem::zeroed();
      pfd.nSize = std::mem::size_of::<PIXELFORMATDESCRIPTOR>() as u16;
      pfd.nVersion = 1;
      pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
      pfd.iPixelType = PFD_TYPE_RGBA;
      pfd.cColorBits = 32;
      pfd.cDepthBits = 24;
      pfd.cStencilBits = 8;

      let pf = ChoosePixelFormat(hdc, &pfd);
      if pf == 0 {
        let _ = ReleaseDC(Some(hwnd), hdc);
        let err = windows::core::Error::from_win32();
        libmpv_render_diag_log(&format!(
          "[libmpv-render-path] ChoosePixelFormat failed win32={err:?} (check PFD.nSize / flags)"
        ));
        return Err(format!("ChoosePixelFormat failed: {err:?}"));
      }
      let mut actual = PIXELFORMATDESCRIPTOR::default();
      if DescribePixelFormat(
        hdc,
        pf,
        std::mem::size_of::<PIXELFORMATDESCRIPTOR>() as u32,
        Some(&mut actual as *mut _),
      ) == 0
      {
        let _ = ReleaseDC(Some(hwnd), hdc);
        let err = windows::core::Error::from_win32();
        libmpv_render_diag_log(&format!(
          "[libmpv-render-path] DescribePixelFormat failed win32={err:?}"
        ));
        return Err(format!("DescribePixelFormat failed: {err:?}"));
      }
      if let Err(e) = SetPixelFormat(hdc, pf, &actual) {
        let _ = ReleaseDC(Some(hwnd), hdc);
        libmpv_render_diag_log(&format!(
          "[libmpv-render-path] SetPixelFormat failed e={e:?} pf={pf} (PFD must include PFD_SUPPORT_OPENGL|PFD_DRAW_TO_WINDOW|PFD_DOUBLEBUFFER)"
        ));
        return Err(format!("SetPixelFormat failed: {e:?}"));
      }

      let hglrc_legacy = wglCreateContext(hdc).map_err(|e| format!("wglCreateContext: {e}"))?;
      if wglMakeCurrent(hdc, hglrc_legacy).is_err() {
        let _ = wglDeleteContext(hglrc_legacy);
        let _ = ReleaseDC(Some(hwnd), hdc);
        return Err("wglMakeCurrent failed".to_string());
      }

      // libmpv’s OpenGL backend expects a real GL version (≥2.1). Promote to 3.2 compatibility when
      // `wglCreateContextAttribsARB` is available (the legacy `wglCreateContext` path is often 1.1-only).
      let mut hglrc = hglrc_legacy;
      let ext = CString::new("wglCreateContextAttribsARB").unwrap_or_default();
      if !ext.as_bytes_with_nul().is_empty() {
        type WglCreateContextAttribsArb = unsafe extern "system" fn(
          windows::Win32::Graphics::Gdi::HDC,
          windows::Win32::Graphics::OpenGL::HGLRC,
          *const c_int,
        ) -> windows::Win32::Graphics::OpenGL::HGLRC;
        let proc_gen = wglGetProcAddress(PCSTR::from_raw(ext.as_ptr().cast()));
        if let Some(p) = proc_gen {
          // Cast through `*const ()` — transmuting between fn pointer types can trip CFG/stack checks.
          let wgl_create_context_attribs_arb: WglCreateContextAttribsArb =
            std::mem::transmute(p as *const ());
          const WGL_CONTEXT_MAJOR_VERSION_ARB: i32 = 0x2091;
          const WGL_CONTEXT_MINOR_VERSION_ARB: i32 = 0x2092;
          const WGL_CONTEXT_PROFILE_MASK_ARB: i32 = 0x9126;
          const WGL_CONTEXT_COMPATIBILITY_PROFILE_BIT_ARB: i32 = 0x0000_0002;
          let attribs: [c_int; 7] = [
            WGL_CONTEXT_MAJOR_VERSION_ARB,
            3,
            WGL_CONTEXT_MINOR_VERSION_ARB,
            2,
            WGL_CONTEXT_PROFILE_MASK_ARB,
            WGL_CONTEXT_COMPATIBILITY_PROFILE_BIT_ARB,
            0,
          ];
          let share = windows::Win32::Graphics::OpenGL::HGLRC(std::ptr::null_mut());
          let h2 = wgl_create_context_attribs_arb(hdc, share, attribs.as_ptr());
          if !h2.is_invalid() {
            let _ = wglMakeCurrent(
              windows::Win32::Graphics::Gdi::HDC::default(),
              windows::Win32::Graphics::OpenGL::HGLRC::default(),
            );
            let _ = wglDeleteContext(hglrc);
            hglrc = h2;
            if wglMakeCurrent(hdc, hglrc).is_err() {
              let _ = wglDeleteContext(hglrc);
              let _ = ReleaseDC(Some(hwnd), hdc);
              return Err("wglMakeCurrent after ARB context failed".to_string());
            }
            libmpv_render_diag_log(
              "[libmpv-render] WGL OpenGL 3.2 compatibility context via wglCreateContextAttribsARB",
            );
          } else {
            libmpv_render_diag_log(
              "[libmpv-render] WGL wglCreateContextAttribsARB failed; keeping legacy wglCreateContext",
            );
          }
        } else {
          libmpv_render_diag_log(
            "[libmpv-render] WGL wglCreateContextAttribsARB not found; keeping legacy wglCreateContext",
          );
        }
      }

      libmpv_render_diag_log(
        "[libmpv-render-path] WGL active (Phase-1 desktop GL + mpv opengl render API); see SUMMARY lines for frame cadence",
      );
      // Do **not** keep HDC after setup — parent may change (`SetParent`); acquire fresh DC each frame.
      let _ = wglMakeCurrent(
        windows::Win32::Graphics::Gdi::HDC::default(),
        HGLRC::default(),
      );
      let _ = ReleaseDC(Some(hwnd), hdc);
      Ok(Self {
        hwnd,
        hglrc,
        window_thread_id,
      })
    }
  }

  /// Fresh `GetDC` + `wglMakeCurrent` for this frame; `ReleaseDC` in guard drop.
  pub fn make_current_guard(&self) -> Result<GlCurrentGuard, String> {
    unsafe {
      let hdc = GetDC(Some(self.hwnd));
      if hdc.is_invalid() {
        return Err(format!(
          "GetDC failed (hwnd=0x{:x}) — window may be destroyed or not ready",
          self.hwnd.0 as usize
        ));
      }
      if wglMakeCurrent(hdc, self.hglrc).is_err() {
        let _ = ReleaseDC(Some(self.hwnd), hdc);
        let err = GetLastError();
        render_path_note_make_current_fail();
        return Err(format!("wglMakeCurrent failed: {err:?}"));
      }
      static MAKE_CURRENT_OK_N: AtomicU64 = AtomicU64::new(0);
      let n = MAKE_CURRENT_OK_N.fetch_add(1, Ordering::Relaxed);
      if n < 48 {
        libmpv_render_diag_log("[libmpv-render-path] make_current OK (fresh GetDC)");
      }
      Ok(GlCurrentGuard {
        hwnd: self.hwnd,
        hdc,
        hglrc: self.hglrc,
      })
    }
  }
}

impl Drop for GlContext {
  fn drop(&mut self) {
    unsafe {
      let _ = wglMakeCurrent(
        windows::Win32::Graphics::Gdi::HDC::default(),
        HGLRC::default(),
      );
      let _ = wglDeleteContext(self.hglrc);
    }
  }
}

/// Passed to libmpv's render update callback — must outlive `mpv_render_context` until `MpvGlRenderer` drops.
#[repr(C)]
pub struct MpvUpdateCbCtx {
  pub hwnd: usize,
  pub session_id: u64,
}

unsafe extern "C" fn get_gl_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
  if name.is_null() {
    return ptr::null_mut();
  }
  if let Some(p) = wglGetProcAddress(PCSTR::from_raw(name.cast())) {
    return p as *mut c_void;
  }
  let Ok(mod_gl) = GetModuleHandleW(windows::core::w!("opengl32.dll")) else {
    return ptr::null_mut();
  };
  if mod_gl.is_invalid() {
    return ptr::null_mut();
  }
  GetProcAddress(mod_gl, PCSTR::from_raw(name.cast()))
    .map(|p| p as *mut c_void)
    .unwrap_or(ptr::null_mut())
}

/// Owns `mpv_render_context` and GL; must be used only on the window thread.
pub struct MpvGlRenderer {
  api: std::sync::Arc<LibMpv>,
  gl: GlContext,
  render: *mut mpv_render_context,
  window_thread_id: u32,
  pub session_id: u64,
  /// Freed in `Drop` — libmpv update callback points here.
  update_ctx: *mut MpvUpdateCbCtx,
}

impl MpvGlRenderer {
  #[inline]
  pub fn window_thread_id(&self) -> u32 {
    self.window_thread_id
  }

  pub fn new(client: &MpvClient, gl: GlContext, video_hwnd: HWND, session_id: u64) -> Result<Self, String> {
    let api = client.api_arc();
    let window_thread_id = gl.window_thread_id;
    let _init_guard = gl.make_current_guard()?;

    let mut init = mpv_opengl_init_params {
      get_proc_address: Some(get_gl_proc_address),
      get_proc_address_ctx: ptr::null_mut(),
    };

    let api_type = CString::new(MPV_RENDER_API_TYPE_OPENGL).map_err(|e| e.to_string())?;

    let mut params: [mpv_render_param; 3] = unsafe { std::mem::zeroed() };
    params[0].type_ = MPV_RENDER_PARAM_API_TYPE;
    params[0].data = api_type.as_ptr() as *mut c_void;
    params[1].type_ = MPV_RENDER_PARAM_OPENGL_INIT_PARAMS;
    params[1].data = (&mut init) as *mut _ as *mut c_void;
    params[2].type_ = MPV_RENDER_PARAM_INVALID;
    params[2].data = ptr::null_mut();

    let mut render: *mut mpv_render_context = ptr::null_mut();
    let rc = unsafe {
      (api.mpv_render_context_create)(&mut render, client.raw_handle(), params.as_mut_ptr())
    };
    libmpv_render_diag_log(&format!(
      "[libmpv-render-path] mpv_render_context_create rc={rc} render_ctx_null={}",
      render.is_null()
    ));
    if rc < 0 || render.is_null() {
      return Err(format!("mpv_render_context_create failed: rc={rc} render_null={}", render.is_null()));
    }

    let update_ctx = Box::new(MpvUpdateCbCtx {
      hwnd: video_hwnd.0 as usize,
      session_id,
    });
    let update_ctx_ptr = Box::into_raw(update_ctx);
    // Do NOT set the update callback here. It must be armed only AFTER mpv_initialize()
    // returns. If the callback is live during mpv_initialize(), COM audio init pumps the
    // Win32 message queue, dispatching the already-queued WM_MPV_RENDER back into
    // on_wm_mpv_render → mpv_render_context_render while mpv_initialize() is still on the
    // call stack → undefined behaviour → STATUS_STACK_BUFFER_OVERRUN.
    // Call arm_update_callback() after mpv_initialize() to enable rendering.

    Ok(Self {
      api,
      gl,
      render,
      window_thread_id,
      session_id,
      update_ctx: update_ctx_ptr,
    })
  }

  /// Arm the mpv render-update callback. **Must** be called after `mpv_initialize()` to
  /// prevent re-entrant `WM_MPV_RENDER` dispatch inside `mpv_initialize()` (see `new()`).
  ///
  /// # Safety
  /// Caller must ensure `mpv_initialize()` has already completed successfully.
  pub unsafe fn arm_update_callback(&self) {
    (self.api.mpv_render_context_set_update_callback)(
      self.render,
      Some(mpv_on_update),
      self.update_ctx as *mut c_void,
    );
    libmpv_render_diag_log("[libmpv-render-path] arm_update_callback: update callback registered (after mpv_initialize)");
  }

  #[inline]
  pub fn make_current_guard(&self) -> Result<GlCurrentGuard, String> {
    self.gl.make_current_guard()
  }

  /// Query libmpv's render update flags (assumes a GL context is already current).
  pub fn render_context_update_flags_current(&self) -> Result<u64, String> {
    let flags = unsafe { (self.api.mpv_render_context_update)(self.render) };
    Ok(flags)
  }

  pub fn render_frame_with_flags(&self, flags: u64, width: i32, height: i32) -> Result<(), String> {
    if width <= 0 || height <= 0 {
      return Ok(());
    }
    if flags == 0 || (flags & MPV_RENDER_UPDATE_FRAME) == 0 {
      return Ok(());
    }

    let mut fbo = mpv_opengl_fbo {
      fbo: 0,
      w: width,
      h: height,
      internal_format: 0,
    };
    let mut flip: i32 = 1;

    let mut rparams: [mpv_render_param; 3] = unsafe { std::mem::zeroed() };
    rparams[0].type_ = MPV_RENDER_PARAM_OPENGL_FBO;
    rparams[0].data = (&mut fbo) as *mut _ as *mut c_void;
    rparams[1].type_ = MPV_RENDER_PARAM_FLIP_Y;
    rparams[1].data = (&mut flip) as *mut _ as *mut c_void;
    rparams[2].type_ = MPV_RENDER_PARAM_INVALID;
    rparams[2].data = ptr::null_mut();

    libmpv_render_diag_log(&format!(
      "[libmpv-render-path] mpv_render_context_render begin fbo=0 w={width} h={height} flags=0x{flags:x}"
    ));
    let rc = unsafe { (self.api.mpv_render_context_render)(self.render, rparams.as_mut_ptr()) };
    libmpv_render_diag_log(&format!(
      "[libmpv-render-path] mpv_render_context_render end rc={rc}"
    ));
    if rc < 0 {
      record_render_path_error("mpv_render_context_render", &format!("rc={rc}"));
      return Err(format!("mpv_render_context_render failed: {rc}"));
    }
    render_path_note_render_context_render_ok();
    Ok(())
  }

  pub fn swap_buffers_logged(&self, guard: &GlCurrentGuard, phase: &str) -> Result<(), String> {
    libmpv_render_diag_log(&format!(
      "[libmpv-render-path] SwapBuffers begin phase={phase}"
    ));
    let r = guard.swap_buffers();
    libmpv_render_diag_log(&format!(
      "[libmpv-render-path] SwapBuffers end phase={phase} ok={}",
      r.is_ok()
    ));
    r
  }

  pub fn report_swap(&self) {
    unsafe {
      (self.api.mpv_render_context_report_swap)(self.render);
    }
  }
}

unsafe extern "C" fn mpv_on_update(ctx: *mut c_void) {
  if ctx.is_null() {
    return;
  }
  let cb = &*(ctx as *const MpvUpdateCbCtx);
  if cb.hwnd == 0 {
    return;
  }
  let hwnd_dest = HWND(cb.hwnd as *mut c_void);
  let session_wparam = cb.session_id as usize;
  let u = PATH_UPDATE_CB_FIRES.fetch_add(1, Ordering::Relaxed) + 1;
  let hard = u <= 25 || u % 120 == 0;
  if hard {
    libmpv_render_diag_log(&format!(
      "[libmpv-render-path] update callback fired n={u} hwnd=0x{:x} session_id={} (next: PostMessageW WM_MPV_RENDER)",
      cb.hwnd, cb.session_id
    ));
  }
  // Must be PostMessageW (never SendMessageW): callback can run on an arbitrary mpv thread.
  let post = PostMessageW(
    Some(hwnd_dest),
    WM_MPV_RENDER,
    windows::Win32::Foundation::WPARAM(session_wparam),
    windows::Win32::Foundation::LPARAM(0),
  );
  let ok = post.is_ok();
  if ok {
    PATH_POST_WM_OK.fetch_add(1, Ordering::Relaxed);
  } else {
    PATH_POST_WM_FAIL.fetch_add(1, Ordering::Relaxed);
  }
  if hard {
    libmpv_render_diag_log(&format!(
      "[libmpv-render-path] WM_MPV_RENDER posted hwnd=0x{:x} PostMessageW_ok={ok}",
      cb.hwnd
    ));
  }
  if u.is_multiple_of(200) {
    render_path_log_summary(&format!("every200_updates n={u}"));
  }
}

impl Drop for MpvGlRenderer {
  fn drop(&mut self) {
    unsafe {
      if let Ok(_g) = self.gl.make_current_guard() {
        if !self.render.is_null() {
          (self.api.mpv_render_context_set_update_callback)(self.render, None, ptr::null_mut());
          (self.api.mpv_render_context_free)(self.render);
          self.render = ptr::null_mut();
        }
      }
      if !self.update_ctx.is_null() {
        drop(Box::from_raw(self.update_ctx));
        self.update_ctx = ptr::null_mut();
      }
    }
  }
}
