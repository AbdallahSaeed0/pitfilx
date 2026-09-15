import 'person_credit.dart';

/// A TMDB person — actor, director, writer — plus their full filmography.
///
/// Cast and crew members are the same kind of thing to TMDB (`/person/{id}`), which is why the
/// person page serves both: tapping a director in a crew row lands on the same screen as tapping an
/// actor, just with the crew filmography leading.
class PersonProfile {
  final int tmdbId;
  final String name;
  final String? biography;
  final String? birthday;
  final String? placeOfBirth;
  final String? profilePath;

  /// TMDB's own guess at what this person is mainly known for ("Acting", "Directing", …). Decides
  /// which filmography a page leads with.
  final String? knownForDepartment;

  /// Titles they appeared in, newest first, each carrying the character played.
  final List<PersonCredit> actingCredits;

  /// Titles they worked on, newest first, each carrying the job done.
  final List<PersonCredit> crewCredits;

  const PersonProfile({
    required this.tmdbId,
    required this.name,
    this.biography,
    this.birthday,
    this.placeOfBirth,
    this.profilePath,
    this.knownForDepartment,
    this.actingCredits = const [],
    this.crewCredits = const [],
  });

  /// True when this person is primarily crew, so their crew work should be the first section.
  bool get leadsWithCrew {
    final dept = knownForDepartment;
    if (dept != null && dept.isNotEmpty) return dept != 'Acting';
    // No hint from TMDB — go with whichever filmography is actually bigger.
    return crewCredits.length > actingCredits.length;
  }

  /// "1975-06-09 · London, England" for the header, or null when TMDB has neither.
  String? get subtitle {
    final parts = [
      if (birthday != null && birthday!.isNotEmpty) birthday!,
      if (placeOfBirth != null && placeOfBirth!.isNotEmpty) placeOfBirth!,
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }
}
