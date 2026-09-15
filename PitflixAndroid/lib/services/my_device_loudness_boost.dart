import 'package:flutter/services.dart';

/// Calls the extra native channel added in the vendored `video_player_android`
/// fork (see `third_party/video_player_android/PITFLIX_PATCH.md`) to boost
/// volume past the 100% ceiling `VideoPlayerController.setVolume` alone can
/// reach — that hard-clamps to [0, 1] in the plugin's own native code.
///
/// Android-only (the channel simply doesn't exist on other platforms, since
/// only the Android side of the plugin was patched); calls are wrapped so a
/// missing channel/platform degrades to "no extra boost" rather than an
/// unhandled exception derailing playback.
abstract class MyDeviceLoudnessBoost {
  static const _channel = MethodChannel('pitflix.dev/video_player_loudness');

  /// [playerId] is `VideoPlayerController.playerId` — the same id
  /// video_player_android's native side already keys its own player map by,
  /// so no separate id-mapping is needed on this side.
  ///
  /// [gainMillibels] is Android's `LoudnessEnhancer` gain unit (100 = 1dB);
  /// 0 disables the boost. Silently no-ops on failure (missing platform,
  /// plugin not yet attached, invalid audio session, etc.) since a lost
  /// volume boost shouldn't be able to crash playback.
  static Future<void> setGain(int playerId, int gainMillibels) async {
    try {
      await _channel.invokeMethod('setLoudnessGain', {
        'playerId': playerId,
        'gainMillibels': gainMillibels,
      });
    } catch (_) {
      // Best-effort — see doc comment above.
    }
  }
}
