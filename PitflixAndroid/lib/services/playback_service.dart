import 'package:flutter/services.dart';

/// Bridges MyDevicePlayerScreen to PlaybackForegroundService.kt — the foreground service that
/// keeps the process (and audio) alive once the app is backgrounded/screen-locked mid-video, with
/// a play/pause/stop notification. The service never touches the VideoPlayerController directly;
/// button taps come back through [events] as "play"/"pause"/"stop" strings for the player to act
/// on, which then calls [updateState] so the notification mirrors the real playback state.
abstract class PlaybackService {
  static const _channel = MethodChannel('pitflix.dev/playback_service');
  static const _eventsChannel = EventChannel('pitflix.dev/playback_events');

  static Stream<String>? _events;

  /// [durationMs] and [positionMs] feed the system "Now Playing" card's
  /// seek bar / time labels via the MediaSession's metadata + playback state —
  /// without them the card shows 00:00 / 00:00 with an empty bar.
  static Future<void> start(
    String title, {
    required int durationMs,
    required int positionMs,
  }) =>
      _channel.invokeMethod('start', {
        'title': title,
        'durationMs': durationMs,
        'positionMs': positionMs,
      });

  /// [positionMs] keeps the card's seek bar in sync; the OS extrapolates it
  /// forward from the last reported position using the playing/paused state, so
  /// this doesn't need to fire every frame — periodic + on play/pause/seek is
  /// enough. [durationMs] only needs re-sending if it changed (e.g. next video).
  static Future<void> updateState(
    bool isPlaying, {
    required int positionMs,
    int? durationMs,
  }) =>
      _channel.invokeMethod('updateState', {
        'isPlaying': isPlaying,
        'positionMs': positionMs,
        // Null-aware element: entry is omitted when durationMs is null.
        'durationMs': ?durationMs,
      });

  static Future<void> stop() => _channel.invokeMethod('stop');

  /// Emits "play" / "pause" / "stop" when the user taps a notification action.
  static Stream<String> get events {
    return _events ??= _eventsChannel
        .receiveBroadcastStream()
        .map((event) => event as String);
  }
}
