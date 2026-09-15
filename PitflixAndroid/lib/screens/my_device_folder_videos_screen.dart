import 'dart:typed_data';

import 'package:photo_manager/photo_manager.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../models/my_device_folder.dart';
import '../models/my_device_video.dart';
import '../services/my_device_favorites_store.dart';
import '../services/my_device_media_edit.dart';
import '../services/my_device_scanner.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';
import 'my_device_player_screen.dart';

class MyDeviceFolderVideosScreen extends StatefulWidget {
  final MyDeviceFolder folder;

  const MyDeviceFolderVideosScreen({super.key, required this.folder});

  @override
  State<MyDeviceFolderVideosScreen> createState() =>
      _MyDeviceFolderVideosScreenState();
}

class _MyDeviceFolderVideosScreenState
    extends State<MyDeviceFolderVideosScreen> {
  List<MyDeviceVideo>? _videos;
  String? _error;
  final Set<String> _selectedIds = {};

  bool get _selecting => _selectedIds.isNotEmpty;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _toggleSelected(String id) {
    setState(() {
      if (_selectedIds.contains(id)) {
        _selectedIds.remove(id);
      } else {
        _selectedIds.add(id);
      }
    });
  }

  void _clearSelection() => setState(_selectedIds.clear);

  Future<void> _deleteSelected() async {
    final count = _selectedIds.length;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.bgCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          'Delete Videos',
          style: AppTextStyles.bebas(
            fontSize: 20,
            letterSpacing: 0.1,
            color: AppColors.destructive,
          ),
        ),
        content: Text(
          'This permanently deletes $count video${count == 1 ? '' : 's'} from your device. This cannot be undone.',
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
              'Cancel',
              style: AppTextStyles.dmSans(
                fontSize: 14,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(
              'Delete',
              style: AppTextStyles.dmSans(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppColors.destructive,
              ),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final ids = _selectedIds.toList();
    try {
      await PhotoManager.editor.deleteWithIds(ids);
      MyDeviceFavoritesStore.favoriteIds.value = {
        ...MyDeviceFavoritesStore.favoriteIds.value,
      }..removeAll(ids);
      _selectedIds.clear();
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't delete: $e")));
    }
  }

  Future<void> _load() async {
    setState(() {
      _error = null;
      _videos = null;
    });
    try {
      final videos = await MyDeviceScanner.videosForFolder(widget.folder.id);
      if (!mounted) return;
      setState(() => _videos = videos);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_selecting,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _selecting) _clearSelection();
      },
      child: Scaffold(
        backgroundColor: AppColors.bgBase,
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
                child: Row(
                  children: [
                    CircleIconButton(
                      icon: _selecting ? Icons.close : Icons.arrow_back_ios_new,
                      background: AppColors.bgCard,
                      onTap: _selecting
                          ? _clearSelection
                          : () => Navigator.of(context).pop(),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Text(
                        _selecting
                            ? '${_selectedIds.length} SELECTED'
                            : widget.folder.name.toUpperCase(),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.bebas(
                          fontSize: 22,
                          letterSpacing: 0.1,
                          color: AppColors.logoAccent,
                        ),
                      ),
                    ),
                    if (_selecting)
                      CircleIconButton(
                        icon: Icons.delete_outline,
                        background: AppColors.bgCard,
                        onTap: _deleteSelected,
                      ),
                  ],
                ),
              ),
              Expanded(child: _body()),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body() {
    if (_error != null) {
      return ErrorRetry(
        message: "Couldn't load videos: $_error",
        onRetry: _load,
      );
    }
    if (_videos == null) {
      return const Center(
        child: CircularProgressIndicator(color: AppColors.accent),
      );
    }
    if (_videos!.isEmpty) {
      return const EmptyState(
        icon: Icons.movie_outlined,
        message: 'No videos in this folder.',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
      itemCount: _videos!.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, i) => _VideoRow(
        video: _videos![i],
        allVideos: _videos!,
        index: i,
        onChanged: _load,
        selecting: _selecting,
        selected: _selectedIds.contains(_videos![i].id),
        onToggleSelected: () => _toggleSelected(_videos![i].id),
      ),
    );
  }
}

class _VideoRow extends StatelessWidget {
  final MyDeviceVideo video;
  final List<MyDeviceVideo> allVideos;
  final int index;

  /// Reloads the folder's video list — called after a rename (title changes)
  /// or delete (row disappears entirely).
  final VoidCallback onChanged;

  final bool selecting;
  final bool selected;
  final VoidCallback onToggleSelected;

  const _VideoRow({
    required this.video,
    required this.allVideos,
    required this.index,
    required this.onChanged,
    required this.selecting,
    required this.selected,
    required this.onToggleSelected,
  });

  String _formatDuration(Duration d) {
    final hours = d.inHours;
    final minutes = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return hours > 0 ? '$hours:$minutes:$seconds' : '$minutes:$seconds';
  }

  String _formatSize(int? bytes) {
    if (bytes == null) return '';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  Future<void> _openMenu(BuildContext context) async {
    final action = await showModalBottomSheet<_VideoAction>(
      context: context,
      backgroundColor: AppColors.bgCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => _VideoActionsSheet(video: video),
    );
    if (action == null || !context.mounted) return;
    switch (action) {
      case _VideoAction.favorite:
        MyDeviceFavoritesStore.toggle(video.id);
      case _VideoAction.share:
        await _share();
      case _VideoAction.rename:
        await _rename(context);
      case _VideoAction.info:
        await _showInfo(context);
      case _VideoAction.delete:
        await _delete(context);
    }
  }

  Future<void> _share() async {
    final path = await video.resolveFilePath();
    if (path == null) return;
    await SharePlus.instance.share(ShareParams(files: [XFile(path)]));
  }

  Future<void> _rename(BuildContext context) async {
    final controller = TextEditingController(text: video.title);
    final newName = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.bgCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          'Rename',
          style: AppTextStyles.bebas(fontSize: 20, letterSpacing: 0.1),
        ),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: AppTextStyles.dmSans(fontSize: 14),
          decoration: InputDecoration(
            isDense: true,
            filled: true,
            fillColor: AppColors.bgBase,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide.none,
            ),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 12,
              vertical: 10,
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(
              'Cancel',
              style: AppTextStyles.dmSans(
                fontSize: 14,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            child: Text(
              'Rename',
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
    if (newName == null || newName.isEmpty || newName == video.title) return;
    if (!context.mounted) return;
    try {
      await MyDeviceMediaEdit.renameVideo(video.id, newName);
      onChanged();
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't rename: $e")));
    }
  }

  Future<void> _showInfo(BuildContext context) async {
    final path = await video.resolveFilePath();
    final sizeBytes = await video.resolveFileSizeBytes();
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.bgCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          'Info',
          style: AppTextStyles.bebas(fontSize: 20, letterSpacing: 0.1),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _InfoRow(label: 'Name', value: video.title),
            _InfoRow(label: 'Duration', value: _formatDuration(video.duration)),
            _InfoRow(label: 'Size', value: _formatSize(sizeBytes)),
            _InfoRow(
              label: 'Modified',
              value:
                  '${video.modifiedAt.year}-${video.modifiedAt.month.toString().padLeft(2, '0')}-${video.modifiedAt.day.toString().padLeft(2, '0')}',
            ),
            _InfoRow(label: 'Path', value: path ?? 'Unavailable'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(
              'Close',
              style: AppTextStyles.dmSans(
                fontSize: 14,
                color: AppColors.textSecondary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _delete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.bgCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          'Delete Video',
          style: AppTextStyles.bebas(
            fontSize: 20,
            letterSpacing: 0.1,
            color: AppColors.destructive,
          ),
        ),
        content: Text(
          'This permanently deletes "${video.title}" from your device. This cannot be undone.',
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
              'Cancel',
              style: AppTextStyles.dmSans(
                fontSize: 14,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(
              'Delete',
              style: AppTextStyles.dmSans(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppColors.destructive,
              ),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      // PhotoManager.editor.deleteWithIds handles the Android scoped-storage
      // consent flow itself (system confirmation on API 30+, a
      // RecoverableSecurityException prompt on 29) — unlike rename, which
      // needed a hand-rolled native channel since photo_manager has no
      // rename API. See MyDeviceMediaEdit's doc comment.
      await PhotoManager.editor.deleteWithIds([video.id]);
      MyDeviceFavoritesStore.favoriteIds.value = {
        ...MyDeviceFavoritesStore.favoriteIds.value,
      }..remove(video.id);
      onChanged();
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't delete: $e")));
    }
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: selected
              ? AppColors.accent.withValues(alpha: 0.16)
              : AppColors.bgCard,
        ),
        child: InkWell(
          onTap: selecting
              ? onToggleSelected
              : () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => MyDevicePlayerScreen(
                      videos: allVideos,
                      initialIndex: index,
                    ),
                  ),
                ),
          onLongPress: selecting ? null : onToggleSelected,
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Row(
              children: [
                Stack(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: SizedBox(
                        width: 84,
                        height: 52,
                        child: _VideoThumbnail(assetId: video.id),
                      ),
                    ),
                    ValueListenableBuilder<Set<String>>(
                      valueListenable: MyDeviceFavoritesStore.favoriteIds,
                      builder: (context, favorites, _) {
                        if (!favorites.contains(video.id)) {
                          return const SizedBox.shrink();
                        }
                        return const Positioned(
                          top: 3,
                          right: 3,
                          child: Icon(
                            Icons.star,
                            size: 14,
                            color: AppColors.star,
                          ),
                        );
                      },
                    ),
                  ],
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        video.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.dmSans(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _formatDuration(video.duration),
                        style: AppTextStyles.dmSans(
                          fontSize: 11,
                          color: AppColors.textMuted,
                        ),
                      ),
                      FutureBuilder<int?>(
                        future: video.resolveFileSizeBytes(),
                        builder: (context, snapshot) {
                          final label = _formatSize(snapshot.data);
                          if (label.isEmpty) return const SizedBox.shrink();
                          return Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(
                              label,
                              style: AppTextStyles.dmSans(
                                fontSize: 11,
                                color: AppColors.textFaint,
                              ),
                            ),
                          );
                        },
                      ),
                    ],
                  ),
                ),
                if (selecting)
                  Icon(
                    selected ? Icons.check_circle : Icons.circle_outlined,
                    color: selected ? AppColors.accent : AppColors.textFaint,
                    size: 22,
                  )
                else
                  IconButton(
                    onPressed: () => _openMenu(context),
                    icon: const Icon(
                      Icons.more_vert,
                      color: AppColors.textMuted,
                      size: 20,
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

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;

  const _InfoRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: AppTextStyles.dmSans(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: AppColors.textMuted,
            ),
          ),
          Text(
            value,
            style: AppTextStyles.dmSans(
              fontSize: 13,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

enum _VideoAction { favorite, share, rename, info, delete }

class _VideoActionsSheet extends StatelessWidget {
  final MyDeviceVideo video;

  const _VideoActionsSheet({required this.video});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ValueListenableBuilder<Set<String>>(
              valueListenable: MyDeviceFavoritesStore.favoriteIds,
              builder: (context, favorites, _) {
                final isFavorite = favorites.contains(video.id);
                return _ActionTile(
                  icon: isFavorite ? Icons.star : Icons.star_border,
                  label: isFavorite
                      ? 'Remove from Favorites'
                      : 'Add to Favorites',
                  onTap: () => Navigator.of(context).pop(_VideoAction.favorite),
                );
              },
            ),
            _ActionTile(
              icon: Icons.share_outlined,
              label: 'Share',
              onTap: () => Navigator.of(context).pop(_VideoAction.share),
            ),
            _ActionTile(
              icon: Icons.edit_outlined,
              label: 'Rename',
              onTap: () => Navigator.of(context).pop(_VideoAction.rename),
            ),
            _ActionTile(
              icon: Icons.info_outline,
              label: 'Info',
              onTap: () => Navigator.of(context).pop(_VideoAction.info),
            ),
            _ActionTile(
              icon: Icons.delete_outline,
              label: 'Delete',
              destructive: true,
              onTap: () => Navigator.of(context).pop(_VideoAction.delete),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool destructive;

  const _ActionTile({
    required this.icon,
    required this.label,
    required this.onTap,
    this.destructive = false,
  });

  @override
  Widget build(BuildContext context) {
    final color = destructive ? AppColors.destructive : AppColors.textPrimary;
    return ListTile(
      leading: Icon(icon, color: color, size: 20),
      title: Text(
        label,
        style: AppTextStyles.dmSans(
          fontSize: 14,
          fontWeight: FontWeight.w500,
          color: color,
        ),
      ),
      onTap: onTap,
    );
  }
}

class _VideoThumbnail extends StatelessWidget {
  final String assetId;

  const _VideoThumbnail({required this.assetId});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List?>(
      future: _loadThumbnail(assetId),
      builder: (context, snapshot) {
        final bytes = snapshot.data;
        if (bytes == null) {
          return const ColoredBox(
            color: AppColors.avatarBg,
            child: Icon(
              Icons.movie_outlined,
              color: AppColors.textFaint,
              size: 18,
            ),
          );
        }
        return Image.memory(bytes, fit: BoxFit.cover);
      },
    );
  }

  static Future<Uint8List?> _loadThumbnail(String assetId) async {
    final asset = await AssetEntity.fromId(assetId);
    return asset?.thumbnailDataWithSize(const ThumbnailSize(200, 200));
  }
}
