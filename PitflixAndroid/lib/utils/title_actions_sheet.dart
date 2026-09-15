import 'package:flutter/material.dart';
import '../models/title_item.dart';
import '../screens/image_picker_screen.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import '../widgets/add_to_list_sheet.dart';
import '../widgets/recommend_friend_sheet.dart';

enum _TitleAction { addToList, drop, recommend, changePoster, changeBackdrop }

/// The Title Detail "..." menu — every action here only needs a tmdbId.
/// Change Poster/Change Backdrop pull candidates straight from TMDB and save
/// the pick to this account's Supabase row (see
/// Pitflix.API/Services/Supabase/sql/008_pitflix_title_customizations.sql),
/// so they work for any title regardless of whether it's matched in the
/// desktop's local scanned-media library.
Future<void> showTitleActionsSheet(
  BuildContext context,
  TitleItem title,
  ValueChanged<TitleItem> onArtworkUpdated, {
  VoidCallback? onDropped,
}) async {
  if (title.tmdbId == null) return;

  final action = await showModalBottomSheet<_TitleAction>(
    context: context,
    backgroundColor: AppColors.bgCard,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(
              Icons.playlist_add,
              color: AppColors.textPrimary,
            ),
            title: Text(
              'Add to List',
              style: AppTextStyles.dmSans(fontSize: 15),
            ),
            onTap: () => Navigator.of(context).pop(_TitleAction.addToList),
          ),
          ListTile(
            leading: const Icon(
              Icons.remove_circle_outline,
              color: AppColors.textPrimary,
            ),
            title: Text('Drop', style: AppTextStyles.dmSans(fontSize: 15)),
            onTap: () => Navigator.of(context).pop(_TitleAction.drop),
          ),
          ListTile(
            leading: const Icon(
              Icons.person_add_alt_1,
              color: AppColors.textPrimary,
            ),
            title: Text(
              'Recommend to Friend',
              style: AppTextStyles.dmSans(fontSize: 15),
            ),
            onTap: () => Navigator.of(context).pop(_TitleAction.recommend),
          ),
          ListTile(
            leading: const Icon(
              Icons.image_outlined,
              color: AppColors.textPrimary,
            ),
            title: Text(
              'Change Poster',
              style: AppTextStyles.dmSans(fontSize: 15),
            ),
            onTap: () => Navigator.of(context).pop(_TitleAction.changePoster),
          ),
          ListTile(
            leading: const Icon(
              Icons.panorama_outlined,
              color: AppColors.textPrimary,
            ),
            title: Text(
              'Change Backdrop',
              style: AppTextStyles.dmSans(fontSize: 15),
            ),
            onTap: () =>
                Navigator.of(context).pop(_TitleAction.changeBackdrop),
          ),
        ],
      ),
    ),
  );
  if (action == null || !context.mounted) return;

  switch (action) {
    case _TitleAction.addToList:
      await showAddToListSheet(context, title);
    case _TitleAction.drop:
      await _dropTitle(context, title, onDropped: onDropped);
    case _TitleAction.recommend:
      await showRecommendFriendSheet(context, title.name);
    case _TitleAction.changePoster:
      await _changeArtwork(
        context,
        title,
        isBackdrop: false,
        onArtworkUpdated: onArtworkUpdated,
      );
    case _TitleAction.changeBackdrop:
      await _changeArtwork(
        context,
        title,
        isBackdrop: true,
        onArtworkUpdated: onArtworkUpdated,
      );
  }
}

/// "Drop" has no dedicated backend status (only Unwatched/Watching/Completed
/// exist) — represented as adding the title to a "Dropped" list instead,
/// creating it on first use.
Future<void> _dropTitle(
  BuildContext context,
  TitleItem title, {
  VoidCallback? onDropped,
}) async {
  final mediaType = title.isShow ? 'series' : 'movie';
  try {
    final lists = await UserLibraryService.fetchLists(forceRefresh: true);
    String listId;
    final existing = lists.where((l) => l.name.toLowerCase() == 'dropped');
    if (existing.isNotEmpty) {
      listId = existing.first.id;
    } else {
      listId = await UserLibraryService.createList('Dropped');
    }
    await UserLibraryService.addToList(
      listId,
      tmdbId: title.tmdbId!,
      mediaType: mediaType,
      title: title.name,
      posterPath: title.posterPath,
    );
    onDropped?.call();
    if (!context.mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('Added "${title.name}" to Dropped')));
  } catch (e) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text("Couldn't drop: $e")));
  }
}

Future<void> _changeArtwork(
  BuildContext context,
  TitleItem title, {
  required bool isBackdrop,
  required ValueChanged<TitleItem> onArtworkUpdated,
}) async {
  final chosenPath = await Navigator.of(context).push<String>(
    MaterialPageRoute(
      builder: (_) => ImagePickerScreen(
        tmdbId: title.tmdbId!,
        kind: title.kind,
        isBackdrop: isBackdrop,
      ),
    ),
  );
  if (chosenPath == null) return;

  onArtworkUpdated(
    isBackdrop
        ? title.copyWith(backdropPath: chosenPath)
        : title.copyWith(posterPath: chosenPath),
  );
}
