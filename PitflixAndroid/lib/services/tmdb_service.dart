import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import '../models/cast_member.dart';
import '../models/episode.dart';
import '../models/season.dart';
import '../models/title_item.dart';
import '../utils/ttl_cache.dart';

/// Direct calls to TMDB's public API — trending lists for Home, and per-title
/// detail lookups used to resolve Supabase list_items/watch_events (which
/// only store a tmdb_id + media_type) into displayable titles.
class TmdbService {
  TmdbService._();

  static const String _base = 'https://api.themoviedb.org/3';
  static const String imageBase = 'https://image.tmdb.org/t/p/w342';
  static const String backdropImageBase = 'https://image.tmdb.org/t/p/w780';
  static const String profileImageBase = 'https://image.tmdb.org/t/p/w185';
  static const String stillImageBase = 'https://image.tmdb.org/t/p/w300';

  static final _trendingCache = {
    TitleKind.movie: TtlCache<List<TitleItem>>(),
    TitleKind.show: TtlCache<List<TitleItem>>(),
  };

  static void clearCache() {
    for (final cache in _trendingCache.values) {
      cache.clear();
    }
  }

  static Future<List<TitleItem>> fetchTrending(
    TitleKind kind, {
    bool forceRefresh = false,
  }) async {
    final cache = _trendingCache[kind]!;
    final cached = cache.get(forceRefresh);
    if (cached != null) return cached;

    final path = kind == TitleKind.movie
        ? 'trending/movie/week'
        : 'trending/tv/week';
    final json = await _get(path);
    final results = (json['results'] as List? ?? [])
        .cast<Map<String, dynamic>>();
    final mapped = results
        .map((r) => TitleItem.fromTmdbSummary(r, kind))
        .toList();
    cache.set(mapped);
    return mapped;
  }

  /// Movies + shows in [movieGenreId]/[tvGenreId] combined, sorted by
  /// popularity — the "category row" content for Discover. [tvGenreId] is
  /// optional since TMDB's TV genre taxonomy doesn't line up 1:1 with movies
  /// (e.g. no standalone "Horror" on the TV side).
  static Future<List<TitleItem>> discoverByGenre({
    required int movieGenreId,
    int? tvGenreId,
  }) async {
    final results = await Future.wait([
      _discoverByGenre('discover/movie', movieGenreId, TitleKind.movie),
      if (tvGenreId != null)
        _discoverByGenre('discover/tv', tvGenreId, TitleKind.show),
    ]);
    return [for (final r in results) ...r];
  }

  static Future<List<TitleItem>> _discoverByGenre(
    String path,
    int genreId,
    TitleKind kind,
  ) async {
    final json = await _get(
      path,
      params: {'with_genres': '$genreId', 'sort_by': 'popularity.desc'},
    );
    final results = (json['results'] as List? ?? [])
        .cast<Map<String, dynamic>>();
    return results.map((r) => TitleItem.fromTmdbSummary(r, kind)).toList();
  }

  /// Resolves a bare (tmdbId, mediaType) pair — as stored in Supabase
  /// list_items/watch_events — into a full title. Returns null on failure so
  /// callers can skip a single bad id without failing the whole list. For
  /// shows, also fetches each season's episode list (capped at 20 seasons)
  /// and cast, in parallel.
  static Future<TitleItem?> fetchDetails(int tmdbId, TitleKind kind) async {
    final path = kind == TitleKind.movie ? 'movie/$tmdbId' : 'tv/$tmdbId';
    try {
      final json = await _get(path);
      var title = TitleItem.fromTmdbDetails(json, kind);

      final cast = fetchCredits(tmdbId, kind);
      if (kind == TitleKind.show) {
        final numberOfSeasons =
            (json['number_of_seasons'] as num?)?.toInt() ?? 0;
        final results = await Future.wait([
          fetchTvSeasons(tmdbId, numberOfSeasons),
          cast,
        ]);
        title = title.copyWith(
          seasons: results[0] as List<Season>,
          cast: results[1] as List<CastMember>,
        );
      } else {
        title = title.copyWith(cast: await cast);
      }
      return title;
    } catch (_) {
      return null;
    }
  }

  /// Fetches episode lists for seasons 1..[numberOfSeasons] (specials/season
  /// 0 skipped), in parallel. A single season failing just drops it rather
  /// than failing the whole show.
  static Future<List<Season>> fetchTvSeasons(
    int tvId,
    int numberOfSeasons,
  ) async {
    final capped = numberOfSeasons.clamp(0, 20);
    final results = await Future.wait(
      List.generate(capped, (i) => i + 1).map((n) => _fetchTvSeason(tvId, n)),
    );
    return results.whereType<Season>().toList();
  }

  static Future<Season?> _fetchTvSeason(int tvId, int seasonNumber) async {
    try {
      final json = await _get('tv/$tvId/season/$seasonNumber');
      final episodesJson = (json['episodes'] as List? ?? [])
          .cast<Map<String, dynamic>>();
      final episodes = episodesJson
          .map(
            (e) => Episode(
              number: (e['episode_number'] as num?)?.toInt() ?? 0,
              title: e['name'] as String? ?? 'Episode',
              durationMinutes: (e['runtime'] as num?)?.toInt() ?? 0,
              watched: false,
              stillPath: e['still_path'] as String?,
            ),
          )
          .toList();
      return Season(
        number: seasonNumber,
        name: json['name'] as String? ?? 'Season $seasonNumber',
        episodes: episodes,
      );
    } catch (_) {
      return null;
    }
  }

  /// Cast for a movie or show, via TMDB's own `/credits` endpoint — works
  /// for any tmdbId regardless of whether it's matched in the local
  /// library (unlike the desktop app's library-only cast data).
  static Future<List<CastMember>> fetchCredits(
    int tmdbId,
    TitleKind kind,
  ) async {
    final path = kind == TitleKind.movie
        ? 'movie/$tmdbId/credits'
        : 'tv/$tmdbId/credits';
    try {
      final json = await _get(path);
      final cast = (json['cast'] as List? ?? []).cast<Map<String, dynamic>>();
      return cast.map(CastMember.fromTmdbCredit).toList();
    } catch (_) {
      return const [];
    }
  }

  /// Text search — used by the Search screen. [kindFilter] narrows to
  /// `/search/movie` or `/search/tv`; null searches both via `/search/multi`
  /// (people results are dropped, since this app has no actor-search UI).
  static Future<List<TitleItem>> search(
    String query, {
    TitleKind? kindFilter,
  }) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) return const [];

    if (kindFilter != null) {
      final path = kindFilter == TitleKind.movie ? 'search/movie' : 'search/tv';
      final json = await _get(path, params: {'query': trimmed});
      final results = (json['results'] as List? ?? [])
          .cast<Map<String, dynamic>>();
      return results
          .map((r) => TitleItem.fromTmdbSummary(r, kindFilter))
          .toList();
    }

    final json = await _get('search/multi', params: {'query': trimmed});
    final results = (json['results'] as List? ?? [])
        .cast<Map<String, dynamic>>();
    return results
        .where((r) => r['media_type'] == 'movie' || r['media_type'] == 'tv')
        .map(
          (r) => TitleItem.fromTmdbSummary(
            r,
            r['media_type'] == 'tv' ? TitleKind.show : TitleKind.movie,
          ),
        )
        .toList();
  }

  static Future<Map<String, dynamic>> _get(
    String path, {
    Map<String, String>? params,
  }) async {
    if (!AppConfig.isTmdbConfigured) {
      throw const TmdbNotConfiguredException();
    }

    final useBearer = AppConfig.tmdbReadAccessToken.isNotEmpty;
    final queryParams = {
      if (!useBearer) 'api_key': AppConfig.tmdbApiKey,
      ...?params,
    };
    final url = Uri.parse('$_base/$path').replace(queryParameters: queryParams);
    final res = await http.get(
      url,
      headers: useBearer
          ? {
              'Authorization': 'Bearer ${AppConfig.tmdbReadAccessToken}',
              'Accept': 'application/json',
            }
          : {'Accept': 'application/json'},
    );

    if (res.statusCode != 200) {
      throw Exception('TMDB GET $path failed: ${res.statusCode} ${res.body}');
    }

    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// [posterPath] is either a TMDB-relative path ("/abc.jpg") or, when the
  /// title came from the local Pitflix.API backend, an already-absolute URL
  /// — passed through [_resolveLocalUrl] in that case.
  static String? posterUrl(String? posterPath) {
    if (posterPath == null || posterPath.isEmpty) return null;
    return posterPath.startsWith('http')
        ? _resolveLocalUrl(posterPath)
        : '$imageBase$posterPath';
  }

  static String? backdropUrl(String? backdropPath) {
    if (backdropPath == null || backdropPath.isEmpty) return null;
    return backdropPath.startsWith('http')
        ? _resolveLocalUrl(backdropPath)
        : '$backdropImageBase$backdropPath';
  }

  static String? profileUrl(String? profilePath) {
    if (profilePath == null || profilePath.isEmpty) return null;
    return profilePath.startsWith('http')
        ? _resolveLocalUrl(profilePath)
        : '$profileImageBase$profilePath';
  }

  static String? stillUrl(String? stillPath) {
    if (stillPath == null || stillPath.isEmpty) return null;
    return stillPath.startsWith('http')
        ? _resolveLocalUrl(stillPath)
        : '$stillImageBase$stillPath';
  }

  /// The backend always bakes `http://localhost:{port}` into URLs for images
  /// it serves from its own file cache (posters/backdrops/stills/cast photos
  /// not sourced straight from TMDB) — correct for the desktop app itself,
  /// but "localhost" from the phone/emulator means the phone, not the PC
  /// running the backend. Rewrite the host/port to match
  /// [AppConfig.localBackendBaseUrl], which the app already successfully
  /// uses for every other API call, keeping the path unchanged.
  static String _resolveLocalUrl(String absoluteUrl) {
    final uri = Uri.tryParse(absoluteUrl);
    if (uri == null) return absoluteUrl;
    if (uri.host != 'localhost' && uri.host != '127.0.0.1') return absoluteUrl;

    final backendUri = Uri.tryParse(AppConfig.localBackendBaseUrl);
    if (backendUri == null) return absoluteUrl;

    return uri
        .replace(
          scheme: backendUri.scheme,
          host: backendUri.host,
          port: backendUri.hasPort ? backendUri.port : uri.port,
        )
        .toString();
  }

  /// Maps the mobile app's own convention ("movie"/"tv") — used for TMDB
  /// calls — from whichever media_type string a Supabase row carries
  /// (desktop writes "Movie"/"Series").
  static TitleKind kindFromMediaType(String mediaType) {
    final m = mediaType.toLowerCase();
    return (m == 'tv' || m == 'series') ? TitleKind.show : TitleKind.movie;
  }
}

class TmdbNotConfiguredException implements Exception {
  const TmdbNotConfiguredException();

  @override
  String toString() =>
      'TMDB API key not configured — set it in lib/config/app_config.dart';
}
