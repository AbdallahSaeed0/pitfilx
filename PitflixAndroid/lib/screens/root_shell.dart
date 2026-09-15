import 'dart:async';
import 'package:flutter/material.dart';
import '../services/friends_store.dart';
import '../services/rate_prompt_store.dart';
import '../services/synced_api_keys_service.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';
import 'discover_screen.dart';
import 'home_screen.dart';
import 'my_device_home_screen.dart';
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
    // Index matches MainTab.myDevice — mounted unconditionally like every
    // other tab (so switching is instant, no rebuild), but it's only ever
    // reachable when MyDeviceSettings.enabled is true, since that's what
    // controls whether PitflixBottomNav shows its icon at all. The screen
    // itself also checks the flag directly and shows a "turn it on in
    // Settings" prompt instead of scanning anything while it's off.
    const MyDeviceHomeScreen(),
  ];

  Timer? _autoSyncTimer;

  @override
  void initState() {
    super.initState();
    RootShell.tabNotifier.addListener(_onTabChanged);
    // Defensive — covers entry paths that skip Login/SignUp's own refresh
    // (e.g. hot restart while already signed in).
    if (!FriendsStore.loaded.value) FriendsStore.refresh();
    RatePromptStore.refresh();
    SyncedApiKeysService.refresh();

    // Periodic re-fetch of this account's Supabase library — picks up
    // whatever the desktop app has pushed via its own "Link Mobile Account"
    // background sync (see Pitflix.API's MobileAccountSyncHostedService),
    // without this app ever needing to reach the desktop over the local
    // network itself. A plain version bump, not a network call — screens
    // that listen to UserLibraryService.libraryVersion do the actual fetch.
    // Also re-checks rate prompts each cycle, so a movie/episode marked
    // watched on desktop shows up as "wanna rate it?" here soon after — and
    // re-syncs API keys, so a key rotated on desktop reaches the phone
    // within one cycle instead of needing the app relaunched.
    _autoSyncTimer = Timer.periodic(const Duration(minutes: 5), (_) {
      UserLibraryService.libraryVersion.value++;
      RatePromptStore.refresh();
      SyncedApiKeysService.refresh();
    });
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
