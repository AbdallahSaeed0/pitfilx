import 'package:flutter/material.dart';
import 'screens/splash_screen.dart';
import 'services/app_settings.dart';
import 'theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  AppSettings.load();
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
