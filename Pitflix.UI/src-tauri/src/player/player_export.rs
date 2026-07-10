//! Export still frames and short clips from the currently playing file (ffmpeg).

use std::{
  env,
  fs,
  path::{Path, PathBuf},
  process::{Command, Stdio},
};

use regex::Regex;
use serde::Deserialize;

use super::{subtitle_generator, thumbs::resolve_ffmpeg};

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportSubtitleOptions {
  #[serde(default)]
  pub include_subtitles: bool,
  pub subtitle_path: Option<String>,
  pub subtitle_stream_si: Option<u32>,
  #[serde(default)]
  pub subtitle_delay_seconds: f64,
}

struct PreparedSubtitle {
  filter: String,
  _temp_files: Vec<PathBuf>,
}

fn set_ffmpeg_below_normal_priority(child: &std::process::Child) {
  #[cfg(windows)]
  unsafe {
    use windows::Win32::System::Threading::{
      OpenProcess, SetPriorityClass, BELOW_NORMAL_PRIORITY_CLASS, PROCESS_SET_INFORMATION,
    };
    if let Ok(handle) = OpenProcess(PROCESS_SET_INFORMATION, false, child.id()) {
      let _ = SetPriorityClass(handle, BELOW_NORMAL_PRIORITY_CLASS);
    }
  }
}

fn run_ffmpeg(args: &[&str]) -> Result<(), String> {
  let ffmpeg = resolve_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;
  let mut cmd = Command::new(&ffmpeg);
  cmd.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }

  #[cfg(debug_assertions)]
  eprintln!("[player-export] ffmpeg {}", args.join(" "));

  let mut child = cmd.spawn().map_err(|e| format!("ffmpeg failed to start: {e}"))?;
  set_ffmpeg_below_normal_priority(&child);
  let status = child.wait().map_err(|e| format!("ffmpeg wait failed: {e}"))?;
  if status.success() {
    return Ok(());
  }

  let stderr = child
    .stderr
    .take()
    .and_then(|mut s| {
      let mut buf = Vec::new();
      std::io::Read::read_to_end(&mut s, &mut buf).ok()?;
      Some(String::from_utf8_lossy(&buf).into_owned())
    })
    .unwrap_or_default();

  let tail: String = stderr
    .lines()
    .filter(|l| !l.trim().is_empty())
    .rev()
    .take(10)
    .collect::<Vec<_>>()
    .into_iter()
    .rev()
    .collect::<Vec<_>>()
    .join("\n");

  let code = status.code().map(|c| c.to_string()).unwrap_or_else(|| "unknown".to_string());

  if tail.is_empty() {
    Err(format!("ffmpeg failed (exit {code})"))
  } else {
    Err(format!("ffmpeg failed (exit {code}): {tail}"))
  }
}

/// Escape a filesystem path for ffmpeg's `subtitles` filter (Windows-safe).
fn escape_filter_path(path: &str) -> String {
  let normalized = path.replace('\\', "/");
  let mut escaped = String::new();
  for (i, ch) in normalized.char_indices() {
    match ch {
      ':' if i == 1 => escaped.push_str("\\:"),
      '\'' | '[' | ']' | ',' | ';' | '\\' => {
        escaped.push('\\');
        escaped.push(ch);
      }
      _ => escaped.push(ch),
    }
  }
  if escaped.contains(' ') {
    format!("'{escaped}'")
  } else {
    escaped
  }
}

fn is_srt_path(path: &Path) -> bool {
  path
    .extension()
    .and_then(|e| e.to_str())
    .map(|e| e.eq_ignore_ascii_case("srt"))
    .unwrap_or(false)
}

fn shift_srt_timestamp(raw: &str, delay_seconds: f64) -> String {
  let (hms, ms) = raw.split_once(',').unwrap_or((raw, "000"));
  let parts: Vec<u32> = hms.split(':').filter_map(|p| p.parse().ok()).collect();
  let (h, m, s) = match parts.as_slice() {
    [h, m, s] => (*h, *m, *s),
    [m, s] => (0, *m, *s),
    [s] => (0, 0, *s),
    _ => (0, 0, 0),
  };
  let ms_val: u32 = ms.parse().unwrap_or(0);
  let total_ms = ((h as f64) * 3600.0 + (m as f64) * 60.0 + s as f64) * 1000.0 + ms_val as f64;
  let shifted = (total_ms + delay_seconds * 1000.0).max(0.0);
  let out_h = (shifted / 3_600_000.0).floor() as u32;
  let rem = shifted - out_h as f64 * 3_600_000.0;
  let out_m = (rem / 60_000.0).floor() as u32;
  let rem = rem - out_m as f64 * 60_000.0;
  let out_s = (rem / 1000.0).floor() as u32;
  let out_ms = (rem - out_s as f64 * 1000.0).round() as u32;
  format!("{out_h:02}:{out_m:02}:{out_s:02},{out_ms:03}")
}

fn shift_srt_timestamps(input: &Path, delay_seconds: f64) -> Result<PathBuf, String> {
  let content = fs::read_to_string(input).map_err(|e| format!("read subtitle file: {e}"))?;
  let re = Regex::new(r"(?m)(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})")
    .map_err(|e| format!("subtitle regex: {e}"))?;
  let shifted = re.replace_all(&content, |caps: &regex::Captures<'_>| {
    let start = shift_srt_timestamp(caps.get(1).map(|m| m.as_str()).unwrap_or("00:00:00,000"), delay_seconds);
    let end = shift_srt_timestamp(caps.get(2).map(|m| m.as_str()).unwrap_or("00:00:00,000"), delay_seconds);
    format!("{start} --> {end}")
  });
  let out = env::temp_dir().join(format!(
    "pitflix-export-sub-{}-{}.srt",
    std::process::id(),
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_millis())
      .unwrap_or(0)
  ));
  fs::write(&out, shifted.as_ref()).map_err(|e| format!("write shifted subtitle: {e}"))?;
  Ok(out)
}

fn temp_sub_path(prefix: &str) -> PathBuf {
  env::temp_dir().join(format!(
    "pitflix-export-{prefix}-{}-{}.srt",
    std::process::id(),
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_millis())
      .unwrap_or(0)
  ))
}

fn extract_embedded_subtitle_to_srt(source_path: &str, stream_si: u32) -> Result<PathBuf, String> {
  let tracks = subtitle_generator::get_subtitle_tracks(source_path)?;
  let track = tracks
    .get(stream_si as usize)
    .ok_or_else(|| "subtitle stream not found".to_string())?;
  let out = temp_sub_path("emb");
  subtitle_generator::extract_subtitle_to_srt(source_path, track.index, out.to_string_lossy().as_ref())?;
  Ok(out)
}

fn apply_subtitle_delay(path: PathBuf, delay: f64) -> Result<PathBuf, String> {
  if delay.abs() <= 0.001 || !is_srt_path(&path) {
    return Ok(path);
  }
  shift_srt_timestamps(&path, delay)
}

fn prepare_subtitle_filter(source_path: &str, opts: &ExportSubtitleOptions) -> Result<Option<PreparedSubtitle>, String> {
  if !opts.include_subtitles {
    return Ok(None);
  }

  let delay = if opts.subtitle_delay_seconds.is_finite() {
    opts.subtitle_delay_seconds
  } else {
    0.0
  };

  let mut temp_files: Vec<PathBuf> = Vec::new();

  let external = opts
    .subtitle_path
    .as_ref()
    .map(|p| p.trim())
    .filter(|p| !p.is_empty());

  if let Some(path) = external {
    let path_buf = PathBuf::from(path);
    if !path_buf.is_file() {
      return Err("subtitle file not found".to_string());
    }
    let sub_path = apply_subtitle_delay(path_buf, delay)?;
    if sub_path.to_string_lossy() != path {
      temp_files.push(sub_path.clone());
    }
    let filter = format!("subtitles={}", escape_filter_path(sub_path.to_string_lossy().as_ref()));
    return Ok(Some(PreparedSubtitle { filter, _temp_files: temp_files }));
  }

  let si = opts
    .subtitle_stream_si
    .ok_or_else(|| "embedded subtitle index missing".to_string())?;

  match extract_embedded_subtitle_to_srt(source_path, si) {
    Ok(extracted) => {
      let sub_path = apply_subtitle_delay(extracted, delay)?;
      temp_files.push(sub_path.clone());
      let filter = format!("subtitles={}", escape_filter_path(sub_path.to_string_lossy().as_ref()));
      Ok(Some(PreparedSubtitle { filter, _temp_files: temp_files }))
    }
    Err(extract_err) => {
      let embedded_tracks = subtitle_generator::get_subtitle_tracks(source_path).unwrap_or_default();
      if embedded_tracks.is_empty() {
        return Err(
          "this file has no embedded subtitles — select the external .srt track in the subtitle menu"
            .to_string(),
        );
      }
      let normalized = source_path.replace('\\', "/");
      let mut path_with_si = String::new();
      for (i, ch) in normalized.char_indices() {
        match ch {
          ':' if i == 1 => path_with_si.push_str("\\:"),
          '\'' | '[' | ']' | ',' | ';' | '\\' => {
            path_with_si.push('\\');
            path_with_si.push(ch);
          }
          _ => path_with_si.push(ch),
        }
      }
      path_with_si.push_str(&format!(":si={si}"));
      let filter = if path_with_si.contains(' ') {
        format!("subtitles='{path_with_si}'")
      } else {
        format!("subtitles={path_with_si}")
      };
      #[cfg(debug_assertions)]
      eprintln!("[player-export] embedded extract failed ({extract_err}); using si={si}");
      Ok(Some(PreparedSubtitle {
        filter,
        _temp_files: temp_files,
      }))
    }
  }
}

fn output_is_png(path: &str) -> bool {
  Path::new(path)
    .extension()
    .and_then(|e| e.to_str())
    .map(|e| e.eq_ignore_ascii_case("png"))
    .unwrap_or(false)
}

fn export_screenshot_sync(
  source_path: String,
  time_seconds: f64,
  output_path: String,
  subtitles: Option<ExportSubtitleOptions>,
) -> Result<(), String> {
  if source_path.trim().is_empty() {
    return Err("source path is empty".to_string());
  }
  if output_path.trim().is_empty() {
    return Err("output path is empty".to_string());
  }
  let at = time_seconds.max(0.0);
  let at_s = format!("{at:.3}");
  let sub_opts = subtitles.unwrap_or_default();
  let prepared = prepare_subtitle_filter(&source_path, &sub_opts)?;
  let burn_subs = prepared.is_some();

  let mut args: Vec<String> = vec![
    "-hide_banner".into(),
    "-loglevel".into(),
    "error".into(),
    "-ss".into(),
    at_s.clone(),
    "-i".into(),
    source_path.clone(),
  ];
  if let Some(prepared) = &prepared {
    args.push("-vf".into());
    args.push(prepared.filter.clone());
  }
  args.push("-frames:v".into());
  args.push("1".into());
  if output_is_png(&output_path) {
    args.extend(["-c:v".into(), "png".into()]);
  } else {
    args.extend(["-q:v".into(), "2".into()]);
  }
  args.extend(["-y".into(), output_path.clone()]);

  let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
  if let Err(err) = run_ffmpeg(&arg_refs) {
    if burn_subs {
      return Err(format!("{err}\n(subtitle burn-in failed — try turning subtitles off)"));
    }
    return Err(err);
  }
  if !Path::new(&output_path).is_file() {
    return Err("screenshot file was not created".to_string());
  }
  Ok(())
}

fn export_clip_sync(
  source_path: String,
  start_seconds: f64,
  duration_seconds: f64,
  output_path: String,
  subtitles: Option<ExportSubtitleOptions>,
) -> Result<(), String> {
  if source_path.trim().is_empty() {
    return Err("source path is empty".to_string());
  }
  if output_path.trim().is_empty() {
    return Err("output path is empty".to_string());
  }
  let start = start_seconds.max(0.0);
  let duration = duration_seconds.clamp(1.0, 600.0);
  let start_s = format!("{start:.3}");
  let duration_s = format!("{duration:.3}");
  let sub_opts = subtitles.unwrap_or_default();
  let prepared = prepare_subtitle_filter(&source_path, &sub_opts)?;
  let burn_subs = prepared.is_some();

  if !burn_subs {
    let copy_args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      &start_s,
      "-i",
      &source_path,
      "-t",
      &duration_s,
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
      "-y",
      &output_path,
    ];
    if run_ffmpeg(&copy_args).is_ok() && Path::new(&output_path).is_file() {
      return Ok(());
    }
  }

  let mut args: Vec<String> = vec![
    "-hide_banner".into(),
    "-loglevel".into(),
    "error".into(),
    "-ss".into(),
    start_s,
    "-i".into(),
    source_path.clone(),
    "-t".into(),
    duration_s,
  ];
  if let Some(prepared) = &prepared {
    args.push("-vf".into());
    args.push(prepared.filter.clone());
  }
  args.extend([
    "-c:v".into(),
    "libx264".into(),
    "-preset".into(),
    "veryfast".into(),
    "-crf".into(),
    "22".into(),
    "-c:a".into(),
    "aac".into(),
    "-b:a".into(),
    "160k".into(),
    "-movflags".into(),
    "+faststart".into(),
    "-y".into(),
    output_path.clone(),
  ]);

  let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
  if let Err(err) = run_ffmpeg(&arg_refs) {
    if burn_subs {
      return Err(format!("{err}\n(subtitle burn-in failed — try turning subtitles off)"));
    }
    return Err(err);
  }
  if !Path::new(&output_path).is_file() {
    return Err("clip file was not created".to_string());
  }
  Ok(())
}

#[tauri::command]
pub async fn player2_export_screenshot(
  source_path: String,
  time_seconds: f64,
  output_path: String,
  subtitles: Option<ExportSubtitleOptions>,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    export_screenshot_sync(source_path, time_seconds, output_path, subtitles)
  })
  .await
  .map_err(|e| format!("screenshot export interrupted: {e}"))?
}

#[tauri::command]
pub async fn player2_export_clip(
  source_path: String,
  start_seconds: f64,
  duration_seconds: f64,
  output_path: String,
  subtitles: Option<ExportSubtitleOptions>,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    export_clip_sync(source_path, start_seconds, duration_seconds, output_path, subtitles)
  })
  .await
  .map_err(|e| format!("clip export interrupted: {e}"))?
}
