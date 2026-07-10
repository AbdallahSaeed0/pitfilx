import 'package:flutter/material.dart';
import '../services/app_settings.dart';
import '../theme/app_theme.dart';
import '../utils/reactions.dart';
import 'pitflix_toggle.dart';
import 'star_rating.dart';

/// "Watch" bottom sheet — everything about logging a watch (rating, watch
/// later, reaction, review) lives in here rather than on the page itself.
/// No backend support exists for any of this, so it's session-only.
Future<(int rating, String review, bool watchLater, String? reaction)?>
showReviewSheet(
  BuildContext context, {
  required String titleName,
  int initialRating = 0,
  String initialReview = '',
  bool initialWatchLater = false,
  String? initialReaction,
}) {
  return showModalBottomSheet<(int, String, bool, String?)>(
    context: context,
    backgroundColor: AppColors.bgCard,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) => _ReviewSheet(
      titleName: titleName,
      initialRating: initialRating,
      initialReview: initialReview,
      initialWatchLater: initialWatchLater,
      initialReaction: initialReaction,
    ),
  );
}

class _ReviewSheet extends StatefulWidget {
  final String titleName;
  final int initialRating;
  final String initialReview;
  final bool initialWatchLater;
  final String? initialReaction;

  const _ReviewSheet({
    required this.titleName,
    required this.initialRating,
    required this.initialReview,
    required this.initialWatchLater,
    required this.initialReaction,
  });

  @override
  State<_ReviewSheet> createState() => _ReviewSheetState();
}

class _ReviewSheetState extends State<_ReviewSheet> {
  late int _rating = widget.initialRating;
  late bool _watchLater = widget.initialWatchLater;
  late String? _reaction = widget.initialReaction;
  late final _reviewController = TextEditingController(
    text: widget.initialReview,
  );

  @override
  void dispose() {
    _reviewController.dispose();
    super.dispose();
  }

  void _save() {
    Navigator.of(
      context,
    ).pop((_rating, _reviewController.text.trim(), _watchLater, _reaction));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'RATE & REVIEW',
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
                const SizedBox(height: 20),
                Text('YOUR RATING', style: AppTextStyles.sectionLabel()),
                const SizedBox(height: 10),
                ValueListenableBuilder<int>(
                  valueListenable: AppSettings.ratingScaleMax,
                  builder: (context, max, _) => StarRating(
                    rating: _rating,
                    max: max,
                    size: max > 5 ? 22 : 28,
                    onChanged: (v) => setState(() => _rating = v),
                  ),
                ),
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('WATCH LATER', style: AppTextStyles.sectionLabel()),
                    PitflixToggle(
                      value: _watchLater,
                      onChanged: (v) => setState(() => _watchLater = v),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                Text('REACTION', style: AppTextStyles.sectionLabel()),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final (emoji, label) in kReactions)
                      _ReactionChip(
                        emoji: emoji,
                        label: label,
                        selected: _reaction == label,
                        onTap: () => setState(
                          () => _reaction = _reaction == label ? null : label,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 20),
                Text('YOUR REVIEW', style: AppTextStyles.sectionLabel()),
                const SizedBox(height: 8),
                TextField(
                  controller: _reviewController,
                  maxLines: 4,
                  minLines: 3,
                  style: AppTextStyles.dmSans(fontSize: 13),
                  decoration: InputDecoration(
                    hintText: 'What did you think?',
                    hintStyle: AppTextStyles.dmSans(
                      fontSize: 13,
                      color: AppColors.textMuted,
                    ),
                    filled: true,
                    fillColor: AppColors.avatarBg,
                    contentPadding: const EdgeInsets.all(14),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(
                        color: AppColors.borderInput,
                      ),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(
                        color: AppColors.borderInput,
                      ),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: AppColors.accent),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _save,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.buttonPurple,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      elevation: 0,
                    ),
                    child: Text(
                      'SAVE',
                      style: AppTextStyles.bebas(
                        fontSize: 18,
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
      ),
    );
  }
}

class _ReactionChip extends StatelessWidget {
  final String emoji;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _ReactionChip({
    required this.emoji,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? AppColors.buttonPurple : AppColors.avatarBg,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: selected ? AppColors.buttonPurple : AppColors.borderInput,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(emoji, style: const TextStyle(fontSize: 14)),
            const SizedBox(width: 6),
            Text(
              label,
              style: AppTextStyles.dmSans(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
