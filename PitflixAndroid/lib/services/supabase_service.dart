import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import '../models/supabase_rows.dart';
import '../utils/ttl_cache.dart';

/// Read-only PostgREST calls against the Supabase project the desktop app's
/// sync module writes to. No auth — the anon key is enough since RLS is
/// disabled on these tables in this no-login phase (see
/// Pitflix.API/Services/Supabase/sql/README.md).
class SupabaseService {
  SupabaseService._();

  static final _listsCache = TtlCache<List<SupabaseListRow>>();

  static Future<List<SupabaseListRow>> fetchLists({
    bool forceRefresh = false,
  }) async {
    final cached = _listsCache.get(forceRefresh);
    if (cached != null) return cached;

    final rows = await _get('lists', 'order=created_at.asc');
    final mapped = rows.map(SupabaseListRow.fromJson).toList();
    _listsCache.set(mapped);
    return mapped;
  }

  static Future<List<SupabaseListItemRow>> fetchListItems(String listId) async {
    final rows = await _get(
      'list_items',
      'list_id=eq.${Uri.encodeQueryComponent(listId)}&order=added_at.desc',
    );
    return rows.map(SupabaseListItemRow.fromJson).toList();
  }

  static Future<List<SupabaseWatchEventRow>> fetchWatchEvents() async {
    final rows = await _get('watch_events', 'order=watched_at.desc');
    return rows.map(SupabaseWatchEventRow.fromJson).toList();
  }

  static Future<List<Map<String, dynamic>>> _get(
    String table,
    String query,
  ) async {
    if (!AppConfig.isSupabaseConfigured) {
      throw const SupabaseNotConfiguredException();
    }

    final url = Uri.parse('${AppConfig.supabaseUrl}/rest/v1/$table?$query');
    final res = await http.get(
      url,
      headers: {
        'apikey': AppConfig.supabaseAnonKey,
        'Authorization': 'Bearer ${AppConfig.supabaseAnonKey}',
        'Accept': 'application/json',
      },
    );

    if (res.statusCode != 200) {
      throw Exception(
        'Supabase GET $table failed: ${res.statusCode} ${res.body}',
      );
    }

    final decoded = jsonDecode(res.body);
    return (decoded as List).cast<Map<String, dynamic>>();
  }
}

class SupabaseNotConfiguredException implements Exception {
  const SupabaseNotConfiguredException();

  @override
  String toString() =>
      'Supabase URL/anon key not configured — set them in lib/config/app_config.dart';
}
