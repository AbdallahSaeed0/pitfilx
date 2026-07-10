/// Row shapes matching the Supabase tables created by
/// Pitflix.API/Services/Supabase/sql/001_pitflix_mobile_sync_schema.sql.
/// Mirrors the desktop sync module's schema — see that folder's DTOs
/// (SupabaseListDto / SupabaseListItemDto / SupabaseWatchEventDto) for the
/// server-side equivalents.
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

class SupabaseListItemRow {
  final String id;
  final String listId;
  final int tmdbId;
  final String mediaType; // "movie" | "tv" (or desktop's "Movie"/"Series")
  final DateTime addedAt;

  const SupabaseListItemRow({
    required this.id,
    required this.listId,
    required this.tmdbId,
    required this.mediaType,
    required this.addedAt,
  });

  factory SupabaseListItemRow.fromJson(Map<String, dynamic> json) =>
      SupabaseListItemRow(
        id: json['id'] as String,
        listId: json['list_id'] as String,
        tmdbId: (json['tmdb_id'] as num?)?.toInt() ?? 0,
        mediaType: json['media_type'] as String? ?? 'movie',
        addedAt:
            DateTime.tryParse(json['added_at'] as String? ?? '') ??
            DateTime.now(),
      );
}

class SupabaseWatchEventRow {
  final String id;
  final int tmdbId;
  final String mediaType;
  final String? title;
  final String? posterPath;
  final DateTime watchedAt;
  final int? rating;
  final String source;
  final DateTime syncedAt;

  const SupabaseWatchEventRow({
    required this.id,
    required this.tmdbId,
    required this.mediaType,
    required this.title,
    required this.posterPath,
    required this.watchedAt,
    required this.rating,
    required this.source,
    required this.syncedAt,
  });

  factory SupabaseWatchEventRow.fromJson(Map<String, dynamic> json) =>
      SupabaseWatchEventRow(
        id: json['id'] as String,
        tmdbId: (json['tmdb_id'] as num?)?.toInt() ?? 0,
        mediaType: json['media_type'] as String? ?? 'movie',
        title: json['title'] as String?,
        posterPath: json['poster_path'] as String?,
        watchedAt:
            DateTime.tryParse(json['watched_at'] as String? ?? '') ??
            DateTime.now(),
        rating: (json['rating'] as num?)?.toInt(),
        source: json['source'] as String? ?? 'desktop',
        syncedAt:
            DateTime.tryParse(json['synced_at'] as String? ?? '') ??
            DateTime.now(),
      );
}

/// True if [mediaType] represents a TV/series item, across both the
/// mobile/TMDB convention ("tv") and the desktop convention ("Series").
bool isSeriesMediaType(String mediaType) =>
    mediaType.toLowerCase() == 'tv' || mediaType.toLowerCase() == 'series';
