import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Local-only settings for "My Device" (Settings > "Enable My Device") — an
/// on-device video browsing/playback feature that is fully isolated from the
/// Supabase-synced library. Everything here lives under its own
/// `mydevice_`-prefixed SharedPreferences keys and is never read by
/// AppSettings/UserLibraryService or written to Supabase; the OpenSubtitles/
/// SubDL API keys in particular are this app's own local credentials, not
/// shared with the desktop app's config in any way.
enum MyDeviceSubtitlePosition { top, middle, bottom }

abstract class MyDeviceSettings {
  static const _enabledKey = 'mydevice_enabled';
  static const _openSubtitlesApiKeyKey = 'mydevice_opensubtitles_api_key';
  static const _subdlApiKeyKey = 'mydevice_subdl_api_key';
  static const _subtitleFontSizeKey = 'mydevice_subtitle_font_size';
  static const _subtitlePositionKey = 'mydevice_subtitle_position';
  static const _subtitleDelayMsKey = 'mydevice_subtitle_delay_ms';
  static const _excludedFolderIdsKey = 'mydevice_excluded_folder_ids';

  /// Off by default — the "My Device" tab/section stays hidden and no
  /// MediaStore permission is ever requested until the user opts in.
  static final ValueNotifier<bool> enabled = ValueNotifier(false);

  static final ValueNotifier<String> openSubtitlesApiKey = ValueNotifier('');
  static final ValueNotifier<String> subdlApiKey = ValueNotifier('');

  /// Same fallback shape as AppConfig's synced TMDB/MDBList keys — set by
  /// SyncedApiKeysService from the desktop-linked account's own configured
  /// keys (`user_api_keys.opensubtitles_api_key`/`subdl_api_key`), used only
  /// when the field above (typed directly into this app's own Settings) is
  /// empty. A key typed on this phone always wins over the synced one.
  static String? _syncedOpenSubtitlesApiKey;
  static String? _syncedSubdlApiKey;

  static void applySyncedSubtitleKeys({
    String? openSubtitlesApiKey,
    String? subdlApiKey,
  }) {
    _syncedOpenSubtitlesApiKey = openSubtitlesApiKey;
    _syncedSubdlApiKey = subdlApiKey;
  }

  static String get effectiveOpenSubtitlesApiKey =>
      openSubtitlesApiKey.value.isNotEmpty
      ? openSubtitlesApiKey.value
      : (_syncedOpenSubtitlesApiKey ?? '');

  static String get effectiveSubdlApiKey => subdlApiKey.value.isNotEmpty
      ? subdlApiKey.value
      : (_syncedSubdlApiKey ?? '');

  /// Player subtitle overlay style — kept intentionally minimal (size +
  /// vertical position only, no fonts/colors/outlines) per the v1 scope.
  static final ValueNotifier<double> subtitleFontSize = ValueNotifier(16);
  static final ValueNotifier<MyDeviceSubtitlePosition> subtitlePosition =
      ValueNotifier(MyDeviceSubtitlePosition.bottom);

  /// Shifts subtitle timing relative to video playback: positive makes
  /// subtitles appear later, negative makes them appear earlier.
  static final ValueNotifier<int> subtitleDelayMs = ValueNotifier(0);

  /// Folders (identified by AssetPathEntity.id) hidden from the My Device
  /// folder list — MyDeviceScanner filters its results against this set
  /// before publishing, so a hidden folder's videos stay untouched on disk,
  /// just not browsable from this screen.
  static final ValueNotifier<Set<String>> excludedFolderIds = ValueNotifier(
    const {},
  );

  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    enabled.value = prefs.getBool(_enabledKey) ?? false;
    openSubtitlesApiKey.value = prefs.getString(_openSubtitlesApiKeyKey) ?? '';
    subdlApiKey.value = prefs.getString(_subdlApiKeyKey) ?? '';
    subtitleFontSize.value = prefs.getDouble(_subtitleFontSizeKey) ?? 16;
    subtitlePosition.value = MyDeviceSubtitlePosition.values.firstWhere(
      (p) => p.name == prefs.getString(_subtitlePositionKey),
      orElse: () => MyDeviceSubtitlePosition.bottom,
    );
    excludedFolderIds.value =
        prefs.getStringList(_excludedFolderIdsKey)?.toSet() ?? const {};
    subtitleDelayMs.value = prefs.getInt(_subtitleDelayMsKey) ?? 0;
  }

  static Future<void> setEnabled(bool value) async {
    enabled.value = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_enabledKey, value);
  }

  static Future<void> setOpenSubtitlesApiKey(String value) async {
    openSubtitlesApiKey.value = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_openSubtitlesApiKeyKey, value);
  }

  static Future<void> setSubdlApiKey(String value) async {
    subdlApiKey.value = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_subdlApiKeyKey, value);
  }

  static Future<void> setSubtitleFontSize(double value) async {
    subtitleFontSize.value = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_subtitleFontSizeKey, value);
  }

  static Future<void> setSubtitlePosition(
    MyDeviceSubtitlePosition value,
  ) async {
    subtitlePosition.value = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_subtitlePositionKey, value.name);
  }

  static Future<void> setSubtitleDelayMs(int value) async {
    subtitleDelayMs.value = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_subtitleDelayMsKey, value);
  }

  static Future<void> _saveExcludedFolderIds(Set<String> value) async {
    excludedFolderIds.value = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_excludedFolderIdsKey, value.toList());
  }

  static Future<void> hideFolder(String folderId) =>
      _saveExcludedFolderIds({...excludedFolderIds.value, folderId});

  static Future<void> unhideFolder(String folderId) => _saveExcludedFolderIds(
    excludedFolderIds.value.where((id) => id != folderId).toSet(),
  );
}
