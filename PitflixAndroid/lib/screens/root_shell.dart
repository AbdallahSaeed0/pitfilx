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

class _RootShellState extends State<RootShell> with WidgetsBindingObserver {
  // Each tab is built the first time it's opened, then kept (so its state
  // survives tab switches). Building them all up front used to start Stats'
  // full-history download, Profile's summary and Discover's 20 genre pages
  // at app launch, all competing with Home for the network while the user
  // was only looking at Home.
  late final List<Widget Function()> _builders = [
    () => HomeScreen(
      onAvatarTap: () => RootShell.tabNotifier.value = MainTab.profile,
    ),
    () => const DiscoverScreen(),
    () => const StatsScreen(),
    () => ProfileScreen(
      onOpenStats: () => RootShell.tabNotifier.value = MainTab.stats,
    ),
    // Index matches MainTab.myDevice — only ever reachable when
    // MyDeviceSettings.enabled is true, since that's what controls whether
    // PitflixBottomNav shows its icon at all. The screen itself also checks
    // the flag directly and shows a "turn it on in Settings" prompt instead
    // of scanning anything while it's off.
    () => const MyDeviceHomeScreen(),
  ];
  final Map<int, Widget> _built = {};

  static const _autoSyncInterval = Duration(minutes: 5);
  Timer? _autoSyncTimer;
  DateTime _lastAutoSync = DateTime.now();

  @override
  void initState() {
    super.initState();
    RootShell.tabNotifier.addListener(_onTabChanged);
    WidgetsBinding.instance.addObserver(this);
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
    //
    // Only while the app is in the foreground (see didChangeAppLifecycleState)
    // — a Dart timer otherwise keeps firing for as long as Android keeps the
    // backgrounded process alive, spending data and battery reloading
    // screens nobody is looking at.
    _startAutoSync();
  }

  void _startAutoSync() {
    _autoSyncTimer ??= Timer.periodic(_autoSyncInterval, (_) => _autoSync());
  }

  void _autoSync() {
    _lastAutoSync = DateTime.now();
    UserLibraryService.libraryVersion.value++;
    RatePromptStore.refresh();
    SyncedApiKeysService.refresh();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        // Catch up at once if a cycle was missed while backgrounded, so
        // coming back to the app shows what the desktop pushed meanwhile.
        if (_autoSyncTimer == null &&
            DateTime.now().difference(_lastAutoSync) >= _autoSyncInterval) {
          _autoSync();
        }
        _startAutoSync();
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
      case AppLifecycleState.detached:
        _autoSyncTimer?.cancel();
        _autoSyncTimer = null;
      case AppLifecycleState.inactive:
        // Transient (notification shade, permission dialog) — keep running.
        break;
    }
  }

  @override
  void dispose() {
    RootShell.tabNotifier.removeListener(_onTabChanged);
    WidgetsBinding.instance.removeObserver(this);
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
          // One slot per tab, always — an unopened tab is a placeholder
          // rather than absent, so each tab keeps its Stack position (and
          // with it its State) when another tab is opened for the first time.
          for (int i = 0; i < MainTab.values.length; i++)
            IgnorePointer(
              ignoring: active != MainTab.values[i],
              child: AnimatedOpacity(
                opacity: active == MainTab.values[i] ? 1.0 : 0.0,
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeInOut,
                child: active == MainTab.values[i] || _built.containsKey(i)
                    ? _built.putIfAbsent(i, _builders[i])
                    : const SizedBox.shrink(),
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
