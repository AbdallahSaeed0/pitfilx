import 'dart:convert';
import 'http_client.dart';
import '../config/app_config.dart';

class MdbListRatings {
  final double? imdbScore;
  final double? rtCritics;
  final double? rtAudience;
  final double? metacritic;

  /// Letterboxd's own 0-5 star scale — MDBList reports this source natively
  /// on that scale rather than normalizing it to 0-100 like the others.
  final double? letterboxd;

  const MdbListRatings({
    this.imdbScore,
    this.rtCritics,
    this.rtAudience,
    this.metacritic,
    this.letterboxd,
  });
}

/// Direct calls to MDBList (https://mdblist.com/api/) for IMDb/Rotten Tomatoes
/// scores — mirrors Pitflix.API's server-side MdbListService, but called
/// straight from the phone instead of routed through the desktop backend, so
/// ratings work over a plain internet connection without the phone needing
/// to be on the same Wi-Fi/LAN as (or even having) the desktop app running.
/// Requires [AppConfig.mdbListApiKey] (free tier: 1000 requests/day).
abstract class MdbListService {
  static const _base = 'https://mdblist.com/api/';

  static Future<MdbListRatings?> fetchRatings({
    String? imdbId,
    int? tmdbId,
  }) async {
    if (!AppConfig.isMdbListConfigured) return null;
    if ((imdbId == null || imdbId.isEmpty) && tmdbId == null) return null;

    final params = <String, String>{'apikey': AppConfig.effectiveMdbListApiKey};
    if (imdbId != null && imdbId.isNotEmpty) {
      params['i'] = imdbId;
    } else {
      params['tm'] = '$tmdbId';
    }

    try {
      final uri = Uri.parse(_base).replace(queryParameters: params);
      final res = await PitflixHttp.client.get(uri).timeout(const Duration(seconds: 10));
      if (res.statusCode != 200) return null;

      final json = jsonDecode(res.body) as Map<String, dynamic>;
      final ratings = (json['ratings'] as List? ?? [])
          .cast<Map<String, dynamic>>();

      double? imdb, rtCritics, rtAudience, metacritic, letterboxd;
      for (final item in ratings) {
        final source = item['source'] as String?;
        final raw = item['value'];
        final value = raw is num ? raw.toDouble() : double.tryParse('$raw');
        if (value == null) continue;
        switch (source) {
          case 'imdb':
            imdb = value;
          case 'tomatoes':
            rtCritics = value;
          case 'tomatoesaudience':
            rtAudience = value;
          case 'metacritic':
            metacritic = value;
          case 'letterboxd':
            letterboxd = value;
        }
      }

      if (imdb == null &&
          rtCritics == null &&
          rtAudience == null &&
          metacritic == null &&
          letterboxd == null) {
        return null;
      }
      return MdbListRatings(
        imdbScore: imdb,
        rtCritics: rtCritics,
        rtAudience: rtAudience,
        metacritic: metacritic,
        letterboxd: letterboxd,
      );
    } catch (_) {
      return null;
    }
  }
}
