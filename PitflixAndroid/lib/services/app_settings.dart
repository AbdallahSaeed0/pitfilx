import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Small persisted user preferences. Backed by shared_preferences so it
/// survives app restarts, unlike most other session-only state in this app
/// (there's no backend support for storing this kind of preference).
abstract class AppSettings {
  static const _ratingScaleKey = 'rating_scale_max';
  static const _searchHistoryKey = 'search_history';
  static const _lastSeenActivityKey = 'last_seen_activity_at';
  static const _lastSyncedAtKey = 'last_synced_at';
  static const _dismissedComingSoonKey = 'dismissed_coming_soon';
  static const _ratePromptBaselineKey = 'rate_prompt_baseline_at';
  static const _dismissedRatePromptsKey = 'dismissed_rate_prompts';
  static const _favoriteGenreIdsKey = 'favorite_genre_ids';
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

  /// Last time Settings' "Refresh Library" was used to force-refresh this
  /// account's view of its Supabase library data. Null until first used.
  static final ValueNotifier<DateTime?> lastSyncedAt = ValueNotifier(null);

  /// Titles the user swiped away from Coming Soon — keyed as "$tmdbId-$mediaType"
  /// since a movie and a show can share a tmdbId. Device-local only (no
  /// Supabase table for this yet), so a dismissal doesn't follow to other
  /// devices.
  static final ValueNotifier<Set<String>> dismissedComingSoonIds =
      ValueNotifier(const {});

  /// The cutoff below which a completed movie/series/episode is old enough to
  /// not bother prompting "wanna rate it?" for — set once, the first time
  /// [load] ever runs on a given install, so shipping this feature doesn't
  /// suddenly dump years of unrated watch history into notifications. Never
  /// null after [load] completes.
  static final ValueNotifier<DateTime?> ratePromptBaselineAt = ValueNotifier(
    null,
  );

  /// Rate-prompt items the user explicitly dismissed without rating — keyed
  /// as "movie-$tmdbId" / "series-$tmdbId" / "episode-$tmdbId-$season-$episode"
  /// so they don't keep reappearing. Device-local only.
  static final ValueNotifier<Set<String>> dismissedRatePrompts = ValueNotifier(
    const {},
  );

  /// TMDB genre ids picked in the first-run Onboarding wizard's "favorite
  /// genres" step — used by Discover to sort those categories to the top
  /// instead of every account seeing the same fixed category order. Empty
  /// (not null) means "no preference set", which Discover treats the same
  /// as its old fixed order.
  static final ValueNotifier<Set<int>> favoriteGenreIds = ValueNotifier(
    const {},
  );

  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getInt(_ratingScaleKey);
    if (saved == 5 || saved == 10) ratingScaleMax.value = saved!;

    searchHistory.value = prefs.getStringList(_searchHistoryKey) ?? const [];

    final lastSeenIso = prefs.getString(_lastSeenActivityKey);
    if (lastSeenIso != null) {
      lastSeenActivityAt.value = DateTime.tryParse(lastSeenIso);
    }

    final lastSyncedIso = prefs.getString(_lastSyncedAtKey);
    if (lastSyncedIso != null) {
      lastSyncedAt.value = DateTime.tryParse(lastSyncedIso);
    }

    dismissedComingSoonIds.value =
        (prefs.getStringList(_dismissedComingSoonKey) ?? const []).toSet();

    dismissedRatePrompts.value =
        (prefs.getStringList(_dismissedRatePromptsKey) ?? const []).toSet();

    final baselineIso = prefs.getString(_ratePromptBaselineKey);
    if (baselineIso != null) {
      ratePromptBaselineAt.value = DateTime.tryParse(baselineIso);
    }
    if (ratePromptBaselineAt.value == null) {
      final now = DateTime.now();
      ratePromptBaselineAt.value = now;
      await prefs.setString(_ratePromptBaselineKey, now.toIso8601String());
    }

    favoriteGenreIds.value =
        (prefs.getStringList(_favoriteGenreIdsKey) ?? const [])
            .map(int.tryParse)
            .whereType<int>()
            .toSet();
  }

  static Future<void> setFavoriteGenreIds(Set<int> ids) async {
    favoriteGenreIds.value = ids;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(
      _favoriteGenreIdsKey,
      ids.map((id) => '$id').toList(),
    );
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

  static Future<void> markSyncedNow() async {
    final now = DateTime.now();
    lastSyncedAt.value = now;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_lastSyncedAtKey, now.toIso8601String());
  }

  static Future<void> dismissComingSoonItem(int tmdbId, String mediaType) async {
    final updated = {...dismissedComingSoonIds.value, '$tmdbId-$mediaType'};
    dismissedComingSoonIds.value = updated;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_dismissedComingSoonKey, updated.toList());
  }

  static Future<void> dismissRatePrompt(String key) async {
    final updated = {...dismissedRatePrompts.value, key};
    dismissedRatePrompts.value = updated;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_dismissedRatePromptsKey, updated.toList());
  }
}
