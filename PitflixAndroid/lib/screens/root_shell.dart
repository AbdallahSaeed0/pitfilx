import 'dart:async';
import 'package:flutter/material.dart';
import '../services/friends_store.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';
import 'discover_screen.dart';
import 'home_screen.dart';
import 'profile_screen.dart';
import 'stats_screen.dart';

/// Bottom-nav shell hosting the 4 main tabs. Title Detail, Actor, Search,
/// and Settings are pushed on top of this via Navigator and are not part of
/// the tab stack, per the design spec. [tabNotifier] lets those pushed
/// screens' (visual) bottom nav pop back here and switch tabs.
class RootShell extends StatefulWidget {
  const RootShell({super.key});

  static final tabNotifier = ValueNotifier<MainTab>(MainTab.home);

  @override
  State<RootShell> createState() => _RootShellState();
}

class _RootShellState extends State<RootShell> {
  // Cached once so tab state is preserved across switches.
  late final List<Widget> _screens = [
    HomeScreen(
      onAvatarTap: () => RootShell.tabNotifier.value = MainTab.profile,
    ),
    const DiscoverScreen(),
    const StatsScreen(),
    ProfileScreen(
      onOpenStats: () => RootShell.tabNotifier.value = MainTab.stats,
    ),
  ];

  Timer? _autoSyncTimer;

  @override
  void initState() {
    super.initState();
    RootShell.tabNotifier.addListener(_onTabChanged);
    // Defensive — covers entry paths that skip Login/SignUp's own refresh
    // (e.g. hot restart while already signed in).
    if (!FriendsStore.loaded.value) FriendsStore.refresh();

    // Periodic re-fetch of this account's Supabase library — picks up
    // whatever the desktop app has pushed via its own "Link Mobile Account"
    // background sync (see Pitflix.API's MobileAccountSyncHostedService),
    // without this app ever needing to reach the desktop over the local
    // network itself. A plain version bump, not a network call — screens
    // that listen to UserLibraryService.libraryVersion do the actual fetch.
    _autoSyncTimer = Timer.periodic(
      const Duration(minutes: 5),
      (_) => UserLibraryService.libraryVersion.value++,
    );
  }

  @override
  void dispose() {
    RootShell.tabNotifier.removeListener(_onTabChanged);
    _autoSyncTimer?.cancel();
    super.dispose();
  }

  void _onTabChanged() => setState(() {});

  @override
  Widget build(BuildContext context) {
    final active = RootShell.tabNotifier.value;
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: Stack(
        children: [
          for (int i = 0; i < MainTab.values.length; i++)
            IgnorePointer(
              ignoring: active != MainTab.values[i],
              child: AnimatedOpacity(
                opacity: active == MainTab.values[i] ? 1.0 : 0.0,
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeInOut,
                child: _screens[i],
              ),
            ),
        ],
      ),
      bottomNavigationBar: PitflixBottomNav(
        active: active,
        onChanged: (tab) => RootShell.tabNotifier.value = tab,
      ),
    );
  }
}
