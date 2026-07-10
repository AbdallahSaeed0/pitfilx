/// Row shape for a list (Watch Later/Favorites/custom) — used by both the
/// desktop-sync path's `lists` table and Supabase's per-account
/// `user_lists` table (see UserLibraryService), which share this shape.
library;

import '../utils/list_marks.dart';

abstract class SupabaseListTypes {
  static const watchlist = 'watchlist';
  static const favorites = 'favorites';
  static const custom = 'custom';
}

class SupabaseListRow {
  final String id;
  final String name;
  final String type; // "watchlist" | "favorites" | "custom"
  final String source; // "desktop" | "mobile"
  final DateTime createdAt;
  final String? icon; // ListMarks id, if the name carried an icon prefix

  const SupabaseListRow({
    required this.id,
    required this.name,
    required this.type,
    required this.source,
    required this.createdAt,
    this.icon,
  });

  factory SupabaseListRow.fromJson(Map<String, dynamic> json) {
    final (icon, title) = ListMarks.decode(json['name'] as String? ?? '');
    return SupabaseListRow(
      id: json['id'] as String,
      name: title,
      type: json['type'] as String? ?? 'custom',
      source: json['source'] as String? ?? 'desktop',
      createdAt:
          DateTime.tryParse(json['created_at'] as String? ?? '') ??
          DateTime.now(),
      icon: icon,
    );
  }
}
