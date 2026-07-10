import 'social_profile.dart';

enum FriendRequestDirection { incoming, outgoing }

/// A real `friend_requests` row, joined with the other side's profile.
class SocialFriendRequest {
  final String id;

  /// The other person in the request (never the current user).
  final SocialProfile profile;
  final FriendRequestDirection direction;
  final DateTime createdAt;

  const SocialFriendRequest({
    required this.id,
    required this.profile,
    required this.direction,
    required this.createdAt,
  });
}
