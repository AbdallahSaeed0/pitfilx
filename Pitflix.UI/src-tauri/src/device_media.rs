//! My Device extras that need to look beyond a single `device_read_dir` listing:
//!   • `device_search_entries` — recursive name search across every saved location at once.
//!   • `device_video_durations` — batched video durations for the grid's duration badge / sort.

use std::path::{Path, PathBuf};

use crate::{device_media_kind, DeviceFsEntry};

fn path_key(path: &Path) -> String {
    path.to_string_lossy()
        .trim_end_matches(['/', '\\'])
        .replace('/', "\\")
        .to_lowercase()
}

fn is_inside(path_key: &str, root_key: &str) -> bool {
    path_key == root_key || path_key.starts_with(&format!("{root_key}\\"))
}

fn entry_for(path: &Path, meta: &std::fs::Metadata) -> DeviceFsEntry {
    let is_dir = meta.is_dir();
    DeviceFsEntry {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        is_directory: is_dir,
        media_kind: if is_dir { None } else { Some(device_media_kind(path).into()) },
        size_bytes: if is_dir { None } else { Some(meta.len()) },
        created_at: meta
            .created()
            .or_else(|_| meta.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64),
    }
}

fn search_sync(roots: Vec<String>, query: String, limit: usize, exclude: Vec<String>) -> Vec<DeviceFsEntry> {
    // Every whitespace-separated word must appear somewhere in the name, in any order — so
    // "beach 2023" finds "2023 Summer Beach Trip.mp4".
    let tokens: Vec<String> = query
        .split_whitespace()
        .map(|t| t.to_lowercase())
        .collect();
    if tokens.is_empty() {
        return Vec::new();
    }
    let exclude_keys: Vec<String> = exclude
        .iter()
        .filter(|e| !e.trim().is_empty())
        .map(|e| path_key(Path::new(e.trim())))
        .collect();

    // A saved location nested inside another saved location would otherwise be walked (and its
    // matches returned) twice.
    let mut root_paths: Vec<PathBuf> = roots
        .iter()
        .map(|r| PathBuf::from(r.trim()))
        .filter(|p| p.is_dir())
        .collect();
    root_paths.sort_by_key(|p| path_key(p).len());
    let mut unique_roots: Vec<(PathBuf, String)> = Vec::new();
    for p in root_paths {
        let key = path_key(&p);
        if unique_roots.iter().any(|(_, k)| is_inside(&key, k)) {
            continue;
        }
        unique_roots.push((p, key));
    }

    const MAX_VISITED: usize = 300_000;
    let limit = limit.clamp(1, 2000);
    let mut visited: usize = 0;
    let mut out: Vec<DeviceFsEntry> = Vec::new();

    'roots: for (root, _) in unique_roots {
        let mut stack = vec![root];
        while let Some(dir) = stack.pop() {
            let read = match std::fs::read_dir(&dir) {
                Ok(r) => r,
                Err(_) => continue,
            };
            for ent in read.flatten() {
                visited += 1;
                if visited > MAX_VISITED {
                    break 'roots;
                }
                let path = ent.path();
                let meta = match ent.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if meta.is_dir() {
                    // Private folders nested inside a normal location must never surface (or be
                    // descended into) from a normal-mode search.
                    let key = path_key(&path);
                    if exclude_keys.iter().any(|ex| is_inside(&key, ex)) {
                        continue;
                    }
                    stack.push(path.clone());
                }
                let name_lower = ent.file_name().to_string_lossy().to_lowercase();
                if tokens.iter().all(|t| name_lower.contains(t.as_str())) {
                    out.push(entry_for(&path, &meta));
                    if out.len() >= limit {
                        break 'roots;
                    }
                }
            }
        }
    }

    out.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    out
}

/// Recursively searches every given saved location for files AND folders whose name contains all
/// words of `query`. `exclude` lists folders (e.g. private ones) to skip entirely.
#[tauri::command]
pub async fn device_search_entries(
    roots: Vec<String>,
    query: String,
    limit: Option<usize>,
    exclude: Option<Vec<String>>,
) -> Result<Vec<DeviceFsEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        search_sync(roots, query, limit.unwrap_or(500), exclude.unwrap_or_default())
    })
    .await
    .map_err(|e| format!("search interrupted: {e}"))
}

// ── Durations ────────────────────────────────────────────────────────────────

#[cfg(windows)]
mod shell_duration {
    use windows::core::{GUID, HSTRING};
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToUInt64};
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
    use windows::Win32::UI::Shell::PropertiesSystem::{
        IPropertyStore, SHGetPropertyStoreFromParsingName, GPS_DEFAULT,
    };

    /// PKEY_Media_Duration — the same "Length" value Explorer shows, in 100 ns units.
    const PKEY_MEDIA_DURATION: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0x64440490_4c8b_11d1_8b70_080036b11a03),
        pid: 3,
    };

    /// RAII COM init for the calling worker thread.
    pub struct ComGuard(bool);
    impl ComGuard {
        pub fn new() -> Self {
            // S_FALSE (already initialized) is still a success that needs a matching uninit.
            Self(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
        }
    }
    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    pub fn duration_secs(path: &str) -> Option<f64> {
        unsafe {
            let store: IPropertyStore =
                SHGetPropertyStoreFromParsingName(&HSTRING::from(path), None, GPS_DEFAULT).ok()?;
            let mut value = store.GetValue(&PKEY_MEDIA_DURATION).ok()?;
            let ticks = PropVariantToUInt64(&value).ok();
            let _ = PropVariantClear(&mut value);
            let secs = ticks? as f64 / 10_000_000.0;
            (secs.is_finite() && secs > 0.0).then_some(secs)
        }
    }
}

#[cfg(windows)]
fn durations_sync(paths: Vec<String>) -> Vec<Option<f64>> {
    const WORKERS: usize = 4;
    let mut results: Vec<Option<f64>> = vec![None; paths.len()];
    if paths.is_empty() {
        return results;
    }
    let chunk = paths.len().div_ceil(WORKERS).max(1);
    std::thread::scope(|scope| {
        for (paths_chunk, out_chunk) in paths.chunks(chunk).zip(results.chunks_mut(chunk)) {
            scope.spawn(move || {
                let _com = shell_duration::ComGuard::new();
                let ffmpeg = std::cell::OnceCell::new();
                for (path, slot) in paths_chunk.iter().zip(out_chunk.iter_mut()) {
                    // Windows' own property handlers first (fast, no process spawn); fall back to
                    // an ffmpeg header probe for containers the shell can't read.
                    *slot = shell_duration::duration_secs(path).or_else(|| {
                        ffmpeg
                            .get_or_init(crate::player::thumbs::resolve_ffmpeg)
                            .as_deref()
                            .and_then(|ff| crate::player::thumbs::probe_duration_seconds(ff, path))
                    });
                }
            });
        }
    });
    results
}

#[cfg(not(windows))]
fn durations_sync(paths: Vec<String>) -> Vec<Option<f64>> {
    vec![None; paths.len()]
}

/// Duration in seconds for each video path (same order), `null` where it couldn't be read.
#[tauri::command]
pub async fn device_video_durations(paths: Vec<String>) -> Result<Vec<Option<f64>>, String> {
    tauri::async_runtime::spawn_blocking(move || durations_sync(paths))
        .await
        .map_err(|e| format!("duration probe interrupted: {e}"))
}

#[cfg(test)]
mod tests {
    use super::search_sync;
    use std::fs;

    #[test]
    fn search_matches_all_words_skips_excluded_and_dedupes_nested_roots() {
        let root = std::env::temp_dir().join(format!("pitflix-search-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Trips").join("Beach 2023")).unwrap();
        fs::create_dir_all(root.join("Secret")).unwrap();
        fs::write(root.join("Trips").join("Summer Beach 2023.mp4"), b"x").unwrap();
        fs::write(root.join("Trips").join("Winter 2023.mp4"), b"x").unwrap();
        fs::write(root.join("Secret").join("beach 2023 private.mp4"), b"x").unwrap();

        let r = |p: &std::path::Path| p.to_string_lossy().into_owned();
        let results = search_sync(
            // nested root listed too — must not produce duplicates
            vec![r(&root), r(&root.join("Trips"))],
            "BEACH 2023".into(),
            100,
            vec![r(&root.join("Secret"))],
        );
        let names: Vec<&str> = results.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["Beach 2023", "Summer Beach 2023.mp4"]);
        assert!(results[0].is_directory);
        assert_eq!(results[1].media_kind.as_deref(), Some("video"));

        let _ = fs::remove_dir_all(&root);
    }

    /// Manual check against real files: `PITFLIX_TEST_VIDEOS="a.mkv|b.mp4" cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn durations_for_real_files() {
        let paths: Vec<String> = std::env::var("PITFLIX_TEST_VIDEOS")
            .unwrap_or_default()
            .split('|')
            .filter(|p| !p.is_empty())
            .map(String::from)
            .collect();
        let t = std::time::Instant::now();
        let out = super::durations_sync(paths.clone());
        for (p, d) in paths.iter().zip(&out) {
            println!("{d:?}  {p}");
        }
        println!("elapsed: {:?}", t.elapsed());
        assert!(out.iter().all(|d| d.is_some()));
    }
}
