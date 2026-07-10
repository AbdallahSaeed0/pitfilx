/// Small "quick glance" stats derived from `/api/stats/watch` — surfaced as
/// badge chips on Profile (Stats page shows the deeper breakdowns from the
/// same response instead).
class ProfileHighlights {
  final int watchStreak;
  final int longestMarathonEpisodes;
  final String? longestMarathonShowTitle;
  final String? favoriteDecade;
  final String? topNetwork;
  final String? mostWatchedGenre;

  const ProfileHighlights({
    required this.watchStreak,
    required this.longestMarathonEpisodes,
    required this.longestMarathonShowTitle,
    required this.favoriteDecade,
    required this.topNetwork,
    required this.mostWatchedGenre,
  });

  factory ProfileHighlights.fromWatchStatsJson(Map<String, dynamic> json) {
    String? topLabel(String key, String labelField) {
      final list = (json[key] as List? ?? []).cast<Map<String, dynamic>>();
      if (list.isEmpty) return null;
      return list.first[labelField] as String?;
    }

    return ProfileHighlights(
      watchStreak: (json['watchStreak'] as num?)?.toInt() ?? 0,
      longestMarathonEpisodes:
          (json['longestMarathonEpisodes'] as num?)?.toInt() ?? 0,
      longestMarathonShowTitle: json['longestMarathonShowTitle'] as String?,
      favoriteDecade: topLabel('decadeTop', 'decade'),
      topNetwork: topLabel('networkCounts', 'network'),
      mostWatchedGenre: json['mostWatchedGenre'] as String?,
    );
  }

  /// From Supabase's `watch_records` rows (see
  /// UserLibraryService.fetchStatsSource). Watch streak and longest marathon
  /// aren't computable from this schema (see StatsScreen's doc comment) —
  /// those stay at their empty defaults, which [isEmpty]'s per-field checks
  /// already handle gracefully. `network` is only ever set on series rows
  /// (and only when synced from the desktop import), so mobile-only
  /// accounts simply won't have a top network yet.
  factory ProfileHighlights.fromUserLibraryBundle(
    List<Map<String, dynamic>> watchRecords,
  ) {
    String? topOf(Map<String, int> counts) {
      if (counts.isEmpty) return null;
      final sorted = counts.entries.toList()
        ..sort((a, b) => b.value.compareTo(a.value));
      return sorted.first.key;
    }

    final decadeCounts = <String, int>{};
    final genreCounts = <String, int>{};
    final networkCounts = <String, int>{};
    for (final r in watchRecords) {
      final year = (r['release_year'] as num?)?.toInt();
      if (year != null && year > 0) {
        final decade = '${(year ~/ 10) * 10}s';
        decadeCounts[decade] = (decadeCounts[decade] ?? 0) + 1;
      }
      for (final g in (r['genres'] as List? ?? const [])) {
        genreCounts[g as String] = (genreCounts[g] ?? 0) + 1;
      }
      final network = r['network'] as String?;
      if (network != null && network.isNotEmpty) {
        networkCounts[network] = (networkCounts[network] ?? 0) + 1;
      }
    }

    return ProfileHighlights(
      watchStreak: 0,
      longestMarathonEpisodes: 0,
      longestMarathonShowTitle: null,
      favoriteDecade: topOf(decadeCounts),
      topNetwork: topOf(networkCounts),
      mostWatchedGenre: topOf(genreCounts),
    );
  }

  bool get isEmpty =>
      watchStreak == 0 &&
      longestMarathonEpisodes == 0 &&
      favoriteDecade == null &&
      topNetwork == null &&
      mostWatchedGenre == null;
}
