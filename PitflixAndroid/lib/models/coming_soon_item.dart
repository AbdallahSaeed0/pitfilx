/// An upcoming movie or TV season from the local backend's
/// `GET /api/home/coming-soon` — automatic discovery (upcoming TMDB movie
/// releases, brand-new series, and season 2+ premieres within ~30 days), not
/// something the user has to manually curate.
class ComingSoonItem {
  final int tmdbId;
  final String mediaType; // "movie" | "tv"
  final String title;
  final String? posterUrl;
  final DateTime? releaseDate;
  final String? overview;
  final double? voteAverage;

  /// Set only for TV entries that are an upcoming season premiere (2+) of a
  /// show already airing, e.g. 2 for "Season 2" — null for brand-new series
  /// and movies.
  final int? seasonNumber;

  const ComingSoonItem({
    required this.tmdbId,
    required this.mediaType,
    required this.title,
    this.posterUrl,
    this.releaseDate,
    this.overview,
    this.voteAverage,
    this.seasonNumber,
  });

  factory ComingSoonItem.fromJson(Map<String, dynamic> json) => ComingSoonItem(
    tmdbId: (json['tmdbId'] as num?)?.toInt() ?? 0,
    mediaType: json['mediaType'] as String? ?? 'movie',
    title: json['title'] as String? ?? 'Untitled',
    posterUrl: json['posterUrl'] as String?,
    releaseDate: json['releaseDate'] == null
        ? null
        : DateTime.tryParse(json['releaseDate'] as String),
    overview: json['overview'] as String?,
    voteAverage: (json['voteAverage'] as num?)?.toDouble(),
    seasonNumber: (json['seasonNumber'] as num?)?.toInt(),
  );

  bool get isShow => mediaType == 'tv';

  String? get seasonLabel =>
      seasonNumber == null ? null : 'Season $seasonNumber';

  /// Countdown label, e.g. "In 12 days", "Tomorrow", "Today", "Released".
  String get countdownLabel {
    final date = releaseDate;
    if (date == null) return 'TBA';
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final target = DateTime(date.year, date.month, date.day);
    final days = target.difference(today).inDays;
    if (days < 0) return 'Released';
    if (days == 0) return 'Today';
    if (days == 1) return 'Tomorrow';
    return 'In $days days';
  }
}
