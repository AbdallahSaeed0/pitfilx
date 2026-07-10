//! Domain-level ad/tracker blocklist for the Browse tab's navigation guard.
//!
//! Phase 1 only blocks by *hostname* on navigation/popup events — no
//! sub-resource network interception (that's Phase 2, `WebResourceRequested`).

use std::collections::HashSet;
use std::sync::OnceLock;

/// Bundled at compile time; ships inside the binary so no runtime resource
/// resolution (dev vs. packaged NSIS layout) is needed for Phase 1.
const RAW_JSON: &str = include_str!("../../resources/ad-domain-blocklist.json");

static DOMAINS: OnceLock<HashSet<String>> = OnceLock::new();

fn domains() -> &'static HashSet<String> {
  DOMAINS.get_or_init(|| {
    serde_json::from_str::<Vec<String>>(RAW_JSON)
      .unwrap_or_default()
      .into_iter()
      .map(|d| d.trim().to_lowercase())
      .filter(|d| !d.is_empty())
      .collect()
  })
}

/// True if `host` is a known ad/tracker domain, or a subdomain of one
/// (e.g. `pagead2.googlesyndication.com` matches the bundled
/// `googlesyndication.com` entry).
pub fn is_blocked(host: &str) -> bool {
  let host = host.trim().trim_end_matches('.').to_lowercase();
  if host.is_empty() {
    return false;
  }
  let set = domains();
  if set.contains(&host) {
    return true;
  }
  set.iter().any(|d| host.ends_with(&format!(".{d}")))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn matches_exact_and_subdomain() {
    assert!(is_blocked("doubleclick.net"));
    assert!(is_blocked("pagead2.googlesyndication.com"));
    assert!(!is_blocked("example.com"));
    assert!(!is_blocked(""));
  }
}
