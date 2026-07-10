import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/social_activity_item.dart';
import '../models/social_comment.dart';
import '../models/social_friend_request.dart';
import '../models/social_profile.dart';
import 'auth_service.dart';

/// Real network calls against the social schema (profiles/friend_requests/
/// friendships/activity_events/activity_likes/activity_comments) — see
/// Pitflix.API/Services/Supabase/sql/002_pitflix_social_schema.sql. RLS on
/// every table already scopes visibility to "me + my friends", so reads
/// here don't need extra client-side filtering for that.
abstract class SocialService {
  static SupabaseClient get _client => Supabase.instance.client;
  static String get _myId => AuthService.currentUser!.id;

  static Future<List<SocialProfile>> _profilesByIds(List<String> ids) async {
    if (ids.isEmpty) return [];
    final rows = await _client.from('profiles').select().inFilter('id', ids);
    return rows.map(SocialProfile.fromJson).toList();
  }

  static Future<SocialProfile?> myProfile() async {
    final row = await _client
        .from('profiles')
        .select()
        .eq('id', _myId)
        .maybeSingle();
    return row == null ? null : SocialProfile.fromJson(row);
  }

  /// Throws [UsernameTakenException] if [username] is already in use by
  /// another account (`profiles.username` has a unique constraint).
  static Future<void> updateProfile({
    String? username,
    String? displayName,
  }) async {
    try {
      await _client
          .from('profiles')
          .update({
            if (username != null) 'username': username,
            if (displayName != null) 'display_name': displayName,
          })
          .eq('id', _myId);
    } on PostgrestException catch (e) {
      if (e.code == '23505') throw const UsernameTakenException();
      rethrow;
    }
  }

  static Future<List<SocialProfile>> searchProfiles(String query) async {
    if (query.trim().isEmpty) return [];
    final rows = await _client
        .from('profiles')
        .select()
        .ilike('username', '%${query.trim()}%')
        .neq('id', _myId)
        .limit(20);
    return rows.map(SocialProfile.fromJson).toList();
  }

  /// Friendships store one row per pair with `user_id < friend_id` — the
  /// current user can be on either side, so two queries + merge.
  static Future<List<SocialProfile>> fetchFriends() async {
    final asUser = await _client
        .from('friendships')
        .select('friend_id')
        .eq('user_id', _myId);
    final asFriend = await _client
        .from('friendships')
        .select('user_id')
        .eq('friend_id', _myId);
    final ids = <String>{
      for (final r in asUser) r['friend_id'] as String,
      for (final r in asFriend) r['user_id'] as String,
    };
    return _profilesByIds(ids.toList());
  }

  static Future<List<SocialFriendRequest>> _fetchRequests({
    required String myField,
    required String otherField,
    required FriendRequestDirection direction,
  }) async {
    final rows = await _client
        .from('friend_requests')
        .select()
        .eq(myField, _myId)
        .eq('status', 'pending')
        .order('created_at');
    if (rows.isEmpty) return [];
    final otherIds = rows.map((r) => r[otherField] as String).toSet().toList();
    final profiles = {
      for (final p in await _profilesByIds(otherIds)) p.id: p,
    };
    return rows
        .map(
          (r) => SocialFriendRequest(
            id: r['id'] as String,
            profile:
                profiles[r[otherField]] ??
                SocialProfile(id: r[otherField] as String),
            direction: direction,
            createdAt: DateTime.parse(r['created_at'] as String),
          ),
        )
        .toList();
  }

  static Future<List<SocialFriendRequest>> fetchIncomingRequests() =>
      _fetchRequests(
        myField: 'receiver_id',
        otherField: 'sender_id',
        direction: FriendRequestDirection.incoming,
      );

  static Future<List<SocialFriendRequest>> fetchOutgoingRequests() =>
      _fetchRequests(
        myField: 'sender_id',
        otherField: 'receiver_id',
        direction: FriendRequestDirection.outgoing,
      );

  static Future<void> sendFriendRequest(String receiverId) => _client
      .from('friend_requests')
      .insert({'sender_id': _myId, 'receiver_id': receiverId});

  static Future<void> acceptFriendRequest(String requestId) =>
      _client.rpc('accept_friend_request', params: {'request_id': requestId});

  static Future<void> declineFriendRequest(String requestId) => _client
      .from('friend_requests')
      .update({
        'status': 'declined',
        'responded_at': DateTime.now().toIso8601String(),
      })
      .eq('id', requestId);

  static Future<void> cancelOutgoingRequest(String requestId) =>
      _client.from('friend_requests').delete().eq('id', requestId);

  /// Pass [profileId] to scope to one person's activity (Friend Profile
  /// screen); omit for the merged feed (own + friends', per RLS).
  static Future<List<SocialActivityItem>> fetchActivityFeed({
    int limit = 30,
    String? profileId,
  }) async {
    final builder = _client.from('activity_events').select();
    final filtered = profileId != null
        ? builder.eq('user_id', profileId)
        : builder;
    final rows = await filtered.order('created_at', ascending: false).limit(limit);
    if (rows.isEmpty) return [];
    final authorIds = rows.map((r) => r['user_id'] as String).toSet().toList();
    final profiles = {
      for (final p in await _profilesByIds(authorIds)) p.id: p,
    };
    return rows
        .map(
          (r) => SocialActivityItem.fromJson(
            r,
            profiles[r['user_id']] ??
                SocialProfile(id: r['user_id'] as String),
          ),
        )
        .toList();
  }

  /// Fire-and-forget — a failure here shouldn't block the watch/rate/
  /// watchlist action that triggered it, and it's a no-op when signed out.
  static Future<void> logActivity({
    required SocialActivityAction action,
    required int tmdbId,
    required String mediaType,
    String? title,
    String? posterPath,
    int? rating,
  }) async {
    if (!AuthService.isSignedIn) return;
    try {
      await _client.from('activity_events').insert({
        'user_id': _myId,
        'action': actionToString(action),
        'tmdb_id': tmdbId,
        'media_type': mediaType,
        'title': title,
        'poster_path': posterPath,
        'rating': rating,
      });
    } catch (_) {
      // Decorative — see doc comment above.
    }
  }

  static Future<List<SocialComment>> fetchComments(String activityId) async {
    final rows = await _client
        .from('activity_comments')
        .select()
        .eq('activity_id', activityId)
        .order('created_at');
    if (rows.isEmpty) return [];
    final authorIds = rows.map((r) => r['user_id'] as String).toSet().toList();
    final profiles = {
      for (final p in await _profilesByIds(authorIds)) p.id: p,
    };
    return rows
        .map(
          (r) => SocialComment.fromJson(
            r,
            profiles[r['user_id']] ??
                SocialProfile(id: r['user_id'] as String),
          ),
        )
        .toList();
  }

  static Future<void> addComment(String activityId, String body) => _client
      .from('activity_comments')
      .insert({'activity_id': activityId, 'user_id': _myId, 'body': body});

  static Future<({int count, bool likedByMe})> likeState(
    String activityId,
  ) async {
    final rows = await _client
        .from('activity_likes')
        .select('user_id')
        .eq('activity_id', activityId);
    return (
      count: rows.length,
      likedByMe: rows.any((r) => r['user_id'] == _myId),
    );
  }

  static Future<void> toggleLike(String activityId, bool liked) {
    if (liked) {
      return _client.from('activity_likes').insert({
        'activity_id': activityId,
        'user_id': _myId,
      });
    }
    return _client
        .from('activity_likes')
        .delete()
        .eq('activity_id', activityId)
        .eq('user_id', _myId);
  }
}

class UsernameTakenException implements Exception {
  const UsernameTakenException();

  @override
  String toString() => 'That username is already taken.';
}
