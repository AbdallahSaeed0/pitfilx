import 'package:flutter/material.dart';
import '../models/social_activity_item.dart';
import '../models/social_comment.dart';
import '../services/social_service.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../utils/time_ago.dart';
import '../widgets/friend_avatar.dart';
import '../widgets/widgets.dart';

/// Detail view for an activity feed entry — real activity card, like
/// button, and comment thread, all backed by the social schema.
class ActivityDetailScreen extends StatefulWidget {
  final SocialActivityItem item;

  const ActivityDetailScreen({super.key, required this.item});

  @override
  State<ActivityDetailScreen> createState() => _ActivityDetailScreenState();
}

class _ActivityDetailScreenState extends State<ActivityDetailScreen> {
  bool _liked = false;
  int _likeCount = 0;
  bool _likeLoaded = false;

  List<SocialComment>? _comments;
  String? _commentsError;

  final _commentController = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _loadLikeState();
    _loadComments();
  }

  @override
  void dispose() {
    _commentController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadLikeState() async {
    try {
      final state = await SocialService.likeState(widget.item.id);
      if (!mounted) return;
      setState(() {
        _liked = state.likedByMe;
        _likeCount = state.count;
        _likeLoaded = true;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _likeLoaded = true);
    }
  }

  Future<void> _loadComments() async {
    setState(() => _commentsError = null);
    try {
      final comments = await SocialService.fetchComments(widget.item.id);
      if (!mounted) return;
      setState(() => _comments = comments);
    } catch (e) {
      if (!mounted) return;
      setState(() => _commentsError = e.toString());
    }
  }

  Future<void> _toggleLike() async {
    final newLiked = !_liked;
    setState(() {
      _liked = newLiked;
      _likeCount += newLiked ? 1 : -1;
    });
    try {
      await SocialService.toggleLike(widget.item.id, newLiked);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _liked = !newLiked;
        _likeCount += newLiked ? -1 : 1;
      });
    }
  }

  Future<void> _submitComment() async {
    final text = _commentController.text.trim();
    if (text.isEmpty) return;
    _commentController.clear();
    FocusScope.of(context).unfocus();
    try {
      await SocialService.addComment(widget.item.id, text);
      await _loadComments();
      if (!mounted) return;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollController.hasClients) {
          _scrollController.animateTo(
            _scrollController.position.maxScrollExtent,
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeOut,
          );
        }
      });
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't post comment: $e")));
    }
  }

  String get _verb => switch (widget.item.action) {
    SocialActivityAction.watched => 'watched',
    SocialActivityAction.rated => 'rated',
    SocialActivityAction.addedToWatchlist => 'added to Watch Later',
  };

  @override
  Widget build(BuildContext context) {
    final item = widget.item;

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
                        FriendAvatar(profile: item.profile, size: 48),
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
                                      text: item.profile.name,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    TextSpan(text: ' $_verb '),
                                    TextSpan(
                                      text: item.title ?? 'something',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    if (item.action ==
                                            SocialActivityAction.rated &&
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
                                timeAgo(item.createdAt),
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
                                      item.tmdbId % 6,
                                    ),
                                  ),
                                ),
                                if (TmdbService.posterUrl(item.posterPath) !=
                                    null)
                                  Image.network(
                                    TmdbService.posterUrl(item.posterPath)!,
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
                        onTap: _likeLoaded ? _toggleLike : null,
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
                      Text('COMMENTS', style: AppTextStyles.sectionLabel()),
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
                          '${_comments?.length ?? 0}',
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
                  _buildComments(),
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

  Widget _buildComments() {
    if (_commentsError != null) {
      return ErrorRetry(
        message: "Couldn't load comments.\n$_commentsError",
        onRetry: _loadComments,
      );
    }
    final comments = _comments;
    if (comments == null) {
      return const ListRowsSkeleton();
    }
    if (comments.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(
          'No comments yet — be the first!',
          style: AppTextStyles.dmSans(fontSize: 12, color: AppColors.textMuted),
        ),
      );
    }
    return Column(
      children: [
        for (final comment in comments) ...[
          _CommentRow(comment: comment),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}

class _CommentRow extends StatelessWidget {
  final SocialComment comment;

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
            comment.profile.initials,
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
                      comment.profile.name,
                      style: AppTextStyles.dmSans(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      timeAgo(comment.createdAt),
                      style: AppTextStyles.dmSans(
                        fontSize: 10,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  comment.body,
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
