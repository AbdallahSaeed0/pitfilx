import '../config/app_config.dart';
import '../models/supabase_rows.dart';
import '../models/title_item.dart';
import '../services/local_backend_service.dart';
import '../services/supabase_service.dart';
import '../services/tmdb_service.dart';

/// Finds the built-in Watch Later list and returns its items — shared by
/// Home (which splits the result into shows/movies for its two tabs) and
/// Profile's Watch Later row. Returns an empty list if there's no Watch
/// Later list yet, rather than throwing.
Future<List<TitleItem>> fetchWatchLaterItems({
  bool forceRefresh = false,
}) async {
  final lists = AppConfig.useLocalBackend
      ? await LocalBackendService.fetchLists(forceRefresh: forceRefresh)
      : await SupabaseService.fetchLists(forceRefresh: forceRefresh);

  SupabaseListRow? watchLater;
  for (final l in lists) {
    if (l.type == SupabaseListTypes.watchlist) {
      watchLater = l;
      break;
    }
  }
  if (watchLater == null) return const [];

  if (AppConfig.useLocalBackend) {
    // Already fully resolved server-side — no TMDB follow-up needed.
    return LocalBackendService.fetchListItems(int.parse(watchLater.id));
  }

  final items = await SupabaseService.fetchListItems(watchLater.id);
  final resolved = await Future.wait(
    items.map((row) async {
      final kind = TmdbService.kindFromMediaType(row.mediaType);
      return TmdbService.fetchDetails(row.tmdbId, kind);
    }),
  );
  return resolved.whereType<TitleItem>().toList();
}
