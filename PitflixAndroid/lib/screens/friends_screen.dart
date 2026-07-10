import 'package:flutter/material.dart';
import '../data/mock_data.dart';
import '../data/mock_friends_data.dart';
import '../models/activity_item.dart';
import '../models/friend.dart';
import '../models/friend_request.dart';
import '../services/friends_store.dart';
import '../theme/app_theme.dart';
import '../utils/time_ago.dart';
import '../widgets/friend_avatar.dart';
import '../widgets/widgets.dart';
import 'activity_detail_screen.dart';
import 'add_friend_screen.dart';
import 'friend_profile_screen.dart';

/// UI-only — see models/friend.dart. Friends/requests/activity are all mock
/// data, but backed by [FriendsStore] (rather than local state) so sending a
/// request from Add Friend actually shows up here and vice versa.
class FriendsScreen extends StatefulWidget {
  const FriendsScreen({super.key});

  @override
  State<FriendsScreen> createState() => _FriendsScreenState();
}

class _FriendsScreenState extends State<FriendsScreen> {
  int _tab = 0; // 0 Friends, 1 Requests, 2 Activity

  void _openAddFriend() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const AddFriendScreen()));
  }

  void _openFriendProfile(Friend friend) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => FriendProfileScreen(friend: friend)),
    );
  }

  void _acceptRequest(FriendRequest request) {
    FriendsStore.acceptRequest(request);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('You and ${request.friend.name} are now friends')),
    );
  }

  void _declineRequest(FriendRequest request) =>
      FriendsStore.declineRequest(request);

  void _cancelOutgoing(FriendRequest request) =>
      FriendsStore.cancelOutgoing(request);

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge([
        FriendsStore.friends,
        FriendsStore.incoming,
        FriendsStore.outgoing,
      ]),
      builder: (context, _) => _buildScaffold(),
    );
  }

  Widget _buildScaffold() {
    final friends = FriendsStore.friends.value;
    final incoming = FriendsStore.incoming.value;
    final outgoing = FriendsStore.outgoing.value;
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
                'Activity',
              ],
              activeIndex: _tab,
              onChanged: (i) => setState(() => _tab = i),
            ),
            Expanded(child: _buildBody(friends, incoming, outgoing)),
          ],
        ),
      ),
    );
  }

  Widget _buildBody(
    List<Friend> friends,
    List<FriendRequest> incoming,
    List<FriendRequest> outgoing,
  ) {
    return switch (_tab) {
      1 => _buildRequests(incoming, outgoing),
      2 => _buildActivity(),
      _ => _buildFriends(friends),
    };
  }

  Widget _buildFriends(List<Friend> friends) {
    if (friends.isEmpty) {
      return Center(
        child: Text(
          'No friends yet — add some!',
          style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
        ),
      );
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
                FriendAvatar(friend: friend),
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
                      const SizedBox(height: 2),
                      Text(
                        friend.currentlyWatching != null
                            ? 'Watching ${friend.currentlyWatching}'
                            : friend.username,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.dmSans(
                          fontSize: 11,
                          color: AppColors.textMuted,
                        ),
                      ),
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
    List<FriendRequest> incoming,
    List<FriendRequest> outgoing,
  ) {
    if (incoming.isEmpty && outgoing.isEmpty) {
      return Center(
        child: Text(
          'No pending requests.',
          style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
        ),
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      children: [
        if (incoming.isNotEmpty) ...[
          Text('INCOMING', style: AppTextStyles.sectionLabel()),
          const SizedBox(height: 10),
          for (final request in incoming) ...[
            _RequestRow(
              friend: request.friend,
              subtitle: 'Sent ${timeAgo(request.sentAt)}',
              onTapFriend: () => _openFriendProfile(request.friend),
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
              friend: request.friend,
              subtitle: 'Pending · sent ${timeAgo(request.sentAt)}',
              onTapFriend: () => _openFriendProfile(request.friend),
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
    final items = MockFriendsData.activity;
    if (items.isEmpty) {
      return Center(
        child: Text(
          'No recent activity.',
          style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
        ),
      );
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
          onTapFriend: () => _openFriendProfile(items[i].friend),
        ),
      ),
    );
  }
}

class _RequestRow extends StatelessWidget {
  final Friend friend;
  final String subtitle;
  final Widget trailing;
  final VoidCallback? onTapFriend;

  const _RequestRow({
    required this.friend,
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
          FriendAvatar(friend: friend),
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
  final ActivityItem item;
  final VoidCallback onTapFriend;

  const _ActivityRow({required this.item, required this.onTapFriend});

  String get _verb => switch (item.action) {
    ActivityAction.watched => 'watched',
    ActivityAction.rated => 'rated',
    ActivityAction.addedToWatchLater => 'added to Watch Later',
  };

  @override
  Widget build(BuildContext context) {
    final title = MockData.byId(item.titleId);
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
            child: FriendAvatar(friend: item.friend, size: 40),
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
                        text: item.friend.name,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      TextSpan(text: ' $_verb '),
                      TextSpan(
                        text: title.name,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      if (item.action == ActivityAction.rated &&
                          item.rating != null)
                        TextSpan(text: ' (${item.rating}★)'),
                    ],
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  timeAgo(item.timestamp),
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
                gradient: PosterGradients.of(title.gradientSeed),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
