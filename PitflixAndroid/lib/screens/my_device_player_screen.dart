import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:screen_brightness/screen_brightness.dart';
import 'package:video_player/video_player.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../models/my_device_subtitle_cue.dart';
import '../models/my_device_video.dart';
import '../services/my_device_loudness_boost.dart';
import '../services/my_device_resume_store.dart';
import '../services/my_device_settings.dart';
import '../services/my_device_subtitle_service.dart';
import '../services/pip_service.dart';
import '../services/playback_service.dart';

/// Local-only palette for My Device's player controls — deliberately not
/// AppColors. The rest of the app reserves purple for the brand mark only
/// (see AppColors' doc comment) and uses white for every other accent, but
/// this spec calls for a purple-accented player specifically, so it's scoped
/// to this screen rather than changing the shared design tokens.
abstract class _PlayerColors {
  static const primary = Color(0xFFA78BFA);
  static const brandFill = Color(0xFF7C3AED);
  static const background = Color(0xFF000000);
  static const controlsScrim = Color(0xCC0A0A0A);
  static const track = Color(0xFF333333);
  static const textPrimary = Color(0xFFFFFFFF);
  static const textMuted = Color(0xFFB0B0B0);
}

enum _PlayerOrientation { horizontal, vertical }

enum _SeekDirection { forward, backward }

/// A brand-new, fully separate player for My Device's local, unsynced
/// videos — not a reskin of the synced library's player. No Supabase calls,
/// no watch_events, no shared state with UserLibraryService; position memory
/// goes through MyDeviceResumeStore only.
///
/// Takes the whole folder's video list (not just one video) so next/prev can
/// move between them without popping back to the folder screen.
class MyDevicePlayerScreen extends StatefulWidget {
  final List<MyDeviceVideo> videos;
  final int initialIndex;

  const MyDevicePlayerScreen({
    super.key,
    required this.videos,
    required this.initialIndex,
  });

  @override
  State<MyDevicePlayerScreen> createState() => _MyDevicePlayerScreenState();
}

class _MyDevicePlayerScreenState extends State<MyDevicePlayerScreen> {
  late int _currentIndex = widget.initialIndex;
  VideoPlayerController? _controller;
  String? _error;
  bool _controlsVisible = true;
  // Starts horizontal (landscape) immediately on open, per spec — not tied
  // to a separate "fullscreen" concept anymore, since the player is always
  // immersive; this only tracks which orientation is locked.
  _PlayerOrientation _orientation = _PlayerOrientation.horizontal;
  bool _scrubbing = false;
  double _scrubValue = 0;
  // 0.0-2.0 (0-200%) — video_player's own VideoPlayerController.setVolume
  // hard-clamps to [0, 1] in native code, so anything above 1.0 is delivered
  // as real gain via the vendored video_player_android's LoudnessEnhancer
  // patch instead (see _applyVolumeTo and third_party/video_player_android/
  // PITFLIX_PATCH.md).
  double _volume = 1;
  static const _maxBoostGainMillibels = 1500; // +15dB of extra gain at 200%.
  Timer? _hideControlsTimer;

  double? _volumeHudValue;
  Timer? _volumeHudTimer;

  // 0.0-1.0 — left-half vertical swipe, mirroring the right-half volume
  // swipe. Scoped to this screen's window via setApplicationBrightness
  // rather than the system-wide brightness setting.
  double _brightness = 0.5;
  double? _brightnessHudValue;
  Timer? _brightnessHudTimer;

  static const _seekSeconds = 5;
  Offset? _pendingDoubleTapPosition;
  _SeekDirection? _seekHudDirection;
  Timer? _seekHudTimer;

  Duration? _sleepTimerRemaining;
  Timer? _sleepTimerTicker;
  bool _sleepTimerWarningOpen = false;
  static const _sleepTimerWarningThreshold = Duration(seconds: 15);

  String? _videoPath;
  List<MyDeviceSubtitleCue> _cues = const [];
  MyDeviceSubtitleCue? _activeCue;

  bool _inPip = false;
  StreamSubscription<bool>? _pipSubscription;
  StreamSubscription<String>? _playbackEventsSubscription;
  // Throttles how often the live playback position is pushed to the foreground
  // service's notification seek bar — _onControllerUpdate fires every frame, but
  // the system card only needs a fresh anchor position every second or so (it
  // animates forward on its own in between).
  DateTime _lastPositionPush = DateTime.fromMillisecondsSinceEpoch(0);

  MyDeviceVideo get _video => widget.videos[_currentIndex];
  bool get _hasPrev => _currentIndex > 0;
  bool get _hasNext => _currentIndex < widget.videos.length - 1;

  @override
  void initState() {
    super.initState();
    _applyOrientation();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    _loadVideo(_currentIndex);
    _initBrightness();

    _pipSubscription = PipService.isInPipStream.listen((inPip) {
      if (!mounted) return;
      setState(() => _inPip = inPip);
      if (!inPip) _resetHideControlsTimer();
    });
    _playbackEventsSubscription = PlaybackService.events.listen((event) {
      final controller = _controller;
      if (controller == null) return;
      // "seek:<ms>" — the user dragged the system notification's seek bar.
      if (event.startsWith('seek:')) {
        final ms = int.tryParse(event.substring(5));
        if (ms != null) _seekFromNotification(Duration(milliseconds: ms));
        return;
      }
      switch (event) {
        case 'play':
          if (!controller.value.isPlaying) _togglePlayPause();
        case 'pause':
          if (controller.value.isPlaying) _togglePlayPause();
        case 'stop':
          _close();
      }
    });
  }

  /// Seeds [_brightness] from the device's actual current brightness so the
  /// first left-side swipe adjusts from where the screen already is instead
  /// of jumping to a hardcoded default. Best-effort — some devices/emulators
  /// don't support reading it, so this silently keeps the 0.5 fallback.
  Future<void> _initBrightness() async {
    try {
      final current = await ScreenBrightness().current;
      if (mounted) setState(() => _brightness = current.clamp(0.0, 1.0));
    } catch (_) {
      // Fallback stays at the default set above.
    }
  }

  Future<void> _applyOrientation() {
    return SystemChrome.setPreferredOrientations(
      _orientation == _PlayerOrientation.horizontal
          ? [DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]
          : [DeviceOrientation.portraitUp],
    );
  }

  Future<void> _toggleOrientation() async {
    setState(() {
      _orientation = _orientation == _PlayerOrientation.horizontal
          ? _PlayerOrientation.vertical
          : _PlayerOrientation.horizontal;
    });
    await _applyOrientation();
  }

  Future<void> _loadVideo(int index) async {
    await _savePosition();
    // Re-enabled after the new video actually starts playing below — if
    // loading fails partway (e.g. file not found), this correctly leaves
    // the wakelock off instead of carrying over the previous video's state.
    await WakelockPlus.disable();
    final oldController = _controller;
    oldController?.removeListener(_onControllerUpdate);

    setState(() {
      _currentIndex = index;
      _controller = null;
      _error = null;
      _cues = const [];
      _activeCue = null;
      _videoPath = null;
    });

    await oldController?.dispose();

    final path = await _video.resolveFilePath();
    if (!mounted) return;
    if (path == null) {
      setState(() => _error = "Couldn't locate this file on device.");
      return;
    }
    _videoPath = path;

    // allowBackgroundPlayback: true is the actual fix for "video stops when the
    // phone is locked/backgrounded". By default the video_player package installs
    // its own _VideoAppLifeCycleObserver (see video_player.dart's initialize())
    // that calls pause() on every AppLifecycleState.paused — a pure Dart-side
    // auto-pause that fires the instant the app backgrounds, entirely
    // independent of (and defeating) the native foreground service, ExoPlayer
    // wake lock, and audio-focus work. Setting this true is what stops that
    // observer from ever being registered, so backgrounding no longer pauses.
    //
    // mixWithOthers: true additionally turns off ExoPlayer's own audio-focus
    // handling (VideoPlayer.java sets handleAudioFocus = !mixWithOthers) so it
    // doesn't auto-pause on AUDIOFOCUS_LOSS (e.g. the system sound some devices
    // play on screen lock). Both are needed together for background audio; this
    // app owns its own "am I the active player" state via
    // PlaybackForegroundService's MediaSession.
    final controller = VideoPlayerController.file(
      File(path),
      videoPlayerOptions: VideoPlayerOptions(
        mixWithOthers: true,
        allowBackgroundPlayback: true,
      ),
    );
    try {
      await controller.initialize();
    } catch (e) {
      await controller.dispose();
      if (!mounted) return;
      setState(() => _error = "Couldn't open this video: $e");
      return;
    }
    if (!mounted) return;

    await _applyVolumeTo(controller, _volume);

    final resumeAt = await MyDeviceResumeStore.loadPosition(_video.id);
    // Don't resume into the last few seconds — that's almost always the
    // point the user finished watching, not a real "pause mid-scene".
    if (resumeAt != null &&
        resumeAt < controller.value.duration - const Duration(seconds: 5)) {
      await controller.seekTo(resumeAt);
    }

    controller.addListener(_onControllerUpdate);
    setState(() => _controller = controller);
    await controller.play();
    // Without this, the OS treats video playback as "no touch input for a
    // while" and dims/locks the screen on its own idle timeout mid-video —
    // there's no gesture activity to reset that timer just from watching.
    await WakelockPlus.enable();
    _resetHideControlsTimer();

    final aspect = controller.value.aspectRatio;
    await PipService.setPipState(
      eligible: true,
      numerator: (aspect * 1000).round().clamp(1, 1 << 30),
      denominator: 1000,
    );
    await PlaybackService.start(
      _video.title,
      durationMs: controller.value.duration.inMilliseconds,
      positionMs: controller.value.position.inMilliseconds,
    );

    await _loadLocalSubtitles(path);
  }

  Future<void> _goNext() async {
    if (_hasNext) await _loadVideo(_currentIndex + 1);
  }

  Future<void> _goPrev() async {
    if (_hasPrev) await _loadVideo(_currentIndex - 1);
  }

  Future<void> _loadLocalSubtitles(String path) async {
    final local = await MyDeviceSubtitleService.discoverLocal(path);
    if (local.isEmpty || !mounted) return;
    // Auto-load the first match — a manual picker (Feature 4's "optional
    // online lookup") is reachable from the subtitle button for anything
    // else.
    final cues = await MyDeviceSubtitleService.loadCuesFromFile(
      local.first.path,
    );
    if (!mounted) return;
    setState(() => _cues = cues);
  }

  void _onControllerUpdate() {
    final controller = _controller;
    if (controller == null || !mounted) return;
    final position = controller.value.position;

    // Keep the notification's seek bar anchored to the real position, but no
    // more than about once a second (the OS animates it forward on its own
    // between pushes, so per-frame updates would be wasted channel traffic).
    if (controller.value.isPlaying) {
      final now = DateTime.now();
      if (now.difference(_lastPositionPush) >= const Duration(seconds: 1)) {
        _lastPositionPush = now;
        PlaybackService.updateState(
          true,
          positionMs: position.inMilliseconds,
        );
      }
    }
    final adjustedPosition =
        position - Duration(milliseconds: MyDeviceSettings.subtitleDelayMs.value);
    MyDeviceSubtitleCue? active;
    for (final cue in _cues) {
      if (cue.containsPosition(adjustedPosition)) {
        active = cue;
        break;
      }
    }
    if (active?.text != _activeCue?.text) {
      setState(() => _activeCue = active);
    } else {
      // Still need to repaint the seek bar/time labels each frame tick.
      setState(() {});
    }
  }

  void _resetHideControlsTimer() {
    _hideControlsTimer?.cancel();
    _hideControlsTimer = Timer(const Duration(seconds: 3), () {
      if (!mounted) return;
      final playing = _controller?.value.isPlaying ?? false;
      if (playing) setState(() => _controlsVisible = false);
    });
  }

  void _toggleControls() {
    setState(() => _controlsVisible = !_controlsVisible);
    if (_controlsVisible) _resetHideControlsTimer();
  }

  Future<void> _togglePlayPause() async {
    final controller = _controller;
    if (controller == null) return;
    if (controller.value.isPlaying) {
      await controller.pause();
      await _savePosition();
      await WakelockPlus.disable();
    } else {
      await controller.play();
      await WakelockPlus.enable();
      _resetHideControlsTimer();
    }
    await PlaybackService.updateState(
      controller.value.isPlaying,
      positionMs: controller.value.position.inMilliseconds,
      durationMs: controller.value.duration.inMilliseconds,
    );
    setState(() {});
  }

  /// Applies a seek requested from the system notification's seek bar, then
  /// immediately re-syncs the notification so its bar snaps to the new spot
  /// instead of waiting for the next throttled push.
  Future<void> _seekFromNotification(Duration target) async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;
    final clamped = target < Duration.zero
        ? Duration.zero
        : (target > controller.value.duration
            ? controller.value.duration
            : target);
    await controller.seekTo(clamped);
    _lastPositionPush = DateTime.now();
    await PlaybackService.updateState(
      controller.value.isPlaying,
      positionMs: clamped.inMilliseconds,
    );
  }

  Future<void> _savePosition() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;
    await MyDeviceResumeStore.savePosition(_video.id, controller.value.position);
  }

  Future<void> _restoreSystemChrome() async {
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    await SystemChrome.setPreferredOrientations(DeviceOrientation.values);
  }

  Future<void> _close() async {
    await _savePosition();
    await _restoreSystemChrome();
    if (mounted) Navigator.of(context).pop();
  }

  /// Splits [v] (0.0-2.0) across the two mechanisms that actually make it
  /// audible: VideoPlayerController.setVolume for the 0-100% range it
  /// natively supports, and the vendored plugin's LoudnessEnhancer channel
  /// for real gain in the 100-200% range setVolume alone can't reach.
  Future<void> _applyVolumeTo(VideoPlayerController controller, double v) async {
    await controller.setVolume(v.clamp(0.0, 1.0));
    final boostFraction = (v - 1.0).clamp(0.0, 1.0);
    // controller.playerId is @visibleForTesting ("shouldn't be used by
    // anyone depending on the plugin") — see the pinned-version comment on
    // the video_player dependency in pubspec.yaml for why that's an
    // accepted, documented risk here rather than an oversight.
    // ignore: invalid_use_of_visible_for_testing_member
    final playerId = controller.playerId;
    await MyDeviceLoudnessBoost.setGain(
      playerId,
      (boostFraction * _maxBoostGainMillibels).round(),
    );
  }

  /// Right-half vertical swipe → volume, 0-200%.
  void _onVolumeDragUpdate(DragUpdateDetails details, double screenHeight) {
    // *2 so a full-height drag still spans the whole 0-200% range now that
    // it's twice as wide as the old 0-100% one.
    final delta = -details.delta.dy / screenHeight * 2;
    final next = (_volume + delta).clamp(0.0, 2.0);
    setState(() {
      _volume = next;
      _volumeHudValue = next;
    });
    final controller = _controller;
    if (controller != null) _applyVolumeTo(controller, next);
    _volumeHudTimer?.cancel();
    _volumeHudTimer = Timer(const Duration(milliseconds: 700), () {
      if (mounted) setState(() => _volumeHudValue = null);
    });
  }

  Future<void> _applyBrightnessTo(double v) async {
    try {
      await ScreenBrightness().setScreenBrightness(v.clamp(0.0, 1.0));
    } catch (_) {
      // Unsupported on this device — the HUD/slider still track the value
      // in-app even if the OS call itself is a no-op.
    }
  }

  /// Left-half vertical swipe → screen brightness, 0-100%.
  void _onBrightnessDragUpdate(DragUpdateDetails details, double screenHeight) {
    final delta = -details.delta.dy / screenHeight;
    final next = (_brightness + delta).clamp(0.0, 1.0);
    setState(() {
      _brightness = next;
      _brightnessHudValue = next;
    });
    _applyBrightnessTo(next);
    _brightnessHudTimer?.cancel();
    _brightnessHudTimer = Timer(const Duration(milliseconds: 700), () {
      if (mounted) setState(() => _brightnessHudValue = null);
    });
  }

  void _onDoubleTapDown(TapDownDetails details) {
    // GestureDetector's onDoubleTap fires with no position of its own, so
    // the down-position from the tap that triggered it is captured here to
    // read back once the double-tap is actually recognized.
    _pendingDoubleTapPosition = details.localPosition;
  }

  Future<void> _onDoubleTap(double screenWidth) async {
    final position = _pendingDoubleTapPosition;
    if (position == null) return;
    final forward = position.dx > screenWidth / 2;
    await _seekBy(
      Duration(seconds: forward ? _seekSeconds : -_seekSeconds),
    );
    if (!mounted) return;
    setState(
      () => _seekHudDirection = forward
          ? _SeekDirection.forward
          : _SeekDirection.backward,
    );
    _seekHudTimer?.cancel();
    _seekHudTimer = Timer(const Duration(milliseconds: 500), () {
      if (mounted) setState(() => _seekHudDirection = null);
    });
  }

  Future<void> _seekBy(Duration delta) async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;
    final target = controller.value.position + delta;
    final clamped = target < Duration.zero
        ? Duration.zero
        : (target > controller.value.duration
              ? controller.value.duration
              : target);
    await controller.seekTo(clamped);
    _lastPositionPush = DateTime.now();
    await PlaybackService.updateState(
      controller.value.isPlaying,
      positionMs: clamped.inMilliseconds,
    );
  }

  Future<void> _openSubtitlePicker() async {
    final path = _videoPath;
    if (path == null) return;
    final selected = await showModalBottomSheet<MyDeviceSubtitleOption>(
      context: context,
      backgroundColor: const Color(0xFF161616),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) =>
          _SubtitlePickerSheet(videoPath: path, videoTitle: _video.title),
    );
    if (selected == null || !mounted) return;
    try {
      final localPath = selected.isLocal
          ? selected.path
          : await MyDeviceSubtitleService.downloadAndSave(selected, path);
      final cues = await MyDeviceSubtitleService.loadCuesFromFile(localPath);
      if (!mounted) return;
      setState(() => _cues = cues);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't load subtitle: $e")));
    }
  }

  Future<void> _openSubtitleStyleSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF161616),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => const _SubtitleStyleSheet(),
    );
  }

  Future<void> _openSleepTimerSheet() async {
    final result = await showModalBottomSheet<Duration>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF161616),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => _SleepTimerSheet(currentRemaining: _sleepTimerRemaining),
    );
    if (result == null) return;
    if (result == Duration.zero) {
      _cancelSleepTimer();
    } else {
      _startSleepTimer(result);
    }
  }

  void _startSleepTimer(Duration duration) {
    _sleepTimerTicker?.cancel();
    setState(() => _sleepTimerRemaining = duration);
    _sleepTimerTicker = Timer.periodic(
      const Duration(seconds: 1),
      (_) => _tickSleepTimer(),
    );
  }

  void _cancelSleepTimer() {
    _sleepTimerTicker?.cancel();
    _sleepTimerTicker = null;
    if (_sleepTimerWarningOpen && mounted) {
      Navigator.of(context, rootNavigator: true).pop();
    }
    setState(() => _sleepTimerRemaining = null);
  }

  void _extendSleepTimer(Duration extra) {
    setState(
      () => _sleepTimerRemaining = (_sleepTimerRemaining ?? Duration.zero) + extra,
    );
  }

  void _tickSleepTimer() {
    final remaining = _sleepTimerRemaining;
    if (remaining == null) return;
    final next = remaining - const Duration(seconds: 1);

    if (next <= Duration.zero) {
      _sleepTimerTicker?.cancel();
      _sleepTimerTicker = null;
      if (_sleepTimerWarningOpen && mounted) {
        Navigator.of(context, rootNavigator: true).pop();
      }
      setState(() => _sleepTimerRemaining = null);
      if (_controller?.value.isPlaying ?? false) _togglePlayPause();
      return;
    }

    setState(() => _sleepTimerRemaining = next);
    if (next == _sleepTimerWarningThreshold) _showSleepTimerWarning();
  }

  void _showSleepTimerWarning() {
    if (_sleepTimerWarningOpen) return;
    _sleepTimerWarningOpen = true;
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF161616),
        title: Text(
          'Sleep timer ending',
          style: GoogleFonts.dmSans(
            fontWeight: FontWeight.w600,
            color: _PlayerColors.textPrimary,
          ),
        ),
        content: Text(
          'Pausing in 15 seconds.',
          style: GoogleFonts.dmSans(color: _PlayerColors.textMuted),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(context).pop();
              _cancelSleepTimer();
            },
            child: Text(
              'Cancel timer',
              style: GoogleFonts.dmSans(color: _PlayerColors.textMuted),
            ),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(context).pop();
              _extendSleepTimer(const Duration(minutes: 15));
            },
            child: Text(
              '+15 min',
              style: GoogleFonts.dmSans(
                fontWeight: FontWeight.w600,
                color: _PlayerColors.primary,
              ),
            ),
          ),
        ],
      ),
    ).then((_) => _sleepTimerWarningOpen = false);
  }

  @override
  void dispose() {
    _hideControlsTimer?.cancel();
    _volumeHudTimer?.cancel();
    _brightnessHudTimer?.cancel();
    _seekHudTimer?.cancel();
    _sleepTimerTicker?.cancel();
    _pipSubscription?.cancel();
    _playbackEventsSubscription?.cancel();
    _controller?.removeListener(_onControllerUpdate);
    _controller?.dispose();
    _restoreSystemChrome();
    // Only this screen's window was dimmed (setScreenBrightness), not the
    // system-wide setting, but it still needs resetting on the way out or
    // the rest of the app would stay at whatever level was last swiped to.
    ScreenBrightness().resetScreenBrightness().catchError((_) {});
    WakelockPlus.disable();
    PipService.setPipState(eligible: false, numerator: 16, denominator: 9);
    PlaybackService.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _close();
      },
      child: Scaffold(
        backgroundColor: _PlayerColors.background,
        body: SafeArea(
          top: false,
          bottom: false,
          child: LayoutBuilder(
            builder: (context, constraints) {
              return _error != null
                  ? _ErrorView(message: _error!, onBack: _close)
                  : (_controller == null || !_controller!.value.isInitialized)
                  ? const Center(
                      child: CircularProgressIndicator(
                        color: _PlayerColors.primary,
                      ),
                    )
                  : GestureDetector(
                      onTap: _toggleControls,
                      onDoubleTapDown: _onDoubleTapDown,
                      onDoubleTap: () => _onDoubleTap(constraints.maxWidth),
                      onVerticalDragUpdate: (details) {
                        if (details.localPosition.dx < constraints.maxWidth / 2) {
                          _onBrightnessDragUpdate(details, constraints.maxHeight);
                        } else {
                          _onVolumeDragUpdate(details, constraints.maxHeight);
                        }
                      },
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          Center(
                            child: AspectRatio(
                              aspectRatio: _controller!.value.aspectRatio,
                              child: VideoPlayer(_controller!),
                            ),
                          ),
                          if (_activeCue != null)
                            _SubtitleOverlay(text: _activeCue!.text),
                          if (_volumeHudValue != null)
                            _VolumeHud(value: _volumeHudValue!),
                          if (_brightnessHudValue != null)
                            _BrightnessHud(value: _brightnessHudValue!),
                          if (_seekHudDirection != null)
                            _SeekHud(
                              direction: _seekHudDirection!,
                              seconds: _seekSeconds,
                            ),
                          if (_controlsVisible && !_inPip)
                            _PlayerControls(
                              title: _video.title,
                              controller: _controller!,
                              orientation: _orientation,
                              scrubbing: _scrubbing,
                              scrubValue: _scrubValue,
                              volume: _volume,
                              hasSubtitles: _cues.isNotEmpty,
                              hasPrev: _hasPrev,
                              hasNext: _hasNext,
                              onClose: _close,
                              onTogglePlayPause: _togglePlayPause,
                              onToggleOrientation: _toggleOrientation,
                              onOpenSubtitles: _openSubtitlePicker,
                              onOpenSubtitleStyle: _openSubtitleStyleSheet,
                              sleepTimerRemaining: _sleepTimerRemaining,
                              onOpenSleepTimer: _openSleepTimerSheet,
                              onEnterPip: () => PipService.enterPip(),
                              onPrev: _goPrev,
                              onNext: _goNext,
                              onScrubStart: () =>
                                  setState(() => _scrubbing = true),
                              onScrubChanged: (v) =>
                                  setState(() => _scrubValue = v),
                              onScrubEnd: (v) async {
                                setState(() => _scrubbing = false);
                                final target = _controller!.value.duration * v;
                                await _controller!.seekTo(target);
                                _lastPositionPush = DateTime.now();
                                await PlaybackService.updateState(
                                  _controller!.value.isPlaying,
                                  positionMs: target.inMilliseconds,
                                );
                              },
                              onVolumeChanged: (v) {
                                setState(() => _volume = v);
                                _applyVolumeTo(_controller!, v);
                              },
                            ),
                        ],
                      ),
                    );
            },
          ),
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onBack;

  const _ErrorView({required this.message, required this.onBack});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              message,
              textAlign: TextAlign.center,
              style: GoogleFonts.dmSans(
                fontSize: 14,
                color: _PlayerColors.textMuted,
              ),
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: onBack,
              child: Text(
                'Back',
                style: GoogleFonts.dmSans(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: _PlayerColors.primary,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Right-aligned (not dead-center) so it doesn't sit on top of the center
/// play/pause button — matches the right-half swipe region that drives it.
class _VolumeHud extends StatelessWidget {
  final double value;

  const _VolumeHud({required this.value});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerRight,
      child: Padding(
        padding: const EdgeInsets.only(right: 32),
        child: IgnorePointer(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.7),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  value == 0 ? Icons.volume_off : Icons.volume_up,
                  color: _PlayerColors.primary,
                  size: 28,
                ),
                const SizedBox(height: 6),
                Text(
                  '${(value * 100).round()}%',
                  style: GoogleFonts.dmSans(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: _PlayerColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Mirrors _VolumeHud, left-aligned for the left-half brightness swipe.
class _BrightnessHud extends StatelessWidget {
  final double value;

  const _BrightnessHud({required this.value});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.only(left: 32),
        child: IgnorePointer(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.7),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  value < 0.5 ? Icons.brightness_low : Icons.brightness_high,
                  color: _PlayerColors.primary,
                  size: 28,
                ),
                const SizedBox(height: 6),
                Text(
                  '${(value * 100).round()}%',
                  style: GoogleFonts.dmSans(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: _PlayerColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Brief feedback for the double-tap-to-seek gesture — right side skips
/// forward, left side skips back (see _MyDevicePlayerScreenState.
/// _onDoubleTap). Positioned toward whichever side was tapped rather than
/// dead center, so it reads as "this side of the screen did something"
/// instead of competing with the volume HUD's centered spot.
class _SeekHud extends StatelessWidget {
  final _SeekDirection direction;
  final int seconds;

  const _SeekHud({required this.direction, required this.seconds});

  @override
  Widget build(BuildContext context) {
    final forward = direction == _SeekDirection.forward;
    return Align(
      alignment: forward ? Alignment.centerRight : Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 48),
        child: IgnorePointer(
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.7),
              shape: BoxShape.circle,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  forward ? Icons.fast_forward : Icons.fast_rewind,
                  color: _PlayerColors.primary,
                  size: 26,
                ),
                const SizedBox(height: 2),
                Text(
                  '${seconds}s',
                  style: GoogleFonts.dmSans(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: _PlayerColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SubtitleOverlay extends StatelessWidget {
  final String text;

  const _SubtitleOverlay({required this.text});

  /// Vertical alignment (-1 = screen top, 0 = dead center, 1 = screen
  /// bottom) for each setting, kept a little inset from the true edges so
  /// "Top"/"Bottom" don't collide with the title bar/seek bar. Previously
  /// this used a Positioned with only one of top/bottom set per case (plus
  /// an inner Align) — but when *neither* top nor bottom is set (the
  /// "middle" case), Positioned shrink-wraps to the child and its position
  /// falls back to the parent Stack's own alignment, which defaults to
  /// top-start, not center. That's what made "Middle" render near the top;
  /// the inner Align never had any extra space to actually center within.
  /// Positioned.fill + Align sidesteps that entirely — the box always fills
  /// the whole screen, so Align's alignment is the only thing that matters.
  static const _alignmentY = {
    MyDeviceSubtitlePosition.top: -0.78,
    MyDeviceSubtitlePosition.middle: 0.0,
    MyDeviceSubtitlePosition.bottom: 0.82,
  };

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<double>(
      valueListenable: MyDeviceSettings.subtitleFontSize,
      builder: (context, fontSize, _) {
        return ValueListenableBuilder<MyDeviceSubtitlePosition>(
          valueListenable: MyDeviceSettings.subtitlePosition,
          builder: (context, position, _) {
            return Positioned.fill(
              child: IgnorePointer(
                child: Align(
                  alignment: Alignment(0, _alignmentY[position]!),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.6),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        text,
                        textAlign: TextAlign.center,
                        style: GoogleFonts.dmSans(
                          fontSize: fontSize,
                          fontWeight: FontWeight.w600,
                          color: _PlayerColors.textPrimary,
                          height: 1.3,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }
}

class _PlayerControls extends StatelessWidget {
  final String title;
  final VideoPlayerController controller;
  final _PlayerOrientation orientation;
  final bool scrubbing;
  final double scrubValue;
  final double volume;
  final bool hasSubtitles;
  final bool hasPrev;
  final bool hasNext;
  final VoidCallback onClose;
  final VoidCallback onTogglePlayPause;
  final VoidCallback onToggleOrientation;
  final VoidCallback onOpenSubtitles;
  final VoidCallback onOpenSubtitleStyle;
  final Duration? sleepTimerRemaining;
  final VoidCallback onOpenSleepTimer;
  final VoidCallback onEnterPip;
  final VoidCallback onPrev;
  final VoidCallback onNext;
  final VoidCallback onScrubStart;
  final ValueChanged<double> onScrubChanged;
  final ValueChanged<double> onScrubEnd;
  final ValueChanged<double> onVolumeChanged;

  const _PlayerControls({
    required this.title,
    required this.controller,
    required this.orientation,
    required this.scrubbing,
    required this.scrubValue,
    required this.volume,
    required this.hasSubtitles,
    required this.hasPrev,
    required this.hasNext,
    required this.onClose,
    required this.onTogglePlayPause,
    required this.onToggleOrientation,
    required this.onOpenSubtitles,
    required this.onOpenSubtitleStyle,
    required this.sleepTimerRemaining,
    required this.onOpenSleepTimer,
    required this.onEnterPip,
    required this.onPrev,
    required this.onNext,
    required this.onScrubStart,
    required this.onScrubChanged,
    required this.onScrubEnd,
    required this.onVolumeChanged,
  });

  String _formatDuration(Duration d) {
    final hours = d.inHours;
    final minutes = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return hours > 0 ? '$hours:$minutes:$seconds' : '$minutes:$seconds';
  }

  String _formatSleepTimerRemaining(Duration d) {
    final minutes = d.inMinutes;
    final seconds = d.inSeconds.remainder(60);
    return minutes > 0 ? '${minutes}m ${seconds}s' : '${seconds}s';
  }

  @override
  Widget build(BuildContext context) {
    final value = controller.value;
    final duration = value.duration;
    final position = value.position;
    final progress = duration.inMilliseconds == 0
        ? 0.0
        : position.inMilliseconds / duration.inMilliseconds;

    return Stack(
      children: [
        // Top bar — back/close + title + subtitle actions.
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          child: Container(
            padding: const EdgeInsets.fromLTRB(8, 8, 16, 24),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [_PlayerColors.controlsScrim, Colors.transparent],
              ),
            ),
            child: Row(
              children: [
                IconButton(
                  onPressed: onClose,
                  icon: const Icon(
                    Icons.close,
                    color: _PlayerColors.textPrimary,
                  ),
                ),
                IconButton(
                  onPressed: onEnterPip,
                  tooltip: 'Picture-in-picture',
                  icon: const Icon(
                    Icons.picture_in_picture_alt_outlined,
                    color: _PlayerColors.textPrimary,
                  ),
                ),
                Expanded(
                  child: Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: GoogleFonts.bebasNeue(
                      fontSize: 20,
                      letterSpacing: 0.6,
                      color: _PlayerColors.textPrimary,
                    ),
                  ),
                ),
                if (hasSubtitles)
                  const Icon(
                    Icons.subtitles,
                    size: 18,
                    color: _PlayerColors.primary,
                  ),
                IconButton(
                  onPressed: onOpenSubtitleStyle,
                  tooltip: 'Subtitle style',
                  icon: const Icon(
                    Icons.tune,
                    color: _PlayerColors.textPrimary,
                  ),
                ),
                IconButton(
                  onPressed: onOpenSubtitles,
                  tooltip: 'Subtitles',
                  icon: const Icon(
                    Icons.closed_caption_outlined,
                    color: _PlayerColors.textPrimary,
                  ),
                ),
                IconButton(
                  onPressed: onOpenSleepTimer,
                  tooltip: sleepTimerRemaining != null
                      ? 'Sleep timer: ${_formatSleepTimerRemaining(sleepTimerRemaining!)}'
                      : 'Sleep timer',
                  icon: Icon(
                    sleepTimerRemaining != null
                        ? Icons.bedtime
                        : Icons.bedtime_outlined,
                    color: sleepTimerRemaining != null
                        ? _PlayerColors.primary
                        : _PlayerColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        ),

        // Center transport — prev / play-pause / next.
        Center(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                onPressed: hasPrev ? onPrev : null,
                iconSize: 34,
                icon: Icon(
                  Icons.skip_previous,
                  color: hasPrev
                      ? _PlayerColors.textPrimary
                      : _PlayerColors.track,
                ),
              ),
              const SizedBox(width: 12),
              GestureDetector(
                onTap: onTogglePlayPause,
                child: Container(
                  width: 64,
                  height: 64,
                  decoration: const BoxDecoration(
                    color: _PlayerColors.brandFill,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    value.isPlaying ? Icons.pause : Icons.play_arrow,
                    color: _PlayerColors.textPrimary,
                    size: 34,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              IconButton(
                onPressed: hasNext ? onNext : null,
                iconSize: 34,
                icon: Icon(
                  Icons.skip_next,
                  color: hasNext
                      ? _PlayerColors.textPrimary
                      : _PlayerColors.track,
                ),
              ),
            ],
          ),
        ),

        // Bottom bar — seek bar, time, volume, orientation.
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: Container(
            padding: const EdgeInsets.fromLTRB(16, 24, 16, 12),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.bottomCenter,
                end: Alignment.topCenter,
                colors: [_PlayerColors.controlsScrim, Colors.transparent],
              ),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                SliderTheme(
                  data: SliderTheme.of(context).copyWith(
                    trackHeight: 3,
                    activeTrackColor: _PlayerColors.primary,
                    inactiveTrackColor: _PlayerColors.track,
                    thumbColor: _PlayerColors.primary,
                    overlayColor: _PlayerColors.primary.withValues(alpha: 0.2),
                    thumbShape: const RoundSliderThumbShape(
                      enabledThumbRadius: 6,
                    ),
                  ),
                  child: Slider(
                    value: (scrubbing ? scrubValue : progress).clamp(0.0, 1.0),
                    onChangeStart: (_) => onScrubStart(),
                    onChanged: onScrubChanged,
                    onChangeEnd: onScrubEnd,
                  ),
                ),
                Row(
                  children: [
                    Text(
                      _formatDuration(
                        scrubbing ? duration * scrubValue : position,
                      ),
                      style: GoogleFonts.dmSans(
                        fontSize: 12,
                        color: _PlayerColors.textMuted,
                      ),
                    ),
                    const Spacer(),
                    Text(
                      _formatDuration(duration),
                      style: GoogleFonts.dmSans(
                        fontSize: 12,
                        color: _PlayerColors.textMuted,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Icon(
                      volume == 0 ? Icons.volume_off : Icons.volume_up,
                      size: 18,
                      color: _PlayerColors.textPrimary,
                    ),
                    SizedBox(
                      width: 70,
                      child: SliderTheme(
                        data: SliderTheme.of(context).copyWith(
                          trackHeight: 2,
                          activeTrackColor: _PlayerColors.primary,
                          inactiveTrackColor: _PlayerColors.track,
                          thumbColor: _PlayerColors.primary,
                          thumbShape: const RoundSliderThumbShape(
                            enabledThumbRadius: 5,
                          ),
                        ),
                        child: Slider(
                          value: volume,
                          max: 2,
                          onChanged: onVolumeChanged,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: onToggleOrientation,
                      tooltip: orientation == _PlayerOrientation.horizontal
                          ? 'Switch to vertical'
                          : 'Switch to horizontal',
                      icon: Icon(
                        orientation == _PlayerOrientation.horizontal
                            ? Icons.stay_current_portrait
                            : Icons.stay_current_landscape,
                        color: _PlayerColors.textPrimary,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _SubtitleStyleSheet extends StatelessWidget {
  const _SubtitleStyleSheet();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'SUBTITLE STYLE',
              style: GoogleFonts.bebasNeue(
                fontSize: 18,
                letterSpacing: 0.5,
                color: _PlayerColors.primary,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Size',
              style: GoogleFonts.dmSans(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: _PlayerColors.textMuted,
              ),
            ),
            ValueListenableBuilder<double>(
              valueListenable: MyDeviceSettings.subtitleFontSize,
              builder: (context, size, _) => SliderTheme(
                data: SliderTheme.of(context).copyWith(
                  activeTrackColor: _PlayerColors.primary,
                  inactiveTrackColor: _PlayerColors.track,
                  thumbColor: _PlayerColors.primary,
                ),
                child: Slider(
                  value: size,
                  min: 12,
                  max: 28,
                  divisions: 16,
                  label: size.round().toString(),
                  onChanged: MyDeviceSettings.setSubtitleFontSize,
                ),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Position',
              style: GoogleFonts.dmSans(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: _PlayerColors.textMuted,
              ),
            ),
            const SizedBox(height: 8),
            ValueListenableBuilder<MyDeviceSubtitlePosition>(
              valueListenable: MyDeviceSettings.subtitlePosition,
              builder: (context, position, _) => Row(
                children: [
                  for (final option in MyDeviceSubtitlePosition.values)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(
                          option.name[0].toUpperCase() +
                              option.name.substring(1),
                        ),
                        selected: position == option,
                        onSelected: (_) =>
                            MyDeviceSettings.setSubtitlePosition(option),
                        selectedColor: _PlayerColors.brandFill,
                        backgroundColor: _PlayerColors.track,
                        labelStyle: GoogleFonts.dmSans(
                          fontSize: 12,
                          color: _PlayerColors.textPrimary,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Delay',
              style: GoogleFonts.dmSans(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: _PlayerColors.textMuted,
              ),
            ),
            ValueListenableBuilder<int>(
              valueListenable: MyDeviceSettings.subtitleDelayMs,
              builder: (context, delayMs, _) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SliderTheme(
                    data: SliderTheme.of(context).copyWith(
                      activeTrackColor: _PlayerColors.primary,
                      inactiveTrackColor: _PlayerColors.track,
                      thumbColor: _PlayerColors.primary,
                    ),
                    child: Slider(
                      value: delayMs.clamp(-10000, 10000).toDouble(),
                      min: -10000,
                      max: 10000,
                      divisions: 80,
                      label: '${(delayMs / 1000).toStringAsFixed(1)}s',
                      onChanged: (v) =>
                          MyDeviceSettings.setSubtitleDelayMs(v.round()),
                    ),
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '${(delayMs / 1000).toStringAsFixed(1)}s',
                        style: GoogleFonts.dmSans(
                          fontSize: 12,
                          color: _PlayerColors.textPrimary,
                        ),
                      ),
                      if (delayMs != 0)
                        GestureDetector(
                          onTap: () => MyDeviceSettings.setSubtitleDelayMs(0),
                          child: Text(
                            'Reset',
                            style: GoogleFonts.dmSans(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: _PlayerColors.primary,
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SleepTimerSheet extends StatelessWidget {
  final Duration? currentRemaining;

  const _SleepTimerSheet({this.currentRemaining});

  static const _presetMinutes = [15, 30, 45, 60, 90];

  String _formatRemaining(Duration d) {
    final minutes = d.inMinutes;
    final seconds = d.inSeconds.remainder(60);
    return minutes > 0 ? '${minutes}m ${seconds}s' : '${seconds}s';
  }

  Future<void> _openCustomDurationDialog(BuildContext context) async {
    // A bottom sheet rather than a centered AlertDialog — a centered dialog
    // gets squeezed into whatever sliver of screen is left above the
    // keyboard (reported as looking broken/unresponsive); a bottom sheet
    // with viewInsets padding rides up above the keyboard properly instead.
    final minutes = await showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF161616),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => const _CustomSleepDurationSheet(),
    );
    if (minutes == null || !context.mounted) return;
    Navigator.of(context).pop(Duration(minutes: minutes));
  }

  @override
  Widget build(BuildContext context) {
    // isScrollControlled (set by the caller) lets this sheet grow past the
    // default ~half-screen cap, but it still needs an explicit ceiling +
    // scroll view — without either, adding the "Custom…" row pushed this
    // past the screen edge (reported as a 121px bottom overflow).
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.8,
        ),
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'SLEEP TIMER',
                  style: GoogleFonts.bebasNeue(
                    fontSize: 18,
                    letterSpacing: 0.5,
                    color: _PlayerColors.primary,
                  ),
                ),
                if (currentRemaining != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Currently pausing in ${_formatRemaining(currentRemaining!)}',
                    style: GoogleFonts.dmSans(
                      fontSize: 12,
                      color: _PlayerColors.textMuted,
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                for (final minutes in _presetMinutes)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(
                      Icons.bedtime_outlined,
                      color: _PlayerColors.textMuted,
                      size: 18,
                    ),
                    title: Text(
                      '$minutes minutes',
                      style: GoogleFonts.dmSans(
                        fontSize: 13,
                        color: _PlayerColors.textPrimary,
                      ),
                    ),
                    onTap: () =>
                        Navigator.of(context).pop(Duration(minutes: minutes)),
                  ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(
                    Icons.edit_outlined,
                    color: _PlayerColors.textMuted,
                    size: 18,
                  ),
                  title: Text(
                    'Custom…',
                    style: GoogleFonts.dmSans(
                      fontSize: 13,
                      color: _PlayerColors.textPrimary,
                    ),
                  ),
                  onTap: () => _openCustomDurationDialog(context),
                ),
                if (currentRemaining != null)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(
                      Icons.close,
                      color: _PlayerColors.textMuted,
                      size: 18,
                    ),
                    title: Text(
                      'Off',
                      style: GoogleFonts.dmSans(
                        fontSize: 13,
                        color: _PlayerColors.textPrimary,
                      ),
                    ),
                    onTap: () => Navigator.of(context).pop(Duration.zero),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Numeric-minutes entry for the sleep timer's "Custom…" option — a bottom
/// sheet (not a centered AlertDialog) so it rides up above the keyboard
/// properly via viewInsets padding instead of getting squeezed into
/// whatever space is left, which is what made the old dialog look broken.
/// Pops the entered minute count, or null if cancelled/invalid.
class _CustomSleepDurationSheet extends StatefulWidget {
  const _CustomSleepDurationSheet();

  @override
  State<_CustomSleepDurationSheet> createState() =>
      _CustomSleepDurationSheetState();
}

class _CustomSleepDurationSheetState
    extends State<_CustomSleepDurationSheet> {
  static const _maxMinutes = 720; // 12h — generous ceiling, not a real limit
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final minutes = int.tryParse(_controller.text.trim());
    if (minutes == null || minutes <= 0) return;
    Navigator.of(context).pop(minutes.clamp(1, _maxMinutes));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      // Rides up above the on-screen keyboard as it opens/closes.
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        // The local player runs in landscape, so once the keyboard opens there's
        // very little vertical room left — without this scroll view the title +
        // field + buttons overflow the remaining space (reported as a 121px
        // bottom overflow). SingleChildScrollView lets the content scroll within
        // whatever height is left instead of overflowing it.
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
              Text(
                'CUSTOM SLEEP TIMER',
                style: GoogleFonts.bebasNeue(
                  fontSize: 18,
                  letterSpacing: 0.5,
                  color: _PlayerColors.primary,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _controller,
                autofocus: true,
                keyboardType: TextInputType.number,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(3),
                ],
                style: GoogleFonts.dmSans(color: _PlayerColors.textPrimary),
                decoration: InputDecoration(
                  suffixText: 'minutes',
                  suffixStyle: GoogleFonts.dmSans(color: _PlayerColors.textMuted),
                  hintText: 'e.g. 20',
                  hintStyle: GoogleFonts.dmSans(color: _PlayerColors.textMuted),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide(color: _PlayerColors.track),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: _PlayerColors.primary),
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
                onSubmitted: (_) => _submit(),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: Text(
                      'Cancel',
                      style: GoogleFonts.dmSans(color: _PlayerColors.textMuted),
                    ),
                  ),
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: _submit,
                    child: Text(
                      'Start',
                      style: GoogleFonts.dmSans(
                        fontWeight: FontWeight.w600,
                        color: _PlayerColors.primary,
                      ),
                    ),
                  ),
                ],
              ),
            ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SubtitlePickerSheet extends StatefulWidget {
  final String videoPath;
  final String videoTitle;

  const _SubtitlePickerSheet({
    required this.videoPath,
    required this.videoTitle,
  });

  @override
  State<_SubtitlePickerSheet> createState() => _SubtitlePickerSheetState();
}

class _SubtitlePickerSheetState extends State<_SubtitlePickerSheet> {
  List<MyDeviceSubtitleOption> _local = const [];
  List<MyDeviceSubtitleOption>? _online;
  bool _searchingOnline = false;

  @override
  void initState() {
    super.initState();
    MyDeviceSubtitleService.discoverLocal(widget.videoPath).then((options) {
      if (mounted) setState(() => _local = options);
    });
  }

  Future<void> _searchOnline() async {
    setState(() => _searchingOnline = true);
    final results = await Future.wait([
      MyDeviceSubtitleService.searchOpenSubtitles(widget.videoTitle),
      MyDeviceSubtitleService.searchSubdl(widget.videoTitle),
    ]);
    if (!mounted) return;
    setState(() {
      _online = [...results[0], ...results[1]];
      _searchingOnline = false;
    });
  }

  /// Escape hatch for subtitles [MyDeviceSubtitleService.discoverLocal]
  /// can't find — that helper only looks in the video's own folder with a
  /// filename-prefix match, so a subtitle downloaded somewhere else (e.g.
  /// Downloads) never surfaces automatically. Returned as a regular local
  /// [MyDeviceSubtitleOption] so it flows through the same load path as
  /// every other option in this sheet.
  Future<void> _browseDeviceFiles() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['srt', 'ass', 'ssa'],
    );
    final path = picked?.files.single.path;
    if (path == null || !mounted) return;
    Navigator.of(context).pop(
      MyDeviceSubtitleOption(
        label: path.split(Platform.pathSeparator).last,
        isLocal: true,
        path: path,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'SUBTITLES',
              style: GoogleFonts.bebasNeue(
                fontSize: 18,
                letterSpacing: 0.5,
                color: _PlayerColors.primary,
              ),
            ),
            const SizedBox(height: 12),
            if (_local.isEmpty && _online == null)
              Text(
                'No local subtitle files found next to this video.',
                style: GoogleFonts.dmSans(
                  fontSize: 13,
                  color: _PlayerColors.textMuted,
                ),
              ),
            for (final option in _local)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(
                  Icons.folder_outlined,
                  color: _PlayerColors.textMuted,
                  size: 18,
                ),
                title: Text(
                  option.label,
                  style: GoogleFonts.dmSans(
                    fontSize: 13,
                    color: _PlayerColors.textPrimary,
                  ),
                ),
                onTap: () => Navigator.of(context).pop(option),
              ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: _browseDeviceFiles,
              icon: const Icon(
                Icons.folder_open,
                size: 16,
                color: _PlayerColors.primary,
              ),
              label: Text(
                'Browse device files…',
                style: GoogleFonts.dmSans(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: _PlayerColors.primary,
                ),
              ),
            ),
            const SizedBox(height: 4),
            if (_online == null)
              TextButton.icon(
                onPressed: _searchingOnline ? null : _searchOnline,
                icon: _searchingOnline
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: _PlayerColors.primary,
                        ),
                      )
                    : const Icon(
                        Icons.search,
                        size: 16,
                        color: _PlayerColors.primary,
                      ),
                label: Text(
                  'Search Online',
                  style: GoogleFonts.dmSans(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: _PlayerColors.primary,
                  ),
                ),
              )
            else if (_online!.isEmpty)
              Text(
                'No online results (check API keys in Settings).',
                style: GoogleFonts.dmSans(
                  fontSize: 13,
                  color: _PlayerColors.textMuted,
                ),
              )
            else
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 240),
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final option in _online!)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(
                          Icons.cloud_outlined,
                          color: _PlayerColors.textMuted,
                          size: 18,
                        ),
                        title: Text(
                          option.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: GoogleFonts.dmSans(
                            fontSize: 13,
                            color: _PlayerColors.textPrimary,
                          ),
                        ),
                        onTap: () => Navigator.of(context).pop(option),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
