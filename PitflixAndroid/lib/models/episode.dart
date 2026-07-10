import 'cast_member.dart';

class Episode {
  final int number;
  final String title;
  final int durationMinutes;

  /// Watched status for the signed-in account (see
  /// UserLibraryService.fetchEpisodeWatchStatuses/setEpisodeWatched — keyed
  /// by TMDB show id + season/episode number, not a local library row).
  final bool watched;

  /// User's per-episode rating (1-5 or 1-10, see AppSettings.ratingScaleMax),
  /// rewatch count, reaction, and favorite cast member — there's no backend
  /// support for any of these yet, so they're session-only UI state, reset
  /// on next app launch.
  final int? rating;
  final int rewatchCount;
  final String? reaction;
  final CastMember? favoritePerson;

  /// TMDB-relative still path ("/abc.jpg") or an already-absolute local
  /// backend URL — resolve via TmdbService.stillUrl(). Null if no image is
  /// available from either source.
  final String? stillPath;

  const Episode({
    required this.number,
    required this.title,
    required this.durationMinutes,
    required this.watched,
    this.rating,
    this.rewatchCount = 0,
    this.reaction,
    this.favoritePerson,
    this.stillPath,
  });

  Episode copyWith({
    bool? watched,
    int? rating,
    int? rewatchCount,
    String? reaction,
    CastMember? favoritePerson,
    String? stillPath,
  }) => Episode(
    number: number,
    title: title,
    durationMinutes: durationMinutes,
    watched: watched ?? this.watched,
    rating: rating ?? this.rating,
    rewatchCount: rewatchCount ?? this.rewatchCount,
    reaction: reaction ?? this.reaction,
    favoritePerson: favoritePerson ?? this.favoritePerson,
    stillPath: stillPath ?? this.stillPath,
  );
}
