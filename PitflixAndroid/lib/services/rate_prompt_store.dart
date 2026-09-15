import 'package:flutter/foundation.dart';
import '../models/rate_prompt_item.dart';
import 'user_library_service.dart';

/// Session-wide cache of pending "you just watched this, wanna rate it?"
/// items — refreshed alongside the periodic library sync (see RootShell) so
/// Home's banner/bell badge and the Notifications screen always agree on the
/// same list without each independently re-querying Supabase.
abstract class RatePromptStore {
  static final ValueNotifier<List<RatePromptItem>> items = ValueNotifier(
    const [],
  );

  static Future<void> refresh() async {
    try {
      items.value = await UserLibraryService.fetchPendingRatePrompts();
    } catch (_) {
      // Decorative feature — a failed refresh just leaves the previous list.
    }
  }

  /// Removes an item locally (after it's been rated or dismissed) without
  /// waiting for the next full refresh.
  static void remove(String key) {
    items.value = items.value.where((i) => i.key != key).toList();
  }
}
