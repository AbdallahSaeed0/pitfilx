import 'package:flutter/material.dart';
import '../models/social_activity_item.dart';
import '../models/social_profile.dart';
import '../services/social_service.dart';
import '../theme/app_theme.dart';
import '../utils/time_ago.dart';
import '../widgets/friend_avatar.dart';
import '../widgets/widgets.dart';

/// Real data — identity from [SocialProfile], plus that friend's real
/// activity feed (RLS already scopes visibility to friends-only). No
/// watch-time/episode stats here: that data only lives in each person's own
/// local Pitflix.API, never synced anywhere shared.
class FriendProfileScreen extends StatefulWidget {
  final SocialProfile profile;

  const FriendProfileScreen({super.key, required this.profile});

  @override
  State<FriendProfileScreen> createState() => _FriendProfileScreenState();
}

class _FriendProfileScreenState extends State<FriendProfileScreen> {
  List<SocialActivityItem>? _activity;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final items = await SocialService.fetchActivityFeed(
        profileId: widget.profile.id,
      );
      if (!mounted) return;
      setState(() => _activity = items);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  String _verb(SocialActivityAction action) => switch (action) {
    SocialActivityAction.watched => 'Watched',
    SocialActivityAction.rated => 'Rated',
    SocialActivityAction.addedToWatchlist => 'Added to Watch Later',
  };

  @override
  Widget build(BuildContext context) {
    final profile = widget.profile;

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
                      gradient: PosterGradients.of(profile.gradientSeed),
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
                        child: FriendAvatar(profile: profile, size: 84),
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
                          profile.name,
                          style: AppTextStyles.bebas(
                            fontSize: 24,
                            letterSpacing: 0.1,
                          ),
                        ),
                        if (profile.username != null) ...[
                          const SizedBox(height: 2),
                          Text(
                            '@${profile.username}',
                            style: AppTextStyles.dmSans(
                              fontSize: 12,
                              color: AppColors.textMuted,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sectionGap),
                  Text('ACTIVITY', style: AppTextStyles.sectionLabel()),
                  const SizedBox(height: 10),
                  _buildActivity(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActivity() {
    if (_error != null) {
      return ErrorRetry(message: "Couldn't load activity.\n$_error", onRetry: _load);
    }
    final items = _activity;
    if (items == null) {
      return const ListRowsSkeleton();
    }
    if (items.isEmpty) {
      return const EmptyState(message: 'Nothing here yet.');
    }
    return Column(
      children: [
        for (final item in items) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.bgCard,
              borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
            ),
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: Container(
                    width: 32,
                    height: 46,
                    decoration: BoxDecoration(
                      gradient: PosterGradients.of(item.tmdbId % 6),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${_verb(item.action)} ${item.title ?? 'something'}',
                        style: AppTextStyles.dmSans(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        timeAgo(item.createdAt),
                        style: AppTextStyles.dmSans(
                          fontSize: 11,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
                if (item.action == SocialActivityAction.rated &&
                    item.rating != null)
                  Text(
                    '${item.rating}★',
                    style: AppTextStyles.dmSans(
                      fontSize: 12,
                      color: AppColors.star,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}
