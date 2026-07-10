import 'package:flutter_test/flutter_test.dart';

import 'package:pitflix_android/main.dart';
import 'package:pitflix_android/widgets/animated_wordmark.dart';

void main() {
  testWidgets('Splash hands off to Login', (WidgetTester tester) async {
    await tester.pumpWidget(const PitflixApp());

    // Splash screen shown first, with the animated wordmark.
    expect(find.byType(AnimatedWordmark), findsOneWidget);

    // Advance past the splash timer, then the route transition. Login's
    // wordmark loops forever by design, so pump fixed durations here
    // instead of pumpAndSettle (which would never settle).
    await tester.pump(const Duration(milliseconds: 3400));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump();

    expect(find.text('LOG IN'), findsOneWidget);
    expect(find.byType(AnimatedWordmark), findsWidgets);
  });
}
