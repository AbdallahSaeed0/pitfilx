import 'package:shared_preferences/shared_preferences.dart';

/// Local-only playback position memory for My Device videos, keyed by the
/// video's photo_manager asset id (Android: the `_id` column of the
/// underlying MediaStore row — see AssetEntity.id). That id is stable across
/// app restarts and device reboots for as long as the file itself isn't
/// deleted and re-indexed by MediaStore (which would hand it a new row and
/// so a new id); if that happens this just quietly starts the file over
/// instead of resuming, rather than resuming the wrong position.
///
/// Entirely separate from the synced player's own watch-progress state (see
/// UserLibraryService) — nothing here is ever written to Supabase, and no
/// watch_events rows are created for local-only playback.
abstract class MyDeviceResumeStore {
  static const _prefix = 'mydevice_resume_';

  static Future<void> savePosition(String assetId, Duration position) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt('$_prefix$assetId', position.inMilliseconds);
  }

  static Future<Duration?> loadPosition(String assetId) async {
    final prefs = await SharedPreferences.getInstance();
    final ms = prefs.getInt('$_prefix$assetId');
    return ms == null ? null : Duration(milliseconds: ms);
  }

  static Future<void> clearPosition(String assetId) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('$_prefix$assetId');
  }
}
