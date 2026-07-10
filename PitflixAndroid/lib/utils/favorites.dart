import '../models/supabase_rows.dart';
import '../services/local_backend_service.dart';

/// Finds the built-in Favorites list's local id, or null if it can't be
/// determined (backend unreachable, or somehow missing).
Future<int?> findFavoritesListId() async {
  final lists = await LocalBackendService.fetchLists();
  for (final l in lists) {
    if (l.type == SupabaseListTypes.favorites) return int.tryParse(l.id);
  }
  return null;
}
