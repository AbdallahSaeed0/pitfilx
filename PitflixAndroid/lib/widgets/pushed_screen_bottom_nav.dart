import 'package:flutter/material.dart';
import '../screens/root_shell.dart';
import 'pitflix_bottom_nav.dart';

/// Bottom nav shown on pushed screens (Title Detail, Actor, Search,
/// Settings) that are not part of the tab stack. Per the design spec these
/// always highlight a fixed tab regardless of how the screen was reached;
/// tapping a different tab pops back to the root shell and switches to it.
class PushedScreenBottomNav extends StatelessWidget {
  final MainTab active;

  const PushedScreenBottomNav({super.key, required this.active});

  @override
  Widget build(BuildContext context) {
    return PitflixBottomNav(
      active: active,
      onChanged: (tab) {
        RootShell.tabNotifier.value = tab;
        Navigator.of(context).popUntil((route) => route.isFirst);
      },
    );
  }
}
