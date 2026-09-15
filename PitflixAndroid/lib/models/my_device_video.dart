import 'package:photo_manager/photo_manager.dart';

/// A single on-device video, wrapping just the fields My Device's UI/player
/// actually needs out of photo_manager's [AssetEntity] — kept as its own
/// model so the rest of this feature doesn't reach for photo_manager types
/// directly outside [MyDeviceScanner].
class MyDeviceVideo {
  /// photo_manager asset id — Android: the MediaStore row's `_id`. See
  /// MyDeviceResumeStore's doc comment for how stable this is.
  final String id;
  final String title;
  final Duration duration;
  final DateTime modifiedAt;
  final AssetEntity asset;

  const MyDeviceVideo({
    required this.id,
    required this.title,
    required this.duration,
    required this.modifiedAt,
    required this.asset,
  });

  static Future<MyDeviceVideo> fromAsset(AssetEntity asset) async {
    final title = asset.title ?? await asset.titleAsync;
    return MyDeviceVideo(
      id: asset.id,
      title: title.isEmpty ? 'Untitled' : title,
      duration: asset.videoDuration,
      modifiedAt: asset.modifiedDateTime,
      asset: asset,
    );
  }

  /// The real filesystem path backing this asset, or null if it couldn't be
  /// resolved (deleted since the scan, or a provider that only exposes a
  /// content:// URI). Needed for both video_player (file-based playback) and
  /// local subtitle discovery (sibling .srt/.ass files next to the video).
  Future<String?> resolveFilePath() async {
    final file = await asset.file;
    return file?.path;
  }

  /// Bytes on disk, resolved lazily (opens the file) rather than during a
  /// folder scan, since stat-ing every video up front would slow scanning
  /// down for large libraries.
  Future<int?> resolveFileSizeBytes() async {
    final file = await asset.file;
    if (file == null) return null;
    return file.length();
  }
}
