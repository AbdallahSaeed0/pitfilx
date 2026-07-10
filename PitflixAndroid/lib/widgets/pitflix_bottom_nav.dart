import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

enum MainTab { home, discover, stats, profile }

class PitflixBottomNav extends StatelessWidget {
  final MainTab active;
  final ValueChanged<MainTab> onChanged;

  const PitflixBottomNav({
    super.key,
    required this.active,
    required this.onChanged,
  });

  static const _items = [
    (tab: MainTab.home, label: 'Home', icon: Icons.home_rounded),
    (tab: MainTab.discover, label: 'Discover', icon: Icons.explore_outlined),
    (tab: MainTab.stats, label: 'Stats', icon: Icons.bar_chart_rounded),
    (tab: MainTab.profile, label: 'Profile', icon: Icons.person_outline),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      height: AppSpacing.bottomNavHeight,
      decoration: const BoxDecoration(
        color: AppColors.bgNav,
        border: Border(top: BorderSide(color: AppColors.border, width: 1)),
      ),
      child: Row(
        children: [
          for (final item in _items)
            Expanded(
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => onChanged(item.tab),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      item.icon,
                      size: 22,
                      color: item.tab == active
                          ? AppColors.logoAccent
                          : AppColors.iconInactive,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      item.label,
                      style: AppTextStyles.navLabel(active: item.tab == active),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
