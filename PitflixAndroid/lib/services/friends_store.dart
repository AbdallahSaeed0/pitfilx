import 'package:flutter/foundation.dart';

import '../models/social_friend_request.dart';
import '../models/social_profile.dart';
import 'social_service.dart';

/// Shared session state for the Friends screens, backed by the real social
/// schema (see SocialService). Notifiers start empty and are populated by
/// [refresh] — called after a successful login/signup and defensively from
/// RootShell — rather than synchronously at app start, since it's now a
/// network call instead of static mock data.
abstract class FriendsStore {
  static final ValueNotifier<List<SocialProfile>> friends = ValueNotifier([]);
  static final ValueNotifier<List<SocialFriendRequest>> incoming =
      ValueNotifier([]);
  static final ValueNotifier<List<SocialFriendRequest>> outgoing =
      ValueNotifier([]);
  static final ValueNotifier<bool> loaded = ValueNotifier(false);

  static bool isFriend(String profileId) =>
      friends.value.any((f) => f.id == profileId);

  static bool isPending(String profileId) =>
      incoming.value.any((r) => r.profile.id == profileId) ||
      outgoing.value.any((r) => r.profile.id == profileId);

  static Future<void> refresh() async {
    final results = await Future.wait([
      SocialService.fetchFriends(),
      SocialService.fetchIncomingRequests(),
      SocialService.fetchOutgoingRequests(),
    ]);
    friends.value = results[0] as List<SocialProfile>;
    incoming.value = results[1] as List<SocialFriendRequest>;
    outgoing.value = results[2] as List<SocialFriendRequest>;
    loaded.value = true;
  }

  static Future<void> sendRequest(SocialProfile profile) async {
    if (isFriend(profile.id) || isPending(profile.id)) return;
    await SocialService.sendFriendRequest(profile.id);
    await refresh();
  }

  static Future<void> acceptRequest(SocialFriendRequest request) async {
    await SocialService.acceptFriendRequest(request.id);
    await refresh();
  }

  static Future<void> declineRequest(SocialFriendRequest request) async {
    await SocialService.declineFriendRequest(request.id);
    await refresh();
  }

  static Future<void> cancelOutgoing(SocialFriendRequest request) async {
    await SocialService.cancelOutgoingRequest(request.id);
    await refresh();
  }
}
