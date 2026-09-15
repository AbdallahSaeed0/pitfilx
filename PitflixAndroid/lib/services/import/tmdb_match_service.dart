import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:shared_preferences/shared_preferences.dart';
import '../../models/title_item.dart';
import '../tmdb_service.dart';

/// A resolved (title -> TMDB id) match, as needed to write a `watch_records`/
/// `episode_watch_status`/`user_list_items` row.
class TmdbMatch {
  final int tmdbId;
  final String title;
  final String? posterPath;
  final int? releaseYear;

  const TmdbMatch({
    required this.tmdbId,
    required this.title,
    this.posterPath,
    this.releaseYear,
  });

  Map<String, dynamic> toJson() => {
    'tmdbId': tmdbId,
    'title': title,
    'posterPath': posterPath,
    'releaseYear': releaseYear,
  };

  static TmdbMatch fromJson(Map<String, dynamic> json) => TmdbMatch(
    tmdbId: json['tmdbId'] as int,
    title: json['title'] as String,
    posterPath: json['posterPath'] as String?,
    releaseYear: json['releaseYear'] as int?,
  );
}

/// Best-effort title -> TMDB id resolution for bulk imports (Letterboxd/TV
/// Time desktop exports export titles as plain text, not TMDB ids). Caches
/// every lookup both in-memory (a show in a TV Time export appears once per
/// watched episode — up to hundreds of times — but only needs one TMDB
/// search) AND on-device (SharedPreferences) across app sessions — a retried
/// or re-run import (very likely, given exports can be large and worth
/// double-checking) doesn't need to re-search TMDB for a title it already
/// resolved in a previous run. A "not found" result is intentionally NOT
/// persisted (only the in-memory cache holds those, cleared each run) —
/// don't want a transient miss or a title TMDB genuinely lacks today to
/// permanently block a re-check after, say, TMDB adds it later.
abstract class TmdbMatchService {
  static final Map<String, TmdbMatch?> _cache = {};
  static Map<String, TmdbMatch>? _persisted;
  static const _prefsKey = 'tmdb_match_cache_v1';

  static Future<Map<String, TmdbMatch>> _loadPersisted() async {
    final existing = _persisted;
    if (existing != null) return existing;
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_prefsKey);
    if (raw == null) return _persisted = {};
    try {
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      return _persisted = decoded.map(
        (k, v) => MapEntry(k, TmdbMatch.fromJson(v as Map<String, dynamic>)),
      );
    } catch (_) {
      return _persisted = {};
    }
  }

  static Future<void> _savePersisted() async {
    final persisted = _persisted;
    if (persisted == null) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _prefsKey,
      jsonEncode(persisted.map((k, v) => MapEntry(k, v.toJson()))),
    );
  }

  static Future<TmdbMatch?> matchMovie(String title, int? year) =>
      _match(title, year, TitleKind.movie);

  static Future<TmdbMatch?> matchShow(String title, int? year) =>
      _match(title, year, TitleKind.show);

  static Future<TmdbMatch?> _match(
    String title,
    int? year,
    TitleKind kind,
  ) async {
    final key = '${kind.name}|${title.toLowerCase()}|${year ?? ''}';
    if (_cache.containsKey(key)) return _cache[key];

    final persisted = await _loadPersisted();
    final persistedHit = persisted[key];
    if (persistedHit != null) {
      _cache[key] = persistedHit;
      return persistedHit;
    }

    // A bulk import fires many concurrent TMDB searches (one per distinct
    // show/movie — hundreds, for a real TV Time export), enough load that a
    // transient rate-limit (429) or server hiccup (5xx) is a real, observed
    // failure mode, not a rare edge case. Previously any error here
    // (including a rate-limit blip) was caught and treated identically to
    // "TMDB genuinely has no such title", AND cached that way forever —
    // which is why real, well-known shows were showing up as "not found" in
    // bulk. Now: retry transient failures with backoff; on a genuine
    // failure (persistent, or a non-TMDB error like no network), give up
    // for THIS call and report unmatched same as before — but don't cache
    // it, so a later occurrence of the same title elsewhere in this import
    // (duplicate names aren't rare in a large export) isn't permanently
    // poisoned by what might have been a one-off blip. Only a search that
    // actually completed (found something, or genuinely found nothing) gets
    // cached.
    const maxAttempts = 4;
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        var results = await TmdbService.search(title, kindFilter: kind);
        if (results.isEmpty) {
          // A type-scoped search (search/movie or search/tv) can come up
          // empty for a title TMDB has simply filed under the other type
          // (a miniseries TMDB treats as a TV movie, a documentary special,
          // etc.) — search/multi covers both, so this catches those instead
          // of reporting a false "not found".
          results = (await TmdbService.search(title))
              .where((r) => r.kind == kind)
              .toList();
        }
        final result = _pickBest(results, title, year);
        _cache[key] = result;
        // Only added to the in-memory `persisted` map here — NOT written to
        // SharedPreferences per-title (that would mean re-serializing and
        // writing the whole growing cache hundreds of times over one
        // import, which would slow things down more than it saves). Callers
        // flush once via [flushPersistedCache] after their matching loop
        // finishes.
        if (result != null) persisted[key] = result;
        return result;
      } catch (e) {
        final transient = e is TmdbHttpException ? e.isTransient : true;
        if (!transient || attempt == maxAttempts) return null;
        await Future<void>.delayed(
          Duration(milliseconds: 400 * pow(2, attempt - 1).toInt()),
        );
      }
    }
    return null; // Unreachable — the loop always returns.
  }

  /// Writes the in-memory persisted-cache additions from this run to disk in
  /// one go — call once after a bulk import's matching loop finishes (not
  /// per-title, see [_match]'s doc comment on why).
  static Future<void> flushPersistedCache() => _savePersisted();

  /// Prefers an exact-year match, falls back to +/-1 year, then to the
  /// plain-search top result; within whichever pool survives, prefers an
  /// exact (normalized) title match over TMDB's relevance ordering.
  static TmdbMatch? _pickBest(
    List<TitleItem> results,
    String title,
    int? year,
  ) {
    if (results.isEmpty) return null;
    var pool = results;
    if (year != null) {
      final exact = results.where((r) => r.year == year).toList();
      if (exact.isNotEmpty) {
        pool = exact;
      } else {
        final near = results
            .where((r) => r.year != 0 && (r.year - year).abs() <= 1)
            .toList();
        if (near.isNotEmpty) pool = near;
      }
    }
    final normalizedTarget = _normalize(title);
    pool = [...pool]..sort((a, b) {
      final aExact = _normalize(a.name) == normalizedTarget ? 0 : 1;
      final bExact = _normalize(b.name) == normalizedTarget ? 0 : 1;
      return aExact.compareTo(bExact);
    });
    final best = pool.first;
    if (best.tmdbId == null) return null;
    return TmdbMatch(
      tmdbId: best.tmdbId!,
      title: best.name,
      posterPath: best.posterPath,
      releaseYear: best.year == 0 ? null : best.year,
    );
  }

  static String _normalize(String s) =>
      s.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');

  static void clearCache() => _cache.clear();
}
