import 'package:flutter/material.dart';
import '../models/rate_prompt_item.dart';
import '../services/app_settings.dart';
import '../services/rate_prompt_store.dart';
import '../services/tmdb_service.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import '../utils/time_ago.dart';
import '../widgets/widgets.dart';
import '../widgets/pitflix_network_image.dart';

/// Full list of pending "you just watched this, wanna rate it?" prompts —
/// reached from Home's bell icon. Rating (or dismissing) an item removes it
/// immediately via [RatePromptStore.remove], no full reload needed.
class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  Future<void> _rate(RatePromptItem item, int rating) async {
    switch (item.type) {
      case RatePromptType.movie:
        await UserLibraryService.setTitleRating(item.tmdbId, 'movie', rating);
      case RatePromptType.series:
        await UserLibraryService.setTitleRating(item.tmdbId, 'series', rating);
      case RatePromptType.episode:
        await UserLibraryService.setEpisodeRating(
          item.tmdbId,
          item.season!,
          item.episodeNumber!,
          rating,
        );
    }
    RatePromptStore.remove(item.key);
  }

  void _dismiss(RatePromptItem item) {
    AppSettings.dismissRatePrompt(item.key);
    RatePromptStore.remove(item.key);
  }

  void _clearAll(List<RatePromptItem> items) {
    for (final item in items) {
      AppSettings.dismissRatePrompt(item.key);
    }
    RatePromptStore.items.value = const [];
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
              child: Row(
                children: [
                  CircleIconButton(
                    icon: Icons.arrow_back_ios_new,
                    background: AppColors.bgCard,
                    onTap: () => Navigator.of(context).pop(),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      'NOTIFICATIONS',
                      style: AppTextStyles.bebas(
                        fontSize: 22,
                        letterSpacing: 0.1,
                        color: AppColors.logoAccent,
                      ),
                    ),
                  ),
                  ValueListenableBuilder<List<RatePromptItem>>(
                    valueListenable: RatePromptStore.items,
                    builder: (context, items, _) => items.isEmpty
                        ? const SizedBox.shrink()
                        : GestureDetector(
                            onTap: () => _clearAll(items),
                            child: Text(
                              'Clear All',
                              style: AppTextStyles.dmSans(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: AppColors.accent,
                              ),
                            ),
                          ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ValueListenableBuilder<List<RatePromptItem>>(
                valueListenable: RatePromptStore.items,
                builder: (context, items, _) {
                  if (items.isEmpty) {
                    return Center(
                      child: Text(
                        'Nothing to rate right now.',
                        style: AppTextStyles.dmSans(
                          fontSize: 13,
                          color: AppColors.textMuted,
                        ),
                      ),
                    );
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
                    itemCount: items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 12),
                    itemBuilder: (context, i) =>
                        _RatePromptRow(item: items[i], onRate: _rate, onDismiss: _dismiss),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RatePromptRow extends StatelessWidget {
  final RatePromptItem item;
  final void Function(RatePromptItem, int) onRate;
  final void Function(RatePromptItem) onDismiss;

  const _RatePromptRow({
    required this.item,
    required this.onRate,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.bgCard,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
      ),
      padding: const EdgeInsets.all(12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: SizedBox(
              width: 56,
              height: 84,
              child: PitflixNetworkImage(
                TmdbService.posterUrl(item.posterPath) ?? '',
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) => ColoredBox(
                  color: AppColors.bgBase,
                  child: const Icon(
                    Icons.movie_outlined,
                    color: AppColors.textMuted,
                    size: 20,
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'You just watched',
                  style: AppTextStyles.dmSans(
                    fontSize: 11,
                    color: AppColors.textMuted,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  item.displayLabel,
                  style: AppTextStyles.dmSans(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  timeAgo(item.watchedAt),
                  style: AppTextStyles.dmSans(
                    fontSize: 11,
                    color: AppColors.textMuted,
                  ),
                ),
                const SizedBox(height: 8),
                // Fixed 5-point scale regardless of AppSettings.ratingScaleMax —
                // the DB column is a 1-5 smallint constraint.
                StarRating(
                  rating: 0,
                  max: 5,
                  size: 22,
                  onChanged: (v) => onRate(item, v),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: () => onDismiss(item),
            icon: const Icon(
              Icons.close,
              size: 18,
              color: AppColors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}
