import '../models/supabase_rows.dart';
import '../models/title_item.dart';
import '../services/user_library_service.dart';

/// Finds the built-in Watch Later list and returns its items — shared by
/// Home (which splits the result into shows/movies for its two tabs) and
/// Profile's Watch Later row. Returns an empty list if there's no Watch
/// Later list yet, rather than throwing.
Future<List<TitleItem>> fetchWatchLaterItems({
  bool forceRefresh = false,
}) async {
  final lists = await UserLibraryService.fetchLists(
    forceRefresh: forceRefresh,
  );

  SupabaseListRow? watchLater;
  for (final l in lists) {
    if (l.type == SupabaseListTypes.watchlist) {
      watchLater = l;
      break;
    }
  }
  if (watchLater == null) return const [];

  return UserLibraryService.fetchListItems(watchLater.id);
}
