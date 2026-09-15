/// Summary of a completed Letterboxd/TV Time import — shown on the Import
/// screen once processing finishes. Shared shape between both importers;
/// each just leaves the fields it doesn't produce at their zero default.
class ImportResult {
  final int matched;
  final int ratingsApplied;
  final int episodesImported;
  final int watchlistAdded;
  final List<String> unmatchedTitles;

  const ImportResult({
    required this.matched,
    this.ratingsApplied = 0,
    this.episodesImported = 0,
    this.watchlistAdded = 0,
    required this.unmatchedTitles,
  });

  int get unmatched => unmatchedTitles.length;
}
