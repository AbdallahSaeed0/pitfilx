import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pitflix_android/models/cast_member.dart';
import 'package:pitflix_android/models/person_credit.dart';
import 'package:pitflix_android/models/title_item.dart';
import 'package:pitflix_android/widgets/person_credit_grid.dart';
import 'package:pitflix_android/widgets/title_about_section.dart';

/// Poster paths are left null throughout so nothing reaches for the network during these tests.
void main() {
  Widget host(Widget child) => MaterialApp(
    home: Scaffold(body: SingleChildScrollView(child: child)),
  );

  group('TitleAboutSection', () {
    testWidgets('renders a CREW section showing each person\'s job', (tester) async {
      await tester.pumpWidget(host(const TitleAboutSection(
        overview: 'An overview.',
        cast: [CastMember(name: 'Leonardo DiCaprio', character: 'Cobb')],
        crew: [
          CastMember(name: 'Christopher Nolan', job: 'Director, Writer'),
          CastMember(name: 'Hans Zimmer', job: 'Original Music Composer'),
        ],
        genres: ['Sci-Fi'],
      )));

      expect(find.text('CAST'), findsOneWidget);
      expect(find.text('CREW'), findsOneWidget);
      expect(find.text('Christopher Nolan'), findsOneWidget);
      expect(find.text('Director, Writer'), findsOneWidget);
      // The cast member still shows their character, not a job.
      expect(find.text('Cobb'), findsOneWidget);
    });

    testWidgets('omits the CREW section entirely when there is no crew', (tester) async {
      await tester.pumpWidget(host(const TitleAboutSection(
        overview: 'An overview.',
        cast: [CastMember(name: 'Someone', character: 'Role')],
        genres: ['Drama'],
      )));

      expect(find.text('CAST'), findsOneWidget);
      expect(find.text('CREW'), findsNothing);
    });

    testWidgets('tapping a crew member reports that member', (tester) async {
      CastMember? tapped;
      await tester.pumpWidget(host(TitleAboutSection(
        overview: '',
        cast: const [],
        crew: const [CastMember(name: 'Greta Gerwig', job: 'Director', tmdbPersonId: 45400)],
        genres: const [],
        onCrewTap: (m) => tapped = m,
      )));

      await tester.tap(find.text('Greta Gerwig'));
      expect(tapped?.tmdbPersonId, 45400);
    });
  });

  group('PersonCreditGrid', () {
    List<PersonCredit> credits(int n) => [
      for (var i = 0; i < n; i++)
        PersonCredit(
          tmdbId: i + 1,
          kind: TitleKind.movie,
          title: 'Film $i',
          character: 'Character $i',
          releaseDate: '20${10 + (i % 10)}-01-01',
        ),
    ];

    testWidgets('shows the character name and year on each card', (tester) async {
      await tester.pumpWidget(host(PersonCreditGrid(
        credits: [
          const PersonCredit(
            tmdbId: 1726,
            kind: TitleKind.movie,
            title: 'Iron Man',
            character: 'Tony Stark',
            releaseDate: '2008-04-30',
          ),
        ],
        onTap: (_) {},
      )));

      expect(find.text('Iron Man'), findsOneWidget);
      expect(find.text('Tony Stark'), findsOneWidget);
      expect(find.text('2008'), findsOneWidget);
    });

    testWidgets('caps the grid and reveals the rest behind Show all', (tester) async {
      await tester.pumpWidget(host(PersonCreditGrid(
        credits: credits(30),
        onTap: (_) {},
        initialCount: 24,
      )));

      expect(find.text('Show all 30'), findsOneWidget);
      // Card 25 exists only once expanded.
      expect(find.text('Film 25'), findsNothing);

      // 24 cards are taller than the default 800x600 test viewport, so the button sits below the
      // fold — scroll to it rather than tapping a position that isn't hit-testable.
      await tester.ensureVisible(find.text('Show all 30'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Show all 30'));
      await tester.pumpAndSettle();

      expect(find.text('Show less'), findsOneWidget);
      expect(find.text('Film 25'), findsOneWidget);
    });

    testWidgets('no Show all button when everything already fits', (tester) async {
      await tester.pumpWidget(host(PersonCreditGrid(
        credits: credits(5),
        onTap: (_) {},
        initialCount: 24,
      )));

      expect(find.textContaining('Show all'), findsNothing);
      expect(find.text('Film 0'), findsOneWidget);
    });

    testWidgets('tapping a card reports that credit', (tester) async {
      PersonCredit? tapped;
      await tester.pumpWidget(host(PersonCreditGrid(
        credits: credits(3),
        onTap: (c) => tapped = c,
      )));

      await tester.tap(find.text('Film 1'));
      expect(tapped?.title, 'Film 1');
    });

    testWidgets('a credit with no year or role still renders', (tester) async {
      await tester.pumpWidget(host(PersonCreditGrid(
        credits: const [
          PersonCredit(tmdbId: 7, kind: TitleKind.movie, title: 'Untitled Project'),
        ],
        onTap: (_) {},
      )));

      expect(find.text('Untitled Project'), findsOneWidget);
    });
  });
}
