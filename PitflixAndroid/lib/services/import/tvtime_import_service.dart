import 'dart:typed_data';

import '../tmdb_service.dart';
import '../user_library_service.dart';
import 'import_csv_utils.dart';
import 'import_result.dart';
import 'import_retry.dart';
import 'tmdb_match_service.dart';

class _WatchedEpisode {
  final int season;
  final int episode;
  final String watchedAt;
  const _WatchedEpisode(this.season, this.episode, this.watchedAt);
}

/// TV Time appends a disambiguating "(YYYY)" straight onto the show name for
/// titles that collide with another show — e.g. "Kingdom (2019)" for the
/// Korean series, distinct from the 2014 "Kingdom". Left in the search query
/// as literal text, that parenthetical actively hurts TMDB's relevance
/// ranking instead of helping; stripped out and passed as a year hint to
/// [TmdbMatchService]'s existing (year-aware) matching instead, it does what
/// it was clearly meant to do. Returns the cleaned name unchanged (with a
/// null year) when there's no such suffix.
final _yearSuffix = RegExp(r'^(.*?)\s*\((\d{4})\)$');

({String name, int? year}) _splitYearSuffix(String rawName) {
  final match = _yearSuffix.firstMatch(rawName.trim());
  if (match == null) return (name: rawName, year: null);
  final cleaned = match.group(1)!.trim();
  final year = int.tryParse(match.group(2)!);
  return cleaned.isEmpty ? (name: rawName, year: null) : (name: cleaned, year: year);
}

/// Imports a TV Time GDPR data export zip (Settings > Export My Data in the
/// TV Time app) — `watched_on_episode.csv` becomes per-episode watch history
/// (grouped by show, matched to TMDB once per show), and any show in
/// `followed_tv_show.csv` still marked active with no watched episodes
/// becomes a Watch Later entry. TV Time's export has no per-title star
/// rating (its "ratings"/"emotions" files are thumbs-style vote records, not
/// a 1-5/1-10 scale), so nothing here touches `rating`.
abstract class TvTimeImportService {
  static Future<ImportResult> importFromZip(
    Uint8List zipBytes, {
    void Function(int done, int total)? onProgress,
  }) async {
    final watchedRows = readCsvFromZip(zipBytes, 'watched_on_episode.csv');
    final followedRows = readCsvFromZip(zipBytes, 'followed_tv_show.csv');
    if (watchedRows.isEmpty && followedRows.isEmpty) {
      // Neither expected file was found at all — almost certainly means TV
      // Time's export changed its file names/layout since this was written,
      // not that the account genuinely has zero watch history. Surface what
      // the zip actually contains instead of quietly returning an all-zero
      // result that looks like a successful-but-empty import.
      final actual = listZipFileNames(zipBytes);
      throw Exception(
        'Expected "watched_on_episode.csv" or "followed_tv_show.csv" in '
        'this export but found neither. Files in this zip: '
        '${actual.isEmpty ? '(none — is this a valid zip?)' : actual.join(', ')}',
      );
    }

    final showYears = <String, int?>{};

    final showEpisodes = <String, List<_WatchedEpisode>>{};
    for (final r in watchedRows.skip(1)) {
      if (r.length < 7) continue;
      final rawName = r[4].toString();
      if (rawName.isEmpty) continue;
      final season = int.tryParse(r[5].toString());
      final episode = int.tryParse(r[6].toString());
      if (season == null || episode == null) continue;
      final (:name, :year) = _splitYearSuffix(rawName);
      showYears[name] = year;
      showEpisodes
          .putIfAbsent(name, () => [])
          .add(_WatchedEpisode(season, episode, r[2].toString()));
    }

    final followedNames = <String>{};
    for (final r in followedRows.skip(1)) {
      if (r.length < 9) continue;
      if (r[8].toString() == '1') {
        final (:name, :year) = _splitYearSuffix(r[6].toString());
        showYears[name] = year;
        followedNames.add(name);
      }
    }

    if (showEpisodes.isEmpty && followedNames.isEmpty) {
      // The expected files were found (the check above already ruled out
      // "missing entirely"), but produced zero usable rows — almost
      // certainly means the column layout at the hardcoded indices (r[4]/
      // r[5]/r[6]/r[2] for watched_on_episode.csv, r[6]/r[8] for
      // followed_tv_show.csv) doesn't match this export. Surface the actual
      // header + a sample row from whichever file is non-empty so the real
      // column order can be read off directly instead of guessed at.
      String describe(String label, List<List<dynamic>> rows) {
        if (rows.isEmpty) return '$label: not found in this zip';
        final header = rows.first.join(' | ');
        final sample = rows.length > 1 ? rows[1].join(' | ') : '(no data rows)';
        return '$label (${rows.length} rows)\n  header: $header\n  row 1:  $sample';
      }

      throw Exception(
        'Found the export files but none of their rows parsed — the column '
        'layout doesn\'t match what this importer expects.\n\n'
        '${describe('watched_on_episode.csv', watchedRows)}\n\n'
        '${describe('followed_tv_show.csv', followedRows)}',
      );
    }

    final showNames = {...showEpisodes.keys, ...followedNames}.toList();
    final total = showNames.length;
    var done = 0;
    final unmatched = <String>[];
    var showsMatched = 0;
    var episodesImported = 0;
    var watchlistAdded = 0;

    final results = await Future.wait<dynamic>([
      UserLibraryService.watchlistListId(),
      UserLibraryService.fetchImportBaseline(),
    ]);
    final listId = results[0] as String;
    final baseline =
        results[1]
            as ({
              Map<int, String> movieStatusByTmdbId,
              Map<int, String> seriesStatusByTmdbId,
              Map<int, Set<String>> watchedEpisodesByShowId,
            });

    // Lower than it used to be (was 4) — combined with TmdbService's shared
    // rate-limit cooldown, this reduces how hard the very first burst of
    // requests hits TMDB before that cooldown even has a chance to kick in.
    const concurrency = 2;
    for (var i = 0; i < showNames.length; i += concurrency) {
      final batch = showNames.skip(i).take(concurrency);
      await Future.wait(
        batch.map((name) async {
          final match = await TmdbMatchService.matchShow(name, showYears[name]);
          done++;
          onProgress?.call(done, total);
          if (match == null) {
            unmatched.add(name);
            return;
          }

          try {
            final episodes = showEpisodes[name];
            if (episodes != null && episodes.isNotEmpty) {
              // Skip episodes this account already has recorded — from a
              // previous import run, normal app use, or the desktop sync
              // push — instead of blindly re-upserting all of them again.
              final alreadyWatched =
                  baseline.watchedEpisodesByShowId[match.tmdbId] ?? const {};
              final newEpisodes = episodes
                  .where((e) => !alreadyWatched.contains('${e.season}-${e.episode}'))
                  .toList();

              if (newEpisodes.isNotEmpty) {
                await retryTransientSupabaseError(
                  () => UserLibraryService.bulkSetEpisodesWatched(
                    match.tmdbId,
                    newEpisodes
                        .map(
                          (e) => {
                            'season_number': e.season,
                            'episode_number': e.episode,
                            'watched_at':
                                DateTime.tryParse(e.watchedAt)?.toIso8601String(),
                          },
                        )
                        .toList(),
                  ),
                );
              }

              final totalEpisodes = await TmdbService.fetchEpisodeCount(
                match.tmdbId,
              );
              final expectedStatus =
                  (totalEpisodes != null && episodes.length >= totalEpisodes)
                  ? 'completed'
                  : 'watching';
              // Same idea for the show's overall status — skip the write if
              // it's already exactly what this import would set it to.
              if (newEpisodes.isNotEmpty ||
                  baseline.seriesStatusByTmdbId[match.tmdbId] != expectedStatus) {
                await retryTransientSupabaseError(
                  () => UserLibraryService.logWatched(
                    tmdbId: match.tmdbId,
                    mediaType: 'series',
                    title: match.title,
                    posterPath: match.posterPath,
                    releaseYear: match.releaseYear,
                    status: expectedStatus,
                  ),
                );
              }
              showsMatched++;
              episodesImported += newEpisodes.length;
            } else if (followedNames.contains(name)) {
              final already = await retryTransientSupabaseError(
                () => UserLibraryService.isInList(
                  listId,
                  match.tmdbId,
                  'series',
                ),
              );
              if (!already) {
                await retryTransientSupabaseError(
                  () => UserLibraryService.addToList(
                    listId,
                    tmdbId: match.tmdbId,
                    mediaType: 'series',
                    title: match.title,
                    posterPath: match.posterPath,
                  ),
                );
                watchlistAdded++;
              }
            }
          } catch (_) {
            // A persistent (non-transient, or retries-exhausted) failure for
            // this one show shouldn't sink the whole import — surfaced as
            // "unmatched" so the run still completes and returns a partial
            // result instead of throwing away every show already written in
            // earlier batches.
            unmatched.add(name);
          }
        }),
      );
    }

    await TmdbMatchService.flushPersistedCache();
    return ImportResult(
      matched: showsMatched,
      episodesImported: episodesImported,
      watchlistAdded: watchlistAdded,
      unmatchedTitles: unmatched,
    );
  }
}
