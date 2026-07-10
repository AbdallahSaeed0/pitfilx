import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/app_config.dart';

/// Small persisted user preferences. Backed by shared_preferences so it
/// survives app restarts, unlike most other session-only state in this app
/// (there's no backend support for storing this kind of preference).
abstract class AppSettings {
  static const _ratingScaleKey = 'rating_scale_max';
  static const _searchHistoryKey = 'search_history';
  static const _lastSeenActivityKey = 'last_seen_activity_at';
  static const _syncWithDesktopKey = 'sync_with_desktop_enabled';
  static const _lastSyncedAtKey = 'last_synced_at';
  static const _maxSearchHistory = 8;

  /// 5 (star rating) or 10 (point rating). Defaults to 5 until [load] runs.
  static final ValueNotifier<int> ratingScaleMax = ValueNotifier(5);

  /// Most-recent-first, capped at [_maxSearchHistory], deduped on re-search.
  static final ValueNotifier<List<String>> searchHistory = ValueNotifier(
    const [],
  );

  /// When the Friends screen's Activity tab was last opened — used to
  /// compute an "unseen activity" badge. Null until the tab has ever been
  /// opened (or [load] hasn't run yet).
  static final ValueNotifier<DateTime?> lastSeenActivityAt = ValueNotifier(
    null,
  );

  /// Whether the app should talk to the local Pitflix.API backend at all
  /// (ratings/actor bios/Coming Soon — see Settings' "Sync with Desktop").
  /// Defaults on; screens that call LocalBackendService should check this.
  static final ValueNotifier<bool> syncWithDesktopEnabled = ValueNotifier(
    true,
  );

  /// Last time the local backend connection was confirmed reachable (see
  /// SettingsScreen's "Sync Now"). Null until the first successful check.
  static final ValueNotifier<DateTime?> lastSyncedAt = ValueNotifier(null);

  /// True when the app is allowed to call [LocalBackendService] at all —
  /// requires both a compiled-in base URL ([AppConfig.useLocalBackend]) and
  /// the user's own "Sync with Desktop" toggle. Screens that gate on the
  /// local backend (Coming Soon, ratings) should check this instead of
  /// [AppConfig.useLocalBackend] alone.
  static bool get desktopSyncActive =>
      AppConfig.useLocalBackend && syncWithDesktopEnabled.value;

  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getInt(_ratingScaleKey);
    if (saved == 5 || saved == 10) ratingScaleMax.value = saved!;

    searchHistory.value = prefs.getStringList(_searchHistoryKey) ?? const [];

    final lastSeenIso = prefs.getString(_lastSeenActivityKey);
    if (lastSeenIso != null) {
      lastSeenActivityAt.value = DateTime.tryParse(lastSeenIso);
    }

    syncWithDesktopEnabled.value =
        prefs.getBool(_syncWithDesktopKey) ?? true;

    final lastSyncedIso = prefs.getString(_lastSyncedAtKey);
    if (lastSyncedIso != null) {
      lastSyncedAt.value = DateTime.tryParse(lastSyncedIso);
    }
  }

  static Future<void> setRatingScaleMax(int value) async {
    ratingScaleMax.value = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_ratingScaleKey, value);
  }

  static Future<void> addSearchTerm(String term) async {
    final trimmed = term.trim();
    if (trimmed.isEmpty) return;
    final updated = [
      trimmed,
      ...searchHistory.value.where(
        (t) => t.toLowerCase() != trimmed.toLowerCase(),
      ),
    ].take(_maxSearchHistory).toList();
    searchHistory.value = updated;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_searchHistoryKey, updated);
  }

  static Future<void> clearSearchHistory() async {
    searchHistory.value = const [];
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_searchHistoryKey);
  }

  static Future<void> markActivitySeen() async {
    final now = DateTime.now();
    lastSeenActivityAt.value = now;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_lastSeenActivityKey, now.toIso8601String());
  }

  static Future<void> setSyncWithDesktopEnabled(bool value) async {
    syncWithDesktopEnabled.value = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_syncWithDesktopKey, value);
  }

  static Future<void> markSyncedNow() async {
    final now = DateTime.now();
    lastSyncedAt.value = now;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_lastSyncedAtKey, now.toIso8601String());
  }
}
