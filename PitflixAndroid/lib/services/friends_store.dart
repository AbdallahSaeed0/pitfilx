import 'dart:async';

import 'package:flutter/foundation.dart';

import '../data/mock_friends_data.dart';
import '../models/friend.dart';
import '../models/friend_request.dart';

/// Session-only shared friend-request state — Pitflix.API has no social
/// graph yet (see models/friend.dart), so this just makes the mock Friends /
/// Add Friend / Requests screens agree with each other in-session: sending a
/// request from Add Friend shows up as outgoing on the Friends screen, and
/// (since there's no real other person to respond) we simulate them
/// accepting it a few seconds later so the full send -> accept lifecycle is
/// visible. Resets on app restart, same as the rest of the friends feature.
abstract class FriendsStore {
  static final ValueNotifier<List<Friend>> friends = ValueNotifier(
    List.of(MockFriendsData.friends),
  );
  static final ValueNotifier<List<FriendRequest>> incoming = ValueNotifier(
    List.of(MockFriendsData.incomingRequests),
  );
  static final ValueNotifier<List<FriendRequest>> outgoing = ValueNotifier(
    List.of(MockFriendsData.outgoingRequests),
  );

  static bool isFriend(String friendId) =>
      friends.value.any((f) => f.id == friendId);

  static bool isPending(String friendId) =>
      incoming.value.any((r) => r.friend.id == friendId) ||
      outgoing.value.any((r) => r.friend.id == friendId);

  static void sendRequest(Friend friend) {
    if (isFriend(friend.id) || isPending(friend.id)) return;
    final request = FriendRequest(
      id: 'out-${friend.id}-${DateTime.now().microsecondsSinceEpoch}',
      friend: friend,
      direction: FriendRequestDirection.outgoing,
      sentAt: DateTime.now(),
    );
    outgoing.value = [...outgoing.value, request];
    Timer(const Duration(seconds: 4), () => _autoAccept(request));
  }

  /// Stands in for the other person accepting — only fires if the request
  /// wasn't cancelled in the meantime.
  static void _autoAccept(FriendRequest request) {
    if (!outgoing.value.any((r) => r.id == request.id)) return;
    outgoing.value = outgoing.value.where((r) => r.id != request.id).toList();
    friends.value = [...friends.value, request.friend];
  }

  static void acceptRequest(FriendRequest request) {
    incoming.value = incoming.value.where((r) => r.id != request.id).toList();
    friends.value = [...friends.value, request.friend];
  }

  static void declineRequest(FriendRequest request) {
    incoming.value = incoming.value.where((r) => r.id != request.id).toList();
  }

  static void cancelOutgoing(FriendRequest request) {
    outgoing.value = outgoing.value.where((r) => r.id != request.id).toList();
  }
}
