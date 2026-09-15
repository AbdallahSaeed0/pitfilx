import 'title_item.dart';

/// One entry in a person's filmography — a movie or show they appeared in or worked on.
///
/// Built from TMDB's `/person/{id}/combined_credits`, which returns acting credits under `cast`
/// (carrying `character`) and crew credits under `crew` (carrying `job`). Both map to this one shape
/// so the person page can render them with the same card.
class PersonCredit {
  final int tmdbId;
  final TitleKind kind;
  final String title;
  final String? posterPath;

  /// Character played, for acting credits.
  final String? character;

  /// Job done, for crew credits. Several jobs on the same title are merged into "Writer, Producer".
  final String? job;

  /// Release / first-air date as TMDB gave it ("2019-05-24"), or null when unannounced.
  final String? releaseDate;

  final double popularity;

  const PersonCredit({
    required this.tmdbId,
    required this.kind,
    required this.title,
    this.posterPath,
    this.character,
    this.job,
    this.releaseDate,
    this.popularity = 0,
  });

  /// Four-digit year, or null when TMDB has no usable date (common for announced-but-undated films).
  int? get year {
    final d = releaseDate;
    if (d == null || d.length < 4) return null;
    return int.tryParse(d.substring(0, 4));
  }

  /// The line under the poster: the character played, or the job done.
  String? get roleLabel {
    final c = character?.trim();
    if (c != null && c.isNotEmpty) return c;
    final j = job?.trim();
    if (j != null && j.isNotEmpty) return j;
    return null;
  }

  static PersonCredit? fromCombinedCredit(Map<String, dynamic> json, {required bool isCrew}) {
    final id = (json['id'] as num?)?.toInt();
    if (id == null || id <= 0) return null;
    final title = (json['title'] ?? json['name']) as String?;
    if (title == null || title.trim().isEmpty) return null;

    // combined_credits is the one TMDB response that mixes movies and shows, so media_type is the
    // only way to tell them apart — unlike /movie or /tv lists where the endpoint implies the kind.
    final mediaType = json['media_type'] as String? ?? 'movie';
    return PersonCredit(
      tmdbId: id,
      kind: mediaType == 'tv' ? TitleKind.show : TitleKind.movie,
      title: title,
      posterPath: json['poster_path'] as String?,
      character: isCrew ? null : json['character'] as String?,
      job: isCrew ? json['job'] as String? : null,
      releaseDate: (json['release_date'] ?? json['first_air_date']) as String?,
      popularity: ((json['popularity'] as num?) ?? 0).toDouble(),
    );
  }

  /// A person credited several times on one title (writer *and* director, or a recurring TV role
  /// listed per season) arrives as one entry per credit. Collapses them to a single card, joining
  /// the roles, and orders the result newest first.
  ///
  /// Undated credits sort last rather than first: TMDB leaves `release_date` empty for announced or
  /// unreleased projects, and treating "no date" as year zero would bury a whole career under
  /// rumoured films.
  static List<PersonCredit> collapseAndSort(List<PersonCredit> credits) {
    final byTitle = <String, PersonCredit>{};
    for (final c in credits) {
      final key = '${c.kind.name}-${c.tmdbId}';
      final existing = byTitle[key];
      if (existing == null) {
        byTitle[key] = c;
        continue;
      }
      byTitle[key] = PersonCredit(
        tmdbId: c.tmdbId,
        kind: c.kind,
        title: existing.title,
        posterPath: existing.posterPath ?? c.posterPath,
        character: _joinRoles(existing.character, c.character),
        job: _joinRoles(existing.job, c.job),
        releaseDate: existing.releaseDate ?? c.releaseDate,
        popularity: existing.popularity > c.popularity ? existing.popularity : c.popularity,
      );
    }

    final list = byTitle.values.toList();
    list.sort((a, b) {
      final ay = a.year, by = b.year;
      if (ay == null && by == null) return b.popularity.compareTo(a.popularity);
      if (ay == null) return 1;
      if (by == null) return -1;
      if (ay != by) return by.compareTo(ay);
      return b.popularity.compareTo(a.popularity);
    });
    return list;
  }

  static String? _joinRoles(String? a, String? b) {
    final parts = <String>{
      for (final v in [a, b])
        if (v != null && v.trim().isNotEmpty) v.trim(),
    };
    return parts.isEmpty ? null : parts.join(', ');
  }

  /// Minimal [TitleItem] for navigating to Title Detail, which re-fetches the full record itself
  /// (see [TitleItem.needsDetailEnrichment]).
  TitleItem toTitleItem() => TitleItem(
    id: 'tmdb-$tmdbId-${kind.name}',
    name: title,
    kind: kind,
    year: year ?? 0,
    network: kind == TitleKind.movie ? 'Theaters' : 'TV',
    rating: 0,
    genres: const [],
    overview: '',
    gradientSeed: tmdbId % 6,
    posterPath: posterPath,
    tmdbId: tmdbId,
    isSummaryOnly: true,
    // TitleItem holds a parsed DateTime; TMDB gives us "2019-05-24" or, for unannounced projects,
    // an empty string. tryParse keeps a malformed date from taking down the whole filmography.
    releaseDate: releaseDate == null ? null : DateTime.tryParse(releaseDate!),
  );
}
