/// A device folder containing at least one video, as shown in My Device's
/// top-level browse list. [firstVideoId] is actually the most recently
/// *added* video in the folder (see MyDeviceScanner.rescan's descending
/// createDate order) — used as the folder card's thumbnail. Storing just the
/// id (rather than a full [MyDeviceVideo]) is what gets persisted to the scan
/// cache — just enough to re-fetch a thumbnail on cold start via
/// `AssetEntity.fromId`, without needing to serialize a whole AssetEntity
/// graph to JSON.
class MyDeviceFolder {
  final String id;
  final String name;
  final int videoCount;
  final String? firstVideoId;

  const MyDeviceFolder({
    required this.id,
    required this.name,
    required this.videoCount,
    required this.firstVideoId,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'videoCount': videoCount,
    'firstVideoId': firstVideoId,
  };

  factory MyDeviceFolder.fromJson(Map<String, dynamic> json) {
    return MyDeviceFolder(
      id: json['id'] as String,
      name: json['name'] as String,
      videoCount: json['videoCount'] as int,
      firstVideoId: json['firstVideoId'] as String?,
    );
  }
}
