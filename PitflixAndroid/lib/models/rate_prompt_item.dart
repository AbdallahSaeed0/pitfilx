/// A movie, whole series, or single episode the account just finished (per
/// Supabase watch state — could be from this device or pushed by the desktop
/// app's "Link Mobile Account" sync) that hasn't been rated yet. Backs the
/// "you just watched this — wanna rate it?" notification feed.
class RatePromptItem {
  /// Dedupe/dismiss key: "movie-$tmdbId" / "series-$tmdbId" /
  /// "episode-$showTmdbId-$season-$episodeNumber".
  final String key;
  final RatePromptType type;
  final int tmdbId;
  final String title;
  final String? posterPath;
  final int? season;
  final int? episodeNumber;
  final DateTime watchedAt;

  const RatePromptItem({
    required this.key,
    required this.type,
    required this.tmdbId,
    required this.title,
    this.posterPath,
    this.season,
    this.episodeNumber,
    required this.watchedAt,
  });

  /// e.g. "The Bear" for a movie/series, "The Bear · S2E5" for an episode.
  String get displayLabel => type == RatePromptType.episode
      ? '$title · S${season}E$episodeNumber'
      : title;
}

enum RatePromptType { movie, series, episode }
