import '../models/title_item.dart';
import 'mdblist_service.dart';

/// Assembles the multi-platform ratings map `RatingsRow` expects
/// (`tmdbRating`, `imdbRating`, `rtCritics`, `rtAudience`, `metacritic`,
/// `letterboxd`) straight from TMDB + MDBList — no desktop backend involved.
/// Replaces the old LocalBackendService.fetchRatings call, which needed the
/// phone on the same Wi-Fi/LAN as a running desktop app.
abstract class RatingsService {
  // Cross-platform scores barely move minute to minute, but the detail
  // screens re-requested them from MDBList on every open (including reopening
  // a title you just backed out of). A short TTL cache makes every open after
  // the first one within the window instant — same idea as
  // TmdbService._detailsCache. Not account-specific, so no need to clear on
  // sign-out; [clearCache] exists only for the Settings "Clear Cache" action.
  static final Map<String, ({Map<String, dynamic> value, DateTime at})> _cache =
      {};
  static const Duration _ttl = Duration(minutes: 30);

  static void clearCache() => _cache.clear();

  static Future<Map<String, dynamic>> fetch(
    int tmdbId,
    TitleKind kind,
    double tmdbRating,
  ) async {
    final cacheKey = '${kind.name}-$tmdbId';
    final cached = _cache[cacheKey];
    if (cached != null && DateTime.now().difference(cached.at) < _ttl) {
      return cached.value;
    }
    final result = <String, dynamic>{
      if (tmdbRating > 0) 'tmdbRating': tmdbRating,
    };
    try {
      // MDBList accepts a bare TMDB id directly (`tm=`) — no need to resolve
      // an IMDb id first via a separate TMDB round trip before this call.
      final mdb = await MdbListService.fetchRatings(tmdbId: tmdbId);
      if (mdb?.imdbScore != null) {
        result['imdbRating'] = mdb!.imdbScore!.toStringAsFixed(1);
      }
      if (mdb?.rtCritics != null) {
        result['rtCritics'] = '${mdb!.rtCritics!.round()}%';
      }
      if (mdb?.rtAudience != null) {
        result['rtAudience'] = '${mdb!.rtAudience!.round()}%';
      }
      if (mdb?.metacritic != null) {
        result['metacritic'] = '${mdb!.metacritic!.round()}';
      }
      if (mdb?.letterboxd != null) {
        result['letterboxd'] = mdb!.letterboxd!.toStringAsFixed(1);
      }
    } catch (_) {
      // Falls back to whatever's already in `result` (TMDB score alone).
    }
    _cache[cacheKey] = (value: result, at: DateTime.now());
    return result;
  }
}
