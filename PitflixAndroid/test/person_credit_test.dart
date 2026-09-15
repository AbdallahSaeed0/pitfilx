import 'package:flutter_test/flutter_test.dart';
import 'package:pitflix_android/models/cast_member.dart';
import 'package:pitflix_android/models/person_credit.dart';
import 'package:pitflix_android/models/title_item.dart';

/// Shapes below mirror TMDB's real payloads: `combined_credits` mixes movies and shows and only
/// `media_type` distinguishes them; movies carry `title`/`release_date` while shows carry
/// `name`/`first_air_date`.
void main() {
  group('PersonCredit.fromCombinedCredit', () {
    test('parses a movie acting credit', () {
      final c = PersonCredit.fromCombinedCredit({
        'id': 1726,
        'media_type': 'movie',
        'title': 'Iron Man',
        'character': 'Tony Stark / Iron Man',
        'release_date': '2008-04-30',
        'poster_path': '/78lPtwv72eTNqFW9COBYI0dWDJa.jpg',
        'popularity': 42.5,
      }, isCrew: false);

      expect(c, isNotNull);
      expect(c!.kind, TitleKind.movie);
      expect(c.title, 'Iron Man');
      expect(c.character, 'Tony Stark / Iron Man');
      expect(c.roleLabel, 'Tony Stark / Iron Man');
      expect(c.year, 2008);
    });

    test('parses a tv credit from name/first_air_date', () {
      final c = PersonCredit.fromCombinedCredit({
        'id': 1396,
        'media_type': 'tv',
        'name': 'Breaking Bad',
        'character': 'Walter White',
        'first_air_date': '2008-01-20',
      }, isCrew: false);

      expect(c!.kind, TitleKind.show);
      expect(c.title, 'Breaking Bad');
      expect(c.year, 2008);
    });

    test('a crew credit carries the job, not a character', () {
      final c = PersonCredit.fromCombinedCredit({
        'id': 27205,
        'media_type': 'movie',
        'title': 'Inception',
        'job': 'Director',
        'character': 'should be ignored for crew',
        'release_date': '2010-07-15',
      }, isCrew: true);

      expect(c!.job, 'Director');
      expect(c.character, isNull);
      expect(c.roleLabel, 'Director');
    });

    test('rejects entries with no id or no title', () {
      expect(
        PersonCredit.fromCombinedCredit({'media_type': 'movie', 'title': 'X'}, isCrew: false),
        isNull,
      );
      expect(
        PersonCredit.fromCombinedCredit({'id': 5, 'media_type': 'movie'}, isCrew: false),
        isNull,
      );
      expect(
        PersonCredit.fromCombinedCredit(
          {'id': 5, 'media_type': 'movie', 'title': '   '},
          isCrew: false,
        ),
        isNull,
      );
    });

    test('missing or malformed dates yield a null year rather than throwing', () {
      for (final date in [null, '', 'not-a-date', '20']) {
        final c = PersonCredit.fromCombinedCredit({
          'id': 1,
          'media_type': 'movie',
          'title': 'Untitled Project',
          'release_date': date,
        }, isCrew: false);
        expect(c!.year, isNull, reason: 'date=$date');
      }
    });
  });

  group('PersonCredit.collapseAndSort', () {
    PersonCredit credit(
      int id,
      String title, {
      String? character,
      String? job,
      String? date,
      double popularity = 0,
    }) => PersonCredit(
      tmdbId: id,
      kind: TitleKind.movie,
      title: title,
      character: character,
      job: job,
      releaseDate: date,
      popularity: popularity,
    );

    test('sorts newest first', () {
      final out = PersonCredit.collapseAndSort([
        credit(1, 'Old', date: '1999-01-01'),
        credit(2, 'New', date: '2021-01-01'),
        credit(3, 'Middle', date: '2010-01-01'),
      ]);
      expect(out.map((c) => c.title), ['New', 'Middle', 'Old']);
    });

    test('undated credits sort last, not first', () {
      // TMDB leaves release_date empty for announced projects; treating that as year zero would
      // bury a real career under rumoured films.
      final out = PersonCredit.collapseAndSort([
        credit(1, 'Announced', date: null),
        credit(2, 'Released', date: '2015-01-01'),
      ]);
      expect(out.map((c) => c.title), ['Released', 'Announced']);
    });

    test('merges repeated credits for one title and joins the roles', () {
      final out = PersonCredit.collapseAndSort([
        credit(10, 'Dune', job: 'Director', date: '2021-10-22'),
        credit(10, 'Dune', job: 'Screenplay', date: '2021-10-22'),
        credit(10, 'Dune', job: 'Producer', date: '2021-10-22'),
      ]);
      expect(out, hasLength(1));
      expect(out.single.job, 'Director, Screenplay, Producer');
    });

    test('does not repeat an identical role', () {
      // A recurring TV part is credited once per season, all with the same character name.
      final out = PersonCredit.collapseAndSort([
        credit(20, 'The Wire', character: 'Omar Little', date: '2002-06-02'),
        credit(20, 'The Wire', character: 'Omar Little', date: '2002-06-02'),
      ]);
      expect(out.single.character, 'Omar Little');
    });

    test('a movie and a show sharing a tmdb id stay separate', () {
      final out = PersonCredit.collapseAndSort([
        const PersonCredit(tmdbId: 99, kind: TitleKind.movie, title: 'Fargo', releaseDate: '1996-04-05'),
        const PersonCredit(tmdbId: 99, kind: TitleKind.show, title: 'Fargo', releaseDate: '2014-04-15'),
      ]);
      expect(out, hasLength(2));
    });

    test('same-year credits fall back to popularity', () {
      final out = PersonCredit.collapseAndSort([
        credit(1, 'Obscure', date: '2020-03-01', popularity: 1),
        credit(2, 'Famous', date: '2020-08-01', popularity: 90),
      ]);
      expect(out.first.title, 'Famous');
    });

    test('toTitleItem carries enough to open Title Detail', () {
      final item = credit(1726, 'Iron Man', character: 'Tony Stark', date: '2008-04-30')
          .toTitleItem();
      expect(item.tmdbId, 1726);
      expect(item.name, 'Iron Man');
      expect(item.year, 2008);
      expect(item.needsDetailEnrichment, isTrue);
      expect(item.releaseDate, DateTime(2008, 4, 30));
    });

    test('toTitleItem survives an unparseable date', () {
      final item = credit(1, 'TBA', date: 'garbage').toTitleItem();
      expect(item.releaseDate, isNull);
      expect(item.year, 0);
    });
  });

  group('CastMember.mergeCrewByPerson', () {
    test('one card per person, roles joined', () {
      final merged = CastMember.mergeCrewByPerson([
        CastMember.fromTmdbCrewCredit({
          'id': 525,
          'name': 'Christopher Nolan',
          'job': 'Director',
          'department': 'Directing',
        }),
        CastMember.fromTmdbCrewCredit({
          'id': 525,
          'name': 'Christopher Nolan',
          'job': 'Writer',
          'department': 'Writing',
        }),
        CastMember.fromTmdbCrewCredit({
          'id': 947,
          'name': 'Hans Zimmer',
          'job': 'Original Music Composer',
          'department': 'Sound',
        }),
      ]);

      expect(merged, hasLength(2));
      expect(merged.first.name, 'Christopher Nolan');
      expect(merged.first.job, 'Director, Writer');
      expect(merged.first.roleLabel, 'Director, Writer');
      expect(merged.last.job, 'Original Music Composer');
    });

    test('keeps first-seen order', () {
      final merged = CastMember.mergeCrewByPerson([
        CastMember.fromTmdbCrewCredit({'id': 1, 'name': 'A', 'job': 'Editor'}),
        CastMember.fromTmdbCrewCredit({'id': 2, 'name': 'B', 'job': 'Director'}),
      ]);
      expect(merged.map((m) => m.name), ['A', 'B']);
    });

    test('crew without an id merge by name instead of collapsing together', () {
      final merged = CastMember.mergeCrewByPerson([
        CastMember(name: 'Jane Doe', job: 'Gaffer'),
        CastMember(name: 'Jane Doe', job: 'Best Boy'),
        CastMember(name: 'John Roe', job: 'Grip'),
      ]);
      expect(merged, hasLength(2));
      expect(merged.first.job, 'Gaffer, Best Boy');
    });
  });

  group('CastMember.roleLabel', () {
    test('prefers character, falls back to job, else null', () {
      expect(const CastMember(name: 'x', character: 'Neo').roleLabel, 'Neo');
      expect(const CastMember(name: 'x', job: 'Director').roleLabel, 'Director');
      expect(const CastMember(name: 'x', character: '  ', job: 'Grip').roleLabel, 'Grip');
      expect(const CastMember(name: 'x').roleLabel, isNull);
    });
  });
}
