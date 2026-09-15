import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:photo_manager/photo_manager.dart';

import '../models/my_device_folder.dart';
import '../services/my_device_scanner.dart';
import '../services/my_device_settings.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';
import 'my_device_folder_videos_screen.dart';
import 'settings_screen.dart';

/// Root tab content for "My Device" — a folder grid of on-device videos.
/// Ordinary AppColors/AppTextStyles chrome (this is regular app UI, not the
/// player); only MyDevicePlayerScreen uses the spec's purple palette.
class MyDeviceHomeScreen extends StatefulWidget {
  const MyDeviceHomeScreen({super.key});

  @override
  State<MyDeviceHomeScreen> createState() => _MyDeviceHomeScreenState();
}

class _MyDeviceHomeScreenState extends State<MyDeviceHomeScreen> {
  bool _permissionChecked = false;
  bool _hasPermission = false;

  @override
  void initState() {
    super.initState();
    MyDeviceSettings.enabled.addListener(_onEnabledChanged);
    if (MyDeviceSettings.enabled.value) _init();
  }

  @override
  void dispose() {
    MyDeviceSettings.enabled.removeListener(_onEnabledChanged);
    super.dispose();
  }

  void _onEnabledChanged() {
    if (MyDeviceSettings.enabled.value && !_permissionChecked) _init();
    if (mounted) setState(() {});
  }

  Future<void> _init() async {
    await MyDeviceScanner.loadCache();
    final granted = await MyDeviceScanner.hasPermission();
    if (!mounted) return;
    setState(() {
      _hasPermission = granted;
      _permissionChecked = true;
    });
    if (granted) {
      // Cache gives instant paint, but folder video counts can be stale
      // (e.g. new files added since the last scan) — always refresh in the
      // background so counts shown in the grid stay correct.
      MyDeviceScanner.rescan();
    }
  }

  Future<void> _requestAccess() async {
    final grant = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.bgCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          'Access Videos on This Device',
          style: AppTextStyles.bebas(fontSize: 20, letterSpacing: 0.1),
        ),
        content: Text(
          "My Device browses and plays video files stored on your phone. "
          "Pitflix only reads video files — nothing is uploaded, synced, or "
          "shared with your account.",
          style: AppTextStyles.dmSans(
            fontSize: 13,
            color: AppColors.textSecondary,
            height: 1.4,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(
              'Not Now',
              style: AppTextStyles.dmSans(fontSize: 14, color: AppColors.textSecondary),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(
              'Continue',
              style: AppTextStyles.dmSans(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppColors.accent,
              ),
            ),
          ),
        ],
      ),
    );
    if (grant != true || !mounted) return;
    final granted = await MyDeviceScanner.requestPermission();
    if (!mounted) return;
    setState(() => _hasPermission = granted);
    if (granted) MyDeviceScanner.rescan();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'My Device',
                      style: AppTextStyles.bebas(fontSize: 26, letterSpacing: 0.14),
                    ),
                  ),
                  if (MyDeviceSettings.enabled.value && _hasPermission)
                    ValueListenableBuilder<Set<String>>(
                      valueListenable: MyDeviceSettings.excludedFolderIds,
                      builder: (context, excluded, _) => excluded.isEmpty
                          ? const SizedBox.shrink()
                          : Padding(
                              padding: const EdgeInsets.only(right: 12),
                              child: GestureDetector(
                                onTap: _openHiddenFoldersSheet,
                                child: const Icon(
                                  Icons.visibility_off_outlined,
                                  color: AppColors.textMuted,
                                ),
                              ),
                            ),
                    ),
                  if (MyDeviceSettings.enabled.value && _hasPermission)
                    ValueListenableBuilder<MyDeviceScanStatus>(
                      valueListenable: MyDeviceScanner.status,
                      builder: (context, status, _) => GestureDetector(
                        onTap: status == MyDeviceScanStatus.scanning
                            ? null
                            : MyDeviceScanner.rescan,
                        child: Icon(
                          Icons.refresh,
                          color: status == MyDeviceScanStatus.scanning
                              ? AppColors.textFaint
                              : AppColors.textMuted,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (!MyDeviceSettings.enabled.value) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.video_library_outlined,
                size: 28,
                color: AppColors.textFaint,
              ),
              const SizedBox(height: 10),
              Text(
                'Turn on "Enable My Device" in Settings to browse videos stored on your phone.',
                textAlign: TextAlign.center,
                style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
              ),
              const SizedBox(height: 14),
              const MyDeviceSettingsLink(),
            ],
          ),
        ),
      );
    }
    if (!_permissionChecked) {
      return const Center(
        child: CircularProgressIndicator(color: AppColors.accent),
      );
    }
    if (!_hasPermission) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.folder_off_outlined,
                size: 28,
                color: AppColors.textFaint,
              ),
              const SizedBox(height: 10),
              Text(
                "Pitflix needs access to your device's videos to show this section.",
                textAlign: TextAlign.center,
                style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
              ),
              const SizedBox(height: 14),
              GestureDetector(
                onTap: _requestAccess,
                child: Text(
                  'Grant Access',
                  style: AppTextStyles.dmSans(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.accent,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }
    return ValueListenableBuilder<MyDeviceScanStatus>(
      valueListenable: MyDeviceScanner.status,
      builder: (context, status, _) {
        return ValueListenableBuilder<List<MyDeviceFolder>>(
          valueListenable: MyDeviceScanner.folders,
          builder: (context, allFolders, _) {
            return ValueListenableBuilder<Set<String>>(
              valueListenable: MyDeviceSettings.excludedFolderIds,
              builder: (context, excluded, _) {
                final folders = excluded.isEmpty
                    ? allFolders
                    : allFolders
                          .where((f) => !excluded.contains(f.id))
                          .toList();
                if (status == MyDeviceScanStatus.scanning && folders.isEmpty) {
                  return const Center(
                    child: CircularProgressIndicator(color: AppColors.accent),
                  );
                }
                if (status == MyDeviceScanStatus.error && folders.isEmpty) {
                  return ErrorRetry(
                    message: "Couldn't scan for videos.",
                    onRetry: MyDeviceScanner.rescan,
                  );
                }
                if (folders.isEmpty) {
                  return EmptyState(
                    icon: Icons.video_library_outlined,
                    message: allFolders.isEmpty
                        ? 'No video files found on this device.'
                        : 'All folders with videos are hidden.',
                  );
                }
                return GridView.builder(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    crossAxisSpacing: 12,
                    mainAxisSpacing: 16,
                    childAspectRatio: 0.78,
                  ),
                  itemCount: folders.length,
                  itemBuilder: (context, i) => _FolderCard(
                    folder: folders[i],
                    onHidden: _onFolderHidden,
                  ),
                );
              },
            );
          },
        );
      },
    );
  }

  Future<void> _onFolderHidden(MyDeviceFolder folder) async {
    await MyDeviceSettings.hideFolder(folder.id);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('"${folder.name}" hidden from My Device'),
        action: SnackBarAction(
          label: 'Undo',
          onPressed: () => MyDeviceSettings.unhideFolder(folder.id),
        ),
      ),
    );
  }

  void _openHiddenFoldersSheet() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.bgCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => const _HiddenFoldersSheet(),
    );
  }
}

class _HiddenFoldersSheet extends StatelessWidget {
  const _HiddenFoldersSheet();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      // Bound to MyDeviceScanner.folders too (not just a snapshot passed in when
      // the sheet opened) so a rescan while this sheet is open doesn't show stale data.
      child: ValueListenableBuilder<List<MyDeviceFolder>>(
        valueListenable: MyDeviceScanner.folders,
        builder: (context, allFolders, _) {
          return ValueListenableBuilder<Set<String>>(
            valueListenable: MyDeviceSettings.excludedFolderIds,
            builder: (context, excluded, _) {
              final hidden = allFolders
                  .where((f) => excluded.contains(f.id))
                  .toList();
              return Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'HIDDEN FOLDERS',
                      style: AppTextStyles.bebas(fontSize: 18, letterSpacing: 0.1),
                    ),
                    const SizedBox(height: 8),
                    if (hidden.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        child: Text(
                          'Nothing hidden.',
                          style: AppTextStyles.dmSans(
                            fontSize: 13,
                            color: AppColors.textMuted,
                          ),
                        ),
                      )
                    else
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxHeight: 320),
                        child: ListView(
                          shrinkWrap: true,
                          children: [
                            for (final folder in hidden)
                              ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: const Icon(
                                  Icons.folder_off_outlined,
                                  color: AppColors.textFaint,
                                  size: 20,
                                ),
                                title: Text(
                                  folder.name,
                                  style: AppTextStyles.dmSans(fontSize: 13),
                                ),
                                trailing: TextButton(
                                  onPressed: () =>
                                      MyDeviceSettings.unhideFolder(folder.id),
                                  child: Text(
                                    'Show',
                                    style: AppTextStyles.dmSans(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                      color: AppColors.accent,
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class _FolderCard extends StatelessWidget {
  final MyDeviceFolder folder;
  final ValueChanged<MyDeviceFolder> onHidden;

  const _FolderCard({required this.folder, required this.onHidden});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => MyDeviceFolderVideosScreen(folder: folder),
        ),
      ),
      onLongPress: () => onHidden(folder),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
              child: Container(
                color: AppColors.bgCard,
                child: folder.firstVideoId == null
                    ? const Center(
                        child: Icon(
                          Icons.folder_outlined,
                          color: AppColors.textFaint,
                          size: 32,
                        ),
                      )
                    : _FolderThumbnail(assetId: folder.firstVideoId!),
              ),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            folder.name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.dmSans(fontSize: 13, fontWeight: FontWeight.w600),
          ),
          Text(
            '${folder.videoCount} video${folder.videoCount == 1 ? '' : 's'}',
            style: AppTextStyles.dmSans(fontSize: 11, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }
}

class _FolderThumbnail extends StatelessWidget {
  final String assetId;

  const _FolderThumbnail({required this.assetId});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List?>(
      future: _loadThumbnail(assetId),
      builder: (context, snapshot) {
        final bytes = snapshot.data;
        if (bytes == null) {
          return const Center(
            child: Icon(
              Icons.movie_outlined,
              color: AppColors.textFaint,
              size: 28,
            ),
          );
        }
        return Image.memory(bytes, fit: BoxFit.cover, width: double.infinity);
      },
    );
  }

  static Future<Uint8List?> _loadThumbnail(String assetId) async {
    final asset = await AssetEntity.fromId(assetId);
    return asset?.thumbnailDataWithSize(const ThumbnailSize(300, 300));
  }
}

/// Small link out to Settings for the empty "disabled" state, so a user who
/// lands on the tab before ever visiting Settings isn't stuck.
class MyDeviceSettingsLink extends StatelessWidget {
  const MyDeviceSettingsLink({super.key});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(
        context,
      ).push(MaterialPageRoute(builder: (_) => const SettingsScreen())),
      child: Text(
        'Open Settings',
        style: AppTextStyles.dmSans(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: AppColors.accent,
        ),
      ),
    );
  }
}
