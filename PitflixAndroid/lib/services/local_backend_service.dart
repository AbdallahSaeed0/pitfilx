import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import '../models/coming_soon_item.dart';
import '../models/supabase_rows.dart';
import '../models/title_item.dart';
import '../utils/list_marks.dart';
import '../utils/ttl_cache.dart';

/// Talks to your own Pitflix.API instance instead of Supabase — useful for
/// checking things work end-to-end before setting up a Supabase project.
/// Unlike [SupabaseService]/[TmdbService], the backend already resolves
/// posters/genres/titles server-side, so list items need no follow-up TMDB
/// call. Toggle via [AppConfig.useLocalBackend].
class LocalBackendService {
  LocalBackendService._();

  static final _listsCache = TtlCache<List<SupabaseListRow>>();

  /// Home's Watch Later section and the Lists screen both call this — cached
  /// briefly so opening Lists right after Home doesn't re-show a loading
  /// skeleton for data already fetched moments ago. Pass [forceRefresh] from
  /// an explicit pull-to-refresh/retry to bypass it.
  static Future<List<SupabaseListRow>> fetchLists({
    bool forceRefresh = false,
  }) async {
    final cached = _listsCache.get(forceRefresh);
    if (cached != null) return cached;

    final rows = await _getList('lists');
    final mapped = rows.map((r) {
      final (icon, title) = ListMarks.decode(r['name'] as String? ?? '');
      final lower = title.toLowerCase();
      final type = lower.contains('favorites')
          ? SupabaseListTypes.favorites
          : lower.contains('watch later')
          ? SupabaseListTypes.watchlist
          : SupabaseListTypes.custom;
      return SupabaseListRow(
        id: '${(r['id'] as num).toInt()}',
        name: title,
        type: type,
        source: 'desktop',
        createdAt:
            DateTime.tryParse(r['createdAt'] as String? ?? '') ??
            DateTime.now(),
        icon: icon,
      );
    }).toList();
    _listsCache.set(mapped);
    return mapped;
  }

  /// [listId] is the numeric local list id (as produced by [fetchLists]'s
  /// `SupabaseListRow.id`, parsed back to int).
  static Future<List<TitleItem>> fetchListItems(int listId) async {
    final rows = await _getList('lists/$listId/items');
    return rows.map((r) {
      final mediaType = (r['tmdbMediaType'] as String? ?? '').toLowerCase();
      final kind = mediaType == 'series' ? TitleKind.show : TitleKind.movie;
      return TitleItem.fromLocalMediaCard(r, kind);
    }).toList();
  }

  static Future<Map<String, dynamic>> fetchWatchStats() =>
      _getMap('stats/watch');

  /// `GET /api/stats/watch`'s `recentlyCompletedMovies`/`recentlyCompletedSeries`
  /// plus the summary totals from the same response — same data Stats
  /// already fetches, used here for Profile's "Latest Watched" sections and
  /// quick stat tiles (one request instead of two).
  static Future<
    ({
      List<TitleItem> movies,
      List<TitleItem> series,
      int totalWatchTimeMinutes,
      int totalEpisodesWatched,
      int totalMoviesWatched,
    })
  >
  fetchRecentlyWatched() async {
    final data = await _getMap('stats/watch');
    final movies = (data['recentlyCompletedMovies'] as List? ?? [])
        .cast<Map<String, dynamic>>()
        .map((m) => TitleItem.fromLocalMediaCard(m, TitleKind.movie))
        .toList();
    final series = (data['recentlyCompletedSeries'] as List? ?? [])
        .cast<Map<String, dynamic>>()
        .map((m) => TitleItem.fromLocalMediaCard(m, TitleKind.show))
        .toList();
    int asInt(dynamic v) => (v as num?)?.toInt() ?? 0;
    return (
      movies: movies,
      series: series,
      totalWatchTimeMinutes: asInt(data['totalWatchTimeMinutes']),
      totalEpisodesWatched: asInt(data['totalEpisodesWatched']),
      totalMoviesWatched: asInt(data['totalMoviesWatched']),
    );
  }

  /// `GET /api/home/watching-currently` — shows in progress, with next
  /// episode + completion fraction already computed server-side.
  static Future<List<Map<String, dynamic>>> fetchWatchingCurrently() =>
      _getList('home/watching-currently');

  /// `GET /api/history` — recent watch sessions (real per-session
  /// timestamps), used to bucket a real daily chart client-side since the
  /// stats bundle only gives week/month totals, not a day-by-day series.
  static Future<List<Map<String, dynamic>>> fetchHistory({int limit = 300}) =>
      _getList('history', params: {'limit': '$limit', 'lite': 'true'});

  /// `GET /api/ratings/{tmdbId}` — TMDB/IMDb/Rotten Tomatoes aggregated
  /// rating snapshot, same source the desktop app displays.
  static Future<Map<String, dynamic>?> fetchRatings(
    int tmdbId,
    String mediaType,
  ) async {
    try {
      return await _getMap('ratings/$tmdbId', params: {'mediaType': mediaType});
    } catch (_) {
      return null;
    }
  }

  /// `GET /api/people/{tmdbId}` — actor bio + local filmography matches,
  /// same data the desktop app's actor page shows.
  static Future<Map<String, dynamic>?> fetchPerson(int tmdbId) async {
    try {
      return await _getMap('people/$tmdbId');
    } catch (_) {
      return null;
    }
  }

  /// `GET /api/images/{tmdbId}/posters` — candidate posters from TMDB for a
  /// title, used by the poster-change picker. [mediaType] is "Movie"|"Series".
  static Future<List<Map<String, dynamic>>> fetchPosterOptions(
    int tmdbId,
    String mediaType,
  ) => _getList('images/$tmdbId/posters', params: {'mediaType': mediaType});

  /// `GET /api/images/{tmdbId}/backdrops` — candidate backdrops from TMDB.
  static Future<List<Map<String, dynamic>>> fetchBackdropOptions(
    int tmdbId,
    String mediaType,
  ) => _getList('images/$tmdbId/backdrops', params: {'mediaType': mediaType});

  /// `POST /api/images/{libraryId}/select` — downloads and persists the
  /// chosen poster as this library title's artwork. [libraryId] is the local
  /// Movie/Show row id (see [TitleItem.libraryId]), not the TMDB id.
  static Future<void> selectPoster(
    int libraryId, {
    required int tmdbId,
    required String mediaType,
    required String posterPath,
  }) => _post('images/$libraryId/select', {
    'tmdbId': tmdbId,
    'mediaType': mediaType,
    'posterPath': posterPath,
  });

  /// `POST /api/images/{libraryId}/select` — same as [selectPoster] for the
  /// backdrop.
  static Future<void> selectBackdrop(
    int libraryId, {
    required int tmdbId,
    required String mediaType,
    required String backdropPath,
  }) => _post('images/$libraryId/select', {
    'tmdbId': tmdbId,
    'mediaType': mediaType,
    'backdropPath': backdropPath,
  });

  /// `GET /api/home/coming-soon` — automatic discovery of upcoming movie
  /// releases, brand-new series, and season 2+ premieres. Unlike
  /// `/api/coming-soon` (a manually-curated pin list, empty unless
  /// something's been pinned via the desktop app), this always has data.
  ///
  /// The backend only caps *season premieres* to a 30-day window — movies
  /// and brand-new series come back with no date limit at all, so this
  /// applies a consistent "next 30 days" filter client-side across
  /// everything, matching what "Coming Soon" should mean.
  static Future<List<ComingSoonItem>> fetchComingSoon() async {
    final data = await _getMap('home/coming-soon');
    final movies = (data['movies'] as List? ?? []).cast<Map<String, dynamic>>();
    final tv = (data['tv'] as List? ?? []).cast<Map<String, dynamic>>();
    final items = [
      ...movies.map(ComingSoonItem.fromJson),
      ...tv.map(ComingSoonItem.fromJson),
    ];

    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final cutoff = today.add(const Duration(days: 30));
    final withinWindow = items.where((item) {
      final date = item.releaseDate;
      if (date == null) return false;
      final day = DateTime(date.year, date.month, date.day);
      return !day.isBefore(today) && !day.isAfter(cutoff);
    }).toList();

    withinWindow.sort((a, b) => a.releaseDate!.compareTo(b.releaseDate!));
    return withinWindow;
  }

  /// `GET /api/series/{libraryId}` — full local series detail; only the
  /// `episodes` (season-grouped, each with its local Episode.Id + WatchStatus)
  /// part is used here, to cross-reference against TMDB-sourced season data
  /// so episode rows can call [setEpisodeWatchStatus].
  static Future<List<Map<String, dynamic>>> fetchLibrarySeriesEpisodeGroups(
    int libraryId,
  ) async {
    final data = await _getMap('series/$libraryId');
    return (data['episodes'] as List? ?? []).cast<Map<String, dynamic>>();
  }

  /// `POST /api/episodes/{episodeId}/watch` — [status] must be one of
  /// "Unwatched"/"Watching"/"Completed". [episodeId] is the local library
  /// Episode.Id (see [fetchLibrarySeriesEpisodeGroups]), not a TMDB id.
  static Future<void> setEpisodeWatchStatus(int episodeId, String status) =>
      _post('episodes/$episodeId/watch', {'watchStatus': status});

  /// `POST /api/lists` — creates a new user list, returns its new id.
  static Future<int> createList(String name) async {
    final result = await _postForMap('lists', {'name': name});
    return (result['id'] as num).toInt();
  }

  /// `POST /api/lists/{listId}/items` — adds a title to a list by tmdbId;
  /// works for any title (doesn't require a local library match).
  static Future<void> addToList(
    int listId, {
    required int tmdbId,
    required String mediaType,
    String? title,
    String? posterRemoteUrl,
  }) => _post('lists/$listId/items', {
    'tmdbId': tmdbId,
    'mediaType': mediaType,
    'title': ?title,
    'posterRemoteUrl': ?posterRemoteUrl,
  });

  /// `DELETE /api/lists/{listId}/items/{tmdbId}?mediaType=`
  static Future<void> removeFromList(
    int listId,
    int tmdbId,
    String mediaType,
  ) => _delete('lists/$listId/items/$tmdbId', params: {'mediaType': mediaType});

  /// `GET /api/lists/{listId}/contains?tmdbId=&mediaType=`
  static Future<bool> isInList(int listId, int tmdbId, String mediaType) async {
    final result = await _getMap(
      'lists/$listId/contains',
      params: {'tmdbId': '$tmdbId', 'mediaType': mediaType},
    );
    return result['inList'] as bool? ?? false;
  }

  static Future<Map<String, dynamic>> _getMap(
    String path, {
    Map<String, String>? params,
  }) async {
    final url = Uri.parse(
      '${AppConfig.localBackendBaseUrl}/api/$path',
    ).replace(queryParameters: params);
    final res = await http.get(url, headers: {'Accept': 'application/json'});
    if (res.statusCode != 200) {
      throw Exception(
        'Backend GET $path failed: ${res.statusCode} ${res.body}',
      );
    }
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  static Future<List<Map<String, dynamic>>> _getList(
    String path, {
    Map<String, String>? params,
  }) async {
    final url = Uri.parse(
      '${AppConfig.localBackendBaseUrl}/api/$path',
    ).replace(queryParameters: params);
    final res = await http.get(url, headers: {'Accept': 'application/json'});
    if (res.statusCode != 200) {
      throw Exception(
        'Backend GET $path failed: ${res.statusCode} ${res.body}',
      );
    }
    final decoded = jsonDecode(res.body);
    return (decoded as List).cast<Map<String, dynamic>>();
  }

  static Future<void> _post(String path, Map<String, dynamic> body) async {
    await _postForMap(path, body);
  }

  static Future<Map<String, dynamic>> _postForMap(
    String path,
    Map<String, dynamic> body,
  ) async {
    final url = Uri.parse('${AppConfig.localBackendBaseUrl}/api/$path');
    final res = await http.post(
      url,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: jsonEncode(body),
    );
    if (res.statusCode != 200) {
      throw Exception(
        'Backend POST $path failed: ${res.statusCode} ${res.body}',
      );
    }
    if (res.body.isEmpty) return const {};
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  static Future<void> _delete(
    String path, {
    Map<String, String>? params,
  }) async {
    final url = Uri.parse(
      '${AppConfig.localBackendBaseUrl}/api/$path',
    ).replace(queryParameters: params);
    final res = await http.delete(url, headers: {'Accept': 'application/json'});
    if (res.statusCode != 200) {
      throw Exception(
        'Backend DELETE $path failed: ${res.statusCode} ${res.body}',
      );
    }
  }
}
