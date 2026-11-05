import 'dart:async';

import 'package:flutter/services.dart';

/// A subtitle track stored inside the video file itself (MKV/MP4) — listed
/// by ExoPlayer, which the stock video_player plugin never exposes.
class MyDeviceEmbeddedSubtitleTrack {
  final int groupIndex;
  final int trackIndex;
  final String? label;
  final String? language;
  final String? mimeType;
  final bool supported;
  final bool selected;
  final bool forced;
  final bool isDefault;

  const MyDeviceEmbeddedSubtitleTrack({
    required this.groupIndex,
    required this.trackIndex,
    this.label,
    this.language,
    this.mimeType,
    this.supported = true,
    this.selected = false,
    this.forced = false,
    this.isDefault = false,
  });

  factory MyDeviceEmbeddedSubtitleTrack.fromMap(Map<Object?, Object?> m) =>
      MyDeviceEmbeddedSubtitleTrack(
        groupIndex: (m['groupIndex'] as num).toInt(),
        trackIndex: (m['trackIndex'] as num).toInt(),
        label: m['label'] as String?,
        language: m['language'] as String?,
        mimeType: m['mimeType'] as String?,
        supported: m['supported'] as bool? ?? true,
        selected: m['selected'] as bool? ?? false,
        forced: m['forced'] as bool? ?? false,
        isDefault: m['isDefault'] as bool? ?? false,
      );

  /// Image-based formats (Blu-ray PGS, DVD VobSub) — drawn as pictures rather
  /// than text, so the font size setting doesn't apply to them.
  bool get isImageBased {
    final mime = mimeType ?? '';
    return mime.contains('pgs') || mime.contains('vobsub') || mime.contains('dvb');
  }

  /// e.g. "English · SDH" / "Arabic (forced)" / "Track 3".
  String displayName(int fallbackNumber) {
    final parts = <String>[
      if (language != null && language!.isNotEmpty && language != 'und')
        _languageName(language!),
      if (label != null && label!.isNotEmpty) label!,
    ];
    var name = parts.isEmpty ? 'Track $fallbackNumber' : parts.toSet().join(' · ');
    if (forced) name = '$name (forced)';
    return name;
  }

  /// Short format tag shown next to the name, e.g. "SRT", "ASS", "PGS".
  String get formatTag {
    final mime = mimeType ?? '';
    if (mime.contains('subrip')) return 'SRT';
    if (mime.contains('ssa') || mime.contains('ass')) return 'ASS';
    if (mime.contains('pgs')) return 'PGS';
    if (mime.contains('vobsub')) return 'VOBSUB';
    if (mime.contains('vtt')) return 'VTT';
    if (mime.contains('tx3g')) return 'MOV_TEXT';
    if (mime.contains('dvb')) return 'DVB';
    return '';
  }

  static const _languages = {
    'en': 'English', 'eng': 'English', 'ar': 'Arabic', 'ara': 'Arabic',
    'fr': 'French', 'fre': 'French', 'fra': 'French', 'es': 'Spanish',
    'spa': 'Spanish', 'de': 'German', 'ger': 'German', 'deu': 'German',
    'it': 'Italian', 'ita': 'Italian', 'pt': 'Portuguese', 'por': 'Portuguese',
    'ru': 'Russian', 'rus': 'Russian', 'tr': 'Turkish', 'tur': 'Turkish',
    'ja': 'Japanese', 'jpn': 'Japanese', 'ko': 'Korean', 'kor': 'Korean',
    'zh': 'Chinese', 'chi': 'Chinese', 'zho': 'Chinese', 'hi': 'Hindi',
    'hin': 'Hindi', 'nl': 'Dutch', 'dut': 'Dutch', 'nld': 'Dutch',
    'pl': 'Polish', 'pol': 'Polish', 'sv': 'Swedish', 'swe': 'Swedish',
    'he': 'Hebrew', 'heb': 'Hebrew', 'fa': 'Persian', 'per': 'Persian',
    'fas': 'Persian', 'el': 'Greek', 'gre': 'Greek', 'ell': 'Greek',
  };

  static String _languageName(String code) {
    final base = code.toLowerCase().split(RegExp('[-_]')).first;
    return _languages[base] ?? code.toUpperCase();
  }
}

/// One decoded cue from an embedded track: either text, or an image (PGS/
/// VobSub) with its placement as fractions of the video frame.
class MyDeviceEmbeddedCue {
  final String? text;
  final Uint8List? png;
  final double left;
  final double top;
  final double width;

  /// Fraction of the frame height, or null to keep the image's aspect ratio.
  final double? height;

  const MyDeviceEmbeddedCue({
    this.text,
    this.png,
    this.left = 0,
    this.top = 0,
    this.width = 0,
    this.height,
  });

  factory MyDeviceEmbeddedCue.fromMap(Map<Object?, Object?> m) {
    final height = (m['height'] as num?)?.toDouble();
    return MyDeviceEmbeddedCue(
      text: m['text'] as String?,
      png: m['png'] as Uint8List?,
      left: (m['left'] as num?)?.toDouble() ?? 0,
      top: (m['top'] as num?)?.toDouble() ?? 0,
      width: (m['width'] as num?)?.toDouble() ?? 0,
      height: (height == null || height <= 0) ? null : height,
    );
  }
}

/// Embedded subtitle tracks via the extra native channel in the vendored
/// `video_player_android` (see `third_party/video_player_android/PITFLIX_PATCH.md`).
/// ExoPlayer decodes the track; cues arrive here and the player screen draws
/// them in its own overlay. Calls degrade to "no embedded subtitles" on
/// failure instead of throwing into playback.
abstract class MyDeviceEmbeddedSubtitles {
  static const _channel = MethodChannel('pitflix.dev/video_player_text_tracks');
  static final _cues =
      StreamController<({int playerId, List<MyDeviceEmbeddedCue> cues})>.broadcast();
  static bool _handlerSet = false;

  /// Cue changes for every player — filter by `playerId`. An empty list
  /// means "nothing on screen now".
  static Stream<({int playerId, List<MyDeviceEmbeddedCue> cues})> get cues {
    _ensureHandler();
    return _cues.stream;
  }

  static void _ensureHandler() {
    if (_handlerSet) return;
    _handlerSet = true;
    _channel.setMethodCallHandler((call) async {
      if (call.method != 'onCues') return;
      final args = call.arguments as Map<Object?, Object?>;
      _cues.add((
        playerId: (args['playerId'] as num).toInt(),
        cues: [
          for (final c in (args['cues'] as List? ?? const []))
            MyDeviceEmbeddedCue.fromMap(c as Map<Object?, Object?>),
        ],
      ));
    });
  }

  /// Starts forwarding cues for [playerId] — so a track ExoPlayer selects by
  /// itself (one flagged default/forced in the file) shows up too.
  static Future<void> attach(int playerId) async {
    _ensureHandler();
    try {
      await _channel.invokeMethod('attach', {'playerId': playerId});
    } catch (_) {}
  }

  static Future<List<MyDeviceEmbeddedSubtitleTrack>> tracks(int playerId) async {
    try {
      final raw = await _channel.invokeMethod<List<Object?>>('getTextTracks', {
        'playerId': playerId,
      });
      return [
        for (final t in raw ?? const [])
          MyDeviceEmbeddedSubtitleTrack.fromMap(t as Map<Object?, Object?>),
      ];
    } catch (_) {
      return const [];
    }
  }

  static Future<void> select(int playerId, MyDeviceEmbeddedSubtitleTrack track) async {
    _ensureHandler();
    await _channel.invokeMethod('selectTextTrack', {
      'playerId': playerId,
      'groupIndex': track.groupIndex,
      'trackIndex': track.trackIndex,
    });
  }

  static Future<void> disable(int playerId) async {
    try {
      await _channel.invokeMethod('disableTextTracks', {'playerId': playerId});
    } catch (_) {}
  }
}
