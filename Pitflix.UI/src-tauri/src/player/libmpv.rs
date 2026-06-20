//! libmpv dynamic load + render API (OpenGL) bindings.
#![allow(non_camel_case_types)] // C API / FFI names (`mpv_*`, `MPV_*`).

use std::{
  ffi::{c_char, c_int, c_void, CString},
  path::Path,
  ptr,
  sync::Arc,
};

use libloading::Library;
use serde_json::Value;

#[repr(C)]
pub struct mpv_handle {
  _private: [u8; 0],
}

#[repr(C)]
pub struct mpv_render_context {
  _private: [u8; 0],
}

#[repr(C)]
pub struct mpv_event {
  pub event_id: c_int,
  pub error: c_int,
  pub reply_userdata: u64,
  pub data: *mut c_void,
}

#[repr(C)]
pub struct mpv_render_param {
  pub type_: i32,
  pub data: *mut c_void,
}

#[repr(C)]
pub struct mpv_opengl_init_params {
  pub get_proc_address: Option<unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void>,
  pub get_proc_address_ctx: *mut c_void,
}

#[repr(C)]
pub struct mpv_opengl_fbo {
  pub fbo: i32,
  pub w: i32,
  pub h: i32,
  pub internal_format: i32,
}

#[allow(dead_code)]
#[repr(C)]
#[derive(Copy, Clone)]
pub enum mpv_format {
  MPV_FORMAT_NONE = 0,
  MPV_FORMAT_STRING = 1,
  MPV_FORMAT_FLAG = 3,
  MPV_FORMAT_INT64 = 4,
  MPV_FORMAT_DOUBLE = 5,
  /// Structured property (e.g. `video-params`).
  MPV_FORMAT_NODE = 6,
}

pub const MPV_RENDER_API_TYPE_OPENGL: &str = "opengl";

pub const MPV_RENDER_PARAM_INVALID: i32 = 0;
pub const MPV_RENDER_PARAM_API_TYPE: i32 = 1;
pub const MPV_RENDER_PARAM_OPENGL_INIT_PARAMS: i32 = 2;
pub const MPV_RENDER_PARAM_OPENGL_FBO: i32 = 3;
pub const MPV_RENDER_PARAM_FLIP_Y: i32 = 4;

pub const MPV_RENDER_UPDATE_FRAME: u64 = 1 << 0;

/// `mpv_event_id::MPV_EVENT_SHUTDOWN` — core stops processing commands reliably without a `mpv_wait_event` loop.
pub const MPV_EVENT_SHUTDOWN: c_int = 11;

// Minimal event ids for Phase 1.
pub const MPV_EVENT_NONE: c_int = 0;
pub const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

#[repr(C)]
pub struct mpv_event_property {
  pub name: *const c_char,
  pub format: mpv_format,
  pub data: *mut c_void,
}

type mpv_create_fn = unsafe extern "C" fn() -> *mut mpv_handle;
type mpv_initialize_fn = unsafe extern "C" fn(*mut mpv_handle) -> c_int;
type mpv_terminate_destroy_fn = unsafe extern "C" fn(*mut mpv_handle);
type mpv_set_option_string_fn = unsafe extern "C" fn(*mut mpv_handle, *const c_char, *const c_char) -> c_int;
type mpv_command_fn = unsafe extern "C" fn(*mut mpv_handle, *const *const c_char) -> c_int;
type mpv_set_property_fn =
  unsafe extern "C" fn(*mut mpv_handle, *const c_char, c_int, *mut c_void) -> c_int;
type mpv_get_property_fn =
  unsafe extern "C" fn(*mut mpv_handle, *const c_char, c_int, *mut c_void) -> c_int;
type mpv_observe_property_fn =
  unsafe extern "C" fn(*mut mpv_handle, u64, *const c_char, mpv_format) -> c_int;
type mpv_wait_event_fn = unsafe extern "C" fn(*mut mpv_handle, f64) -> *const mpv_event;
type mpv_free_fn = unsafe extern "C" fn(*mut c_void);

type mpv_render_context_create_fn =
  unsafe extern "C" fn(*mut *mut mpv_render_context, *mut mpv_handle, *mut mpv_render_param) -> c_int;
type mpv_render_context_free_fn = unsafe extern "C" fn(*mut mpv_render_context);
type mpv_render_context_set_update_callback_fn =
  unsafe extern "C" fn(*mut mpv_render_context, Option<unsafe extern "C" fn(*mut c_void)>, *mut c_void);
type mpv_render_context_update_fn = unsafe extern "C" fn(*mut mpv_render_context) -> u64;
type mpv_render_context_render_fn = unsafe extern "C" fn(*mut mpv_render_context, *mut mpv_render_param) -> c_int;
type mpv_render_context_report_swap_fn = unsafe extern "C" fn(*mut mpv_render_context);

pub struct LibMpv {
  pub mpv_create: mpv_create_fn,
  pub mpv_initialize: mpv_initialize_fn,
  pub mpv_terminate_destroy: mpv_terminate_destroy_fn,
  pub mpv_set_option_string: mpv_set_option_string_fn,
  pub mpv_command: mpv_command_fn,
  pub mpv_set_property: Option<mpv_set_property_fn>,
  pub mpv_get_property: Option<mpv_get_property_fn>,
  pub mpv_observe_property: mpv_observe_property_fn,
  pub mpv_wait_event: mpv_wait_event_fn,
  pub mpv_free: mpv_free_fn,
  pub mpv_render_context_create: mpv_render_context_create_fn,
  pub mpv_render_context_free: mpv_render_context_free_fn,
  pub mpv_render_context_set_update_callback: mpv_render_context_set_update_callback_fn,
  pub mpv_render_context_update: mpv_render_context_update_fn,
  pub mpv_render_context_render: mpv_render_context_render_fn,
  pub mpv_render_context_report_swap: mpv_render_context_report_swap_fn,
  _lib: Library,
}

pub struct MpvClient {
  pub(crate) api: Arc<LibMpv>,
  handle: *mut mpv_handle,
}

unsafe impl Send for MpvClient {}
unsafe impl Sync for MpvClient {}

impl LibMpv {
  pub fn load_at(path: &Path) -> Result<Self, String> {
    let lib = unsafe { Library::new(path) }.map_err(|e| format!("Load {}: {e}", path.display()))?;
    unsafe {
      let mpv_create = *lib.get::<mpv_create_fn>(b"mpv_create\0").map_err(|e| e.to_string())?;
      let mpv_initialize =
        *lib.get::<mpv_initialize_fn>(b"mpv_initialize\0").map_err(|e| e.to_string())?;
      let mpv_terminate_destroy = *lib
        .get::<mpv_terminate_destroy_fn>(b"mpv_terminate_destroy\0")
        .map_err(|e| e.to_string())?;
      let mpv_set_option_string = *lib
        .get::<mpv_set_option_string_fn>(b"mpv_set_option_string\0")
        .map_err(|e| e.to_string())?;
      let mpv_command = *lib.get::<mpv_command_fn>(b"mpv_command\0").map_err(|e| e.to_string())?;
      let mpv_set_property = lib.get::<mpv_set_property_fn>(b"mpv_set_property\0").ok().map(|f| *f);
      let mpv_get_property = lib.get::<mpv_get_property_fn>(b"mpv_get_property\0").ok().map(|f| *f);
      let mpv_observe_property = *lib
        .get::<mpv_observe_property_fn>(b"mpv_observe_property\0")
        .map_err(|e| e.to_string())?;
      let mpv_wait_event =
        *lib.get::<mpv_wait_event_fn>(b"mpv_wait_event\0").map_err(|e| e.to_string())?;
      let mpv_free = *lib.get::<mpv_free_fn>(b"mpv_free\0").map_err(|e| e.to_string())?;
      let mpv_render_context_create = *lib
        .get::<mpv_render_context_create_fn>(b"mpv_render_context_create\0")
        .map_err(|e| e.to_string())?;
      let mpv_render_context_free = *lib
        .get::<mpv_render_context_free_fn>(b"mpv_render_context_free\0")
        .map_err(|e| e.to_string())?;
      let mpv_render_context_set_update_callback = *lib
        .get::<mpv_render_context_set_update_callback_fn>(b"mpv_render_context_set_update_callback\0")
        .map_err(|e| e.to_string())?;
      let mpv_render_context_update = *lib
        .get::<mpv_render_context_update_fn>(b"mpv_render_context_update\0")
        .map_err(|e| e.to_string())?;
      let mpv_render_context_render = *lib
        .get::<mpv_render_context_render_fn>(b"mpv_render_context_render\0")
        .map_err(|e| e.to_string())?;
      let mpv_render_context_report_swap = *lib
        .get::<mpv_render_context_report_swap_fn>(b"mpv_render_context_report_swap\0")
        .map_err(|e| e.to_string())?;

      Ok(Self {
        mpv_create,
        mpv_initialize,
        mpv_terminate_destroy,
        mpv_set_option_string,
        mpv_command,
        mpv_set_property,
        mpv_get_property,
        mpv_observe_property,
        mpv_wait_event,
        mpv_free,
        mpv_render_context_create,
        mpv_render_context_free,
        mpv_render_context_set_update_callback,
        mpv_render_context_update,
        mpv_render_context_render,
        mpv_render_context_report_swap,
        _lib: lib,
      })
    }
  }
}

impl MpvClient {
  /// Create handle + options (`vo=libmpv`), **without** `mpv_initialize` (render context must be created first).
  pub fn create_for_render(path: &Path) -> Result<Self, String> {
    let api = Arc::new(LibMpv::load_at(path)?);
    let handle = unsafe { (api.mpv_create)() };
    if handle.is_null() {
      return Err("mpv_create returned null".to_string());
    }
    let _ = opt(&api, handle, "terminal", "no")?;
    let _ = opt(&api, handle, "input-default-bindings", "no")?;
    let _ = opt(&api, handle, "input-vo-keyboard", "no")?;
    let _ = opt(&api, handle, "volume-max", "200")?;
    let _ = opt(&api, handle, "vo", "libmpv")?;
    // Letterbox / pillarbox with black unused areas (VLC-like), not stretched video.
    let _ = opt(&api, handle, "keepaspect", "yes")?;
    // mpv 0.38+: background is a mode (color/tiles/none); color goes in background-color.
    let _ = opt(&api, handle, "background", "color")?;
    let _ = opt(&api, handle, "background-color", "#000000")?;
    // hwdec disabled: WGL render context has no D3D/DXVA GPU interop — auto-safe still
    // triggers the hardware path and corrupts the stack (STATUS_STACK_BUFFER_OVERRUN).
    let _ = opt(&api, handle, "hwdec", "no")?;
    Ok(Self { api, handle })
  }

  /// Create handle with **no** vo/render forcing — caller sets `wid`, `vo=gpu`,
  /// `gpu-api=d3d11`, etc. before `initialize()`. Matches Harbor's Windows path.
  pub fn create_minimal(path: &Path) -> Result<Self, String> {
    let api = Arc::new(LibMpv::load_at(path)?);
    let handle = unsafe { (api.mpv_create)() };
    if handle.is_null() {
      return Err("mpv_create returned null".to_string());
    }
    Ok(Self { api, handle })
  }

  pub fn initialize(&self) -> Result<(), String> {
    let rc = unsafe { (self.api.mpv_initialize)(self.handle) };
    if rc < 0 {
      return Err(format!("mpv_initialize failed: {rc}"));
    }
    Ok(())
  }

  pub fn api_arc(&self) -> Arc<LibMpv> {
    self.api.clone()
  }

  pub fn raw_handle(&self) -> *mut mpv_handle {
    self.handle
  }

  pub fn command(&self, args: &[&str]) -> Result<(), String> {
    let mut cstrings: Vec<CString> = Vec::with_capacity(args.len());
    for a in args {
      cstrings.push(CString::new(*a).map_err(|e| e.to_string())?);
    }
    let mut ptrs: Vec<*const c_char> = cstrings.iter().map(|s| s.as_ptr()).collect();
    ptrs.push(ptr::null());
    let rc = unsafe { (self.api.mpv_command)(self.handle, ptrs.as_ptr()) };
    if rc < 0 {
      return Err(format!("mpv_command failed: {rc}"));
    }
    Ok(())
  }

  /// Pause/unpause via `mpv_set_property` — required for reliable resume on some Windows libmpv builds.
  /// Read a float/double property (`time-pos`, `duration`, `volume`, …).
  pub fn get_property_double(&self, name: &str) -> Result<f64, String> {
    let Some(f) = self.api.mpv_get_property else {
      return Err("mpv_get_property not exported by libmpv".to_string());
    };
    let n = CString::new(name).map_err(|e| e.to_string())?;
    let mut val: f64 = 0.0;
    let rc = unsafe {
      (f)(
        self.handle,
        n.as_ptr(),
        mpv_format::MPV_FORMAT_DOUBLE as c_int,
        &mut val as *mut f64 as *mut c_void,
      )
    };
    if rc < 0 {
      return Err(format!("mpv_get_property {name} rc={rc}"));
    }
    Ok(val)
  }

  /// Read a boolean property (e.g. `pause`, `mute`) from the native handle — ground truth for verification.
  pub fn get_property_flag(&self, name: &str) -> Result<bool, String> {
    let Some(f) = self.api.mpv_get_property else {
      return Err("mpv_get_property not exported by libmpv".to_string());
    };
    let n = CString::new(name).map_err(|e| e.to_string())?;
    let mut flag: c_int = 0;
    let rc = unsafe {
      (f)(
        self.handle,
        n.as_ptr(),
        mpv_format::MPV_FORMAT_FLAG as c_int,
        &mut flag as *mut c_int as *mut c_void,
      )
    };
    if rc < 0 {
      return Err(format!("mpv_get_property {name} rc={rc}"));
    }
    Ok(flag != 0)
  }

  pub fn set_pause(&self, paused: bool) -> Result<(), String> {
    if let Some(f) = self.api.mpv_set_property {
      let name = CString::new("pause").map_err(|e| e.to_string())?;
      let mut flag: c_int = if paused { 1 } else { 0 };
      let rc = unsafe {
        (f)(
          self.handle,
          name.as_ptr(),
          mpv_format::MPV_FORMAT_FLAG as c_int,
          &mut flag as *mut c_int as *mut c_void,
        )
      };
      if rc >= 0 {
        return Ok(());
      }
    }
    self.command(&["set", "pause", if paused { "yes" } else { "no" }])
  }

  pub fn observe_property(&self, id: u64, name: &str, format: mpv_format) -> Result<(), String> {
    let n = CString::new(name).map_err(|e| e.to_string())?;
    let rc = unsafe { (self.api.mpv_observe_property)(self.handle, id, n.as_ptr(), format) };
    if rc < 0 {
      return Err(format!("mpv_observe_property failed: {rc}"));
    }
    Ok(())
  }

  pub fn set_option_string(&self, key: &str, val: &str) -> Result<(), String> {
    let k = CString::new(key).map_err(|e| e.to_string())?;
    let v = CString::new(val).map_err(|e| e.to_string())?;
    let rc = unsafe { (self.api.mpv_set_option_string)(self.handle, k.as_ptr(), v.as_ptr()) };
    if rc < 0 {
      return Err(format!("mpv_set_option_string {key} failed: {rc}"));
    }
    Ok(())
  }
}

impl Drop for MpvClient {
  fn drop(&mut self) {
    unsafe {
      (self.api.mpv_terminate_destroy)(self.handle);
    }
  }
}

/// Drain pending core events (`mpv_wait_event` with timeout 0). Returns true if `MPV_EVENT_SHUTDOWN` was seen.
pub fn drain_mpv_events(api: &LibMpv, handle: *mut mpv_handle) -> bool {
  if handle.is_null() {
    return false;
  }
  loop {
    let ev = unsafe { (api.mpv_wait_event)(handle, 0.0) };
    if ev.is_null() {
      return false;
    }
    let id = unsafe { (*ev).event_id };
    if id == MPV_EVENT_SHUTDOWN {
      return true;
    }
  }
}

fn opt(api: &LibMpv, handle: *mut mpv_handle, key: &str, val: &str) -> Result<(), String> {
  let k = CString::new(key).map_err(|e| e.to_string())?;
  let v = CString::new(val).map_err(|e| e.to_string())?;
  let rc = unsafe { (api.mpv_set_option_string)(handle, k.as_ptr(), v.as_ptr()) };
  if rc < 0 {
    return Err(format!("mpv_set_option_string {key} failed: {rc}"));
  }
  Ok(())
}

/// Apply `{"command":[...]}` from the legacy IPC-style JSON to `mpv_command`.
pub fn apply_ipc_style_command(mpv: &MpvClient, msg: &Value) -> Result<(), String> {
  let Some(arr) = msg.get("command").and_then(|c| c.as_array()) else {
    return Ok(());
  };
  if arr.len() == 1 && arr[0].as_str() == Some("quit") {
    return mpv.command(&["stop"]);
  }
  if arr.len() >= 3 && arr[1].as_str() == Some("pause") {
    if arr[0].as_str() == Some("set") {
      let paused = match arr.get(2) {
        Some(Value::String(s)) => s == "yes",
        Some(Value::Bool(b)) => *b,
        _ => false,
      };
      return mpv.set_pause(paused);
    }
    if arr[0].as_str() == Some("set_property") {
      let paused = match arr.get(2) {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => s == "yes" || s == "true",
        _ => false,
      };
      return mpv.set_pause(paused);
    }
  }
  let mut parts: Vec<String> = Vec::with_capacity(arr.len());
  for v in arr {
    parts.push(json_to_mpv_arg(v));
  }
  let refs: Vec<&str> = parts.iter().map(|s| s.as_str()).collect();
  mpv.command(&refs)
}

fn json_to_mpv_arg(v: &Value) -> String {
  match v {
    Value::Bool(b) => {
      if *b {
        "yes".to_string()
      } else {
        "no".to_string()
      }
    }
    Value::Number(n) => n.to_string(),
    Value::String(s) => s.clone(),
    Value::Null => "".to_string(),
    _ => v.to_string(),
  }
}
