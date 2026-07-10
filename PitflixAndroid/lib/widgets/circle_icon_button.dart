import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// 34px circular icon button — used for back chevrons and the "more" button
/// on hero headers, and Settings' back button.
class CircleIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onTap;
  final Color background;

  const CircleIconButton({
    super.key,
    required this.icon,
    this.onTap,
    this.background = const Color(0x66000000), // rgba(0,0,0,0.4)
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(color: background, shape: BoxShape.circle),
        child: Icon(icon, size: 18, color: AppColors.textPrimary),
      ),
    );
  }
}
