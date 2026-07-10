import 'package:flutter/material.dart';
import '../models/cast_member.dart';
import '../models/episode.dart';
import '../services/app_settings.dart';
import '../services/local_backend_service.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../utils/reactions.dart';
import 'poster_gradients.dart';
import 'star_rating.dart';

/// Bottom sheet opened by tapping an episode row — lets the user rate it,
/// toggle watched, mark it rewatched (more than once), react, and pick a
/// favorite cast member for that episode. Watched status is persisted via
/// the real backend when [Episode.libraryId] is set (title matched in the
/// local library); everything else has no backend support at all yet, so
/// it's session-only regardless.
Future<Episode?> showEpisodeActionsSheet(
  BuildContext context, {
  required Episode episode,
  required String label,
  List<CastMember> cast = const [],
}) {
  return showModalBottomSheet<Episode>(
    context: context,
    backgroundColor: AppColors.bgCard,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) =>
        _EpisodeActionsSheet(episode: episode, label: label, cast: cast),
  );
}

class _EpisodeActionsSheet extends StatefulWidget {
  final Episode episode;
  final String label;
  final List<CastMember> cast;

  const _EpisodeActionsSheet({
    required this.episode,
    required this.label,
    required this.cast,
  });

  @override
  State<_EpisodeActionsSheet> createState() => _EpisodeActionsSheetState();
}

class _EpisodeActionsSheetState extends State<_EpisodeActionsSheet> {
  late bool _watched = widget.episode.watched;
  late int _rewatchCount = widget.episode.rewatchCount;
  late int _rating = widget.episode.rating ?? 0;
  late String? _reaction = widget.episode.reaction;
  late CastMember? _favoritePerson = widget.episode.favoritePerson;
  bool _saving = false;
  String? _error;

  Future<void> _setWatched(bool value) async {
    if (widget.episode.libraryId != null) {
      setState(() {
        _saving = true;
        _error = null;
      });
      try {
        await LocalBackendService.setEpisodeWatchStatus(
          widget.episode.libraryId!,
          value ? 'Completed' : 'Unwatched',
        );
      } catch (e) {
        if (mounted) setState(() => _error = "Couldn't save: $e");
      }
      if (mounted) setState(() => _saving = false);
    }
    if (mounted) setState(() => _watched = value);
  }

  void _markRewatched() {
    setState(() {
      _rewatchCount += 1;
      _watched = true;
    });
  }

  void _done() {
    Navigator.of(context).pop(
      widget.episode.copyWith(
        watched: _watched,
        rating: _rating == 0 ? null : _rating,
        rewatchCount: _rewatchCount,
        reaction: _reaction,
        favoritePerson: _favoritePerson,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(widget.label, style: AppTextStyles.sectionLabel()),
              const SizedBox(height: 4),
              Text(
                widget.episode.title,
                style: AppTextStyles.bebas(fontSize: 20, letterSpacing: 0.08),
              ),
              const SizedBox(height: 22),
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
              const SizedBox(height: 22),
              Row(
                children: [
                  Expanded(
                    child: _SheetActionButton(
                      label: _watched ? 'Watched' : 'Mark Watched',
                      icon: _watched
                          ? Icons.check_circle
                          : Icons.check_circle_outline,
                      active: _watched,
                      loading: _saving,
                      onTap: () => _setWatched(!_watched),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _SheetActionButton(
                      label: _rewatchCount > 0
                          ? 'Rewatched ×$_rewatchCount'
                          : 'Mark Rewatched',
                      icon: Icons.replay,
                      active: _rewatchCount > 0,
                      onTap: _markRewatched,
                    ),
                  ),
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(
                  _error!,
                  style: AppTextStyles.dmSans(
                    fontSize: 11,
                    color: AppColors.destructive,
                  ),
                ),
              ],
              if (widget.episode.libraryId == null) ...[
                const SizedBox(height: 10),
                Text(
                  "This episode isn't matched in your local library yet, so watched status won't sync with the desktop app — only kept for this session, same as rating/rewatch.",
                  style: AppTextStyles.dmSans(
                    fontSize: 11,
                    color: AppColors.textMuted,
                  ),
                ),
              ],
              const SizedBox(height: 22),
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
              if (widget.cast.isNotEmpty) ...[
                const SizedBox(height: 22),
                Text(
                  'FAVORITE PERSON THIS EPISODE',
                  style: AppTextStyles.sectionLabel(),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  height: 152,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: widget.cast.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 12),
                    itemBuilder: (context, i) {
                      final member = widget.cast[i];
                      final selected = _favoritePerson?.name == member.name;
                      final imageUrl = TmdbService.profileUrl(
                        member.profilePath,
                      );
                      return GestureDetector(
                        onTap: () => setState(
                          () => _favoritePerson = selected ? null : member,
                        ),
                        child: SizedBox(
                          width: 96,
                          child: Column(
                            children: [
                              Container(
                                width: 96,
                                height: 120,
                                clipBehavior: Clip.antiAlias,
                                decoration: BoxDecoration(
                                  gradient: PosterGradients.of(
                                    member.gradientSeed,
                                  ),
                                  borderRadius: BorderRadius.circular(12),
                                  border: selected
                                      ? Border.all(
                                          color: AppColors.buttonPurple,
                                          width: 3,
                                        )
                                      : null,
                                ),
                                alignment: Alignment.center,
                                child: imageUrl != null
                                    ? Image.network(
                                        imageUrl,
                                        fit: BoxFit.cover,
                                        width: 96,
                                        height: 120,
                                        errorBuilder:
                                            (context, error, stackTrace) =>
                                                Text(
                                                  member.initials,
                                                  style: AppTextStyles.bebas(
                                                    fontSize: 26,
                                                  ),
                                                ),
                                      )
                                    : Text(
                                        member.initials,
                                        style: AppTextStyles.bebas(
                                          fontSize: 26,
                                        ),
                                      ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                member.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                textAlign: TextAlign.center,
                                style: AppTextStyles.dmSans(
                                  fontSize: 11,
                                  fontWeight: selected
                                      ? FontWeight.w600
                                      : FontWeight.w400,
                                  color: selected
                                      ? AppColors.accent
                                      : Colors.white.withValues(alpha: 0.6),
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
              const SizedBox(height: 22),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _done,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.buttonPurple,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    elevation: 0,
                  ),
                  child: Text(
                    'DONE',
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
    );
  }
}

class _SheetActionButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool active;
  final bool loading;
  final VoidCallback onTap;

  const _SheetActionButton({
    required this.label,
    required this.icon,
    required this.active,
    required this.onTap,
    this.loading = false,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: loading ? null : onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 10),
        decoration: BoxDecoration(
          color: active ? AppColors.buttonPurple : AppColors.avatarBg,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: active ? AppColors.buttonPurple : AppColors.borderInput,
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (loading)
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppColors.textPrimary,
                ),
              )
            else
              Icon(icon, size: 18, color: AppColors.textPrimary),
            const SizedBox(height: 6),
            Text(
              label,
              textAlign: TextAlign.center,
              style: AppTextStyles.dmSans(
                fontSize: 11,
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
