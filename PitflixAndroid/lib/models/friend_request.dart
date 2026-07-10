import 'friend.dart';

enum FriendRequestDirection { incoming, outgoing }

/// UI-only placeholder — see friend.dart.
class FriendRequest {
  final String id;
  final Friend friend;
  final FriendRequestDirection direction;
  final DateTime sentAt;

  const FriendRequest({
    required this.id,
    required this.friend,
    required this.direction,
    required this.sentAt,
  });
}
