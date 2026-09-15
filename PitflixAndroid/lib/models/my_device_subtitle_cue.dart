/// One timed subtitle line, produced by either the SRT or ASS parser and
/// rendered identically by the player's overlay regardless of source format.
class MyDeviceSubtitleCue {
  final Duration start;
  final Duration end;
  final String text;

  const MyDeviceSubtitleCue({
    required this.start,
    required this.end,
    required this.text,
  });

  bool containsPosition(Duration position) =>
      position >= start && position <= end;
}
