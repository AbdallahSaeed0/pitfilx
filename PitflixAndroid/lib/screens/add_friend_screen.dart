import 'package:flutter/material.dart';
import '../data/mock_friends_data.dart';
import '../models/friend.dart';
import '../services/friends_store.dart';
import '../theme/app_theme.dart';
import '../widgets/friend_avatar.dart';
import '../widgets/widgets.dart';

/// UI-only — see models/friend.dart. Searches a mock directory; "Add" sends
/// the request through [FriendsStore] so it actually shows up as outgoing
/// on the Friends screen (and gets auto-accepted a few seconds later, since
/// there's no real backend/other person to respond).
class AddFriendScreen extends StatefulWidget {
  const AddFriendScreen({super.key});

  @override
  State<AddFriendScreen> createState() => _AddFriendScreenState();
}

class _AddFriendScreenState extends State<AddFriendScreen> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  List<Friend> get _results {
    final query = _controller.text.trim().toLowerCase();
    if (query.isEmpty) return MockFriendsData.directory;
    return MockFriendsData.directory
        .where(
          (f) =>
              f.name.toLowerCase().contains(query) ||
              f.username.toLowerCase().contains(query),
        )
        .toList();
  }

  void _sendRequest(Friend friend) {
    FriendsStore.sendRequest(friend);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Friend request sent to ${friend.name}')),
    );
  }

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
                  Text(
                    'ADD FRIEND',
                    style: AppTextStyles.bebas(
                      fontSize: 22,
                      letterSpacing: 0.1,
                      color: AppColors.logoAccent,
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
              child: Container(
                height: 46,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: AppColors.bgCard,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.borderInput, width: 1.5),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.search,
                      size: 18,
                      color: AppColors.textMuted,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _controller,
                        onChanged: (_) => setState(() {}),
                        style: AppTextStyles.dmSans(
                          fontSize: 15,
                          color: AppColors.textPrimary,
                        ),
                        decoration: const InputDecoration(
                          isDense: true,
                          border: InputBorder.none,
                          hintText: 'Search by name or username',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Expanded(child: _buildBody()),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    final results = _results;
    if (results.isEmpty) {
      return Center(
        child: Text(
          'No one found.',
          style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
        ),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      itemCount: results.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, i) {
        final friend = results[i];
        final isFriend = FriendsStore.isFriend(friend.id);
        final isPending = !isFriend && FriendsStore.isPending(friend.id);

        return Container(
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
                      friend.username,
                      style: AppTextStyles.dmSans(
                        fontSize: 11,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
              if (isFriend)
                Text(
                  'Friends',
                  style: AppTextStyles.dmSans(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textMuted,
                  ),
                )
              else if (isPending)
                Text(
                  'Sent',
                  style: AppTextStyles.dmSans(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textMuted,
                  ),
                )
              else
                GestureDetector(
                  onTap: () => _sendRequest(friend),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.buttonPurple,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'Add',
                      style: AppTextStyles.dmSans(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}
