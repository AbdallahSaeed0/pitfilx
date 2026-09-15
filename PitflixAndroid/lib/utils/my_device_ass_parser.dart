import '../models/my_device_subtitle_cue.dart';

/// Minimal .ass/.ssa parser — only reads the `[Events]` section's `Format:`
/// and `Dialogue:` lines to recover start/end/text; styling (fonts, colors,
/// positioning, karaoke tags) is intentionally ignored, per the v1 "keep it
/// simple" scope — a full ASS style editor is out of scope. Override blocks
/// like `{\an8}` and the `\N`/`\n` line-break codes are stripped/normalized
/// so plain readable text is left over.
abstract class MyDeviceAssParser {
  static final _overrideBlockPattern = RegExp(r'\{[^}]*\}');
  static final _timingPattern = RegExp(
    r'^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,2})$',
  );

  static List<MyDeviceSubtitleCue> parse(String content) {
    final lines = content.replaceAll('\r\n', '\n').split('\n');
    List<String>? format;
    final cues = <MyDeviceSubtitleCue>[];
    var inEvents = false;

    for (final rawLine in lines) {
      final line = rawLine.trim();
      if (line.isEmpty) continue;
      if (line.startsWith('[')) {
        inEvents = line.toLowerCase() == '[events]';
        continue;
      }
      if (!inEvents) continue;

      if (line.toLowerCase().startsWith('format:')) {
        format = line
            .substring(line.indexOf(':') + 1)
            .split(',')
            .map((f) => f.trim().toLowerCase())
            .toList();
        continue;
      }
      if (!line.toLowerCase().startsWith('dialogue:') || format == null) {
        continue;
      }

      final startIndex = format.indexOf('start');
      final endIndex = format.indexOf('end');
      final textIndex = format.indexOf('text');
      if (startIndex == -1 || endIndex == -1 || textIndex == -1) continue;

      // Text is the last field and may itself contain commas, so split only
      // as many times as the fields before it require.
      final fields = line
          .substring(line.indexOf(':') + 1)
          .trim()
          .split(',');
      if (fields.length <= textIndex) continue;
      final text = fields.sublist(textIndex).join(',');

      final start = _parseTiming(fields[startIndex].trim());
      final end = _parseTiming(fields[endIndex].trim());
      if (start == null || end == null) continue;

      final cleaned = text
          .replaceAll(_overrideBlockPattern, '')
          .replaceAll(RegExp(r'\\N|\\n', caseSensitive: false), '\n')
          .trim();
      if (cleaned.isEmpty) continue;

      cues.add(MyDeviceSubtitleCue(start: start, end: end, text: cleaned));
    }
    cues.sort((a, b) => a.start.compareTo(b.start));
    return cues;
  }

  static Duration? _parseTiming(String value) {
    final match = _timingPattern.firstMatch(value);
    if (match == null) return null;
    final hours = int.parse(match.group(1)!);
    final minutes = int.parse(match.group(2)!);
    final seconds = int.parse(match.group(3)!);
    // ASS centiseconds (2 digits) vs SSA's occasional 1-digit — pad to 2
    // then scale to milliseconds.
    final centiseconds = int.parse(match.group(4)!.padRight(2, '0'));
    return Duration(
      hours: hours,
      minutes: minutes,
      seconds: seconds,
      milliseconds: centiseconds * 10,
    );
  }
}
