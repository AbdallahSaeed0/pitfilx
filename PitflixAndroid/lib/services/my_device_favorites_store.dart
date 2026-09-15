import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Local-only "favorite" flag for My Device videos, keyed by the same
/// photo_manager asset id used by MyDeviceResumeStore — see that class's doc
/// comment for how stable that id is. Entirely separate from the synced
/// library's Favorites list (UserLibraryService/user_lists); nothing here
/// ever touches Supabase.
abstract class MyDeviceFavoritesStore {
  static const _key = 'mydevice_favorite_ids';

  static final ValueNotifier<Set<String>> favoriteIds = ValueNotifier(const {});

  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    favoriteIds.value = (prefs.getStringList(_key) ?? const []).toSet();
  }

  static bool isFavorite(String assetId) => favoriteIds.value.contains(assetId);

  static Future<void> toggle(String assetId) async {
    final updated = {...favoriteIds.value};
    if (!updated.remove(assetId)) updated.add(assetId);
    favoriteIds.value = updated;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_key, updated.toList());
  }
}
