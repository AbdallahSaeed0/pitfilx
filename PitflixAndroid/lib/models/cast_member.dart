import 'actor.dart';

/// A cast entry shown on Title Detail's About tab — either a real TMDB
/// credit ([fromTmdbCredit]) or a wrapper around the app's mock [Actor]
/// data ([fromMockActor]), so the same widget can render both.
class CastMember {
  final String name;
  final String? character;

  /// Crew role for this credit ("Director", "Screenplay", …). Set only for entries built by
  /// [CastMember.fromTmdbCrewCredit]; null for acting credits, where [character] carries the role
  /// instead. Both live on one class so the cast and crew rows can share a single card widget.
  final String? job;

  /// TMDB department ("Directing", "Writing", "Camera", …). Used to order the crew row so the
  /// people users actually look for come first.
  final String? department;

  /// The line shown under the name — the character played, or the job done.
  String? get roleLabel => character?.trim().isNotEmpty == true
      ? character
      : (job?.trim().isNotEmpty == true ? job : null);

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
    this.job,
    this.department,
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

  factory CastMember.fromTmdbCrewCredit(Map<String, dynamic> json) {
    final id = (json['id'] as num?)?.toInt();
    return CastMember(
      name: json['name'] as String? ?? 'Unknown',
      job: json['job'] as String?,
      department: json['department'] as String?,
      profilePath: json['profile_path'] as String?,
      tmdbPersonId: id,
      gradientSeed: (id ?? 0) % 6,
    );
  }

  /// Same person credited for several jobs on one title (writer *and* producer, say) arrives as one
  /// TMDB crew entry per job. Merges them into a single card reading "Writer, Producer" rather than
  /// repeating the same face down the row.
  static List<CastMember> mergeCrewByPerson(List<CastMember> crew) {
    final byPerson = <Object, CastMember>{};
    final order = <Object>[];
    for (final member in crew) {
      // Fall back to the name when there's no id, so unidentified crew still merge sensibly.
      final key = member.tmdbPersonId ?? 'name:${member.name.toLowerCase()}';
      final existing = byPerson[key];
      if (existing == null) {
        byPerson[key] = member;
        order.add(key);
        continue;
      }
      final jobs = <String>{
        if (existing.job != null && existing.job!.isNotEmpty) existing.job!,
        if (member.job != null && member.job!.isNotEmpty) member.job!,
      };
      byPerson[key] = CastMember(
        name: existing.name,
        job: jobs.join(', '),
        department: existing.department ?? member.department,
        profilePath: existing.profilePath ?? member.profilePath,
        tmdbPersonId: existing.tmdbPersonId ?? member.tmdbPersonId,
        gradientSeed: existing.gradientSeed,
      );
    }
    return [for (final key in order) byPerson[key]!];
  }

  factory CastMember.fromMockActor(Actor actor) => CastMember(
    name: actor.name,
    mockActorId: actor.id,
    gradientSeed: actor.gradientSeed.isNotEmpty ? actor.gradientSeed[0] : 0,
  );
}
