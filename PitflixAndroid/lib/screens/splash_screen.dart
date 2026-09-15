import 'dart:async';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config/app_config.dart';
import '../services/auth_service.dart';
import '../services/friends_store.dart';
import '../widgets/animated_wordmark.dart';
import 'login_screen.dart';
import 'root_shell.dart';

/// Shown once at app launch, then hands off to RootShell if there's a valid
/// Supabase session, or Login otherwise. Also owns the actual
/// `Supabase.initialize` call (main.dart no longer awaits it before
/// `runApp`) — it can involve a network round trip that's been observed
/// taking multiple seconds on a slow connection, and blocking `runApp` on
/// that held the native pre-Flutter splash on screen the whole time instead
/// of this screen's own UI. Doing it here lets Flutter's first frame paint
/// immediately; [_handOff] just awaits it before deciding where to navigate.
///
/// The logo/wordmark fades in on arrival and the hand-off to Login/RootShell
/// crossfades rather than using the default slide-in route, so the whole
/// launch reads as one continuous piece rather than native splash → static
/// logo → hard-cut into the app.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  // Enough for the fade-in to actually be seen and read as an intentional
  // brand beat, without holding up a slow cold start any longer than that —
  // _handOff below takes the max of this and however long init actually
  // takes, never the sum of both.
  static const _minVisibleDuration = Duration(milliseconds: 700);

  late final Future<void> _initFuture;
  bool _visible = false;

  // Pre-warms Android's on-screen keyboard (IME) during this screen's
  // already-there wait, instead of the user eating that cold-start delay
  // the first time they tap a real text field (Search, Delete Account,
  // ...). Android has to spin up the keyboard process on its very first
  // use in a session, which can take upward of a second — focusing this
  // offstage (invisible, not part of layout) field triggers that init
  // without ever actually showing a keyboard.
  final _keyboardPrewarmFocusNode = FocusNode();
  final _keyboardPrewarmController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _initFuture = _initSupabase();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _keyboardPrewarmFocusNode.requestFocus();
      Timer(const Duration(milliseconds: 300), () {
        if (mounted) _keyboardPrewarmFocusNode.unfocus();
      });
      // Kicks off the fade-in on the very next frame rather than in
      // initState directly, so AnimatedOpacity actually animates from 0
      // instead of the first frame already painting at full opacity.
      if (mounted) setState(() => _visible = true);
    });
    unawaited(_handOff());
  }

  Future<void> _initSupabase() async {
    if (!AppConfig.isSupabaseConfigured) return;
    try {
      await Supabase.initialize(
        url: AppConfig.supabaseUrl,
        publishableKey: AppConfig.supabaseAnonKey,
      );
    } catch (_) {
      // Best-effort — _handOff's isSupabaseConfigured/isSignedIn checks
      // below still degrade gracefully to Login if this never completes.
    }
  }

  Future<void> _handOff() async {
    await Future.wait([
      _initFuture,
      Future.delayed(_minVisibleDuration),
    ]);
    final signedIn = AppConfig.isSupabaseConfigured && AuthService.isSignedIn;
    if (!signedIn) {
      if (!mounted) return;
      Navigator.of(context).pushReplacement(_fadeRoute(const LoginScreen()));
      return;
    }
    // Not awaited — Friends data is unrelated to Home's own load (Currently
    // Watching etc.), so there's no reason to make every cold start pay this
    // round trip before the user even sees Home. Screens that need Friends
    // data have their own loading/error states and will just see it arrive
    // a moment later.
    unawaited(
      FriendsStore.refresh().catchError((_) {
        // Best-effort — still let the user in.
      }),
    );
    if (!mounted) return;
    Navigator.of(context).pushReplacement(_fadeRoute(const RootShell()));
  }

  /// Crossfade instead of Material's default slide-in — reads as a
  /// continuation of the splash fading rather than a new screen sliding
  /// over it.
  static PageRouteBuilder<void> _fadeRoute(Widget page) {
    return PageRouteBuilder<void>(
      transitionDuration: const Duration(milliseconds: 350),
      pageBuilder: (context, animation, secondaryAnimation) => page,
      transitionsBuilder: (context, animation, secondaryAnimation, child) =>
          FadeTransition(opacity: animation, child: child),
    );
  }

  @override
  void dispose() {
    _keyboardPrewarmFocusNode.dispose();
    _keyboardPrewarmController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Matches the native launch_background's solid color (see
    // android/app/src/main/res/values/colors.xml's splash_background) so
    // there's no visible flash/mismatch when this takes over from it.
    return Scaffold(
      backgroundColor: const Color(0xFF0A0614),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Offstage(
              offstage: true,
              child: TextField(
                controller: _keyboardPrewarmController,
                focusNode: _keyboardPrewarmFocusNode,
              ),
            ),
            AnimatedOpacity(
              opacity: _visible ? 1 : 0,
              duration: const Duration(milliseconds: 400),
              curve: Curves.easeOut,
              child: AnimatedSlide(
                offset: _visible ? Offset.zero : const Offset(0, 0.04),
                duration: const Duration(milliseconds: 400),
                curve: Curves.easeOut,
                // Just the "PITFLIX" wordmark on the dark background — no purple
                // logo tile. The native splash (a white "P" glyph on the same
                // dark background) hands off into this, so the whole launch stays
                // dark and minimal rather than showing a big purple square.
                child: const AnimatedWordmark(fontSize: 52, animated: false),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
