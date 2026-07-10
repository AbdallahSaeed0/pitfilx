import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../widgets/animated_wordmark.dart';
import 'login_screen.dart';

/// Shown once at app launch, then hands off to Login.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    // Long enough for the wordmark to play twice in full (~1.53s per cycle)
    // before handing off, landing the cut during the post-cycle pause so we
    // never navigate away mid-reveal (which would freeze partially-faded
    // letters right as the screen changes).
    _timer = Timer(const Duration(milliseconds: 2900), () {
      if (!mounted) return;
      Navigator.of(
        context,
      ).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen()));
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0614),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 80,
              height: 80,
              decoration: const BoxDecoration(
                color: AppColors.logoAccentDim,
                // Circle, not a rounded square — matches the native Android
                // splash icon, which the system always masks into a circle
                // regardless of the source image's shape. Keeping this one
                // in sync avoids a shape mismatch on the native-to-Flutter
                // handoff.
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: Text(
                'P',
                style: AppTextStyles.bebas(
                  fontSize: 40,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            const SizedBox(height: 24),
            const AnimatedWordmark(fontSize: 52, loop: true),
          ],
        ),
      ),
    );
  }
}
