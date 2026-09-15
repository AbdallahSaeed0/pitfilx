import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:photo_manager/photo_manager.dart';

import '../models/my_device_folder.dart';
import '../models/my_device_video.dart';

enum MyDeviceScanStatus { idle, permissionDenied, scanning, ready, error }

/// Scans the device for video files via MediaStore (through photo_manager),
/// grouped by containing folder. Fully separate from UserLibraryService/
/// TmdbService — nothing here touches Supabase or the synced library.
///
/// Only the top-level folder list is cached to disk (a small JSON file under
/// this app's own support directory, not shared_preferences — a device with
/// a lot of folders makes for an awkwardly large single pref value). A
/// folder's video list is always re-fetched fresh from photo_manager when
/// opened rather than cached — that's one fast MediaStore query backed by
/// the OS's own index, so there's no real win to caching it, and it avoids
/// needing to serialize/invalidate a much larger AssetEntity graph.
abstract class MyDeviceScanner {
  static final ValueNotifier<MyDeviceScanStatus> status = ValueNotifier(
    MyDeviceScanStatus.idle,
  );
  static final ValueNotifier<List<MyDeviceFolder>> folders = ValueNotifier(
    const [],
  );

  static Future<File> _cacheFile() async {
    final dir = await getApplicationSupportDirectory();
    return File('${dir.path}/mydevice_scan_cache.json');
  }

  /// Loads the last cached folder list (if any) so the My Device screen has
  /// something to show immediately on open, without waiting for a fresh
  /// MediaStore query. Call [rescan] for up-to-date results.
  static Future<void> loadCache() async {
    try {
      final file = await _cacheFile();
      if (!await file.exists()) return;
      final raw = jsonDecode(await file.readAsString()) as List;
      folders.value = raw
          .map((f) => MyDeviceFolder.fromJson(f as Map<String, dynamic>))
          .toList();
      if (folders.value.isNotEmpty) status.value = MyDeviceScanStatus.ready;
    } catch (_) {
      // Corrupt or unreadable cache — harmless, a rescan rebuilds it.
    }
  }

  /// Video-only permission request — never asks for photo/image access, and
  /// never MANAGE_EXTERNAL_STORAGE. On Android this resolves to
  /// READ_MEDIA_VIDEO (33+) or READ_EXTERNAL_STORAGE (below that).
  static Future<bool> requestPermission() async {
    final state = await PhotoManager.requestPermissionExtend(
      requestOption: const PermissionRequestOption(
        androidPermission: AndroidPermission(
          type: RequestType.video,
          mediaLocation: false,
        ),
      ),
    );
    return state == PermissionState.authorized ||
        state == PermissionState.limited;
  }

  static Future<bool> hasPermission() async {
    final state = await PhotoManager.getPermissionState(
      requestOption: const PermissionRequestOption(
        androidPermission: AndroidPermission(
          type: RequestType.video,
          mediaLocation: false,
        ),
      ),
    );
    return state == PermissionState.authorized ||
        state == PermissionState.limited;
  }

  /// Full rescan — requests permission if not already granted, re-queries
  /// MediaStore for every folder containing at least one video, and
  /// refreshes both [folders] and the on-disk cache.
  static Future<void> rescan() async {
    status.value = MyDeviceScanStatus.scanning;
    final granted = await requestPermission();
    if (!granted) {
      status.value = MyDeviceScanStatus.permissionDenied;
      return;
    }
    try {
      final paths = await PhotoManager.getAssetPathList(
        type: RequestType.video,
        hasAll: false,
        // Most-recently-added first, so the single asset fetched below for
        // the folder thumbnail is the most recent video, not whatever order
        // the OS happened to return (previously just "index 0"). createDate
        // is MediaStore's `date_added` on Android (when the file was added
        // to the gallery) — the "recent" ordering apps normally sort by, and
        // deliberately NOT updateDate (`date_modified`), which can predate
        // date_added for a file that was copied/downloaded onto the device
        // with its original mtime preserved, making an old video look newest.
        filterOption: FilterOptionGroup(
          orders: [const OrderOption(type: OrderOptionType.createDate, asc: false)],
        ),
      );
      final result = <MyDeviceFolder>[];
      for (final path in paths) {
        final count = await path.assetCountAsync;
        if (count == 0) continue;
        final assets = await path.getAssetListRange(start: 0, end: 1);
        result.add(
          MyDeviceFolder(
            id: path.id,
            name: path.name,
            videoCount: count,
            firstVideoId: assets.isEmpty ? null : assets.first.id,
          ),
        );
      }
      result.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      folders.value = result;
      status.value = MyDeviceScanStatus.ready;
      await _saveCache(result);
    } catch (_) {
      status.value = MyDeviceScanStatus.error;
    }
  }

  /// Fetches (fresh, uncached) every video in the given folder, most
  /// recently modified first.
  static Future<List<MyDeviceVideo>> videosForFolder(String folderId) async {
    final path = await AssetPathEntity.fromId(folderId, type: RequestType.video);
    final count = await path.assetCountAsync;
    if (count == 0) return const [];
    final assets = await path.getAssetListRange(start: 0, end: count);
    final videos = await Future.wait(assets.map(MyDeviceVideo.fromAsset));
    videos.sort((a, b) => b.modifiedAt.compareTo(a.modifiedAt));
    return videos;
  }

  static Future<void> _saveCache(List<MyDeviceFolder> value) async {
    try {
      final file = await _cacheFile();
      await file.writeAsString(
        jsonEncode(value.map((f) => f.toJson()).toList()),
      );
    } catch (_) {
      // Non-fatal — folders.value is already updated for this session.
    }
  }
}
