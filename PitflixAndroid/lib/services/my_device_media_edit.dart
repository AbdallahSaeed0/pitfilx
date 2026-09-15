import 'package:flutter/services.dart';

/// Calls MainActivity's native "renameVideo" method (see
/// android/app/.../MainActivity.kt) to rename a MediaStore video's display
/// name — plain dart:io File.rename() can't do this, since these files
/// almost never belong to this app (Android's scoped storage requires a
/// MediaStore ContentResolver update, which needs one-time user consent on
/// API 29+ for files this app didn't create).
abstract class MyDeviceMediaEdit {
  static const _channel = MethodChannel('pitflix.dev/media_store_edit');

  /// [mediaId] is the numeric photo_manager asset id (MyDeviceVideo.id) —
  /// Android's MediaStore row `_id`. Throws on failure/denial; callers
  /// should show that message rather than swallow it, unlike the
  /// best-effort loudness-boost channel — a failed rename is something the
  /// user needs to know about.
  static Future<void> renameVideo(String mediaId, String newDisplayName) {
    return _channel.invokeMethod('renameVideo', {
      'mediaId': int.parse(mediaId),
      'newDisplayName': newDisplayName,
    });
  }
}
