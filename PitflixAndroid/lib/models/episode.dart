import 'cast_member.dart';

class Episode {
  final int number;
  final String title;
  final int durationMinutes;
  final bool watched;

  /// Local Pitflix.API library episode id — set only once this episode has
  /// been cross-referenced against `GET /api/series/{libraryId}` (see
  /// LocalBackendService.fetchLibrarySeriesEpisodes). Required to call the
  /// real `POST /api/episodes/{id}/watch` endpoint; null for TMDB-only
  /// episodes (title not yet matched in the local library).
  final int? libraryId;

  /// Raw backend watch status ("Unwatched"/"Watching"/"Completed"), kept
  /// alongside [watched] so we can round-trip it back to the API unchanged.
  final String? watchStatus;

  /// User's per-episode rating (1-5 or 1-10, see AppSettings.ratingScaleMax),
  /// rewatch count, reaction, and favorite cast member — there's no backend
  /// support for any of these (see LocalBackendService docs), so they're all
  /// session-only UI state, reset on next app launch.
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
    this.libraryId,
    this.watchStatus,
    this.rating,
    this.rewatchCount = 0,
    this.reaction,
    this.favoritePerson,
    this.stillPath,
  });

  Episode copyWith({
    bool? watched,
    int? libraryId,
    String? watchStatus,
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
    libraryId: libraryId ?? this.libraryId,
    watchStatus: watchStatus ?? this.watchStatus,
    rating: rating ?? this.rating,
    rewatchCount: rewatchCount ?? this.rewatchCount,
    reaction: reaction ?? this.reaction,
    favoritePerson: favoritePerson ?? this.favoritePerson,
    stillPath: stillPath ?? this.stillPath,
  );
}
