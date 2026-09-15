import 'package:flutter/foundation.dart';

/// Session-only tally of reactions used and ratings given, split by
/// movie/series — these have no backend support yet (see review_sheet.dart /
/// episode_actions_sheet.dart), so they're tracked here in memory and reset
/// on restart. Filled in by [SessionStatsStore.logReaction] /
/// [SessionStatsStore.logRating] calls from any review or episode-popup
/// result handler. Split by media type so the Stats page's Shows/Movies tabs
/// each only show their own reactions/ratings instead of a combined tally
/// bleeding across tabs.
abstract class SessionStatsStore {
  /// Emoji label → count, e.g. {'Fire': 3, 'Cried': 1}
  static final ValueNotifier<Map<String, int>> movieReactions =
      ValueNotifier(const {});
  static final ValueNotifier<Map<String, int>> seriesReactions =
      ValueNotifier(const {});

  /// Star value → count, e.g. {5: 4, 4: 2, 3: 1}
  static final ValueNotifier<Map<int, int>> movieRatings = ValueNotifier(
    const {},
  );
  static final ValueNotifier<Map<int, int>> seriesRatings = ValueNotifier(
    const {},
  );

  static void logReaction(String? label, {required bool isShow}) {
    if (label == null) return;
    final notifier = isShow ? seriesReactions : movieReactions;
    final updated = Map<String, int>.of(notifier.value);
    updated[label] = (updated[label] ?? 0) + 1;
    notifier.value = updated;
  }

  static void logRating(int? rating, int? max, {required bool isShow}) {
    if (rating == null || rating <= 0) return;
    // Normalize 10-scale ratings down to 5-scale halves for display,
    // but store raw so the chart can show /10 if user chose that scale.
    final notifier = isShow ? seriesRatings : movieRatings;
    final updated = Map<int, int>.of(notifier.value);
    updated[rating] = (updated[rating] ?? 0) + 1;
    notifier.value = updated;
  }
}
