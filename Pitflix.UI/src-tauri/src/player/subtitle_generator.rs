use std::path::{Path, PathBuf};
use std::process::Command;
use std::fs;
use regex::Regex;

#[derive(Debug, Clone, serde::Serialize)]
pub struct SubtitleTrack {
    pub index: i32,
    pub language: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SubtitleCue {
    pub index: usize,
    pub start: String,
    pub end: String,
    pub text: String,
}

fn log_subtitle_gen(msg: &str) {
    eprintln!("[subtitle-gen] {}", msg);
}

pub fn get_subtitle_tracks(video_path: &str) -> Result<Vec<SubtitleTrack>, String> {
    log_subtitle_gen(&format!("Detecting subtitle tracks in: {}", video_path));
    
    let output = Command::new("ffprobe")
        .args(&[
            "-v", "error",
            "-select_streams", "s",
            "-show_entries", "stream=index,language,tags=title",
            "-of", "json",
            video_path,
        ])
        .output()
        .map_err(|e| format!("ffprobe error: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("JSON parse error: {}", e))?;

    let mut tracks = Vec::new();
    if let Some(streams) = json.get("streams").and_then(|v| v.as_array()) {
        for stream in streams {
            let index = stream.get("index").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let language = stream
                .get("tags")
                .and_then(|t| t.get("language"))
                .and_then(|l| l.as_str())
                .unwrap_or("unknown")
                .to_string();
            let title = stream
                .get("tags")
                .and_then(|t| t.get("title"))
                .and_then(|t| t.as_str())
                .map(|s| s.to_string());

            log_subtitle_gen(&format!("Found track {}: {} ({})", index, language, title.as_deref().unwrap_or("no title")));
            tracks.push(SubtitleTrack { index, language, title });
        }
    }

    log_subtitle_gen(&format!("Total subtitle tracks found: {}", tracks.len()));
    Ok(tracks)
}

pub fn find_english_subtitle_track(tracks: &[SubtitleTrack]) -> Option<SubtitleTrack> {
    // 1. Try to find a track explicitly marked as English
    let english = tracks
        .iter()
        .find(|t| t.language == "eng" || t.language == "en" || t.language == "english")
        .cloned();
    
    if let Some(ref track) = english {
        log_subtitle_gen(&format!("Found English track at index: {}", track.index));
        return Some(track.clone());
    }

    // 2. FALLBACK: If no English track, use the first "unknown" track
    // This handles videos where subtitles aren't tagged correctly.
    let unknown = tracks
        .iter()
        .find(|t| t.language == "unknown")
        .cloned();

    if let Some(ref track) = unknown {
        log_subtitle_gen(&format!("No English track found, falling back to unknown track at index: {}", track.index));
        return Some(track.clone());
    }

    // 3. LAST RESORT: Just use the first track found if any exist
    if let Some(track) = tracks.first() {
        log_subtitle_gen(&format!("Falling back to first available track at index: {}", track.index));
        return Some(track.clone());
    }

    log_subtitle_gen("No subtitle tracks found at all");
    None
}

pub fn extract_subtitle_to_srt(video_path: &str, track_index: i32, output_srt: &str) -> Result<(), String> {
    log_subtitle_gen(&format!("Extracting subtitle track index {} to: {}", track_index, output_srt));
    
    // Use the absolute stream index directly with "0:stream_index"
    // The previous "0:s:index" was failing because it was trying to find the Nth subtitle stream,
    // but we already have the global stream index from ffprobe.
    let status = Command::new("ffmpeg")
        .args(&[
            "-i", video_path,
            "-map", &format!("0:{}", track_index),
            "-c:s", "srt",
            "-y",
            output_srt,
        ])
        .output()
        .map_err(|e| format!("ffmpeg error: {}", e))?;

    if !status.status.success() {
        let stderr = String::from_utf8_lossy(&status.stderr);
        return Err(format!("ffmpeg extraction failed: {}", stderr));
    }

    log_subtitle_gen(&format!("Subtitle extraction completed successfully"));
    Ok(())
}

pub fn parse_srt_file(srt_path: &str) -> Result<Vec<SubtitleCue>, String> {
    log_subtitle_gen(&format!("Parsing SRT file: {}", srt_path));
    
    let content = fs::read_to_string(srt_path)
        .map_err(|e| format!("Failed to read SRT file: {}", e))?;

    let mut cues = Vec::new();
    
    // Simpler regex that doesn't use look-ahead (not supported by Rust's regex crate)
    // This matches the index, timestamp line, and then captures everything until the next double newline or end of string
    let re = Regex::new(r"(?m)^(\d+)\s*\n(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})\s*\n([\s\S]*?)(?:\n\n|\z)")
        .map_err(|e| format!("Regex error: {}", e))?;

    for cap in re.captures_iter(&content) {
        let index = cap.get(1).and_then(|m| m.as_str().trim().parse::<usize>().ok()).unwrap_or(0);
        let start = cap.get(2).map(|m| m.as_str()).unwrap_or("").to_string();
        let end = cap.get(3).map(|m| m.as_str()).unwrap_or("").to_string();
        let text = cap.get(4).map(|m| m.as_str()).unwrap_or("").trim().to_string();

        if !text.is_empty() {
            cues.push(SubtitleCue { index, start, end, text });
        }
    }

    log_subtitle_gen(&format!("Parsed {} subtitle cues", cues.len()));
    Ok(cues)
}

pub fn translate_cue_with_argos(text: &str) -> Result<String, String> {
    let output = Command::new("argospm-translate")
        .args(&["--from-lang", "en", "--to-lang", "ar"])
        .arg(text)
        .output()
        .or_else(|_| {
            Command::new("python")
                .args(&["-m", "argostranslate.cli", "--from-lang", "en", "--to-lang", "ar"])
                .arg(text)
                .output()
        })
        .map_err(|e| format!("Argos translate error: {}", e))?;

    if !output.status.success() {
        return Err(format!("Translation failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn write_srt_file(cues: &[SubtitleCue], output_path: &str) -> Result<(), String> {
    log_subtitle_gen(&format!("Writing {} cues to: {}", cues.len(), output_path));
    
    let mut content = String::new();
    for cue in cues {
        content.push_str(&format!("{}\n{} --> {}\n{}\n\n", cue.index, cue.start, cue.end, cue.text));
    }

    fs::write(output_path, content)
        .map_err(|e| format!("Failed to write SRT file: {}", e))?;
    
    log_subtitle_gen(&format!("SRT file written successfully"));
    Ok(())
}

pub fn get_subtitle_output_path(video_path: &str) -> PathBuf {
    let path = Path::new(video_path);
    let file_stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    parent.join(format!("{}.ar.srt", file_stem))
}

/// Parse an SRT timestamp "HH:MM:SS,mmm" into milliseconds.
fn parse_srt_time_ms(ts: &str) -> Option<u64> {
    let (time_part, ms_part) = ts.split_once(',')?;
    let ms: u64 = ms_part.trim().parse().ok()?;
    let mut parts = time_part.split(':');
    let h: u64 = parts.next()?.trim().parse().ok()?;
    let m: u64 = parts.next()?.trim().parse().ok()?;
    let s: u64 = parts.next()?.trim().parse().ok()?;
    Some(h * 3_600_000 + m * 60_000 + s * 1_000 + ms)
}

/// Merge consecutive cues whose gap is ≤ `max_gap_ms` milliseconds.
/// Joined text is separated by a single space; index is re-numbered afterward.
pub fn merge_short_gap_cues(cues: Vec<SubtitleCue>, max_gap_ms: u64) -> Vec<SubtitleCue> {
    if cues.is_empty() {
        return cues;
    }
    let mut result: Vec<SubtitleCue> = Vec::with_capacity(cues.len());
    let mut iter = cues.into_iter();
    let mut current = iter.next().unwrap();

    for next in iter {
        let end_ms = parse_srt_time_ms(&current.end).unwrap_or(u64::MAX);
        let start_ms = parse_srt_time_ms(&next.start).unwrap_or(u64::MAX);
        if start_ms.saturating_sub(end_ms) <= max_gap_ms {
            current = SubtitleCue {
                index: current.index,
                start: current.start.clone(),
                end: next.end.clone(),
                text: format!("{} {}", current.text.trim(), next.text.trim()),
            };
        } else {
            result.push(current);
            current = next;
        }
    }
    result.push(current);
    for (i, cue) in result.iter_mut().enumerate() {
        cue.index = i + 1;
    }
    result
}

/// Wrap a single-line subtitle string into at most 2 lines of ≤ `max_chars` each.
/// Splits at the word boundary closest to the midpoint.
/// Multi-line text (dialogue with embedded newlines) is returned unchanged.
pub fn wrap_arabic_text(text: &str, max_chars: usize) -> String {
    if text.contains('\n') {
        return text.to_string();
    }
    let char_count = text.chars().count();
    if char_count <= max_chars {
        return text.to_string();
    }
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() < 2 {
        return text.to_string();
    }
    let half = char_count / 2;
    let mut len_so_far = 0usize;
    let mut best_idx = 1;
    let mut best_dist = usize::MAX;
    for (i, w) in words.iter().enumerate() {
        if i > 0 {
            let dist = (len_so_far as isize - half as isize).unsigned_abs();
            if dist < best_dist {
                best_dist = dist;
                best_idx = i;
            }
        }
        len_so_far += w.chars().count() + 1;
    }
    format!("{}\n{}", words[..best_idx].join(" "), words[best_idx..].join(" "))
}

pub fn is_subtitle_cached(video_path: &str) -> bool {
    let cache_path = get_subtitle_output_path(video_path);
    let exists = cache_path.exists();
    if exists {
        log_subtitle_gen(&format!("Found cached Arabic subtitle: {}", cache_path.display()));
    }
    exists
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_english_subtitle() {
        let tracks = vec![
            SubtitleTrack { index: 0, language: "eng".to_string(), title: Some("English".to_string()) },
            SubtitleTrack { index: 1, language: "fr".to_string(), title: None },
        ];
        let found = find_english_subtitle_track(&tracks);
        assert!(found.is_some());
        assert_eq!(found.unwrap().index, 0);
    }
}

