import 'package:flutter/foundation.dart';

/// Session-only tally of reactions used and ratings given — these have no
/// backend support yet (see review_sheet.dart / episode_actions_sheet.dart),
/// so they're tracked here in memory and reset on restart. Filled in by
/// [SessionStatsStore.logReaction] / [SessionStatsStore.logRating] calls from
/// any review or episode-popup result handler.
abstract class SessionStatsStore {
  /// Emoji label → count, e.g. {'Fire': 3, 'Cried': 1}
  static final ValueNotifier<Map<String, int>> reactions = ValueNotifier(
    const {},
  );

  /// Star value → count, e.g. {5: 4, 4: 2, 3: 1}
  static final ValueNotifier<Map<int, int>> ratings = ValueNotifier(const {});

  static void logReaction(String? label) {
    if (label == null) return;
    final updated = Map<String, int>.of(reactions.value);
    updated[label] = (updated[label] ?? 0) + 1;
    reactions.value = updated;
  }

  static void logRating(int? rating, int? max) {
    if (rating == null || rating <= 0) return;
    // Normalize 10-scale ratings down to 5-scale halves for display,
    // but store raw so the chart can show /10 if user chose that scale.
    final updated = Map<int, int>.of(ratings.value);
    updated[rating] = (updated[rating] ?? 0) + 1;
    ratings.value = updated;
  }
}
