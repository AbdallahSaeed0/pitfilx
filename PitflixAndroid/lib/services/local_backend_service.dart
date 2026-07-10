import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import '../models/coming_soon_item.dart';

/// Talks to your own Pitflix.API instance for shared, non-account-specific
/// data — ratings aggregation, actor bios, the release calendar, and the
/// poster/backdrop picker. Personal library data (lists, watched status,
/// ratings, Stats) moved to Supabase — see [UserLibraryService].
class LocalBackendService {
  LocalBackendService._();

  /// `GET /api/stats` — the cheapest existing endpoint, used purely as a
  /// reachability check for Settings' "Sync with Desktop" status. Returns
  /// false (never throws) on any failure — timeout, connection refused, or
  /// a non-200 response all just mean "not connected".
  static Future<bool> ping() async {
    try {
      final url = Uri.parse('${AppConfig.localBackendBaseUrl}/api/stats');
      final res = await http
          .get(url, headers: {'Accept': 'application/json'})
          .timeout(const Duration(seconds: 4));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

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
  }
}
