//! HDR + audio passthrough — isolated, opt-in playback quality features for the embedded
//! (libmpv-in-window) player only. Does not touch existing mpv init/render/IPC code; the
//! libmpv session (`libmpv_session.rs`) only *appends* option calls based on what this module
//! reports / what the user has selected in Settings.

use serde::Serialize;

/// Reported HDR capability for the current machine/WebView2 install.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct HdrCapability {
  pub webview2_sufficient: bool,
  pub os_hdr_enabled: bool,
  pub true_hdr_available: bool,
}

#[tauri::command]
pub fn check_hdr_capability() -> HdrCapability {
  let webview2_sufficient = webview2_major_version().is_some_and(|major| major >= 109);
  let os_hdr_enabled = detect_os_hdr_enabled();
  HdrCapability {
    webview2_sufficient,
    os_hdr_enabled,
    true_hdr_available: webview2_sufficient && os_hdr_enabled,
  }
}

/// Reads the installed WebView2 runtime's major version from the registry.
/// Returns `None` if the key/value is missing or unparsable — callers treat that as "insufficient".
fn webview2_major_version() -> Option<u32> {
  #[cfg(windows)]
  {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm
      .open_subkey_with_flags(
        r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        KEY_READ,
      )
      .ok()?;
    let version: String = key.get_value("pv").ok()?;
    let major_str = version.split('.').next()?;
    major_str.parse::<u32>().ok()
  }
  #[cfg(not(windows))]
  {
    None
  }
}

/// Enumerates display outputs via DXGI and checks whether any is in HDR10 (BT.2020 PQ) color
/// space, i.e. Windows HDR is currently on for that display. Never panics — any enumeration
/// failure (no adapter, cast failure, etc.) silently yields `false`.
#[cfg(windows)]
fn detect_os_hdr_enabled() -> bool {
  use windows::core::Interface;
  use windows::Win32::Graphics::Dxgi::Common::DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020;
  use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput6};

  unsafe {
    let factory: windows::core::Result<IDXGIFactory1> = CreateDXGIFactory1();
    let Ok(factory) = factory else {
      return false;
    };

    let mut adapter_index = 0u32;
    loop {
      let Ok(adapter) = factory.EnumAdapters(adapter_index) else {
        break;
      };

      let mut output_index = 0u32;
      loop {
        let Ok(output) = adapter.EnumOutputs(output_index) else {
          break;
        };

        if let Ok(output6) = output.cast::<IDXGIOutput6>() {
          if let Ok(desc) = output6.GetDesc1() {
            if desc.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020 {
              return true;
            }
          }
        }

        output_index += 1;
      }

      adapter_index += 1;
    }

    false
  }
}

#[cfg(not(windows))]
fn detect_os_hdr_enabled() -> bool {
  false
}

/// Appends True-HDR mpv option calls. Caller only invokes this when `HdrMode == "true_hdr"`
/// AND `HdrCapability.true_hdr_available == true`; otherwise callers should use
/// `apply_tonemap_sdr_options` instead. Purely additive — assumes the base options
/// (`vo`, `gpu-api`, `hwdec`, etc.) have already been set by the existing init path.
pub fn apply_true_hdr_options<F>(mut set_option: F) -> Result<(), String>
where
  F: FnMut(&str, &str) -> Result<(), String>,
{
  set_option("vo", "gpu-next")?;
  set_option("gpu-api", "d3d11")?;
  set_option("target-colorspace-hint", "yes")?;
  set_option("tone-mapping", "no")?;
  set_option("hdr-compute-peak", "yes")?;
  Ok(())
}

/// Safe default: always tonemap to SDR. Used for `HdrMode == "auto"`, `"tonemap_sdr"`, or when
/// the true-HDR capability check fails.
pub fn apply_tonemap_sdr_options<F>(mut set_option: F) -> Result<(), String>
where
  F: FnMut(&str, &str) -> Result<(), String>,
{
  set_option("tone-mapping", "hable")?;
  set_option("hdr-compute-peak", "no")?;
  Ok(())
}

/// Appends audio-passthrough mpv option calls (Dolby/DTS bitstreaming over HDMI/optical).
pub fn apply_audio_passthrough_options<F>(mut set_option: F) -> Result<(), String>
where
  F: FnMut(&str, &str) -> Result<(), String>,
{
  set_option("audio-spdif", "ac3,eac3,dts,truehd,dts-hd")?;
  set_option("ad-lavc-ac3drc", "0")?;
  Ok(())
}
