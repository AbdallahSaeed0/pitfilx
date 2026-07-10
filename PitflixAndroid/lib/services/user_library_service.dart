import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/supabase_rows.dart';
import '../models/title_item.dart';
import 'auth_service.dart';

/// Per-account library data (Watch Later/Favorites/custom lists, watched
/// status, ratings, episode progress, Stats source data) — see
/// Pitflix.API/Services/Supabase/sql/003_pitflix_user_library_schema.sql.
/// Every table is single-owner (RLS: `user_id = auth.uid()`), so unlike
/// [SocialService] there's no cross-user visibility to worry about.
abstract class UserLibraryService {
  static SupabaseClient get _client => Supabase.instance.client;
  static String get _myId => AuthService.currentUser!.id;

  /// Bumped after every write in this class — lists, watch records, episode
  /// status/rewatch counts, and the desktop-import bulk writes. Lets other
  /// already-mounted screens (Home/Stats/Profile/Lists — kept alive across
  /// tab switches by RootShell, so they don't naturally re-fetch) react by
  /// reloading; listen via `addListener` in `initState` and remove it in
  /// `dispose`.
  static final ValueNotifier<int> libraryVersion = ValueNotifier(0);

  // ── lists ──────────────────────────────────────────────────────────────

  /// Ensures a Watchlist and Favorites list exist for the current account
  /// (auto-created on first use, mirroring the old local backend's
  /// always-present built-in lists), then returns all of the user's lists.
  static Future<List<SupabaseListRow>> fetchLists({
    bool forceRefresh = false,
  }) async {
    var rows = await _client
        .from('user_lists')
        .select()
        .eq('user_id', _myId)
        .order('created_at');
    final hasWatchlist = rows.any((r) => r['type'] == 'watchlist');
    final hasFavorites = rows.any((r) => r['type'] == 'favorites');
    if (!hasWatchlist) {
      await _client.from('user_lists').insert({
        'user_id': _myId,
        'name': 'Watch Later',
        'type': 'watchlist',
      });
    }
    if (!hasFavorites) {
      await _client.from('user_lists').insert({
        'user_id': _myId,
        'name': 'Favorites',
        'type': 'favorites',
      });
    }
    if (!hasWatchlist || !hasFavorites) {
      rows = await _client
          .from('user_lists')
          .select()
          .eq('user_id', _myId)
          .order('created_at');
    }
    return rows
        .map(
          // .fromJson (not a manual constructor call) so names carrying a
          // `::icon:: Title` prefix (e.g. from the desktop import) get
          // decoded into (icon, title) instead of showing the raw prefix.
          (r) => SupabaseListRow.fromJson(r),
        )
        .toList();
  }

  static Future<String> createList(String name) async {
    final row = await _client
        .from('user_lists')
        .insert({'user_id': _myId, 'name': name, 'type': 'custom'})
        .select()
        .single();
    libraryVersion.value++;
    return row['id'] as String;
  }

  /// Deletes a custom list (cascades to its items). Watchlist/Favorites are
  /// treated as permanent — callers should not offer this for those.
  static Future<void> deleteList(String listId) async {
    await _client.from('user_lists').delete().eq('id', listId);
    libraryVersion.value++;
  }

  static Future<List<TitleItem>> fetchListItems(String listId) async {
    final rows = await _client
        .from('user_list_items')
        .select()
        .eq('list_id', listId)
        .order('added_at', ascending: false);
    return rows.map(_titleFromListItemRow).toList();
  }

  static Future<void> addToList(
    String listId, {
    required int tmdbId,
    required String mediaType,
    String? title,
    String? posterPath,
  }) async {
    await _client.from('user_list_items').insert({
      'list_id': listId,
      'tmdb_id': tmdbId,
      'media_type': mediaType,
      'title': title,
      'poster_path': posterPath,
    });
    libraryVersion.value++;
  }

  static Future<void> removeFromList(
    String listId,
    int tmdbId,
    String mediaType,
  ) async {
    await _client
        .from('user_list_items')
        .delete()
        .eq('list_id', listId)
        .eq('tmdb_id', tmdbId)
        .eq('media_type', mediaType);
    libraryVersion.value++;
  }

  static Future<bool> isInList(
    String listId,
    int tmdbId,
    String mediaType,
  ) async {
    final rows = await _client
        .from('user_list_items')
        .select('id')
        .eq('list_id', listId)
        .eq('tmdb_id', tmdbId)
        .eq('media_type', mediaType)
        .limit(1);
    return rows.isNotEmpty;
  }

  static TitleItem _titleFromListItemRow(Map<String, dynamic> r) {
    final tmdbId = (r['tmdb_id'] as num).toInt();
    final mediaType = r['media_type'] as String? ?? 'movie';
    final kind = mediaType.toLowerCase() == 'series' || mediaType.toLowerCase() == 'tv'
        ? TitleKind.show
        : TitleKind.movie;
    final title = r['title'] as String? ?? 'Untitled';
    return TitleItem(
      id: 'user-list-$tmdbId-${kind.name}',
      name: title,
      kind: kind,
      year: 0,
      network: kind == TitleKind.movie ? 'Theaters' : 'TV',
      rating: 0,
      genres: const [],
      overview: '',
      gradientSeed: tmdbId % 6,
      posterPath: r['poster_path'] as String?,
      tmdbId: tmdbId,
      isSummaryOnly: true,
    );
  }

  // ── watch records (movies + series overall status) ───────────────────────

  static Future<Map<String, dynamic>?> fetchWatchRecord(
    int tmdbId,
    String mediaType,
  ) async {
    return _client
        .from('watch_records')
        .select()
        .eq('user_id', _myId)
        .eq('tmdb_id', tmdbId)
        .eq('media_type', mediaType)
        .maybeSingle();
  }

  /// Upserts the watch record for a title and logs a `watch_log` entry
  /// (feeds the Stats 7-day chart / week-month totals).
  static Future<void> logWatched({
    required int tmdbId,
    required String mediaType,
    required String title,
    String? posterPath,
    List<String>? genres,
    int? releaseYear,
    String? network,
    int? rating,
    int estimatedMinutes = 0,
    String status = 'completed',
  }) async {
    await _client.from('watch_records').upsert({
      'user_id': _myId,
      'tmdb_id': tmdbId,
      'media_type': mediaType,
      'title': title,
      'poster_path': posterPath,
      'genres': genres ?? const [],
      'release_year': releaseYear,
      'network': network,
      'status': status,
      'rating': rating,
      'updated_at': DateTime.now().toIso8601String(),
    }, onConflict: 'user_id,tmdb_id,media_type');
    if (estimatedMinutes > 0) {
      await _client.from('watch_log').insert({
        'user_id': _myId,
        'tmdb_id': tmdbId,
        'media_type': mediaType,
        'minutes': estimatedMinutes,
      });
    }
    libraryVersion.value++;
  }

  static Future<List<Map<String, dynamic>>> fetchRecentlyCompleted({
    String? mediaType,
    int limit = 10,
  }) async {
    var query = _client
        .from('watch_records')
        .select()
        .eq('user_id', _myId)
        .eq('status', 'completed');
    if (mediaType != null) query = query.eq('media_type', mediaType);
    return query.order('updated_at', ascending: false).limit(limit);
  }

  /// Series with `status = 'watching'`, each with its watched-episode count
  /// (there's no TMDB season data cached here to compute a precise "next
  /// episode" label without an extra fetch per show, so Home just shows
  /// progress-so-far instead).
  static Future<List<Map<String, dynamic>>> fetchCurrentlyWatching() async {
    final records = await _client
        .from('watch_records')
        .select()
        .eq('user_id', _myId)
        .eq('media_type', 'series')
        .eq('status', 'watching')
        .order('updated_at', ascending: false);
    return Future.wait(
      records.map((r) async {
        final tmdbId = (r['tmdb_id'] as num).toInt();
        final watchedCount = await _client
            .from('episode_watch_status')
            .count()
            .eq('user_id', _myId)
            .eq('show_tmdb_id', tmdbId);
        return {...r, 'watched_episode_count': watchedCount};
      }),
    );
  }

  static TitleItem _titleFromWatchRecord(Map<String, dynamic> r) {
    final tmdbId = (r['tmdb_id'] as num).toInt();
    final mediaType = r['media_type'] as String? ?? 'movie';
    final kind = mediaType == 'series' ? TitleKind.show : TitleKind.movie;
    return TitleItem(
      id: 'watch-record-$tmdbId-${kind.name}',
      name: r['title'] as String? ?? 'Untitled',
      kind: kind,
      year: (r['release_year'] as num?)?.toInt() ?? 0,
      network: kind == TitleKind.movie ? 'Theaters' : 'TV',
      rating: 0,
      genres: (r['genres'] as List? ?? const []).cast<String>(),
      overview: '',
      gradientSeed: tmdbId % 6,
      posterPath: r['poster_path'] as String?,
      tmdbId: tmdbId,
      isSummaryOnly: true,
    );
  }

  /// Same shape Profile's old `fetchRecentlyWatched()` returned — recently
  /// completed movies/series plus summary totals, for the "Movies"/"Series"
  /// rows and quick stat tiles.
  static Future<
    ({
      List<TitleItem> movies,
      List<TitleItem> series,
      int totalWatchTimeMinutes,
      int totalEpisodesWatched,
      int totalMoviesWatched,
    })
  >
  fetchProfileSummary() async {
    final results = await Future.wait([
      fetchRecentlyCompleted(mediaType: 'movie'),
      fetchRecentlyCompleted(mediaType: 'series'),
      _client.from('watch_log').select('minutes').eq('user_id', _myId),
      _client
          .from('watch_records')
          .select('id')
          .eq('user_id', _myId)
          .eq('media_type', 'movie')
          .eq('status', 'completed'),
      _client
          .from('episode_watch_status')
          .select('id')
          .eq('user_id', _myId),
    ]);
    final movieRows = results[0];
    final seriesRows = results[1];
    final logRows = results[2];
    final completedMovies = results[3];
    final watchedEpisodes = results[4];

    final totalMinutes = logRows.fold<int>(
      0,
      (sum, r) => sum + ((r['minutes'] as num?)?.toInt() ?? 0),
    );

    return (
      movies: movieRows.map(_titleFromWatchRecord).toList(),
      series: seriesRows.map(_titleFromWatchRecord).toList(),
      totalWatchTimeMinutes: totalMinutes,
      totalEpisodesWatched: watchedEpisodes.length,
      totalMoviesWatched: completedMovies.length,
    );
  }

  // ── episode tracking ──────────────────────────────────────────────────

  /// Per-episode watch state for [showTmdbId] — key is "$season-$episode",
  /// value is that episode's rewatch count (row presence = watched; 0 means
  /// watched-but-never-rewatched).
  static Future<Map<String, int>> fetchEpisodeWatchStatuses(
    int showTmdbId,
  ) async {
    final rows = await _client
        .from('episode_watch_status')
        .select('season_number, episode_number, rewatch_count')
        .eq('user_id', _myId)
        .eq('show_tmdb_id', showTmdbId);
    return {
      for (final r in rows)
        '${r['season_number']}-${r['episode_number']}':
            (r['rewatch_count'] as num?)?.toInt() ?? 0,
    };
  }

  static Future<void> setEpisodeWatched(
    int showTmdbId,
    int season,
    int episode, {
    required bool watched,
  }) async {
    if (watched) {
      await _client.from('episode_watch_status').upsert({
        'user_id': _myId,
        'show_tmdb_id': showTmdbId,
        'season_number': season,
        'episode_number': episode,
      }, onConflict: 'user_id,show_tmdb_id,season_number,episode_number');
    } else {
      await _client
          .from('episode_watch_status')
          .delete()
          .eq('user_id', _myId)
          .eq('show_tmdb_id', showTmdbId)
          .eq('season_number', season)
          .eq('episode_number', episode);
    }
    libraryVersion.value++;
  }

  /// Persists the episode popup's "Mark Rewatched" counter — upserts (rather
  /// than requiring the episode already be marked watched first) since
  /// rewatching implies watched, matching the sheet's own local behavior.
  static Future<void> setEpisodeRewatchCount(
    int showTmdbId,
    int season,
    int episode,
    int count,
  ) async {
    await _client.from('episode_watch_status').upsert({
      'user_id': _myId,
      'show_tmdb_id': showTmdbId,
      'season_number': season,
      'episode_number': episode,
      'rewatch_count': count,
    }, onConflict: 'user_id,show_tmdb_id,season_number,episode_number');
    libraryVersion.value++;
  }

  // ── stats ──────────────────────────────────────────────────────────────

  /// Raw rows for client-side aggregation by `_StatsData.fromUserLibrary` —
  /// kept as maps (not parsed into a bundle here) since the aggregation
  /// shape is presentation-specific and lives with the Stats screen.
  static Future<
    ({
      List<Map<String, dynamic>> watchRecords,
      List<Map<String, dynamic>> watchLog,
      List<Map<String, dynamic>> episodeRewatches,
    })
  >
  fetchStatsSource() async {
    final results = await Future.wait([
      _client.from('watch_records').select().eq('user_id', _myId),
      _client
          .from('watch_log')
          .select()
          .eq('user_id', _myId)
          .order('logged_at', ascending: false)
          .limit(500),
      _client
          .from('episode_watch_status')
          .select('rewatch_count')
          .eq('user_id', _myId)
          .gt('rewatch_count', 0),
    ]);
    return (
      watchRecords: results[0],
      watchLog: results[1],
      episodeRewatches: results[2],
    );
  }
}
