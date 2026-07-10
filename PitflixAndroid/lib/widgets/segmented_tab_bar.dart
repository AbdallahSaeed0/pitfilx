import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Two/three-way top tab bar used on Home (Shows/Movies), Stats
/// (Shows/Movies), and Title Detail (Episodes/About).
class SegmentedTabBar extends StatelessWidget {
  final List<String> tabs;
  final int activeIndex;
  final ValueChanged<int> onChanged;

  const SegmentedTabBar({
    super.key,
    required this.tabs,
    required this.activeIndex,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenPadding,
        10,
        AppSpacing.screenPadding,
        0,
      ),
      child: Row(
        children: [
          for (var i = 0; i < tabs.length; i++)
            Expanded(
              child: GestureDetector(
                onTap: () => onChanged(i),
                behavior: HitTestBehavior.opaque,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  curve: Curves.easeInOut,
                  alignment: Alignment.center,
                  padding: const EdgeInsets.only(bottom: 10),
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(
                        width: 2,
                        color: i == activeIndex
                            ? AppColors.logoAccent
                            : AppColors.tabInactiveBorder,
                      ),
                    ),
                  ),
                  child: AnimatedDefaultTextStyle(
                    duration: const Duration(milliseconds: 200),
                    style: AppTextStyles.dmSans(
                      fontSize: 14,
                      fontWeight: i == activeIndex
                          ? FontWeight.w600
                          : FontWeight.w400,
                      color: i == activeIndex
                          ? AppColors.logoAccent
                          : AppColors.inactiveTabText,
                    ),
                    child: Text(tabs[i]),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
