import 'package:supabase_flutter/supabase_flutter.dart';
import '../config/app_config.dart';
import 'auth_service.dart';
import 'my_device_settings.dart';

/// Reads this account's `user_api_keys` row (see
/// `015_pitflix_synced_api_keys.sql`, `016_pitflix_subtitle_api_keys.sql`)
/// and applies it to [AppConfig] (TMDB/MDBList) and [MyDeviceSettings]
/// (OpenSubtitles/SubDL), so those calls use the same keys the desktop app
/// is configured with instead of whatever's compiled into this build or
/// typed separately into My Device's own Settings screen. A no-op (falls
/// back to the compiled-in/local defaults) when the desktop was never
/// linked or hasn't synced yet — see [AppConfig.applySyncedKeys]'s
/// null-means-fallback contract, mirrored by
/// [MyDeviceSettings.applySyncedSubtitleKeys].
abstract class SyncedApiKeysService {
  static Future<void> refresh() async {
    if (!AppConfig.isSupabaseConfigured || !AuthService.isSignedIn) return;
    try {
      final row = await Supabase.instance.client
          .from('user_api_keys')
          .select()
          .eq('user_id', AuthService.currentUser!.id)
          .maybeSingle();
      AppConfig.applySyncedKeys(
        tmdbApiKey: row?['tmdb_api_key'] as String?,
        mdbListApiKey: row?['mdblist_api_key'] as String?,
      );
      MyDeviceSettings.applySyncedSubtitleKeys(
        openSubtitlesApiKey: row?['opensubtitles_api_key'] as String?,
        subdlApiKey: row?['subdl_api_key'] as String?,
      );
    } catch (_) {
      // Best-effort — the compiled-in AppConfig defaults still work fine.
    }
  }
}
