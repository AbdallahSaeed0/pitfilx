import 'actor.dart';

/// A cast entry shown on Title Detail's About tab — either a real TMDB
/// credit ([fromTmdbCredit]) or a wrapper around the app's mock [Actor]
/// data ([fromMockActor]), so the same widget can render both.
class CastMember {
  final String name;
  final String? character;

  /// Relative TMDB path (e.g. "/abc.jpg"); resolve via
  /// `TmdbService.profileUrl`. Null for mock actors (no photo — shows the
  /// initials placeholder instead).
  final String? profilePath;

  /// TMDB person id — set only for real credits; used to open a
  /// backend-backed Actor page. Null for mock actors.
  final int? tmdbPersonId;

  /// Set only for [fromMockActor] — round-trips back to `MockData.actorById`
  /// so tapping a mock cast member still opens the existing mock Actor page.
  final String? mockActorId;

  final int gradientSeed;

  const CastMember({
    required this.name,
    this.character,
    this.profilePath,
    this.tmdbPersonId,
    this.mockActorId,
    this.gradientSeed = 0,
  });

  String get initials {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
  }

  factory CastMember.fromTmdbCredit(Map<String, dynamic> json) {
    final id = (json['id'] as num?)?.toInt();
    return CastMember(
      name: json['name'] as String? ?? 'Unknown',
      character: json['character'] as String?,
      profilePath: json['profile_path'] as String?,
      tmdbPersonId: id,
      gradientSeed: (id ?? 0) % 6,
    );
  }

  factory CastMember.fromMockActor(Actor actor) => CastMember(
    name: actor.name,
    mockActorId: actor.id,
    gradientSeed: actor.gradientSeed.isNotEmpty ? actor.gradientSeed[0] : 0,
  );
}
