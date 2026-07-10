import 'social_profile.dart';

enum SocialActivityAction { watched, rated, addedToWatchlist }

SocialActivityAction _actionFromString(String value) => switch (value) {
  'watched' => SocialActivityAction.watched,
  'rated' => SocialActivityAction.rated,
  'added_to_watchlist' => SocialActivityAction.addedToWatchlist,
  _ => SocialActivityAction.watched,
};

String actionToString(SocialActivityAction action) => switch (action) {
  SocialActivityAction.watched => 'watched',
  SocialActivityAction.rated => 'rated',
  SocialActivityAction.addedToWatchlist => 'added_to_watchlist',
};

/// A real `activity_events` row, joined with the author's profile. Unlike
/// the old mock `ActivityItem` (which stored a `titleId` index into
/// `MockData.titles`), this carries the title/poster denormalized on the
/// row itself — no local lookup needed.
class SocialActivityItem {
  final String id;
  final SocialProfile profile;
  final SocialActivityAction action;
  final int tmdbId;
  final String mediaType;
  final String? title;
  final String? posterPath;
  final int? rating;
  final DateTime createdAt;

  const SocialActivityItem({
    required this.id,
    required this.profile,
    required this.action,
    required this.tmdbId,
    required this.mediaType,
    this.title,
    this.posterPath,
    this.rating,
    required this.createdAt,
  });

  factory SocialActivityItem.fromJson(
    Map<String, dynamic> json,
    SocialProfile profile,
  ) {
    return SocialActivityItem(
      id: json['id'] as String,
      profile: profile,
      action: _actionFromString(json['action'] as String? ?? 'watched'),
      tmdbId: (json['tmdb_id'] as num).toInt(),
      mediaType: json['media_type'] as String? ?? 'movie',
      title: json['title'] as String?,
      posterPath: json['poster_path'] as String?,
      rating: (json['rating'] as num?)?.toInt(),
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }
}
