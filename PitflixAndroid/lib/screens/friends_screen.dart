import 'package:flutter/material.dart';
import '../models/social_activity_item.dart';
import '../models/social_friend_request.dart';
import '../models/social_profile.dart';
import '../services/app_settings.dart';
import '../services/friends_store.dart';
import '../services/social_service.dart';
import '../theme/app_theme.dart';
import '../utils/time_ago.dart';
import '../widgets/friend_avatar.dart';
import '../widgets/widgets.dart';
import 'activity_detail_screen.dart';
import 'add_friend_screen.dart';
import 'friend_profile_screen.dart';

/// Real data — friends/requests come from [FriendsStore] (shared session
/// state backed by the social schema), activity is fetched fresh each time
/// the Activity tab is opened.
class FriendsScreen extends StatefulWidget {
  const FriendsScreen({super.key});

  @override
  State<FriendsScreen> createState() => _FriendsScreenState();
}

class _FriendsScreenState extends State<FriendsScreen> {
  int _tab = 0; // 0 Friends, 1 Requests, 2 Activity
  List<SocialActivityItem>? _activity;
  String? _activityError;

  @override
  void initState() {
    super.initState();
    FriendsStore.refresh();
    _loadActivity();
  }

  Future<void> _loadActivity() async {
    setState(() => _activityError = null);
    try {
      final items = await SocialService.fetchActivityFeed();
      if (!mounted) return;
      setState(() => _activity = items);
    } catch (e) {
      if (!mounted) return;
      setState(() => _activityError = e.toString());
    }
  }

  void _openAddFriend() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const AddFriendScreen()));
  }

  void _openFriendProfile(SocialProfile profile) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => FriendProfileScreen(profile: profile)),
    );
  }

  void _acceptRequest(SocialFriendRequest request) {
    FriendsStore.acceptRequest(request);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('You and ${request.profile.name} are now friends'),
      ),
    );
  }

  void _declineRequest(SocialFriendRequest request) =>
      FriendsStore.declineRequest(request);

  void _cancelOutgoing(SocialFriendRequest request) =>
      FriendsStore.cancelOutgoing(request);

  int get _unseenActivityCount {
    final items = _activity;
    if (items == null) return 0;
    final lastSeen = AppSettings.lastSeenActivityAt.value;
    if (lastSeen == null) return items.length;
    return items.where((a) => a.createdAt.isAfter(lastSeen)).length;
  }

  void _setTab(int i) {
    setState(() => _tab = i);
    if (i == 2) AppSettings.markActivitySeen();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge([
        FriendsStore.friends,
        FriendsStore.incoming,
        FriendsStore.outgoing,
        AppSettings.lastSeenActivityAt,
      ]),
      builder: (context, _) => _buildScaffold(),
    );
  }

  Widget _buildScaffold() {
    final friends = FriendsStore.friends.value;
    final incoming = FriendsStore.incoming.value;
    final outgoing = FriendsStore.outgoing.value;
    final unseenActivity = _unseenActivityCount;
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      CircleIconButton(
                        icon: Icons.arrow_back_ios_new,
                        background: AppColors.bgCard,
                        onTap: () => Navigator.of(context).pop(),
                      ),
                      const SizedBox(width: 14),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'FRIENDS',
                            style: AppTextStyles.bebas(
                              fontSize: 26,
                              letterSpacing: 0.14,
                              color: AppColors.logoAccent,
                            ),
                          ),
                          Text(
                            '${friends.length} friend${friends.length == 1 ? '' : 's'}',
                            style: AppTextStyles.dmSans(
                              fontSize: 11,
                              color: AppColors.textMuted,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  GestureDetector(
                    onTap: _openAddFriend,
                    child: Container(
                      width: 34,
                      height: 34,
                      decoration: const BoxDecoration(
                        color: AppColors.buttonPurple,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.person_add_alt_1,
                        size: 17,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            SegmentedTabBar(
              tabs: [
                'Friends (${friends.length})',
                incoming.isEmpty ? 'Requests' : 'Requests (${incoming.length})',
                unseenActivity == 0 ? 'Activity' : 'Activity ($unseenActivity)',
              ],
              activeIndex: _tab,
              onChanged: _setTab,
            ),
            Expanded(child: _buildBody(friends, incoming, outgoing)),
          ],
        ),
      ),
    );
  }

  Widget _buildBody(
    List<SocialProfile> friends,
    List<SocialFriendRequest> incoming,
    List<SocialFriendRequest> outgoing,
  ) {
    return switch (_tab) {
      1 => _buildRequests(incoming, outgoing),
      2 => _buildActivity(),
      _ => _buildFriends(friends),
    };
  }

  Widget _buildFriends(List<SocialProfile> friends) {
    if (!FriendsStore.loaded.value) {
      return const ListRowsSkeleton();
    }
    if (friends.isEmpty) {
      return const EmptyState(message: 'No friends yet — add some!');
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      itemCount: friends.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, i) {
        final friend = friends[i];
        return GestureDetector(
          onTap: () => _openFriendProfile(friend),
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.bgCard,
              borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
            ),
            child: Row(
              children: [
                FriendAvatar(profile: friend),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        friend.name,
                        style: AppTextStyles.dmSans(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (friend.username != null) ...[
                        const SizedBox(height: 2),
                        Text(
                          '@${friend.username}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppTextStyles.dmSans(
                            fontSize: 11,
                            color: AppColors.textMuted,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const Icon(
                  Icons.chevron_right,
                  size: 18,
                  color: Color(0x40FFFFFF),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildRequests(
    List<SocialFriendRequest> incoming,
    List<SocialFriendRequest> outgoing,
  ) {
    if (!FriendsStore.loaded.value) {
      return const ListRowsSkeleton();
    }
    if (incoming.isEmpty && outgoing.isEmpty) {
      return const EmptyState(message: 'No pending requests.');
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      children: [
        if (incoming.isNotEmpty) ...[
          Text('INCOMING', style: AppTextStyles.sectionLabel()),
          const SizedBox(height: 10),
          for (final request in incoming) ...[
            _RequestRow(
              profile: request.profile,
              subtitle: 'Sent ${timeAgo(request.createdAt)}',
              onTapFriend: () => _openFriendProfile(request.profile),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  GestureDetector(
                    onTap: () => _declineRequest(request),
                    child: Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        color: AppColors.avatarBg,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppColors.borderInput),
                      ),
                      child: const Icon(
                        Icons.close,
                        size: 16,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  GestureDetector(
                    onTap: () => _acceptRequest(request),
                    child: Container(
                      width: 32,
                      height: 32,
                      decoration: const BoxDecoration(
                        color: AppColors.buttonPurple,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.check,
                        size: 16,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
          ],
        ],
        if (outgoing.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text('SENT', style: AppTextStyles.sectionLabel()),
          const SizedBox(height: 10),
          for (final request in outgoing) ...[
            _RequestRow(
              profile: request.profile,
              subtitle: 'Pending · sent ${timeAgo(request.createdAt)}',
              onTapFriend: () => _openFriendProfile(request.profile),
              trailing: GestureDetector(
                onTap: () => _cancelOutgoing(request),
                child: Text(
                  'Cancel',
                  style: AppTextStyles.dmSans(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textMuted,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
          ],
        ],
      ],
    );
  }

  Widget _buildActivity() {
    if (_activityError != null) {
      return ErrorRetry(
        message: "Couldn't load activity.\n$_activityError",
        onRetry: _loadActivity,
      );
    }
    final items = _activity;
    if (items == null) {
      return const ListRowsSkeleton();
    }
    if (items.isEmpty) {
      return const EmptyState(message: 'No recent activity.');
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      itemCount: items.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, i) => GestureDetector(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => ActivityDetailScreen(item: items[i]),
          ),
        ),
        child: _ActivityRow(
          item: items[i],
          onTapFriend: () => _openFriendProfile(items[i].profile),
        ),
      ),
    );
  }
}

class _RequestRow extends StatelessWidget {
  final SocialProfile profile;
  final String subtitle;
  final Widget trailing;
  final VoidCallback? onTapFriend;

  const _RequestRow({
    required this.profile,
    required this.subtitle,
    required this.trailing,
    this.onTapFriend,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTapFriend,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.bgCard,
          borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
        ),
        child: Row(
          children: [
            FriendAvatar(profile: profile),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    profile.name,
                    style: AppTextStyles.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: AppTextStyles.dmSans(
                      fontSize: 11,
                      color: AppColors.textMuted,
                    ),
                  ),
                ],
              ),
            ),
            trailing,
          ],
        ),
      ),
    );
  }
}

class _ActivityRow extends StatelessWidget {
  final SocialActivityItem item;
  final VoidCallback onTapFriend;

  const _ActivityRow({required this.item, required this.onTapFriend});

  String get _verb => switch (item.action) {
    SocialActivityAction.watched => 'watched',
    SocialActivityAction.rated => 'rated',
    SocialActivityAction.addedToWatchlist => 'added to Watch Later',
  };

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.bgCard,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GestureDetector(
            onTap: onTapFriend,
            child: FriendAvatar(profile: item.profile, size: 40),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                RichText(
                  text: TextSpan(
                    style: AppTextStyles.dmSans(
                      fontSize: 13,
                      color: AppColors.textPrimary,
                    ),
                    children: [
                      TextSpan(
                        text: item.profile.name,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      TextSpan(text: ' $_verb '),
                      TextSpan(
                        text: item.title ?? 'something',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      if (item.action == SocialActivityAction.rated &&
                          item.rating != null)
                        TextSpan(text: ' (${item.rating}★)'),
                    ],
                  ),
                ),
                const SizedBox(height: 4),
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
        ],
      ),
    );
  }
}
