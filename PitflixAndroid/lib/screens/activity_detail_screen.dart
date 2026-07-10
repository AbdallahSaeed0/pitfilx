import 'package:flutter/material.dart';
import '../data/mock_data.dart';
import '../models/activity_item.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../utils/time_ago.dart';
import '../widgets/friend_avatar.dart';
import '../widgets/widgets.dart';

/// Mock comment on an activity.
class _Comment {
  final String authorName;
  final String authorInitials;
  final String text;
  final DateTime postedAt;

  const _Comment({
    required this.authorName,
    required this.authorInitials,
    required this.text,
    required this.postedAt,
  });
}

/// Detail view for an activity feed entry — shows the activity card, a
/// like button, and a comment thread. All data is session-only mock.
class ActivityDetailScreen extends StatefulWidget {
  final ActivityItem item;

  const ActivityDetailScreen({super.key, required this.item});

  @override
  State<ActivityDetailScreen> createState() => _ActivityDetailScreenState();
}

class _ActivityDetailScreenState extends State<ActivityDetailScreen> {
  bool _liked = false;
  int _likeCount = 4; // starter mock count

  final _commentController = TextEditingController();
  final _scrollController = ScrollController();

  late final List<_Comment> _comments = [
    _Comment(
      authorName: 'Sarah K.',
      authorInitials: 'SK',
      text: 'Great choice! One of my favourites too 🔥',
      postedAt: DateTime.now().subtract(const Duration(hours: 2)),
    ),
    _Comment(
      authorName: 'Omar T.',
      authorInitials: 'OT',
      text: 'Have you watched the second season yet?',
      postedAt: DateTime.now().subtract(const Duration(minutes: 45)),
    ),
  ];

  @override
  void dispose() {
    _commentController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _toggleLike() {
    setState(() {
      _liked = !_liked;
      _likeCount += _liked ? 1 : -1;
    });
  }

  void _submitComment() {
    final text = _commentController.text.trim();
    if (text.isEmpty) return;
    setState(() {
      _comments.add(
        _Comment(
          authorName: 'You',
          authorInitials: MockData.userInitials,
          text: text,
          postedAt: DateTime.now(),
        ),
      );
    });
    _commentController.clear();
    FocusScope.of(context).unfocus();
    // Scroll to bottom after the frame so the new comment is visible.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  String get _verb => switch (widget.item.action) {
    ActivityAction.watched => 'watched',
    ActivityAction.rated => 'rated',
    ActivityAction.addedToWatchLater => 'added to Watch Later',
  };

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final title = MockData.byId(item.titleId);

    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        child: Column(
          children: [
            // Header
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
                    'ACTIVITY',
                    style: AppTextStyles.bebas(
                      fontSize: 22,
                      letterSpacing: 0.1,
                      color: AppColors.logoAccent,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                controller: _scrollController,
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                children: [
                  // Activity card
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.bgCard,
                      borderRadius: BorderRadius.circular(
                        AppSpacing.cardRadiusMax,
                      ),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        FriendAvatar(friend: item.friend, size: 48),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              RichText(
                                text: TextSpan(
                                  style: AppTextStyles.dmSans(
                                    fontSize: 14,
                                    color: AppColors.textPrimary,
                                  ),
                                  children: [
                                    TextSpan(
                                      text: item.friend.name,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    TextSpan(text: ' $_verb '),
                                    TextSpan(
                                      text: title.name,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    if (item.action == ActivityAction.rated &&
                                        item.rating != null)
                                      TextSpan(
                                        text: ' · ${item.rating}★',
                                        style: TextStyle(
                                          color: AppColors.star,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 6),
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
                        const SizedBox(width: 12),
                        // Poster thumbnail
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: SizedBox(
                            width: 52,
                            height: 74,
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                DecoratedBox(
                                  decoration: BoxDecoration(
                                    gradient: PosterGradients.of(
                                      title.gradientSeed,
                                    ),
                                  ),
                                ),
                                if (TmdbService.posterUrl(title.posterPath) !=
                                    null)
                                  Image.network(
                                    TmdbService.posterUrl(title.posterPath)!,
                                    fit: BoxFit.cover,
                                    errorBuilder: (context, err, st) =>
                                        const SizedBox.shrink(),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Like row
                  Row(
                    children: [
                      GestureDetector(
                        onTap: _toggleLike,
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 10,
                          ),
                          decoration: BoxDecoration(
                            color: _liked
                                ? AppColors.logoAccent.withValues(alpha: 0.15)
                                : AppColors.bgCard,
                            borderRadius: BorderRadius.circular(24),
                            border: Border.all(
                              color: _liked
                                  ? AppColors.logoAccent
                                  : AppColors.borderInput,
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                _liked
                                    ? Icons.favorite_rounded
                                    : Icons.favorite_border_rounded,
                                size: 16,
                                color: _liked
                                    ? AppColors.logoAccent
                                    : AppColors.textMuted,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                '$_likeCount',
                                style: AppTextStyles.dmSans(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                  color: _liked
                                      ? AppColors.logoAccent
                                      : AppColors.textMuted,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),

                  // Comments section
                  Row(
                    children: [
                      Text(
                        'COMMENTS',
                        style: AppTextStyles.sectionLabel(),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 7,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.bgCard,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          '${_comments.length}',
                          style: AppTextStyles.dmSans(
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                            color: AppColors.textMuted,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  for (final comment in _comments) ...[
                    _CommentRow(comment: comment),
                    const SizedBox(height: 10),
                  ],
                  if (_comments.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Text(
                        'No comments yet — be the first!',
                        style: AppTextStyles.dmSans(
                          fontSize: 12,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ),
                ],
              ),
            ),

            // Comment input
            Container(
              decoration: const BoxDecoration(
                color: AppColors.bgCard,
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              padding: EdgeInsets.fromLTRB(
                16,
                10,
                16,
                10 + MediaQuery.of(context).viewInsets.bottom,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _commentController,
                      style: AppTextStyles.dmSans(
                        fontSize: 14,
                        color: AppColors.textPrimary,
                      ),
                      decoration: InputDecoration(
                        hintText: 'Add a comment…',
                        hintStyle: AppTextStyles.dmSans(
                          fontSize: 14,
                          color: AppColors.textMuted,
                        ),
                        border: InputBorder.none,
                        isDense: true,
                        contentPadding: EdgeInsets.zero,
                      ),
                      onSubmitted: (_) => _submitComment(),
                      textInputAction: TextInputAction.send,
                    ),
                  ),
                  const SizedBox(width: 10),
                  GestureDetector(
                    onTap: _submitComment,
                    child: Container(
                      width: 34,
                      height: 34,
                      decoration: const BoxDecoration(
                        color: AppColors.buttonPurple,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.send_rounded,
                        size: 16,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CommentRow extends StatelessWidget {
  final _Comment comment;

  const _CommentRow({required this.comment});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: const BoxDecoration(
            color: AppColors.avatarBg,
            shape: BoxShape.circle,
          ),
          alignment: Alignment.center,
          child: Text(
            comment.authorInitials,
            style: AppTextStyles.bebas(
              fontSize: 13,
              color: AppColors.logoAccent,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: AppColors.bgCard,
              borderRadius: const BorderRadius.only(
                topRight: Radius.circular(12),
                bottomLeft: Radius.circular(12),
                bottomRight: Radius.circular(12),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      comment.authorName,
                      style: AppTextStyles.dmSans(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      timeAgo(comment.postedAt),
                      style: AppTextStyles.dmSans(
                        fontSize: 10,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  comment.text,
                  style: AppTextStyles.dmSans(
                    fontSize: 13,
                    color: Colors.white.withValues(alpha: 0.8),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
