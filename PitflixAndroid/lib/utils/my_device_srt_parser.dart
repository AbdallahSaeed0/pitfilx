import '../models/my_device_subtitle_cue.dart';

/// Minimal .srt parser — video_player has no native subtitle rendering, so
/// My Device's player renders these as a timed Text overlay itself (see
/// MyDevicePlayerScreen). Deliberately simple per the v1 scope: no styling
/// directives, just index/timing/text blocks with basic HTML-ish tags
/// (<i>, <b>, <u>, {\...}) stripped.
abstract class MyDeviceSrtParser {
  static final _timingPattern = RegExp(
    r'(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})',
  );
  static final _tagPattern = RegExp(r'<[^>]*>|\{[^}]*\}');

  static List<MyDeviceSubtitleCue> parse(String content) {
    final cues = <MyDeviceSubtitleCue>[];
    final blocks = content.replaceAll('\r\n', '\n').split(RegExp(r'\n\s*\n'));
    for (final block in blocks) {
      final lines = block.trim().split('\n');
      if (lines.isEmpty) continue;
      final timingLineIndex = lines.indexWhere(
        (l) => _timingPattern.hasMatch(l),
      );
      if (timingLineIndex == -1) continue;
      final match = _timingPattern.firstMatch(lines[timingLineIndex])!;
      final start = _durationFromMatch(match, 1);
      final end = _durationFromMatch(match, 5);
      final text = lines
          .sublist(timingLineIndex + 1)
          .join('\n')
          .replaceAll(_tagPattern, '')
          .trim();
      if (text.isEmpty) continue;
      cues.add(MyDeviceSubtitleCue(start: start, end: end, text: text));
    }
    cues.sort((a, b) => a.start.compareTo(b.start));
    return cues;
  }

  static Duration _durationFromMatch(RegExpMatch match, int groupOffset) {
    final hours = int.parse(match.group(groupOffset)!);
    final minutes = int.parse(match.group(groupOffset + 1)!);
    final seconds = int.parse(match.group(groupOffset + 2)!);
    final fraction = match.group(groupOffset + 3)!.padRight(3, '0');
    return Duration(
      hours: hours,
      minutes: minutes,
      seconds: seconds,
      milliseconds: int.parse(fraction),
    );
  }
}
