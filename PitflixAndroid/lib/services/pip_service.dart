import 'package:flutter/services.dart';

/// Bridges MyDevicePlayerScreen to MainActivity.kt's Picture-in-Picture support.
/// `enterPictureInPictureMode` is a stock Android Activity method (API 26+) — no third-party
/// plugin needed, just a MethodChannel to trigger it and an EventChannel to hear back when the
/// system actually switches modes (so the player can hide its overlay controls while in PiP).
abstract class PipService {
  static const _channel = MethodChannel('pitflix.dev/pip');
  static const _eventsChannel = EventChannel('pitflix.dev/pip_events');

  static Stream<bool>? _events;

  /// Tell native whether entering PiP makes sense right now (video actively loaded) and what
  /// aspect ratio to use if the user leaves the app (Home button) while it does.
  static Future<void> setPipState({
    required bool eligible,
    required int numerator,
    required int denominator,
  }) {
    return _channel.invokeMethod('setPipState', {
      'eligible': eligible,
      'numerator': numerator,
      'denominator': denominator,
    });
  }

  /// Explicit "enter PiP now" trigger (e.g. a button in the player), independent of the
  /// Home-button auto-trigger in MainActivity.onUserLeaveHint.
  static Future<void> enterPip() => _channel.invokeMethod('enterPip');

  /// True when the system has just switched into/out of PiP mode.
  static Stream<bool> get isInPipStream {
    return _events ??= _eventsChannel
        .receiveBroadcastStream()
        .map((event) => event as bool);
  }
}
