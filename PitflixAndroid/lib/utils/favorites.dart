import '../models/supabase_rows.dart';
import '../services/user_library_service.dart';

/// Finds the built-in Favorites list's id, or null if it can't be
/// determined (network unreachable).
Future<String?> findFavoritesListId() async {
  final lists = await UserLibraryService.fetchLists();
  for (final l in lists) {
    if (l.type == SupabaseListTypes.favorites) return l.id;
  }
  return null;
}
