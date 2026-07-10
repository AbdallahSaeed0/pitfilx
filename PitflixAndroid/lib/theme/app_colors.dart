import 'package:flutter/material.dart';

/// Design tokens — colors. See design_handoff_pitflix_android/README.md.
abstract class AppColors {
  // Neutral black/gray — no purple tint (purple is reserved for the logo,
  // see below). Was a purple-tinted near-black before; cards especially
  // read as plum/maroon rather than black.
  static const bgBase = Color(0xFF0A0A0A);
  static const bgCanvas = Color(0xFF080808);
  static const bgCard = Color(0xFF161616);
  static const bgNav = Color(0xFF101010);

  static const border = Color(0xFF262626);
  static const borderInput = Color(0xFF333333);

  // Purple is reserved for the brand mark only (Login/Sign Up logo) — every
  // other "accent" surface (buttons, toggles, active states, links) uses
  // white/black instead.
  static const accent = Color(0xFFFFFFFF);
  static const logoAccent = Color(0xFF7C3AED);
  static const logoAccentDim = Color(0xFF5B21B6);

  static const textPrimary = Color(0xFFFFFFFF);
  static const textSecondary = Color(0xA6FFFFFF); // rgba(255,255,255,0.65)
  static const textMuted = Color(0xFF8A8A8A);
  static const textInactiveNav = Color(0x73FFFFFF); // rgba(255,255,255,0.45)

  static const iconInactive = Color(0xFF8A8A8A);
  static const tabInactiveBorder = Color(0xFF2E2E2E);

  static const success = Color(0xFF34D399);
  static const successBg = Color(0xFF1A3A2A);
  static const destructive = Color(0xFFEF4444);
  static const star = Color(0xFFF59E0B);

  // Frequently used derived tones (not in the token table but used repeatedly
  // across screens per the design file).
  static const activeTabText = Color(0xFFF5F5F5);
  static const inactiveTabText = Color(0xFF8A8A8A);
  static const avatarBg = Color(0xFF1E1E1E);
  static const posterPlaceholderStart = Color(0xFF0D1A2E);
  static const posterPlaceholderEnd = Color(0xFF1C2F4E);

  /// Track color behind progress bars/bar-chart bars (was purple-tinted).
  static const progressTrack = Color(0xFF262626);

  /// Faint numeric labels (ranks, week labels) and unfilled episode borders
  /// (was purple-tinted).
  static const textFaint = Color(0xFF4A4A4A);

  /// Login/Sign Up input field text (was purple-tinted).
  static const inputText = Color(0xFFB0B0B0);
  static const inputTextObscured = Color(0xFF8F8F8F);

  /// Primary CTA buttons (Sign Up, Log In, Save, Log This Watch, Mark,
  /// Create List) — a darker purple than the logo mark, kept as its own
  /// token so the logo stays the brighter brand shade.
  static const buttonPurple = Color(0xFF4C1D95);
}
