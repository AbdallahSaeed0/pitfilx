import 'dart:typed_data';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/social_activity_item.dart';
import '../models/social_comment.dart';
import '../models/social_friend_request.dart';
import '../models/social_profile.dart';
import '../models/title_item.dart';
import '../utils/list_marks.dart';
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
    String? avatarUrl,
    String? coverUrl,
  }) async {
    try {
      await _client
          .from('profiles')
          .update({
            if (username != null) 'username': username,
            if (displayName != null) 'display_name': displayName,
            if (avatarUrl != null) 'avatar_url': avatarUrl,
            if (coverUrl != null) 'cover_url': coverUrl,
          })
          .eq('id', _myId);
    } on PostgrestException catch (e) {
      if (e.code == '23505') throw const UsernameTakenException();
      rethrow;
    }
  }

  /// Uploads picked image bytes to the `profile-images` bucket (see
  /// 007_pitflix_profile_images_storage.sql) at a fixed per-account path —
  /// `{user_id}/avatar.jpg` or `{user_id}/cover.jpg`, `upsert: true` so a
  /// re-pick overwrites rather than accumulating orphaned files — then
  /// updates `profiles.avatar_url`/`cover_url` to the resulting public URL.
  /// A cache-busting query param is appended since the object key (and so
  /// the URL) doesn't change between uploads, which would otherwise leave
  /// stale cached copies showing after a re-pick. Returns the final URL.
  static Future<String> uploadProfileImage({
    required Uint8List bytes,
    required bool isCover,
    String contentType = 'image/jpeg',
  }) async {
    final path = '$_myId/${isCover ? 'cover' : 'avatar'}.jpg';
    await _client.storage
        .from('profile-images')
        .uploadBinary(
          path,
          bytes,
          fileOptions: FileOptions(contentType: contentType, upsert: true),
        );
    final publicUrl = _client.storage.from('profile-images').getPublicUrl(path);
    final url = '$publicUrl?v=${DateTime.now().millisecondsSinceEpoch}';
    await updateProfile(
      avatarUrl: isCover ? null : url,
      coverUrl: isCover ? url : null,
    );
    return url;
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
    final profiles = {for (final p in await _profilesByIds(otherIds)) p.id: p};
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
    final rows = await filtered
        .order('created_at', ascending: false)
        .limit(limit);
    if (rows.isEmpty) return [];
    final authorIds = rows.map((r) => r['user_id'] as String).toSet().toList();
    final profiles = {for (final p in await _profilesByIds(authorIds)) p.id: p};
    return rows
        .map(
          (r) => SocialActivityItem.fromJson(
            r,
            profiles[r['user_id']] ?? SocialProfile(id: r['user_id'] as String),
          ),
        )
        .toList();
  }

  /// Every friend's (+ your own) watched/rated activity for one specific
  /// title — powers Title Detail's "Friends" section. RLS already scopes
  /// `activity_events` to self + friends (see class doc), so this is just
  /// that same table filtered down to one title instead of the whole feed.
  /// One entry per author: if a friend both watched and later rated the
  /// same title, only the most recent of those two rows is kept (dedup by
  /// author id, first-seen-wins since rows arrive newest-first) — otherwise
  /// they'd show up twice for one title.
  static Future<List<SocialActivityItem>> fetchActivityForTitle(
    int tmdbId,
    String mediaType, {
    int limit = 30,
  }) async {
    final rows = await _client
        .from('activity_events')
        .select()
        .eq('tmdb_id', tmdbId)
        .eq('media_type', mediaType)
        .inFilter('action', ['watched', 'rated'])
        .order('created_at', ascending: false)
        .limit(limit);
    if (rows.isEmpty) return [];
    final authorIds = rows.map((r) => r['user_id'] as String).toSet().toList();
    final profiles = {for (final p in await _profilesByIds(authorIds)) p.id: p};
    final seenAuthors = <String>{};
    final items = <SocialActivityItem>[];
    for (final r in rows) {
      final authorId = r['user_id'] as String;
      if (!seenAuthors.add(authorId)) continue;
      items.add(
        SocialActivityItem.fromJson(
          r,
          profiles[authorId] ?? SocialProfile(id: authorId),
        ),
      );
    }
    return items;
  }

  /// Real "what have they watched" data for a friend's profile — their
  /// `watch_records` (movies/series), `watch_log`/`episode_watch_status`
  /// (TV time/episode totals), and `user_lists`/`user_list_items`
  /// (playlists), readable thanks to the friends-visibility policies in
  /// `011_pitflix_friend_library_visibility.sql` and
  /// `013_pitflix_friend_watch_time_visibility.sql`. Same three headline
  /// numbers (TV time, episodes, movies) a user's own Profile shows via
  /// [UserLibraryService.fetchProfileSummary] — this is the friends-visible
  /// equivalent of that call.
  ///
  /// `recentMovies`/`recentSeries` are scoped to `status = 'completed'`,
  /// matching [UserLibraryService.fetchRecentlyCompleted]'s own semantics
  /// (which is what a user's own Profile "Movies"/"Series" rows show) — so a
  /// friend's rows show the same subset of titles their own Profile would.
  /// `totalSeriesWatched` stays broader (any status) since that tile is
  /// meant to read as "tracked", not "finished".
  static Future<
    ({
      List<TitleItem> recentMovies,
      List<TitleItem> recentSeries,
      int totalMoviesWatched,
      int totalSeriesWatched,
      int totalWatchTimeMinutes,
      int totalEpisodesWatched,
      List<({String id, String name, String? icon, String type, int itemCount})>
      playlists,
    })
  >
  fetchFriendLibrarySummary(String profileId) async {
    final results = await Future.wait([
      _client
          .from('watch_records')
          .select()
          .eq('user_id', profileId)
          .order('updated_at', ascending: false),
      _client.from('watch_log').select('minutes').eq('user_id', profileId),
      _client
          .from('episode_watch_status')
          .select('id')
          .eq('user_id', profileId),
    ]);
    final records = results[0];
    final logRows = results[1];
    final watchedEpisodes = results[2];
    final totalMinutes = logRows.fold<int>(
      0,
      (sum, r) => sum + ((r['minutes'] as num?)?.toInt() ?? 0),
    );

    final movieRows = records.where((r) => r['media_type'] == 'movie');
    final seriesRows = records.where((r) => r['media_type'] == 'series');
    final completedMovieRows = movieRows.where(
      (r) => r['status'] == 'completed',
    );
    final completedSeriesRows = seriesRows.where(
      (r) => r['status'] == 'completed',
    );

    TitleItem toTitle(Map<String, dynamic> r) {
      final tmdbId = (r['tmdb_id'] as num).toInt();
      final isSeries = r['media_type'] == 'series';
      return TitleItem(
        id: 'friend-watch-$tmdbId-${isSeries ? 'series' : 'movie'}',
        name: r['title'] as String? ?? 'Untitled',
        kind: isSeries ? TitleKind.show : TitleKind.movie,
        year: (r['release_year'] as num?)?.toInt() ?? 0,
        network: isSeries ? 'TV' : 'Theaters',
        rating: 0,
        genres: (r['genres'] as List? ?? const []).cast<String>(),
        overview: '',
        gradientSeed: tmdbId % 6,
        posterPath: r['poster_path'] as String?,
        tmdbId: tmdbId,
        isSummaryOnly: true,
      );
    }

    final lists = await _client
        .from('user_lists')
        .select()
        .eq('user_id', profileId)
        .order('created_at');
    final playlists = await Future.wait(
      lists.map((l) async {
        final id = l['id'] as String;
        final (icon, name) = ListMarks.decode(l['name'] as String? ?? '');
        final count = await _client
            .from('user_list_items')
            .count()
            .eq('list_id', id);
        return (
          id: id,
          name: name.isEmpty ? 'Untitled' : name,
          icon: icon,
          type: l['type'] as String? ?? 'custom',
          itemCount: count,
        );
      }),
    );

    return (
      recentMovies: completedMovieRows.take(10).map(toTitle).toList(),
      recentSeries: completedSeriesRows.take(10).map(toTitle).toList(),
      totalMoviesWatched: completedMovieRows.length,
      totalSeriesWatched: seriesRows.length,
      totalWatchTimeMinutes: totalMinutes,
      totalEpisodesWatched: watchedEpisodes.length,
      playlists: playlists,
    );
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
    final profiles = {for (final p in await _profilesByIds(authorIds)) p.id: p};
    return rows
        .map(
          (r) => SocialComment.fromJson(
            r,
            profiles[r['user_id']] ?? SocialProfile(id: r['user_id'] as String),
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
