import 'package:flutter/material.dart';
import 'screens/splash_screen.dart';
import 'services/app_settings.dart';
import 'services/my_device_favorites_store.dart';
import 'services/my_device_settings.dart';
import 'theme/app_theme.dart';
import 'utils/persistent_json_cache.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  AppSettings.load();
  // Restores the previous session's TMDB responses so Home can paint from them instead of waiting
  // on the network. Not awaited, for the same reason Supabase.initialize isn't (see below) — the
  // read is fast, and any fetch that beats it just misses the cache and goes to TMDB as before.
  PersistentJsonCache.load();
  // My Device is a fully separate, local-only feature (no Supabase) — see
  // MyDeviceSettings' doc comment — so it gets its own load() call rather
  // than folding into AppSettings.
  MyDeviceSettings.load();
  MyDeviceFavoritesStore.load();
  // Supabase.initialize is NOT awaited here — it can involve a network round
  // trip (session refresh) that's been observed taking multiple seconds on a
  // slow connection, which used to block runApp entirely, holding the native
  // pre-Flutter splash on screen that whole time. Now runApp fires
  // immediately so Flutter's first frame (and SplashScreen's own UI) paints
  // right away; SplashScreen kicks off Supabase.initialize itself and awaits
  // it before deciding where to navigate — see its doc comment.
  runApp(const PitflixApp());
}

class PitflixApp extends StatelessWidget {
  const PitflixApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Pitflix',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark,
      home: const SplashScreen(),
    );
  }
}
