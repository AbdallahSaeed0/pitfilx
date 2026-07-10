import 'package:flutter/material.dart';
import '../data/mock_data.dart';
import '../models/friend.dart';
import '../models/title_item.dart';
import '../theme/app_theme.dart';
import '../widgets/friend_avatar.dart';
import '../widgets/widgets.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';

/// UI-only — see models/friend.dart. Mirrors the app's own Profile screen
/// layout so a friend's page feels consistent with your own.
class FriendProfileScreen extends StatelessWidget {
  final Friend friend;

  const FriendProfileScreen({super.key, required this.friend});

  void _openTitle(BuildContext context, TitleItem title) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => title.isShow
            ? TitleDetailSeriesScreen(title: title)
            : TitleDetailMovieScreen(title: title),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final recent = MockData.byIds(friend.recentTitleIds);
    final watchLater = MockData.byIds(friend.watchLaterTitleIds);

    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            SizedBox(
              height: 168,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Container(
                    height: 128,
                    width: double.infinity,
                    decoration: BoxDecoration(
                      gradient: PosterGradients.of(friend.gradientSeed),
                    ),
                  ),
                  Positioned(
                    top: 14,
                    left: 16,
                    child: CircleIconButton(
                      icon: Icons.arrow_back_ios_new,
                      onTap: () => Navigator.of(context).pop(),
                    ),
                  ),
                  Positioned(
                    left: 0,
                    right: 0,
                    top: 88,
                    child: Center(
                      child: Container(
                        padding: const EdgeInsets.all(4),
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          color: AppColors.bgBase,
                        ),
                        child: FriendAvatar(friend: friend, size: 84),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                children: [
                  Center(
                    child: Column(
                      children: [
                        Text(
                          friend.name,
                          style: AppTextStyles.bebas(
                            fontSize: 24,
                            letterSpacing: 0.1,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          friend.username,
                          style: AppTextStyles.dmSans(
                            fontSize: 12,
                            color: AppColors.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sectionGap),
                  Row(
                    children: [
                      Expanded(
                        child: _StatTile(
                          label: 'TV TIME',
                          value: friend.tvTimeLabel,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _StatTile(
                          label: 'EPISODES',
                          value: '${friend.totalEpisodesWatched}',
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _StatTile(
                          label: 'MOVIES',
                          value: '${friend.totalMoviesWatched}',
                        ),
                      ),
                    ],
                  ),
                  if (friend.currentlyWatching != null) ...[
                    const SizedBox(height: 10),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: AppColors.bgCard,
                        borderRadius: BorderRadius.circular(
                          AppSpacing.cardRadiusMax,
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.play_circle_outline,
                            size: 20,
                            color: AppColors.accent,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'CURRENTLY WATCHING',
                                  style: AppTextStyles.sectionLabel(),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  friend.currentlyWatching!,
                                  style: AppTextStyles.dmSans(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  if (recent.isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.sectionGap),
                    Text(
                      'RECENTLY WATCHED',
                      style: AppTextStyles.sectionLabel(),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      height: 132,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: recent.length,
                        separatorBuilder: (_, _) =>
                            const SizedBox(width: AppSpacing.posterGap),
                        itemBuilder: (context, i) {
                          final t = recent[i];
                          return PosterCard(
                            width: 90,
                            height: 132,
                            title: t.name,
                            gradientSeed: t.gradientSeed,
                            onTap: () => _openTitle(context, t),
                          );
                        },
                      ),
                    ),
                  ],
                  if (watchLater.isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.sectionGap),
                    Text('WATCH LATER', style: AppTextStyles.sectionLabel()),
                    const SizedBox(height: 10),
                    SizedBox(
                      height: 132,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: watchLater.length,
                        separatorBuilder: (_, _) =>
                            const SizedBox(width: AppSpacing.posterGap),
                        itemBuilder: (context, i) {
                          final t = watchLater[i];
                          return PosterCard(
                            width: 90,
                            height: 132,
                            title: t.name,
                            gradientSeed: t.gradientSeed,
                            onTap: () => _openTitle(context, t),
                          );
                        },
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  final String label;
  final String value;

  const _StatTile({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 16, 14, 14),
      decoration: BoxDecoration(
        color: AppColors.bgCard,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: AppTextStyles.sectionLabel()),
          const SizedBox(height: 4),
          Text(value, style: AppTextStyles.bebas(fontSize: 22)),
        ],
      ),
    );
  }
}
