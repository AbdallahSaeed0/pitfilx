import 'dart:typed_data';

import '../user_library_service.dart';
import 'import_csv_utils.dart';
import 'import_result.dart';
import 'import_retry.dart';
import 'tmdb_match_service.dart';

/// Imports a Letterboxd data export zip (Settings > Account > Export Data on
/// letterboxd.com) — `watched.csv` becomes completed movies, `ratings.csv`
/// (0.5-5, half-star steps) is merged in and rounded to Pitflix's 1-5 scale,
/// and `watchlist.csv` becomes Watch Later entries. `diary.csv`/`reviews.csv`
/// (rewatch logs, review text) aren't imported — Pitflix has no per-viewing
/// log or review field to put them in, just one row per title.
abstract class LetterboxdImportService {
  static Future<ImportResult> importFromZip(
    Uint8List zipBytes, {
    void Function(int done, int total)? onProgress,
  }) async {
    final watchedRows = readCsvFromZip(zipBytes, 'watched.csv');
    final ratingRows = readCsvFromZip(zipBytes, 'ratings.csv');
    final watchlistRows = readCsvFromZip(zipBytes, 'watchlist.csv');

    // ratings.csv: Date,Name,Year,Letterboxd URI,Rating
    final ratingByKey = <String, double>{};
    for (final r in ratingRows.skip(1)) {
      if (r.length < 5) continue;
      final rating = double.tryParse(r[4].toString());
      if (rating == null) continue;
      ratingByKey[_key(r[1].toString(), r[2].toString())] = rating;
    }

    // watched.csv: Date,Name,Year,Letterboxd URI
    final watchedEntries = watchedRows
        .skip(1)
        .where((r) => r.length >= 3 && r[1].toString().isNotEmpty)
        .toList();
    // watchlist.csv: Date,Name,Year,Letterboxd URI
    final watchlistEntries = watchlistRows
        .skip(1)
        .where((r) => r.length >= 3 && r[1].toString().isNotEmpty)
        .toList();

    final total = watchedEntries.length + watchlistEntries.length;
    var done = 0;
    final unmatched = <String>[];
    var matchedCount = 0;
    var ratingsApplied = 0;
    var watchlistAdded = 0;
    final bulkRows = <Map<String, dynamic>>[];

    final baseline = await UserLibraryService.fetchImportBaseline();

    // Lower than it used to be (was 6) — combined with TmdbService's shared
    // rate-limit cooldown, this reduces how hard the very first burst of
    // requests hits TMDB before that cooldown even has a chance to kick in.
    const concurrency = 3;
    for (var i = 0; i < watchedEntries.length; i += concurrency) {
      final batch = watchedEntries.skip(i).take(concurrency);
      await Future.wait(
        batch.map((r) async {
          final date = r[0].toString();
          final name = r[1].toString();
          final yearStr = r[2].toString();
          final year = int.tryParse(yearStr);
          final match = await TmdbMatchService.matchMovie(name, year);
          done++;
          onProgress?.call(done, total);
          if (match == null) {
            unmatched.add(year != null ? '$name ($year)' : name);
            return;
          }
          matchedCount++;
          final ratingRaw = ratingByKey[_key(name, yearStr)];
          int? scaledRating;
          if (ratingRaw != null) {
            scaledRating = ratingRaw.round().clamp(1, 5);
            ratingsApplied++;
          }
          // Skip re-writing a movie this account already has recorded as
          // completed, UNLESS this row carries a rating — a rating always
          // gets written since there's no baseline rating to compare
          // against here to tell whether it actually changed.
          if (scaledRating == null &&
              baseline.movieStatusByTmdbId[match.tmdbId] == 'completed') {
            return;
          }
          bulkRows.add({
            'tmdb_id': match.tmdbId,
            'media_type': 'movie',
            'title': match.title,
            'poster_path': match.posterPath,
            'release_year': match.releaseYear,
            'status': 'completed',
            'rating': scaledRating,
            'updated_at':
                DateTime.tryParse(date)?.toIso8601String() ??
                DateTime.now().toIso8601String(),
          });
        }),
      );
    }

    if (bulkRows.isNotEmpty) {
      await retryTransientSupabaseError(
        () => UserLibraryService.bulkLogWatched(bulkRows),
      );
    }

    if (watchlistEntries.isNotEmpty) {
      final listId = await UserLibraryService.watchlistListId();
      for (var i = 0; i < watchlistEntries.length; i += concurrency) {
        final batch = watchlistEntries.skip(i).take(concurrency);
        await Future.wait(
          batch.map((r) async {
            final name = r[1].toString();
            final year = int.tryParse(r[2].toString());
            final match = await TmdbMatchService.matchMovie(name, year);
            done++;
            onProgress?.call(done, total);
            if (match == null) return;
            try {
              final already = await retryTransientSupabaseError(
                () => UserLibraryService.isInList(
                  listId,
                  match.tmdbId,
                  'movie',
                ),
              );
              if (already) return;
              await retryTransientSupabaseError(
                () => UserLibraryService.addToList(
                  listId,
                  tmdbId: match.tmdbId,
                  mediaType: 'movie',
                  title: match.title,
                  posterPath: match.posterPath,
                ),
              );
              watchlistAdded++;
            } catch (_) {
              // A persistent (non-transient) failure for this one title
              // shouldn't sink the rest of the watchlist import.
            }
          }),
        );
      }
    }

    await TmdbMatchService.flushPersistedCache();
    return ImportResult(
      matched: matchedCount,
      ratingsApplied: ratingsApplied,
      watchlistAdded: watchlistAdded,
      unmatchedTitles: unmatched,
    );
  }

  static String _key(String name, String year) =>
      '${name.trim().toLowerCase()}|${year.trim()}';
}
