import 'package:flutter/material.dart';
import '../models/friend.dart';
import '../services/friends_store.dart';
import '../theme/app_theme.dart';
import 'friend_avatar.dart';

/// "Recommend to Friend" bottom sheet — UI-only, see models/friend.dart.
/// Tapping a friend just flips that row to "Sent" for this sheet's lifetime;
/// there's no backend to actually deliver a recommendation to yet.
Future<void> showRecommendFriendSheet(BuildContext context, String titleName) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: AppColors.bgCard,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) => _RecommendFriendSheet(titleName: titleName),
  );
}

class _RecommendFriendSheet extends StatefulWidget {
  final String titleName;

  const _RecommendFriendSheet({required this.titleName});

  @override
  State<_RecommendFriendSheet> createState() => _RecommendFriendSheetState();
}

class _RecommendFriendSheetState extends State<_RecommendFriendSheet> {
  final Set<String> _sentIds = {};

  void _send(Friend friend) {
    setState(() => _sentIds.add(friend.id));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Recommended "${widget.titleName}" to ${friend.name}'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final friends = FriendsStore.friends.value;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.7,
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'RECOMMEND TO FRIEND',
                style: AppTextStyles.bebas(fontSize: 20, letterSpacing: 0.1),
              ),
              const SizedBox(height: 4),
              Text(
                widget.titleName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTextStyles.dmSans(
                  fontSize: 13,
                  color: AppColors.textMuted,
                ),
              ),
              const SizedBox(height: 14),
              if (friends.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 20),
                  child: Text(
                    'No friends yet.',
                    style: AppTextStyles.dmSans(
                      fontSize: 12,
                      color: AppColors.textMuted,
                    ),
                  ),
                )
              else
                Flexible(
                  child: ListView.builder(
                    shrinkWrap: true,
                    itemCount: friends.length,
                    itemBuilder: (context, i) {
                      final friend = friends[i];
                      final sent = _sentIds.contains(friend.id);
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: FriendAvatar(friend: friend, size: 40),
                        title: Text(
                          friend.name,
                          style: AppTextStyles.dmSans(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        subtitle: Text(
                          friend.username,
                          style: AppTextStyles.dmSans(
                            fontSize: 11,
                            color: AppColors.textMuted,
                          ),
                        ),
                        trailing: sent
                            ? const Icon(
                                Icons.check_circle,
                                color: AppColors.accent,
                              )
                            : const Icon(
                                Icons.send_outlined,
                                size: 18,
                                color: AppColors.textMuted,
                              ),
                        onTap: sent ? null : () => _send(friend),
                      );
                    },
                  ),
                ),
              const SizedBox(height: 6),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => Navigator.of(context).pop(),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.buttonPurple,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                    elevation: 0,
                  ),
                  child: Text(
                    'DONE',
                    style: AppTextStyles.bebas(
                      fontSize: 16,
                      color: AppColors.textPrimary,
                      letterSpacing: 0.1,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
