import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Custom toggle matching the design: ON = accent bg with thumb right,
/// OFF = border-input bg with thumb left. Animates over 200ms.
class PitflixToggle extends StatelessWidget {
  final bool value;
  final ValueChanged<bool> onChanged;

  const PitflixToggle({
    super.key,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => onChanged(!value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 44,
        height: 26,
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(
          color: value ? AppColors.accent : AppColors.borderInput,
          borderRadius: BorderRadius.circular(13),
        ),
        alignment: value ? Alignment.centerRight : Alignment.centerLeft,
        child: Container(
          width: 20,
          height: 20,
          decoration: BoxDecoration(
            // ON = white track, so the thumb needs to be dark to stay visible.
            color: value ? AppColors.bgBase : AppColors.textPrimary,
            shape: BoxShape.circle,
          ),
        ),
      ),
    );
  }
}
