import 'friend.dart';

enum ActivityAction { watched, rated, addedToWatchLater }

/// One entry in a friend's activity feed — UI-only placeholder, see friend.dart.
class ActivityItem {
  final String id;
  final Friend friend;

  /// Id into MockData.titles.
  final String titleId;
  final ActivityAction action;
  final int? rating;
  final DateTime timestamp;

  const ActivityItem({
    required this.id,
    required this.friend,
    required this.titleId,
    required this.action,
    this.rating,
    required this.timestamp,
  });
}
