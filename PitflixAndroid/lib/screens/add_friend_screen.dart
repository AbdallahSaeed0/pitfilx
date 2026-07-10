import 'dart:async';
import 'package:flutter/material.dart';
import '../models/social_profile.dart';
import '../services/friends_store.dart';
import '../services/social_service.dart';
import '../theme/app_theme.dart';
import '../widgets/friend_avatar.dart';
import '../widgets/widgets.dart';

/// Real data — searches `profiles` by username. "Add" sends a real
/// `friend_requests` row through [FriendsStore].
class AddFriendScreen extends StatefulWidget {
  const AddFriendScreen({super.key});

  @override
  State<AddFriendScreen> createState() => _AddFriendScreenState();
}

class _AddFriendScreenState extends State<AddFriendScreen> {
  final _controller = TextEditingController();
  Timer? _debounce;
  List<SocialProfile>? _results;
  String? _error;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onQueryChanged() {
    setState(() {});
    _debounce?.cancel();
    final query = _controller.text.trim();
    if (query.isEmpty) {
      setState(() {
        _results = null;
        _error = null;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 400), _runSearch);
  }

  Future<void> _runSearch() async {
    final query = _controller.text.trim();
    if (query.isEmpty) return;
    setState(() => _error = null);
    try {
      final results = await SocialService.searchProfiles(query);
      if (!mounted) return;
      setState(() => _results = results);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  void _sendRequest(SocialProfile profile) {
    FriendsStore.sendRequest(profile);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Friend request sent to ${profile.name}')),
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
                        onChanged: (_) => _onQueryChanged(),
                        style: AppTextStyles.dmSans(
                          fontSize: 15,
                          color: AppColors.textPrimary,
                        ),
                        decoration: const InputDecoration(
                          isDense: true,
                          border: InputBorder.none,
                          hintText: 'Search by username',
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
    final query = _controller.text.trim();
    if (query.isEmpty) {
      return const EmptyState(message: 'Search for a username to add a friend.');
    }
    if (_error != null) {
      return ErrorRetry(message: "Couldn't search: $_error", onRetry: _runSearch);
    }
    final results = _results;
    if (results == null) {
      return const ListRowsSkeleton();
    }
    if (results.isEmpty) {
      return const EmptyState(message: 'No one found.');
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      itemCount: results.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, i) {
        final profile = results[i];
        final isFriend = FriendsStore.isFriend(profile.id);
        final isPending = !isFriend && FriendsStore.isPending(profile.id);

        return Container(
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
                    if (profile.username != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        '@${profile.username}',
                        style: AppTextStyles.dmSans(
                          fontSize: 11,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
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
                  onTap: () => _sendRequest(profile),
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
